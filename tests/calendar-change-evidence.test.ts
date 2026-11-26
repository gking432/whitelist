import test from "node:test";
import assert from "node:assert/strict";
import { calendarChangeEvidence } from "../lib/business/calendar-change-evidence.ts";
import { executeJourneyCommand } from "../lib/business/customer-journey-commands.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateCalendarReconciliation } from "../lib/scheduling/calendar-reconciliation-rules.ts";
import type { CalendarMutationPayload } from "../lib/scheduling/calendar-mutation-rules.ts";

const now = "2026-11-17T21:00:00Z", version = "2026-11-17T20:00:00.123456Z";
const oldSlot = { start_iso: "2026-11-20T15:00:00Z", end_iso: "2026-11-20T16:00:00Z" };
const newSlot = { start_iso: "2026-11-21T15:00:00Z", end_iso: "2026-11-21T16:00:00Z" };
const payload = { calendar_mutation_version: 1, mutation: "reschedule", booking_approval_id: "booking", booking_action_job_id: "original",
  appointment_id: "appointment", appointment_updated_at: version, contact_id: "customer", contact_updated_at: version,
  provider: "google_workspace", calendar_connection_id: "account", calendar_account_id: "owner@example.test", calendar_id: "primary",
  external_ref: "event", source_record_id: "source", source_updated_at: version, source_etag: '"old"', old_slot: oldSlot, new_slot: newSlot,
  authority_revision: 4, customer_activity_id: null, customer_activity_at: null, conversation_id: null, conversation_revision: null };
const approval = { id: "change", status: "approved", proposed_payload: payload, updated_at: version };
const receipt = { provider: "google_workspace", operation: "reschedule", event_id: "event", http_status: 200, request_id: null,
  event_etag: '"new"', event_updated_at: "2026-11-17T20:30:00Z", verified_at: "2026-11-17T20:31:00Z", verified_absent: false, old_slot: oldSlot, new_slot: newSlot };
const job = { id: "mutation", approval_id: "change", kind: "calendar.reschedule", status: "succeeded", external_ref: "event", provider_receipt: receipt };

test("the owner sees a verified time change while local reconciliation remains separately reviewable", () => {
  const evidence = calendarChangeEvidence([approval], [{ ...job, calendar_reconcile_reason: "The owner edited the local appointment after approval." }], version, now);
  assert.equal(evidence.stages[0].status, "confirmed");
  assert.match(evidence.warnings[0], /result retained/);
  assert.equal(evidence.active, true, "an old-version receipt awaiting reconciliation blocks a duplicate change");
  assert.equal(calendarChangeEvidence([approval], [job], "new-native-version", now).active, false);
});
test("an unrelated, unchanged or ambiguous provider receipt cannot confirm a time change", () => {
  for (const invalid of [
    { ...job, kind: "calendar.cancel" }, { ...job, external_ref: "different-event" },
    { ...job, provider_receipt: { ...receipt, event_etag: '"old"' } },
    { ...job, provider_receipt: { ...receipt, event_etag: 'W/"new"' } },
    { ...job, provider_receipt: { ...receipt, event_updated_at: null } },
    { ...job, provider_receipt: { ...receipt, new_slot: oldSlot } },
    { ...job, provider_receipt: { ...receipt, verified_at: "2027-01-01T00:00:00Z" } },
  ]) assert.equal(calendarChangeEvidence([approval], [invalid], version, now).stages[0].status, "review");
  assert.equal(calendarChangeEvidence([approval], [{ ...job, status: "uncertain" }], version, now).stages[0].status, "review");
  assert.equal(calendarChangeEvidence([approval], [{ ...job, status: "uncertain" }], "manual-new-version", now).active, true, "an uncertain old version still blocks another provider effect");
  assert.equal(calendarChangeEvidence([approval], [{ ...job, status: "provider_pending" }], version, now).stages[0].status, "provider_pending");
});
test("a declined or expired calendar decision permits a fresh review without claiming a calendar change", () => {
  for (const status of ["rejected", "expired"]) {
    const result = calendarChangeEvidence([{ ...approval, status }], [], version, now);
    assert.equal(result.stages[0].status, "cancelled"); assert.equal(result.active, false);
  }
  const expired = calendarChangeEvidence([{ ...approval, status: "pending", expires_at: now }], [], version, now);
  assert.equal(expired.stages[0].status, "review"); assert.equal(expired.active, false);
});
test("lost calendar and rebooking responses replay the exact saved decision before changed live facts", async () => {
  const actor = { partnerId: "tenant", clientId: "business", actorId: "owner", canWrite: true };
  for (const action of ["prepare_cancellation", "prepare_time_change", "qualify_rebooking", "reconcile_calendar_change"] as const) {
    const command = { action, key: "00000000-0000-4000-8000-000000000001", targetId: "00000000-0000-4000-8000-000000000002", expectedRevision: "old-review" };
    const saved = { actor_id: actor.actorId, command: { owner_request: command }, result: { id: "00000000-0000-4000-8000-000000000003", [action === "reconcile_calendar_change" ? "actionJobId" : "bookingApprovalId"]: command.targetId, message: "Saved earlier", replayed: false } };
    const filters: unknown[] = [];
    const query = { select() { return this; }, eq(...args: unknown[]) { filters.push(args); return this; }, async maybeSingle() { return { data: saved, error: null }; } };
    const admin = { from(table: string) { assert.equal(table, "business_owner_commands"); return query; }, rpc() { assert.fail("a committed request must not prepare a second action"); } } as unknown as SupabaseClient;
    assert.equal((await executeJourneyCommand(admin, actor, command)).replayed, true);
    assert.ok(filters.some((row) => JSON.stringify(row) === JSON.stringify(["partner_id", actor.partnerId])));
    await assert.rejects(executeJourneyCommand(admin, { ...actor, actorId: "other-owner" }, command), /different decision/);
    await assert.rejects(executeJourneyCommand(admin, actor, { ...command, expectedRevision: "changed-review" }), /different decision/);
  }
});

test("independently verified source state preserves the uncertain write history and never invents an acknowledgment", () => {
  const id = (end: string) => `00000000-0000-4000-8000-${end.padStart(12, "0")}`;
  const p = { ...payload, booking_approval_id: id("1"), booking_action_job_id: id("2"), appointment_id: id("3"), contact_id: id("4"), calendar_connection_id: id("5"), source_record_id: id("6") } as CalendarMutationPayload;
  const target = { jobId: id("7"), approvalId: id("8"), previousStatus: "uncertain" as const, attemptedAt: "2026-11-17T20:10:00Z", bookingReceiptAt: version, payload: p };
  const observation = { observed_at: "2026-11-17T20:13:00Z", account_id: p.calendar_account_id!, requested_calendar_id: "primary", resolved_calendar_id: "calendar@example.test", calendar_access_role: "owner" as const,
    event_id: p.external_ref, http_status: 200, event: { id: p.external_ref, status: "confirmed", etag: '"source-version"', updated_at: "2026-11-17T20:12:00Z", slot: newSlot, organizer_self: true, recurring: false, attendee_count: 0, event_type: "default" }, tombstone: null, tombstone_complete: false };
  const evidence = evaluateCalendarReconciliation(target, [observation, { ...observation, observed_at: "2026-11-17T20:14:00Z" }], "2026-11-17T20:15:00Z");
  const uncertain = { id: target.jobId, approval_id: target.approvalId, kind: "calendar.reschedule", status: "uncertain", external_ref: null, provider_receipt: null,
    last_attempt_at: target.attemptedAt, calendar_reconciled_at: "2026-11-17T20:16:00Z", calendar_reconciliation: evidence };
  const source = { id: p.booking_action_job_id, kind: "calendar.book", status: "succeeded", receipt_recorded_at: version };
  const changes = [{ ...approval, id: target.approvalId, proposed_payload: p }];
  const result = calendarChangeEvidence(changes, [uncertain, source], "new-native-version", now);
  assert.equal(result.stages[0].status, "confirmed");
  assert.match(result.stages[0].summary, /source state independently verified/);
  assert.match(result.stages[0].summary, /uncertain write result is retained/);
  assert.equal(result.active, false);
  assert.equal(uncertain.status, "uncertain"); assert.equal(uncertain.provider_receipt, null);
  const incomplete = { ...uncertain, calendar_reconciliation: { ...evidence, observations: [observation] } };
  assert.equal(calendarChangeEvidence(changes, [incomplete, source], version, now).active, true);
});
