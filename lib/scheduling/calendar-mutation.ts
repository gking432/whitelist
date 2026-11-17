import { googleAccountCanAct } from "../connections/google-permissions.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionJobRecord } from "../jobs/record.ts";
import type { DeliveryOutcome } from "../delivery/customer-message.ts";
import type { WorkspaceCredentials } from "../integrations/providers/workspace-oauth.ts";
import {
  CalendarMutationReceiptSchema, calendarMutationEventBlock, calendarMutationTimeBlock, readCalendarMutationPayload, sameMutationSlot,
  type CalendarMutationPayload, type CalendarMutationReceipt, type CalendarMutationSession, type CalendarMutationSlot,
} from "./calendar-mutation-rules.ts";

export type CalendarMutationOutcome = DeliveryOutcome & { calendarMutationReceipt?: CalendarMutationReceipt };
const stopped = (detail: string): CalendarMutationOutcome => ({ status: "skipped", attempted: false, delivered: false, detail });
const unknown = (): CalendarMutationOutcome => ({ status: "uncertain", attempted: true, delivered: false,
  detail: "The calendar change may have reached the provider, but its final state could not be verified. Reconcile this saved action before trying another change." });

/** Injectable write coordinator. A successful response alone is insufficient:
 * readback must prove the exact event's final state, or the action is uncertain. */
export async function executePinnedCalendarMutation(payload: CalendarMutationPayload, dependencies: {
  check: () => Promise<string | null>;
  session: () => Promise<CalendarMutationSession>;
  now: () => string;
}): Promise<CalendarMutationOutcome> {
  const time = calendarMutationTimeBlock(payload, dependencies.now());
  if (time) return stopped(time);
  if (payload.provider === "microsoft_365") return stopped("Microsoft calendar changes require the source app until conditional mutation support has been verified.");
  if (payload.provider === "northstar_internal") return stopped("An internal calendar change must use its transactional approval handler.");
  let writeStarted = false, writeAcknowledged = false;
  try {
    const initial = await dependencies.check();
    if (initial) return stopped(initial);
    const session = await dependencies.session(); // Token mint and account identity happen before final policy checks.
    const current = await session.readEvent();
    const source = calendarMutationEventBlock(payload, current);
    if (source) return stopped(source);
    if (payload.source_etag?.startsWith("W/")) return stopped("A strong Google event version is required. Refresh this source appointment.");
    if (payload.new_slot) {
      const busy = await session.busyForSlot(payload.new_slot);
      const start = Date.parse(payload.new_slot.start_iso), end = Date.parse(payload.new_slot.end_iso);
      if (busy.some((block) => !Number.isFinite(Date.parse(block.start)) || !Number.isFinite(Date.parse(block.end)) ||
          Date.parse(block.end) <= Date.parse(block.start) || (Date.parse(block.start) < end && Date.parse(block.end) > start)))
        return stopped("The replacement time is no longer free. Request fresh availability; the original appointment is unchanged.");
    }
    const finalTime = calendarMutationTimeBlock(payload, dependencies.now());
    if (finalTime) return stopped(finalTime);
    const final = await dependencies.check();
    if (final) return stopped(final);
    writeStarted = true;
    const result = await session.write(payload);
    writeAcknowledged = true;
    if (result.status === 202) return { status: "provider_pending", attempted: true, delivered: false, externalRef: payload.external_ref,
      detail: "The calendar provider accepted the request. Its final change remains unverified; reconcile this action before another attempt." };
    if (result.status !== (payload.mutation === "cancel" ? 204 : 200)) return unknown();
    const verified = await session.readEvent();
    const absent = verified === null;
    const proved = payload.mutation === "cancel"
      ? absent
      : !!verified && verified.id === payload.external_ref && verified.status === "confirmed" && !!verified.slot &&
        !!verified.etag && verified.etag !== payload.source_etag && !!verified.updatedAt && sameMutationSlot(verified.slot, payload.new_slot!);
    if (!proved) return unknown();
    const receipt: CalendarMutationReceipt = { provider: payload.provider, operation: payload.mutation, event_id: payload.external_ref,
      http_status: result.status, request_id: result.requestId, event_etag: verified?.etag ?? null, event_updated_at: verified?.updatedAt ?? null,
      verified_at: dependencies.now(), verified_absent: absent, old_slot: payload.old_slot, new_slot: payload.new_slot ?? null };
    if (!CalendarMutationReceiptSchema.safeParse(receipt).success || receipt.event_etag?.startsWith("W/")) return unknown();
    return { status: "succeeded", attempted: true, delivered: true, externalRef: payload.external_ref, calendarMutationReceipt: receipt,
      detail: payload.mutation === "cancel" ? "The exact source appointment was cancelled and its result verified." : "The exact source appointment was moved to the approved replacement time and its result verified." };
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : Number.NaN;
    if (writeStarted && (writeAcknowledged || !Number.isFinite(status) || status >= 500 || status === 408)) return unknown();
    if (writeStarted && [404, 409, 410, 412].includes(status)) return { ...stopped("The source appointment changed or the provider rejected its version. Review a fresh decision; this action was not repeated."), attempted: true };
    return { status: "failed", attempted: writeStarted, delivered: false,
      detail: error instanceof Error ? error.message : "The calendar change could not be prepared. Nothing was changed." };
  }
}

async function providerSession(credentials: WorkspaceCredentials, payload: CalendarMutationPayload): Promise<CalendarMutationSession> {
  const binding = { accountId: payload.calendar_account_id!, calendarId: payload.calendar_id!, eventId: payload.external_ref };
  if (payload.provider === "google_workspace") {
    const { createGoogleWorkspaceCalendarMutationSession } = await import("../integrations/providers/google-workspace.ts");
    return createGoogleWorkspaceCalendarMutationSession(credentials, binding);
  }
  if (payload.provider === "google_calendar") {
    const { createLegacyGoogleCalendarMutationSession } = await import("../integrations/providers/google-calendar.ts");
    return createLegacyGoogleCalendarMutationSession(credentials, binding);
  }
  throw new Error("This provider does not support verified conditional calendar changes.");
}

/** Read-only owner offer input. Caller must authorize the scoped source first.
 * The same account/source checks as execution apply; no provider write occurs. */
export async function getCalendarMutationOffer(credentials: WorkspaceCredentials, payload: CalendarMutationPayload, window: CalendarMutationSlot, options: {
  session?: () => Promise<CalendarMutationSession>; now?: () => string;
} = {}) {
  if (credentials.accessMode === "read_only") throw new Error("This account is read only. Use the source calendar to change it.");
  if (!["google_workspace", "google_calendar"].includes(payload.provider)) throw new Error("This provider requires its source app for appointment changes.");
  if (!Number.isFinite(Date.parse(window.start_iso)) || !Number.isFinite(Date.parse(window.end_iso)) || Date.parse(window.end_iso) <= Date.parse(window.start_iso))
    throw new Error("A valid bounded availability window is required.");
  if (Date.parse(window.end_iso) - Date.parse(window.start_iso) > 31 * 86400000) throw new Error("Choose an availability window of at most 31 days.");
  const session = await (options.session ?? (() => providerSession(credentials, payload)))();
  const event = await session.readEvent();
  const reason = calendarMutationEventBlock(payload, event);
  if (reason) throw new Error(reason);
  return { event, busy: await session.busyForSlot(window), observedAt: (options.now ?? (() => new Date().toISOString()))() };
}

export async function executeApprovedCalendarMutation(admin: SupabaseClient, job: ActionJobRecord, beforeWrite?: () => Promise<string | null>): Promise<CalendarMutationOutcome> {
  if (job.payload.scenario_lab === true) return { status: "dry_run", attempted: true, delivered: false,
    detail: "Scenario Lab appointment change recorded as a dry run. No real calendar was contacted or changed." };
  const payload = readCalendarMutationPayload(job.payload);
  if (!payload || job.kind !== `calendar.${payload.mutation}` || !job.approval_id) return stopped("The exact approved calendar change is invalid. Prepare a fresh decision.");
  const check = async () => {
    const { data, error } = await admin.rpc("calendar_mutation_action_check", {
      p_partner: job.partner_id, p_client: job.client_id, p_approval: job.approval_id, p_job: job.id,
    });
    if (error || !data || typeof data.allowed !== "boolean") throw new Error("The current approved appointment change could not be verified.");
    if (!data.allowed) return typeof data.reason === "string" ? data.reason : "The appointment, customer or current owner authority changed.";
    return beforeWrite ? beforeWrite() : null;
  };
  if (payload.provider === "northstar_internal") {
    const initial = await check();
    if (initial) return stopped(initial);
    const time = calendarMutationTimeBlock(payload, new Date().toISOString());
    if (time) return stopped(time);
    const { data, error } = await admin.rpc("apply_internal_calendar_mutation", {
      p_partner: job.partner_id, p_client: job.client_id, p_approval: job.approval_id, p_job: job.id,
    });
    if (error) return { status: "uncertain", attempted: true, delivered: false, detail: "The internal calendar result could not be confirmed. Reconcile the saved action before repeating it." };
    if (!data || data.state !== "succeeded") return stopped(typeof data?.reason === "string" ? data.reason : "The internal appointment changed. Review its current state.");
    const proof = CalendarMutationReceiptSchema.safeParse(data.receipt);
    if (!proof.success || proof.data.provider !== "northstar_internal" || proof.data.operation !== payload.mutation || proof.data.event_id !== payload.external_ref || proof.data.http_status !== 0 ||
        !sameMutationSlot(proof.data.old_slot, payload.old_slot) || (payload.mutation === "reschedule" && (!proof.data.new_slot || !sameMutationSlot(proof.data.new_slot, payload.new_slot!))))
      return { ...unknown(), detail: "The internal change receipt needs reconciliation. Do not repeat the saved action." };
    return { status: "succeeded", attempted: true, delivered: true, externalRef: data.externalRef ?? payload.external_ref,
      calendarMutationReceipt: proof.data, detail: payload.mutation === "cancel" ? "Appointment cancelled in the internal business calendar." : "Appointment moved to the approved replacement time in the internal business calendar." };
  }
  if (payload.provider === "microsoft_365") return stopped("Microsoft calendar changes require the source app until conditional mutation support has been verified.");
  const account = await admin.from("integration_connections").select("id,status,runtime_mode,config,external_account_id,provider:integration_providers!inner(provider_key)")
    .eq("id", payload.calendar_connection_id!).eq("partner_id", job.partner_id).eq("client_id", job.client_id).maybeSingle();
  if (account.error) throw new Error("The exact approved calendar account could not be verified.");
  const provider = (account.data?.provider as unknown as { provider_key?: string } | null)?.provider_key;
  if (!account.data || provider !== payload.provider || account.data.external_account_id !== payload.calendar_account_id || account.data.status !== "connected" ||
      account.data.runtime_mode !== "live" || (account.data.config?.workspace_view_only === true && !(provider === "google_workspace" && googleAccountCanAct(account.data.config, "calendar"))))
    return stopped("The exact approved calendar account is disconnected, paused or read only.");
  const { readProviderCredentials } = await import("../integrations/credentials.ts");
  const credentials = await readProviderCredentials<WorkspaceCredentials>(admin, account.data.id);
  if (!credentials?.refreshToken || credentials.accessMode === "read_only") return stopped("Calendar write authorization is unavailable or read only. Reconnect the approved account.");
  return executePinnedCalendarMutation(payload, { check, session: () => providerSession(credentials, payload), now: () => new Date().toISOString() });
}
