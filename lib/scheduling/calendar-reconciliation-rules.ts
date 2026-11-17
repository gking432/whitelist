import { createHash } from "node:crypto";
import { z } from "zod";
import { sameBookingVersion } from "./lifecycle-rules.ts";
import { readCalendarMutationPayload, sameMutationSlot, type CalendarMutationPayload } from "./calendar-mutation-rules.ts";

const identity = z.string().min(1).max(500);
const timestamp = z.string().max(100).refine((value) => /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)));
const slot = z.object({ start_iso: timestamp, end_iso: timestamp }).strict();
export const CalendarReconciliationEventSchema = z.object({
  id: identity, status: z.string().max(100), etag: z.string().max(1100).nullable(), updated_at: timestamp.nullable(),
  slot: slot.nullable(), organizer_self: z.boolean(), recurring: z.boolean(), attendee_count: z.number().int().nonnegative(), event_type: z.string().max(100),
}).strict();
export const CalendarReconciliationReadSchema = z.object({
  observed_at: timestamp, account_id: identity, requested_calendar_id: identity, resolved_calendar_id: identity,
  calendar_access_role: z.literal("owner"), event_id: identity, http_status: z.number().int().min(100).max(599),
  event: CalendarReconciliationEventSchema.nullable(), tombstone: CalendarReconciliationEventSchema.nullable(), tombstone_complete: z.boolean(),
}).strict();
export const CalendarReconciliationEvidenceSchema = z.object({
  version: z.literal(1), state: z.enum(["source_state_verified", "needs_review"]), previous_status: z.enum(["uncertain", "provider_pending"]),
  action_job_id: z.uuid(), approval_id: z.uuid(), booking_approval_id: z.uuid(), booking_action_job_id: z.uuid(),
  provider: z.enum(["google_workspace", "google_calendar", "microsoft_365", "northstar_internal"]), operation: z.enum(["cancel", "reschedule"]),
  calendar_connection_id: z.uuid().nullable(), calendar_account_id: identity.nullable(), calendar_id: identity.nullable(), external_ref: identity,
  attempted_at: timestamp.nullable(), verified_at: timestamp, old_slot: slot, new_slot: slot.nullable(),
  observations: z.array(CalendarReconciliationReadSchema).max(2), reason: z.string().min(1).max(2000),
}).strict();
export type CalendarReconciliationEvent = z.infer<typeof CalendarReconciliationEventSchema>;
export type CalendarReconciliationRead = z.infer<typeof CalendarReconciliationReadSchema>;
export type CalendarReconciliationEvidence = z.infer<typeof CalendarReconciliationEvidenceSchema>;
export type CalendarReconciliationTarget = {
  jobId: string; approvalId: string; previousStatus: "uncertain" | "provider_pending";
  attemptedAt: string | null; bookingReceiptAt: string | null; payload: CalendarMutationPayload;
};
const strongEtag = (value: string | null) => typeof value === "string" && /^"[\x21\x23-\x7E]+"$/.test(value);
const epoch = (value: string | null) => Date.parse(value ?? "");
export function calendarReconciliationRevision(value: unknown): string {
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable) : item && typeof item === "object"
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, data]) => [key, stable(data)])) : item;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function proofBlock(target: CalendarReconciliationTarget, reads: CalendarReconciliationRead[], now: string): string | null {
  const p = target.payload, clock = epoch(now), attempted = epoch(target.attemptedAt), booked = epoch(target.bookingReceiptAt);
  if (!readCalendarMutationPayload(p) || (p.mutation === "reschedule" && (!p.new_slot || sameMutationSlot(p.old_slot, p.new_slot) ||
    epoch(p.new_slot.end_iso) - epoch(p.new_slot.start_iso) !== epoch(p.old_slot.end_iso) - epoch(p.old_slot.start_iso))))
    return "The immutable approved calendar change does not contain the exact supported source and replacement-time pins.";
  if (!Number.isFinite(clock) || !Number.isFinite(attempted) || !Number.isFinite(booked) || attempted < booked || attempted > clock)
    return "The saved attempt and original booking clocks cannot establish a verified source result.";
  if (!["google_workspace", "google_calendar"].includes(p.provider) || !p.calendar_account_id || !p.calendar_id || !p.calendar_connection_id || !strongEtag(p.source_etag))
    return "This saved action needs review in its source calendar; exact supported account evidence is unavailable.";
  if (reads.length !== 2) return "Two independent, matching source reads are required. A missing event or accepted request alone does not verify the result.";
  const positive: CalendarReconciliationEvent[] = [];
  for (const read of reads) {
    if (!CalendarReconciliationReadSchema.safeParse(read).success || read.account_id !== p.calendar_account_id || read.requested_calendar_id !== p.calendar_id ||
      read.event_id !== p.external_ref || read.calendar_access_role !== "owner" ||
      (p.calendar_id !== "primary" && read.resolved_calendar_id !== p.calendar_id) || read.resolved_calendar_id !== reads[0].resolved_calendar_id)
      return "The source account, owned calendar or exact event does not match this approved action.";
    if (p.provider === "google_calendar" && read.resolved_calendar_id !== p.calendar_account_id)
      return "The legacy primary-calendar identity does not match its original account.";
    const observed = epoch(read.observed_at);
    if (!Number.isFinite(observed) || observed < attempted || observed > clock || clock - observed > 5 * 60_000)
      return "The source observations are stale, future-dated or older than the saved attempt.";
    let event: CalendarReconciliationEvent | null;
    if (p.mutation === "cancel") {
      event = read.http_status === 200 ? read.event : [404, 410].includes(read.http_status) && read.event === null && read.tombstone_complete ? read.tombstone : null;
      if (!event || event.status !== "cancelled") return "Cancellation needs positive exact deleted-event evidence on both reads. Absence alone is insufficient.";
    } else {
      event = read.http_status === 200 ? read.event : null;
      if (!event || event.status !== "confirmed" || !event.slot || !p.new_slot || !sameMutationSlot(event.slot, p.new_slot) ||
        !event.organizer_self || event.recurring || event.attendee_count !== 0 || event.event_type !== "default")
        return "The exact source event does not verify the approved replacement time as a supported owned appointment.";
    }
    if (event.id !== p.external_ref || !strongEtag(event.etag) || event.etag === p.source_etag || !Number.isFinite(epoch(event.updated_at)) ||
      epoch(event.updated_at) < attempted || epoch(event.updated_at) > observed)
      return "The event has no strong changed source version and post-attempt clock for this exact action.";
    positive.push(event);
  }
  if (epoch(reads[1].observed_at) < epoch(reads[0].observed_at) || positive[0].etag !== positive[1].etag ||
    !sameBookingVersion(positive[0].updated_at, positive[1].updated_at) || positive[0].status !== positive[1].status ||
    (p.mutation === "reschedule" && !sameMutationSlot(positive[0].slot!, positive[1].slot!)))
    return "The independent source reads disagree. Keep this action in review before any further calendar change.";
  return null;
}

/** Verifies present source state, never attribution to our uncertain write. */
export function evaluateCalendarReconciliation(target: CalendarReconciliationTarget, observations: CalendarReconciliationRead[], now: string, unavailableReason?: string): CalendarReconciliationEvidence {
  const parsed = observations.map((read) => CalendarReconciliationReadSchema.safeParse(read));
  const valid = parsed.flatMap((read) => read.success ? [read.data] : []);
  const reason = unavailableReason || (valid.length !== observations.length ? "The source returned an incomplete observation. Keep the saved result in review." : proofBlock(target, valid, now));
  const p = target.payload;
  return CalendarReconciliationEvidenceSchema.parse({
    version: 1, state: reason ? "needs_review" : "source_state_verified", previous_status: target.previousStatus,
    action_job_id: target.jobId, approval_id: target.approvalId, booking_approval_id: p.booking_approval_id, booking_action_job_id: p.booking_action_job_id,
    provider: p.provider, operation: p.mutation, calendar_connection_id: p.calendar_connection_id, calendar_account_id: p.calendar_account_id,
    calendar_id: p.calendar_id, external_ref: p.external_ref, attempted_at: target.attemptedAt, verified_at: now,
    old_slot: p.old_slot, new_slot: p.new_slot ?? null, observations: valid, reason: reason || "Two matching reads verify the approved source state. The original uncertain provider result is preserved; this does not attribute the change to our request.",
  });
}
export function verifiedCalendarReconciliation(target: CalendarReconciliationTarget, value: unknown, now = new Date().toISOString()): boolean {
  const parsed = CalendarReconciliationEvidenceSchema.safeParse(value);
  if (!parsed.success || parsed.data.state !== "source_state_verified" || !Number.isFinite(epoch(now)) || epoch(parsed.data.verified_at) > epoch(now)) return false;
  const saved = parsed.data;
  const expected = evaluateCalendarReconciliation(target, saved.observations, saved.verified_at);
  return expected.state === "source_state_verified" && calendarReconciliationRevision({ ...expected, reason: "" }) === calendarReconciliationRevision({ ...saved, reason: "" });
}
