import test from "node:test";
import assert from "node:assert/strict";
import { CalendarMutationPayloadSchema, calendarMutationEventBlock, calendarMutationProposalEligibilityBlock, verifiedRescheduleLifecycleState,
  type CalendarMutationEvent, type CalendarMutationPayload, type CalendarMutationProposalState, type CalendarMutationReceipt } from "../lib/scheduling/calendar-mutation-rules.ts";
import { authorizedActionPayload } from "../lib/jobs/execution-state.ts";
import { evaluateBookingLifecycle, type BookingLifecycleState } from "../lib/scheduling/lifecycle-rules.ts";
import { intakeBookingSourceBlock } from "../lib/scheduling/intake-guard.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

const now = "2026-11-17T12:00:00Z";
function payload(): CalendarMutationPayload {
  return { calendar_mutation_version: 1, mutation: "reschedule", booking_approval_id: "original", booking_action_job_id: "original-job",
    appointment_id: "native", appointment_updated_at: "2026-11-17T10:00:00.123456Z", contact_id: "person", contact_updated_at: "2026-11-17T09:00:00Z",
    provider: "google_workspace", calendar_connection_id: "write-account", calendar_account_id: "google-user", calendar_id: "primary", external_ref: "event-exact",
    source_record_id: "source", source_updated_at: "2026-11-17T10:01:00Z", source_etag: '"old-etag"',
    old_slot: { start_iso: "2026-11-18T12:00:00Z", end_iso: "2026-11-18T13:00:00Z" },
    new_slot: { start_iso: "2026-11-18T12:30:00Z", end_iso: "2026-11-18T13:30:00Z" },
    authority_revision: 7, customer_activity_id: null, customer_activity_at: null, conversation_id: null, conversation_revision: null };
}
function current(p = payload()): CalendarMutationProposalState {
  return { appointment: { id: p.appointment_id, updatedAt: p.appointment_updated_at, contactId: p.contact_id, status: "booked", slot: p.old_slot, externalRef: p.external_ref },
    contact: { id: p.contact_id, updatedAt: p.contact_updated_at, tags: [] }, receipt: { id: p.booking_action_job_id, status: "succeeded", externalRef: p.external_ref, recordedAt: "2026-11-17T10:00:00Z" },
    connection: { id: p.calendar_connection_id!, accountId: p.calendar_account_id, provider: p.provider, status: "connected", runtimeMode: "live", readOnly: false },
    source: { id: p.source_record_id!, updatedAt: p.source_updated_at, etag: p.source_etag, externalRef: p.external_ref, status: "confirmed", deleted: false, observedAt: "2026-11-17T11:59:00Z", slot: p.old_slot },
    authority: { allowed: true, revision: p.authority_revision, reason: "Current policy allows an approved action." }, latestInbound: null, humanTakeover: false };
}
function event(p = payload()): CalendarMutationEvent {
  return { id: p.external_ref, etag: p.source_etag, updatedAt: p.source_updated_at, status: "confirmed", slot: p.old_slot,
    organizerSelf: true, recurring: false, attendeeCount: 0, eventType: "default" };
}
test("mutation schema requires exact bindings, source versions and operation-specific slots", () => {
  assert.equal(CalendarMutationPayloadSchema.safeParse(payload()).success, true);
  for (const patch of [{ calendar_account_id: null }, { calendar_connection_id: null }, { source_etag: "*" }, { source_etag: '"bad\r\nheader"' }, { new_slot: undefined }, { conversation_id: "conversation" }])
    assert.equal(CalendarMutationPayloadSchema.safeParse({ ...payload(), ...patch }).success, false);
  assert.equal(CalendarMutationPayloadSchema.safeParse({ ...payload(), mutation: "cancel" }).success, false);
});
test("pure proposal eligibility detects scope identity, microsecond native versions, readonly, source and authority changes", () => {
  assert.equal(calendarMutationProposalEligibilityBlock(payload(), current(), now), null);
  for (const change of [
    (c: CalendarMutationProposalState) => { c.appointment!.updatedAt = "2026-11-17T10:00:00.123457Z"; },
    (c: CalendarMutationProposalState) => { c.contact!.id = "someone-else"; },
    (c: CalendarMutationProposalState) => { c.connection!.accountId = "another-account"; },
    (c: CalendarMutationProposalState) => { c.connection!.readOnly = true; },
    (c: CalendarMutationProposalState) => { c.source!.etag = '"new-etag"'; },
    (c: CalendarMutationProposalState) => { c.source!.observedAt = "2026-11-17T10:00:00Z"; },
    (c: CalendarMutationProposalState) => { c.authority.revision++; },
    (c: CalendarMutationProposalState) => { c.contact!.tags = ["Do Not Contact"]; },
    (c: CalendarMutationProposalState) => { c.latestInbound = { id: "new-reply", at: "2026-11-17T11:00:00Z" }; },
  ]) { const data = current(); change(data); assert.notEqual(calendarMutationProposalEligibilityBlock(payload(), data, now), null); }
});
test("shared/recurring/customer-attendee events cannot take the bounded mutation path", () => {
  for (const patch of [{ organizerSelf: false }, { recurring: true }, { attendeeCount: 1 }, { eventType: "outOfOffice" }, { etag: '"new-version"' }])
    assert.notEqual(calendarMutationEventBlock(payload(), { ...event(), ...patch }), null);
});
test("retry reconstruction authorizes only the immutable matching appointment change", () => {
  const job = { approval_id: "change", partner_id: "p", client_id: "c", kind: "calendar.reschedule" };
  const approval = { id: "change", partner_id: "p", client_id: "c", status: "approved", type: "appointment_change", resolved_content: null, proposed_payload: payload() as unknown as Record<string, unknown> };
  assert.deepEqual(authorizedActionPayload(job, approval), payload());
  assert.equal(authorizedActionPayload({ ...job, kind: "calendar.cancel" }, approval), null);
  assert.equal(authorizedActionPayload(job, { ...approval, client_id: "foreign" }), null);
  assert.equal(authorizedActionPayload(job, { ...approval, type: "appointment_booking" }), null);
});
test("effective lifecycle state requires a scoped committed verified time change, never an uncertain receipt", () => {
  const p = payload();
  const receipt: CalendarMutationReceipt = { provider: p.provider, operation: "reschedule", event_id: p.external_ref, http_status: 200,
    request_id: "actual-request-header", event_etag: '"new-etag"', event_updated_at: "2026-11-17T11:30:00Z", verified_at: "2026-11-17T11:31:00Z",
    verified_absent: false, old_slot: p.old_slot, new_slot: p.new_slot! };
  const input = { scope: { partnerId: "p", clientId: "c" }, origin: { bookingApprovalId: p.booking_approval_id, bookingActionJobId: p.booking_action_job_id, provider: p.provider, calendarConnectionId: p.calendar_connection_id, externalRef: p.external_ref },
    native: { id: p.appointment_id, contactId: p.contact_id, slot: p.new_slot!, stateJobId: "change-job" },
    job: { id: "change-job", partner_id: "p", client_id: "c", approval_id: "change", kind: "calendar.reschedule", status: "succeeded", external_ref: p.external_ref, provider_receipt: receipt },
    approval: { id: "change", partner_id: "p", client_id: "c", status: "approved", type: "appointment_change", proposed_payload: p }, now };
  assert.equal(verifiedRescheduleLifecycleState(input)?.receiptAt, receipt.verified_at);
  assert.equal(verifiedRescheduleLifecycleState({ ...input, job: { ...input.job, status: "uncertain" } }), null);
  assert.equal(verifiedRescheduleLifecycleState({ ...input, job: { ...input.job, partner_id: "foreign" } }), null);
  assert.equal(verifiedRescheduleLifecycleState({ ...input, job: { ...input.job, provider_receipt: { ...receipt, event_id: "another-event" } } }), null);
  assert.equal(verifiedRescheduleLifecycleState({ ...input, job: { ...input.job, provider_receipt: { ...receipt, http_status: 202 } } }), null);
  assert.equal(verifiedRescheduleLifecycleState({ ...input, native: { ...input.native, slot: p.old_slot } }), null);
});
test("new effective state invalidates an old lifecycle approval even for identical customer records", () => {
  const p = payload(), scope = { partnerId: "p", clientId: "c" };
  const state: BookingLifecycleState = { ...scope, bookingApprovalId: p.booking_approval_id, actionJobId: p.booking_action_job_id, approvalStatus: "approved", receiptStatus: "succeeded",
    externalRef: p.external_ref, receiptAt: "2026-11-17T10:00:00Z", provider: "northstar_internal", calendarConnectionId: null, calendarAccountId: null,
    startAt: p.old_slot.start_iso, endAt: p.old_slot.end_iso, nativeLifecycleEnabledAt: "2026-11-17T09:00:00Z", native: { ...scope, id: p.appointment_id, approvalId: p.booking_approval_id, contactId: p.contact_id,
      updatedAt: p.appointment_updated_at, status: "booked", startAt: p.old_slot.start_iso, endAt: p.old_slot.end_iso, completedAt: null },
    contact: { ...scope, id: p.contact_id, updatedAt: p.contact_updated_at, tags: [] }, delivery: { channel: "email", to: "customer@example.com" }, latestInbound: null,
    conversation: null, otherHumanTakeover: false, cancellationRequested: false, coverageComplete: true, imports: [], authority: { allowed: true, revision: 7, reason: "Allowed" } };
  const original = evaluateBookingLifecycle(state, { kind: "confirmation", now }); assert.equal(original.state, "ready");
  if (original.state !== "ready") return;
  state.stateJobId = "change-job"; state.startAt = p.new_slot!.start_iso; state.endAt = p.new_slot!.end_iso; state.receiptAt = "2026-11-17T11:30:00Z";
  state.native = { ...state.native!, updatedAt: "2026-11-17T11:31:00Z", startAt: state.startAt, endAt: state.endAt };
  assert.equal(evaluateBookingLifecycle(state, { kind: "confirmation", now, pin: original.pin }).state, "blocked");
  const fresh = evaluateBookingLifecycle(state, { kind: "confirmation", now }); assert.equal(fresh.state, "ready");
  if (fresh.state === "ready") assert.equal(fresh.pin.booking_state_job_id, "change-job");
});
test("owner-verified conversation rebooking uses its exact final source check and completed receipt mode", async () => {
  const calls: { name: string; args: unknown }[] = [];
  const admin = { rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { data: { allowed: false, reason: "A new customer reply requires review." }, error: null }; } } as unknown as SupabaseClient;
  const reason = await intakeBookingSourceBlock(admin, { origin: "owner_conversation", customer_rebooking_work_id: "work" }, "original", true);
  assert.match(reason!, /customer reply/);
  assert.deepEqual(calls, [{ name: "customer_rebooking_action_check", args: { p_work: "work", p_approval: "original", p_allow_completed: true } }]);
});
