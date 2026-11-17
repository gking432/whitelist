import { confirmationContactSuppressed } from "./confirmation-rules.ts";
import { z } from "zod";

export const BOOKING_FOLLOWUP_KINDS = ["confirmation", "reminder", "rebooking"] as const;
export type BookingFollowupKind = (typeof BOOKING_FOLLOWUP_KINDS)[number];
export type BookingSourcePin = {
  provider: string;
  connection_id: string | null;
  external_account_id: string | null;
  external_ref: string;
  canonical_record_id: string | null;
  source_updated_at: string | null;
  source_event_at: string | null;
};
export type BookingLifecyclePin = {
  booking_lifecycle_version: 1;
  booking_followup_kind: BookingFollowupKind;
  booking_approval_id: string;
  booking_action_job_id: string;
  booking_state_job_id?: string | null;
  appointment_id: string;
  appointment_updated_at: string;
  contact_id: string;
  contact_updated_at: string;
  booking_slot: { start_iso: string; end_iso: string };
  booking_source: BookingSourcePin;
  customer_activity_id: string | null;
  customer_activity_at: string | null;
  conversation_id: string | null;
  conversation_revision: number | null;
  authority_revision: number;
  connection_id?: string | null;
  channel: "sms" | "email" | "website_chat" | "instagram";
  to: string;
};
type Scoped = { partnerId: string; clientId: string };
export type LifecycleImport = Scoped & {
  id: string; connectionId: string; externalAccountId: string | null; provider: string;
  externalId: string; externalUpdatedAt: string | null; sourceEventAt: string | null;
  observedAt: string; deleted: boolean; status: string; startAt: string; endAt: string;
  nativeId: string | null;
};
export type BookingLifecycleState = Scoped & {
  bookingApprovalId: string; actionJobId: string; approvalStatus: string; receiptStatus: string;
  stateJobId?: string | null;
  externalRef: string | null; receiptAt: string; provider: string;
  calendarConnectionId: string | null; calendarAccountId: string | null;
  startAt: string; endAt: string; nativeLifecycleEnabledAt: string | null;
  native: (Scoped & { id: string; approvalId: string | null; updatedAt: string; contactId: string | null;
    status: string; startAt: string; endAt: string; completedAt: string | null }) | null;
  contact: (Scoped & { id: string; updatedAt: string; tags: unknown }) | null;
  delivery: { channel: BookingLifecyclePin["channel"]; to: string; connectionId?: string | null } | null;
  latestInbound: { id: string; at: string } | null;
  conversation: { id: string; revision: number; mode: string; optedOut: boolean; state: string } | null;
  otherHumanTakeover: boolean;
  cancellationRequested: boolean;
  coverageComplete: boolean;
  imports: LifecycleImport[];
  authority: { allowed: boolean; reason: string; revision: number };
};
export type BookingLifecycleDecision = {
  state: "ready"; pin: BookingLifecyclePin; expiresAt: string;
} | { state: "waiting" | "blocked" | "not_due"; reason: string; nextDueAt?: string };

const epoch = (value: string | null) => value ? Date.parse(value) : Number.NaN;
function microseconds(value: string): bigint | null {
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/.exec(value);
  if (!match) return null;
  const whole = Date.parse(`${match[1]}${match[3]}`);
  return Number.isFinite(whole) ? BigInt(whole) * BigInt(1000) + BigInt((match[2] ?? "").padEnd(6, "0")) : null;
}
export function sameBookingVersion(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  const a = microseconds(left), b = microseconds(right);
  return a !== null && b !== null && a === b;
}
const sameSlot = (a: { startAt: string; endAt: string }, b: { startAt: string; endAt: string }) =>
  sameBookingVersion(a.startAt, b.startAt) && sameBookingVersion(a.endAt, b.endAt);
const blocked = (reason: string): BookingLifecycleDecision => ({ state: "blocked", reason });
const waiting = (reason: string): BookingLifecycleDecision => ({ state: "waiting", reason });

function pinBlock(pin: BookingLifecyclePin, state: BookingLifecycleState, source: BookingSourcePin, slot: { startAt: string; endAt: string }): string | null {
  if (!state.native || !state.contact || !state.delivery) return "The exact saved appointment, customer or destination is unavailable.";
  if (pin.booking_lifecycle_version !== 1 || pin.booking_approval_id !== state.bookingApprovalId || pin.booking_action_job_id !== state.actionJobId ||
      (pin.booking_state_job_id ?? null) !== (state.stateJobId ?? null) ||
      pin.appointment_id !== state.native?.id || pin.contact_id !== state.contact?.id)
    return "The saved follow-up does not match its original booking and customer.";
  if (!sameBookingVersion(pin.appointment_updated_at, state.native.updatedAt) ||
      !sameBookingVersion(pin.contact_updated_at, state.contact.updatedAt) ||
      !sameSlot({ startAt: pin.booking_slot.start_iso, endAt: pin.booking_slot.end_iso }, slot))
    return "The appointment or customer changed after this follow-up was prepared. Review a fresh proposal.";
  const previous = pin.booking_source;
  if (previous.provider !== source.provider || previous.connection_id !== source.connection_id ||
      previous.external_account_id !== source.external_account_id || previous.external_ref !== source.external_ref ||
      previous.canonical_record_id !== source.canonical_record_id ||
      !sameBookingVersion(previous.source_updated_at, source.source_updated_at) ||
      !sameBookingVersion(previous.source_event_at, source.source_event_at))
    return "The calendar source version changed. Review a fresh follow-up.";
  if (pin.customer_activity_id !== (state.latestInbound?.id ?? null) ||
      !sameBookingVersion(pin.customer_activity_at, state.latestInbound?.at ?? null))
    return "The customer replied after this follow-up was prepared. Review their current request.";
  if (pin.conversation_id !== (state.conversation?.id ?? null) || pin.conversation_revision !== (state.conversation?.revision ?? null))
    return "The customer conversation changed. Review a fresh follow-up.";
  if (pin.authority_revision !== state.authority.revision)
    return "Owner authority changed. Review a fresh follow-up.";
  if (pin.connection_id !== undefined && pin.connection_id !== (state.delivery?.connectionId ?? null)) return "The exact approved delivery account changed. Prepare a fresh follow-up.";
  if (pin.channel !== state.delivery?.channel || pin.to !== state.delivery.to)
    return "The approved customer destination changed. Nothing was sent.";
  return null;
}

/** Deterministic eligibility over exact authorized records; performs no writes. */
export function evaluateBookingLifecycle(state: BookingLifecycleState, options: {
  kind: BookingFollowupKind; now: string; pin?: BookingLifecyclePin; explicitOwnerRequest?: boolean;
}): BookingLifecycleDecision {
  const { kind, now, pin } = options;
  const nowAt = epoch(now);
  if (!Number.isFinite(nowAt)) return blocked("The current time could not be verified.");
  if (!state.coverageComplete) return waiting("Customer or calendar coverage is incomplete. Refresh before preparing a follow-up.");
  if (state.cancellationRequested) return blocked("An owner requested cancellation. Old follow-ups stay stopped until the booking is reviewed.");
  if (!["approved", "edited_and_approved"].includes(state.approvalStatus) || state.receiptStatus !== "succeeded" || !state.externalRef)
    return blocked("A durable successful booking receipt is required. The calendar must not be retried for a follow-up.");
  const native = state.native, contact = state.contact;
  if (!native || !contact || native.partnerId !== state.partnerId || native.clientId !== state.clientId ||
      contact.partnerId !== state.partnerId || contact.clientId !== state.clientId ||
      native.approvalId !== state.bookingApprovalId || native.contactId !== contact.id)
    return blocked("The exact saved appointment and customer identity are unavailable.");
  if (confirmationContactSuppressed(contact.tags)) return blocked("The customer opted out. No follow-up was sent.");
  if (!Array.isArray(contact.tags)) return waiting("Current customer contact preferences are unavailable.");
  if (state.otherHumanTakeover || state.conversation?.mode === "human" || state.conversation?.optedOut || state.conversation?.state === "closed")
    return blocked("An owner is handling this customer or the conversation is closed. Review before another follow-up.");
  if (!state.authority.allowed) return blocked(state.authority.reason);
  if (!state.delivery || !state.delivery.to.trim()) return blocked("A verified customer destination is required.");
  const slot = kind === "rebooking" ? { startAt: native.startAt, endAt: native.endAt } : { startAt: state.startAt, endAt: state.endAt };
  if (![slot.startAt, slot.endAt, native.updatedAt, contact.updatedAt, state.receiptAt].every((v) => Number.isFinite(epoch(v))) || epoch(slot.endAt) <= epoch(slot.startAt))
    return blocked("The appointment time or source versions cannot be verified.");
  if (state.latestInbound && (!Number.isFinite(epoch(state.latestInbound.at)) || epoch(state.latestInbound.at) > epoch(state.receiptAt)))
    return blocked("The customer replied after booking. Review their current request before preparing another follow-up.");
  if (kind === "rebooking") {
    if (!options.explicitOwnerRequest) return blocked("Rebooking requires an explicit owner request. No outreach was enabled.");
    if (native.status !== "completed" || !Number.isFinite(epoch(native.completedAt)) || epoch(native.completedAt) > nowAt || epoch(native.endAt) > nowAt)
      return blocked("Recorded service completion is required before proposing rebooking; elapsed calendar time is insufficient.");
  } else {
    if (native.status !== "booked" || !sameSlot(native, slot)) return blocked("The appointment was cancelled, completed or rescheduled. The old follow-up is stopped.");
    if (epoch(slot.startAt) <= nowAt) return blocked("The appointment time has passed. No reminder or confirmation was sent.");
    if (kind === "reminder") {
      if (!Number.isFinite(epoch(state.nativeLifecycleEnabledAt)) || epoch(state.receiptAt) < epoch(state.nativeLifecycleEnabledAt))
        return blocked("Appointment reminders were not enabled for this booking. Review the lifecycle settings first.");
      const dueAt = epoch(slot.startAt) - 24 * 60 * 60_000;
      if (nowAt < dueAt) return { state: "not_due", reason: "The appointment reminder is not due yet.", nextDueAt: new Date(dueAt).toISOString() };
    }
  }
  let source: BookingSourcePin = {
    provider: state.provider, connection_id: state.calendarConnectionId, external_account_id: state.calendarAccountId,
    external_ref: state.externalRef, canonical_record_id: null, source_updated_at: native.updatedAt, source_event_at: null,
  };
  if (state.provider !== "northstar_internal") {
    if (!state.calendarConnectionId || !state.imports.length) return waiting("Waiting for the booked calendar account to import this exact appointment.");
    const ordered = [...state.imports].sort((a, b) => epoch(b.observedAt) - epoch(a.observedAt));
    const current = pin?.booking_source.canonical_record_id
      ? ordered.find((row) => row.id === pin.booking_source.canonical_record_id) : ordered[0];
    if (!current) return waiting("The calendar source used by this follow-up is unavailable.");
    for (const row of ordered) {
      if (row.partnerId !== state.partnerId || row.clientId !== state.clientId || row.provider !== state.provider || row.externalId !== state.externalRef ||
          (row.connectionId !== state.calendarConnectionId && (!state.calendarAccountId || row.externalAccountId !== state.calendarAccountId)) ||
          (row.nativeId !== null && row.nativeId !== native.id)) return blocked("The calendar source does not match this booking and account.");
      if (row.deleted || ["cancelled", "canceled"].includes(row.status) || !sameSlot(row, slot)) return blocked("The source appointment was cancelled, deleted or rescheduled. Review the current customer request.");
    }
    if (!["booked", "confirmed"].includes(current.status)) return waiting("The source calendar has not confirmed this appointment.");
    if (!Number.isFinite(epoch(current.observedAt)) || epoch(current.observedAt) < epoch(state.receiptAt) || epoch(current.observedAt) > nowAt || nowAt - epoch(current.observedAt) > 45 * 60_000)
      return waiting("The exact calendar source is stale or predates the booking receipt. Refresh it before follow-up.");
    if (!current.externalUpdatedAt && !current.sourceEventAt) return waiting("The calendar source has no usable modification version. Review before follow-up.");
    source = { provider: state.provider, connection_id: state.calendarConnectionId, external_account_id: state.calendarAccountId,
      external_ref: state.externalRef, canonical_record_id: current.id, source_updated_at: current.externalUpdatedAt, source_event_at: current.sourceEventAt };
  }
  if (pin) {
    if (pin.booking_followup_kind !== kind) return blocked("The proposed follow-up kind changed.");
    const reason = pinBlock(pin, state, source, slot);
    if (reason) return blocked(reason);
  }
  return { state: "ready", expiresAt: kind === "rebooking" ? new Date(nowAt + 24 * 60 * 60_000).toISOString() : slot.startAt,
    pin: {
      booking_lifecycle_version: 1, booking_followup_kind: kind, booking_approval_id: state.bookingApprovalId,
      booking_action_job_id: state.actionJobId, appointment_id: native.id, appointment_updated_at: native.updatedAt,
      booking_state_job_id: state.stateJobId ?? null,
      contact_id: contact.id, contact_updated_at: contact.updatedAt, booking_slot: { start_iso: slot.startAt, end_iso: slot.endAt },
      booking_source: source, customer_activity_id: state.latestInbound?.id ?? null, customer_activity_at: state.latestInbound?.at ?? null,
      conversation_id: state.conversation?.id ?? null, conversation_revision: state.conversation?.revision ?? null,
      authority_revision: state.authority.revision, connection_id: state.delivery.connectionId ?? null, channel: state.delivery.channel, to: state.delivery.to,
    } };
}

const textId = z.string().min(1).max(500);
const version = z.string().min(1).max(100);
const Pin = z.object({
  booking_lifecycle_version: z.literal(1), booking_followup_kind: z.enum(BOOKING_FOLLOWUP_KINDS),
  booking_approval_id: textId, booking_action_job_id: textId, appointment_id: textId,
  booking_state_job_id: textId.nullable().optional(),
  appointment_updated_at: version, contact_id: textId, contact_updated_at: version,
  booking_slot: z.object({ start_iso: version, end_iso: version }),
  booking_source: z.object({ provider: textId, connection_id: textId.nullable(), external_account_id: textId.nullable(), external_ref: textId,
    canonical_record_id: textId.nullable(), source_updated_at: version.nullable(), source_event_at: version.nullable() }),
  customer_activity_id: textId.nullable(), customer_activity_at: version.nullable(),
  conversation_id: textId.nullable(), conversation_revision: z.number().int().positive().nullable(),
  authority_revision: z.number().int().nonnegative(), connection_id: textId.nullable().optional(), channel: z.enum(["sms", "email", "website_chat", "instagram"]), to: textId,
});
export function readBookingLifecyclePin(raw: unknown): BookingLifecyclePin | null {
  const result = Pin.safeParse(raw);
  return result.success ? result.data : null;
}

/** Owner controls remain available while automatic work is paused. */
export function planBookingOwnerChange(input: {
  canWrite: boolean; provider: string; nativeUpdatedAt: string; expectedUpdatedAt: string;
  status: string; action: "cancel" | "reschedule"; now: string; newSlot?: { startAt: string; endAt: string };
}): { state: "internal_change" | "external_request" | "blocked"; reason: string } {
  if (!input.canWrite) return { state: "blocked", reason: "Business owner write access is required." };
  if (!sameBookingVersion(input.nativeUpdatedAt, input.expectedUpdatedAt) || !["proposed", "booked"].includes(input.status))
    return { state: "blocked", reason: "The appointment changed. Review its current state before choosing an action." };
  if (input.action === "reschedule" && (!input.newSlot || !Number.isFinite(epoch(input.newSlot.startAt)) ||
      epoch(input.newSlot.startAt) <= epoch(input.now) || epoch(input.newSlot.endAt) <= epoch(input.newSlot.startAt)))
    return { state: "blocked", reason: "Choose a valid future replacement time and recheck availability." };
  return input.provider === "northstar_internal"
    ? { state: "internal_change", reason: "Save the owner-selected change atomically against the current native appointment and availability." }
    : { state: "external_request", reason: "A source-app change is required. Save an owner task and pause old follow-ups; no external cancellation or reschedule has occurred." };
}
