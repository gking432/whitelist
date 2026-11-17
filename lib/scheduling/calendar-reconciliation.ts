import type { SupabaseClient } from "@supabase/supabase-js";
import type { CustomerJourney } from "../business/customer-journey-contract.ts";
import { readCalendarMutationPayload, sameMutationSlot } from "./calendar-mutation-rules.ts";
import { sameBookingVersion } from "./lifecycle-rules.ts";
import {
  calendarReconciliationRevision, evaluateCalendarReconciliation, verifiedCalendarReconciliation,
  type CalendarReconciliationEvidence, type CalendarReconciliationRead, type CalendarReconciliationTarget,
} from "./calendar-reconciliation-rules.ts";
import type { CalendarReconciliationSession } from "../integrations/providers/google-calendar-reconciliation.ts";
import type { WorkspaceCredentials } from "../integrations/providers/workspace-oauth.ts";

type Row = Record<string, unknown>;
type Scope = { partnerId: string; clientId: string };
export type CalendarReconciliationCommand = { action: "reconcile_calendar_change"; key: string; targetId: string; expectedRevision: string; acceptReviewedSource?: true };
export type CalendarReconciliationContext = {
  target: CalendarReconciliationTarget; revision: string; resolved: boolean; readBlock: string | null;
  expectedJobUpdatedAt: string; expectedAppointmentUpdatedAt: string; expectedContactUpdatedAt: string; expectedConnectionUpdatedAt: string | null;
  review: NonNullable<CustomerJourney["reconciliationReview"]>;
};
export class CalendarReconciliationError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}
const text = (value: unknown) => typeof value === "string" ? value : "";
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const validClock = (value: string) => /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const labelledSlot = (start: string, end: string) => {
  if (!validClock(start) || !validClock(end)) return undefined;
  const format = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return { start_iso: start, end_iso: end, label: `${format.format(new Date(start))} – ${format.format(new Date(end))} UTC` };
};

async function loadContext(admin: SupabaseClient, scope: Scope, jobId: string, now: string): Promise<CalendarReconciliationContext | null> {
  const scoped = <Columns extends string>(table: string, columns: Columns) => admin.from(table).select(columns).eq("partner_id", scope.partnerId).eq("client_id", scope.clientId);
  const jobResult = await scoped("action_jobs", "id,approval_id,kind,status,payload,updated_at,last_attempt_at,claimed_at,calendar_reconciliation,calendar_reconciled_at")
    .eq("id", jobId).maybeSingle();
  if (jobResult.error) throw new CalendarReconciliationError("The saved calendar action could not be loaded. No calendar request was repeated.", 503);
  const job: Row = jobResult.data ?? {};
  if (!job.id || !["uncertain", "provider_pending"].includes(text(job.status)) || !["calendar.cancel", "calendar.reschedule"].includes(text(job.kind)) || !uuid.test(text(job.approval_id))) return null;
  const approvalResult = await scoped("approval_items", "id,status,proposed_payload").eq("id", text(job.approval_id)).eq("type", "appointment_change").maybeSingle();
  if (approvalResult.error) throw new CalendarReconciliationError("The exact approved calendar decision could not be loaded.", 503);
  const approval: Row = approvalResult.data ?? {}, payload = readCalendarMutationPayload(approval.proposed_payload);
  if (!approval.id || !["approved", "edited_and_approved"].includes(text(approval.status)) || !payload || job.kind !== `calendar.${payload.mutation}` ||
    calendarReconciliationRevision(job.payload) !== calendarReconciliationRevision(approval.proposed_payload)) return null;
  const [booking, originalReceipt, appointment, contact, connection] = await Promise.all([
    scoped("approval_items", "id,status,proposed_payload").eq("id", payload.booking_approval_id).eq("type", "appointment_booking").maybeSingle(),
    scoped("action_jobs", "id,status,external_ref,receipt_recorded_at").eq("id", payload.booking_action_job_id).eq("approval_id", payload.booking_approval_id).eq("kind", "calendar.book").maybeSingle(),
    scoped("crm_appointments", "id,approval_id,contact_id,external_ref,status,start_at,end_at,updated_at,calendar_state_job_id,calendar_reconciliation_job_id").eq("id", payload.appointment_id).eq("approval_id", payload.booking_approval_id).maybeSingle(),
    scoped("crm_contacts", "id,updated_at").eq("id", payload.contact_id).maybeSingle(),
    payload.calendar_connection_id ? scoped("integration_connections", "id,status,updated_at,external_account_id,external_account_name,provider:integration_providers!inner(provider_key)").eq("id", payload.calendar_connection_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if ([booking, originalReceipt, appointment, contact, connection].some((result) => result.error)) throw new CalendarReconciliationError("The exact booking, customer and source versions could not be checked.", 503);
  const origin: Row = booking.data ?? {}, original: Row = originalReceipt.data ?? {}, native: Row = appointment.data ?? {}, customer: Row = contact.data ?? {}, account: Row = connection.data ?? {};
  if (!origin.id || !["approved", "edited_and_approved"].includes(text(origin.status)) || original.status !== "succeeded" || original.external_ref !== payload.external_ref ||
    object(origin.proposed_payload).provider !== payload.provider || (object(origin.proposed_payload).calendar_connection_id ?? null) !== payload.calendar_connection_id ||
    (object(origin.proposed_payload).contact_id != null && object(origin.proposed_payload).contact_id !== payload.contact_id) || !validClock(text(original.receipt_recorded_at)) || !native.id || !customer.id) return null;
  const attempted = text(job.last_attempt_at) || text(job.claimed_at);
  const target: CalendarReconciliationTarget = { jobId: text(job.id), approvalId: text(approval.id), previousStatus: job.status as "uncertain" | "provider_pending",
    attemptedAt: validClock(attempted) ? attempted : null, bookingReceiptAt: text(original.receipt_recorded_at), payload };
  let readBlock: string | null = null;
  if (!["google_workspace", "google_calendar"].includes(payload.provider)) readBlock = "This saved result needs its supported internal recovery or a review in the source calendar. No external calendar change will be repeated.";
  else if (!account.id || !["connected", "needs_attention"].includes(text(account.status)) || account.external_account_id !== payload.calendar_account_id || object(account.provider).provider_key !== payload.provider)
    readBlock = "The exact connected calendar account is unavailable or changed. Keep the saved result in review.";
  else if (!target.attemptedAt) readBlock = "The saved attempt clock is unavailable. Source absence or a local status cannot verify this calendar result.";
  const revision = calendarReconciliationRevision({ job, approval, origin, original, native, customer, account });
  const current = labelledSlot(text(native.start_at), text(native.end_at));
  const requiresFreshReview = !sameBookingVersion(text(native.updated_at), payload.appointment_updated_at) || native.status !== "booked" || !current || !sameMutationSlot(current, payload.old_slot);
  const finalMatches = native.contact_id === payload.contact_id && native.external_ref === payload.external_ref &&
    (payload.mutation === "cancel" ? native.status === "cancelled" : native.status === "booked" && !!current && !!payload.new_slot && sameMutationSlot(current, payload.new_slot));
  const resolved = native.calendar_reconciliation_job_id === job.id && validClock(text(job.calendar_reconciled_at)) &&
    sameBookingVersion(text(native.updated_at), text(job.calendar_reconciled_at)) && finalMatches && verifiedCalendarReconciliation(target, job.calendar_reconciliation, now);
  return { target, revision, resolved, readBlock, expectedJobUpdatedAt: text(job.updated_at), expectedAppointmentUpdatedAt: text(native.updated_at),
    expectedContactUpdatedAt: text(customer.updated_at), expectedConnectionUpdatedAt: text(account.updated_at) || null,
    review: { jobId, revision, provider: payload.provider, operation: payload.mutation, status: text(job.status),
      current, currentStatus: text(native.status), requiresFreshReview, proposed: payload.new_slot ? labelledSlot(payload.new_slot.start_iso, payload.new_slot.end_iso) ?? null : null,
      detail: readBlock || `Check the exact calendar source using two read-only observations. Calendar account: ${text(account.external_account_name) || payload.calendar_account_id || "unavailable"}; calendar: ${payload.calendar_id || "unavailable"}. This does not repeat or attribute the saved change.`,
      sources: [{ kind: "action_job", id: jobId, revision: text(job.updated_at), href: "/client/action-center" },
        { kind: "approval", id: text(approval.id), href: "/client/approvals" }, { kind: "appointment", id: payload.appointment_id, revision: text(native.updated_at), href: "/client/calendar" },
        ...(payload.calendar_connection_id ? [{ kind: "calendar_account", id: payload.calendar_connection_id, revision: text(account.updated_at), href: "/client/apps" }] : [])] },
  };
}

export async function readCalendarReconciliationReview(admin: SupabaseClient, scope: Scope, jobId: string, now = new Date().toISOString()): Promise<NonNullable<CustomerJourney["reconciliationReview"]> | null> {
  if (!uuid.test(jobId)) return null;
  const context = await loadContext(admin, scope, jobId, now);
  return context && !context.resolved ? context.review : null;
}

/** Only read() is injected: this coordinator has no mutation capability. */
export async function observeCalendarReconciliation(target: CalendarReconciliationTarget, dependencies: {
  session: () => Promise<CalendarReconciliationSession>; now: () => string; readBlock?: string | null;
}): Promise<CalendarReconciliationEvidence> {
  const observations: CalendarReconciliationRead[] = [];
  let reason = dependencies.readBlock || undefined;
  if (!reason && target.attemptedAt && ["google_workspace", "google_calendar"].includes(target.payload.provider)) {
    try {
      const session = await dependencies.session();
      observations.push(await session.read());
      observations.push(await session.read());
    } catch { reason = "The exact calendar could not be read consistently. Keep this saved result in review; no calendar change was repeated."; }
  }
  return evaluateCalendarReconciliation(target, observations, dependencies.now(), reason);
}

export async function reconcileCalendarChange(admin: SupabaseClient, actor: Scope & { actorId: string }, command: CalendarReconciliationCommand, dependencies: {
  now?: () => string;
  load?: typeof loadContext;
  session?: (context: CalendarReconciliationContext) => Promise<CalendarReconciliationSession>;
} = {}) {
  if (command.action !== "reconcile_calendar_change" || !uuid.test(command.key) || !uuid.test(command.targetId) || !command.expectedRevision)
    throw new CalendarReconciliationError("Select the exact saved calendar result before checking its source.", 400);
  const now = dependencies.now ?? (() => new Date().toISOString());
  const context = await (dependencies.load ?? loadContext)(admin, actor, command.targetId, now());
  if (!context || context.resolved || context.revision !== command.expectedRevision) throw new CalendarReconciliationError("The saved action or source versions changed. Refresh and review this result again.");
  if (context.review.requiresFreshReview && (!context.review.current || command.acceptReviewedSource !== true))
    throw new CalendarReconciliationError("Explicitly review the current local appointment and approved source outcome before accepting a changed native record.", 400);
  if (command.acceptReviewedSource !== undefined && (!context.review.requiresFreshReview || command.acceptReviewedSource !== true))
    throw new CalendarReconciliationError("Fresh source acceptance belongs only to the displayed changed appointment review.", 400);
  const evidence = await observeCalendarReconciliation(context.target, { now, readBlock: context.readBlock, session: async () => {
    if (dependencies.session) return dependencies.session(context);
    const payload = context.target.payload;
    if (!payload.calendar_connection_id || !payload.calendar_account_id || !payload.calendar_id || !context.target.attemptedAt || !["google_workspace", "google_calendar"].includes(payload.provider))
      throw new Error("The exact supported source identity is unavailable.");
    const [{ readProviderCredentials }, { createGoogleCalendarReconciliationSession }] = await Promise.all([
      import("../integrations/credentials.ts"), import("../integrations/providers/google-calendar-reconciliation.ts"),
    ]);
    const credentials = await readProviderCredentials<WorkspaceCredentials>(admin, payload.calendar_connection_id);
    if (!credentials) throw new Error("The exact source read credentials are unavailable.");
    return createGoogleCalendarReconciliationSession(credentials, { provider: payload.provider as "google_workspace" | "google_calendar",
      accountId: payload.calendar_account_id, calendarId: payload.calendar_id, eventId: payload.external_ref,
      operation: payload.mutation, attemptedAt: context.target.attemptedAt }, { now });
  } });
  const { data, error } = await admin.rpc("reconcile_calendar_change", { p_partner: actor.partnerId, p_client: actor.clientId, p_actor: actor.actorId,
    p_command: { ...command, owner_request: command, expectedJobUpdatedAt: context.expectedJobUpdatedAt,
      expectedAppointmentUpdatedAt: context.expectedAppointmentUpdatedAt, expectedContactUpdatedAt: context.expectedContactUpdatedAt,
      expectedConnectionUpdatedAt: context.expectedConnectionUpdatedAt, evidence } });
  if (error) throw new CalendarReconciliationError("The source review could not be confirmed as saved. Retry this unchanged request; the calendar change will not be repeated.", 503);
  const receipt = object(data);
  if (!uuid.test(text(receipt.id)) || receipt.actionJobId !== command.targetId || receipt.bookingApprovalId !== context.target.payload.booking_approval_id || !text(receipt.message).trim() || typeof receipt.replayed !== "boolean")
    throw new CalendarReconciliationError("A correlated saved source-review receipt was not confirmed. Retry unchanged without repeating the calendar change.", 503);
  return receipt;
}
