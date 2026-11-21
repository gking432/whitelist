import { z } from "zod";
import { confirmationContactSuppressed } from "./confirmation-rules.ts";
import { sameBookingVersion } from "./lifecycle-rules.ts";

const identity = z.string().min(1).max(500);
const timestamp = z.string().max(100).refine((v) => /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)), "A timestamp with a time zone is required.");
const slot = z.object({ start_iso: timestamp, end_iso: timestamp });
const etag = z.string().max(1100).regex(/^(?:W\/)?"[\x21\x23-\x7E]+"$/);

export const CalendarMutationPayloadSchema = z.object({
  calendar_mutation_version: z.literal(1), mutation: z.enum(["cancel", "reschedule"]),
  booking_approval_id: identity, booking_action_job_id: identity,
  appointment_id: identity, appointment_updated_at: timestamp,
  contact_id: identity, contact_updated_at: timestamp,
  provider: z.enum(["google_workspace", "google_calendar", "microsoft_365", "northstar_internal"]),
  calendar_connection_id: identity.nullable(), calendar_account_id: identity.nullable(), calendar_id: identity.nullable(),
  external_ref: identity, source_record_id: identity.nullable(), source_updated_at: timestamp,
  source_etag: etag.nullable(), old_slot: slot, new_slot: slot.optional(),
  authority_revision: z.number().int().nonnegative(),
  customer_activity_id: identity.nullable(), customer_activity_at: timestamp.nullable(),
  conversation_id: identity.nullable(), conversation_revision: z.number().int().positive().nullable(),
}).superRefine((value, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  if (value.mutation === "reschedule" && !value.new_slot) fail("A reschedule must pin the new slot.");
  if (value.mutation === "cancel" && value.new_slot) fail("A cancellation cannot include a replacement slot.");
  for (const selected of [value.old_slot, value.new_slot].filter((v) => !!v))
    if (Date.parse(selected!.end_iso) <= Date.parse(selected!.start_iso)) fail("The slot must have a positive duration.");
  if ((value.customer_activity_id === null) !== (value.customer_activity_at === null)) fail("Customer activity identity and version must be pinned together.");
  if ((value.conversation_id === null) !== (value.conversation_revision === null)) fail("Conversation identity and revision must be pinned together.");
  if (value.provider === "northstar_internal") {
    if (value.calendar_connection_id !== null || value.calendar_account_id !== null || value.calendar_id !== null || value.source_record_id !== null || value.source_etag !== null)
      fail("An internal appointment cannot claim an external source account.");
  } else if (!value.calendar_connection_id || !value.calendar_account_id || !value.calendar_id || !value.source_record_id || !value.source_etag) {
    fail("An external mutation requires the exact account, calendar, event and source version.");
  }
});
export type CalendarMutationPayload = z.infer<typeof CalendarMutationPayloadSchema>;
export type CalendarMutationSlot = CalendarMutationPayload["old_slot"];
export type CalendarMutationReceipt = {
  provider: string; operation: "cancel" | "reschedule"; event_id: string;
  http_status: number; request_id: string | null; event_etag: string | null;
  event_updated_at: string | null; verified_at: string; verified_absent: boolean;
  old_slot: CalendarMutationSlot; new_slot: CalendarMutationSlot | null;
};
export const CalendarMutationReceiptSchema = z.object({
  provider: identity, operation: z.enum(["cancel", "reschedule"]), event_id: identity,
  http_status: z.number().int().min(0).max(599), request_id: z.string().max(1000).nullable(),
  event_etag: etag.nullable(), event_updated_at: timestamp.nullable(), verified_at: timestamp,
  verified_absent: z.boolean(), old_slot: slot, new_slot: slot.nullable(),
});

/** Only a committed, verified, exactly linked time change may advance the
 * lifecycle's effective slot/clock. An uncertain result cannot authorize it. */
export function verifiedRescheduleLifecycleState(input: {
  scope: { partnerId: string; clientId: string };
  origin: { bookingApprovalId: string; bookingActionJobId: string; provider: string; calendarConnectionId: string | null; externalRef: string };
  native: { id: string; contactId: string | null; slot: CalendarMutationSlot; stateJobId: string };
  job: { id: string; partner_id: string; client_id: string; approval_id: string | null; kind: string; status: string; external_ref: string | null; provider_receipt: unknown } | null;
  approval: { id: string; partner_id: string; client_id: string; type: string; status: string; proposed_payload: unknown } | null;
  now: string;
}): { stateJobId: string; slot: CalendarMutationSlot; receiptAt: string; calendarAccountId: string | null } | null {
  const { job, approval, native, origin, scope } = input;
  if (!job || !approval || job.id !== native.stateJobId || job.partner_id !== scope.partnerId || job.client_id !== scope.clientId ||
      approval.partner_id !== scope.partnerId || approval.client_id !== scope.clientId || approval.id !== job.approval_id || approval.type !== "appointment_change" ||
      !["approved", "edited_and_approved"].includes(approval.status) || job.kind !== "calendar.reschedule" || job.status !== "succeeded" || job.external_ref !== origin.externalRef) return null;
  const payload = readCalendarMutationPayload(approval.proposed_payload), parsed = CalendarMutationReceiptSchema.safeParse(job.provider_receipt);
  if (!payload || !parsed.success) return null;
  const receipt = parsed.data;
  if (payload.mutation !== "reschedule" || payload.booking_approval_id !== origin.bookingApprovalId || payload.booking_action_job_id !== origin.bookingActionJobId ||
      payload.appointment_id !== native.id || payload.contact_id !== native.contactId || payload.provider !== origin.provider || payload.calendar_connection_id !== origin.calendarConnectionId ||
      payload.external_ref !== origin.externalRef || !payload.new_slot || !sameMutationSlot(payload.new_slot, native.slot) ||
      receipt.provider !== payload.provider || receipt.operation !== "reschedule" || receipt.event_id !== origin.externalRef || receipt.verified_absent ||
      !sameMutationSlot(receipt.old_slot, payload.old_slot) || !receipt.new_slot || !sameMutationSlot(receipt.new_slot, native.slot) ||
      Date.parse(receipt.verified_at) > Date.parse(input.now) || !Number.isFinite(Date.parse(input.now))) return null;
  if (payload.provider === "northstar_internal") {
    if (receipt.http_status !== 0 || receipt.event_etag !== null) return null;
  } else if (!["google_workspace", "google_calendar"].includes(payload.provider) || receipt.http_status !== 200 || !receipt.event_etag ||
      receipt.event_etag === payload.source_etag || !receipt.event_updated_at) return null;
  return { stateJobId: job.id, slot: native.slot, receiptAt: receipt.verified_at, calendarAccountId: payload.calendar_account_id };
}
export function readCalendarMutationPayload(value: unknown): CalendarMutationPayload | null {
  const parsed = CalendarMutationPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export function calendarMutationTimeBlock(payload: CalendarMutationPayload, now: string): string | null {
  const clock = Date.parse(now);
  if (!Number.isFinite(clock) || Date.parse(payload.old_slot.start_iso) <= clock)
    return "The original appointment has started or the current time is unavailable. Review it before changing it.";
  if (payload.new_slot) {
    if (Date.parse(payload.new_slot.start_iso) <= clock) return "Choose a valid future replacement time.";
    if (Date.parse(payload.new_slot.end_iso) - Date.parse(payload.new_slot.start_iso) !== Date.parse(payload.old_slot.end_iso) - Date.parse(payload.old_slot.start_iso))
      return "The replacement time must preserve the approved service duration.";
    if (sameMutationSlot(payload.old_slot, payload.new_slot)) return "Choose a replacement time different from the current appointment.";
  }
  return null;
}
export function sameMutationSlot(left: CalendarMutationSlot, right: CalendarMutationSlot): boolean {
  return sameBookingVersion(left.start_iso, right.start_iso) && sameBookingVersion(left.end_iso, right.end_iso);
}
export type CalendarMutationProposalState = {
  appointment: { id: string; updatedAt: string; contactId: string; status: string; slot: CalendarMutationSlot; externalRef: string } | null;
  contact: { id: string; updatedAt: string; tags: unknown } | null;
  receipt: { id: string; status: string; externalRef: string; recordedAt: string | null } | null;
  connection: { id: string; accountId: string | null; provider: string; status: string; runtimeMode: string; readOnly: boolean } | null;
  source: { id: string; updatedAt: string; etag: string | null; externalRef: string; status: string; deleted: boolean; observedAt: string; slot: CalendarMutationSlot } | null;
  authority: { allowed: boolean; revision: number; reason: string };
  latestInbound: { id: string; at: string } | null;
  humanTakeover: boolean;
};

/** Pure proposal eligibility; the database must recheck these pins on enqueue
 * and immediately before execution. No provider or database calls occur here. */
export function calendarMutationProposalEligibilityBlock(payload: CalendarMutationPayload, current: CalendarMutationProposalState, now: string): string | null {
  const time = calendarMutationTimeBlock(payload, now);
  if (time) return time;
  if (payload.provider === "microsoft_365") return "Microsoft calendar changes require the source app until conditional mutation support has been verified.";
  const native = current.appointment, customer = current.contact, receipt = current.receipt;
  if (!native || native.id !== payload.appointment_id || native.contactId !== payload.contact_id || native.status !== "booked" || native.externalRef !== payload.external_ref ||
      !sameBookingVersion(native.updatedAt, payload.appointment_updated_at) || !sameMutationSlot(native.slot, payload.old_slot))
    return "The exact saved appointment changed. Review its current time and status.";
  if (!customer || customer.id !== payload.contact_id || !sameBookingVersion(customer.updatedAt, payload.contact_updated_at) || !Array.isArray(customer.tags))
    return "The verified customer changed. Review the current customer record.";
  if (confirmationContactSuppressed(customer.tags) || current.humanTakeover) return "The customer is suppressed or under human handling. Review their current instructions.";
  if (!receipt || receipt.id !== payload.booking_action_job_id || receipt.status !== "succeeded" || receipt.externalRef !== payload.external_ref || !receipt.recordedAt)
    return "An immutable successful original booking receipt is required.";
  if (!current.authority.allowed || current.authority.revision !== payload.authority_revision) return current.authority.reason || "Current owner calendar authority changed.";
  if ((current.latestInbound?.id ?? null) !== payload.customer_activity_id || !sameBookingVersion(current.latestInbound?.at ?? null, payload.customer_activity_at))
    return "The customer replied after this decision was prepared. Review their current request.";
  if (payload.provider !== "northstar_internal") {
    const connection = current.connection, source = current.source;
    if (!connection || connection.id !== payload.calendar_connection_id || connection.accountId !== payload.calendar_account_id || connection.provider !== payload.provider ||
        connection.status !== "connected" || connection.runtimeMode !== "live" || connection.readOnly)
      return "The exact calendar account is unavailable, paused or read only.";
    if (!source || source.id !== payload.source_record_id || source.externalRef !== payload.external_ref || source.etag !== payload.source_etag ||
        !sameBookingVersion(source.updatedAt, payload.source_updated_at) || source.deleted || !["booked", "confirmed"].includes(source.status) || !sameMutationSlot(source.slot, payload.old_slot))
      return "The exact calendar source version changed. Refresh and review a new decision.";
    if (!Number.isFinite(Date.parse(source.observedAt)) || Date.parse(source.observedAt) < Date.parse(receipt.recordedAt) || Date.parse(source.observedAt) > Date.parse(now) || Date.parse(now) - Date.parse(source.observedAt) > 45 * 60_000)
      return "Refresh the exact source calendar before proposing a change.";
  }
  return null;
}

export type CalendarMutationEvent = {
  id: string; etag: string | null; updatedAt: string | null; status: string;
  slot: CalendarMutationSlot | null; organizerSelf: boolean; recurring: boolean; attendeeCount: number; eventType: string;
};
export function calendarMutationEventBlock(payload: CalendarMutationPayload, event: CalendarMutationEvent | null): string | null {
  if (!event || event.id !== payload.external_ref || event.status === "cancelled") return "The exact source appointment is missing or already cancelled. Review its current source.";
  if (event.etag !== payload.source_etag || !sameBookingVersion(event.updatedAt, payload.source_updated_at) || !event.slot || !sameMutationSlot(event.slot, payload.old_slot))
    return "The source appointment changed after approval. Prepare a fresh decision.";
  if (!event.organizerSelf || event.recurring || event.attendeeCount !== 0 || event.eventType !== "default")
    return "This shared, recurring or attendee meeting requires a change in the source calendar. No mutation was performed.";
  return null;
}

export type CalendarMutationSession = {
  readEvent(): Promise<CalendarMutationEvent | null>;
  busyForSlot(slot: CalendarMutationSlot): Promise<{ start: string; end: string }[]>;
  write(payload: CalendarMutationPayload): Promise<{ status: number; requestId: string | null }>;
};
