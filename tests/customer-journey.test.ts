import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCustomerJourneys, intakeJourneyRevision, type JourneyEvidence } from "../lib/business/customer-journey-data.ts";
import { executeJourneyCommand, sameJourneyRequest, selectStoredJourneySlot, JourneyCommand } from "../lib/business/customer-journey-commands.ts";
const now = "2026-11-17T15:00:00Z", version = "2026-11-17T13:00:00.123456+00:00";
const lead = { id: "lead", contact_id: "contact", title: "Consultation inquiry", updated_at: version, status: "new" };
const source = { id: "source", object_type: "lead", native_object_id: "lead", updated_at: version, canonical_data: { status: "new" } };
const contact = { id: "contact", first_name: "Sam", email: "sam@example.test", tags: ["source_identity_unverified"], updated_at: version };
const booking = { id: "booking", type: "appointment_booking", status: "approved", proposed_payload: { lead_id: "lead" }, created_at: version };
function evidence(extra: Partial<JourneyEvidence> = {}): JourneyEvidence { return { leads: [lead], contacts: [contact], sources: [source], tasks: [], conversations: [], work: [], approvals: [], jobs: [], appointments: [], importedAppointments: [], authorityRevision: 3, ...extra }; }

test("adopted source/customer work retains exact evidence and requires an explicit qualified scheduling decision", () => {
  const [journey] = buildCustomerJourneys(evidence({ tasks: [{ id: "review", task_type: "intake_review", lead_id: "lead", updated_at: version }] }), true, now);
  assert.equal(journey.customer.identity, "unverified");
  assert.equal(journey.revision, intakeJourneyRevision(source, lead, contact, 3));
  assert.equal(journey.nextAction?.kind === "command" && journey.nextAction.command, "progress_inquiry");
  assert.ok(journey.stages.flatMap((stage) => stage.sources).some((item) => item.kind === "task" && item.id === "review"));
  assert.ok(!journey.stages.some((stage) => stage.key === "booking"));
});
test("approval, pending provider result and a verified receipt remain distinct", () => {
  for (const [job, expected] of [[null, "queued"], [{ id: "job", approval_id: "booking", kind: "calendar.book", status: "provider_pending" }, "provider_pending"], [{ id: "job", approval_id: "booking", kind: "calendar.book", status: "succeeded", external_ref: "event" }, "confirmed"]] as const) {
    const [journey] = buildCustomerJourneys(evidence({ approvals: [booking], jobs: job ? [job] : [] }), true, now);
    assert.equal(journey.stages.find((item) => item.key === "booking")?.status, expected);
  }
  const [emptyReceipt] = buildCustomerJourneys(evidence({ approvals: [booking], jobs: [{ approval_id: "booking", kind: "calendar.book", status: "succeeded" }] }), true, now);
  assert.notEqual(emptyReceipt.stages.find((item) => item.key === "booking")?.status, "confirmed");
});
test("cancellation requests stop unsent followups without claiming an external cancellation result", () => {
  const [journey] = buildCustomerJourneys(evidence({ approvals: [booking, { id: "reminder", type: "customer_message", status: "approved", proposed_payload: { booking_approval_id: "booking", booking_followup_kind: "reminder" } }],
    jobs: [{ id: "job", approval_id: "booking", kind: "calendar.book", status: "succeeded", external_ref: "event" }],
    appointments: [{ id: "appointment", approval_id: "booking", status: "booked", updated_at: version }],
    tasks: [{ id: "request", task_type: "booking_cancellation_request", lead_id: "lead", booking_approval_id: "booking", status: "open" }],
  }), true, now);
  assert.equal(journey.stages.find((item) => item.key === "cancellation")?.status, "requested");
  assert.equal(journey.stages.find((item) => item.key === "booking")?.status, "confirmed");
  assert.equal(journey.stages.find((item) => item.key === "reminder")?.status, "cancelled");
});
test("a prior cancellation task cannot cancel a later appointment for the same lead", () => {
  const [journey] = buildCustomerJourneys(evidence({ approvals: [booking], jobs: [{ approval_id: "booking", kind: "calendar.book", status: "succeeded", external_ref: "event" }],
    appointments: [{ id: "appointment", approval_id: "booking", status: "booked", updated_at: version }], tasks: [{ task_type: "booking_cancellation_request", lead_id: "lead", booking_approval_id: "old-booking", status: "open" }] }), true, now);
  assert.ok(!journey.stages.some((item) => item.key === "cancellation"));
  assert.ok(journey.actions?.some((item) => item.kind === "command" && item.command === "request_cancellation"));
});
test("a changed appointment needs review while past delivery receipts remain confirmed", () => {
  const [journey] = buildCustomerJourneys(evidence({ approvals: [booking, { id: "confirmation", status: "approved", proposed_payload: { booking_approval_id: "booking", booking_followup_kind: "confirmation" } }],
    jobs: [{ approval_id: "booking", kind: "calendar.book", status: "succeeded", external_ref: "event" }, { approval_id: "confirmation", kind: "email.send", status: "succeeded", external_ref: "message" }],
    appointments: [{ id: "appointment", approval_id: "booking", status: "booked", start_at: "2026-11-18T10:00:00Z", end_at: "2026-11-18T11:00:00Z" }],
    importedAppointments: [{ native_object_id: "appointment", canonical_data: { status: "confirmed", start_at: "2026-11-18T12:00:00Z", end_at: "2026-11-18T13:00:00Z" } }],
  }), true, now);
  assert.equal(journey.stages.find((item) => item.key === "booking")?.status, "review");
  assert.equal(journey.stages.find((item) => item.key === "confirmation")?.status, "confirmed");
  const cancelled = evidence({ approvals: [booking], jobs: [{ approval_id: "booking", kind: "calendar.book", status: "succeeded", external_ref: "event" }],
    appointments: [{ id: "appointment", approval_id: "booking", status: "booked", updated_at: version }],
    importedAppointments: [{ native_object_id: "appointment", canonical_data: { deleted: true } }] });
  assert.ok(buildCustomerJourneys(cancelled, true, now)[0].actions?.some((action) => action.kind === "command" && action.command === "prepare_rebooking"));
});
test("only the exact customer's scheduling offer becomes a selection decision", () => {
  const [journey] = buildCustomerJourneys(evidence({ work: [{ id: "wrong", source_lead_id: "other", kind: "booking_request", result: { offer: { slots: [1] } } }, { id: "work", source_lead_id: "lead", kind: "booking_request", status: "waiting_approval", revision: 4, result: { offer: { slots: [1] } } }] }), true, now);
  assert.equal(journey.nextAction?.kind === "command" && journey.nextAction.targetId, "work");
  assert.equal(buildCustomerJourneys(evidence(), false, now)[0].actions?.length, 0);
});
test("selected conversation lineage survives newer threads and ambiguous source links require review", () => {
  const [thread] = buildCustomerJourneys(evidence({ selectedConversationId: "original-thread", conversations: [
    { id: "original-thread", lead_id: "lead", contact_id: "contact", created_at: "2026-11-16T10:00:00Z" },
    { id: "new-thread", lead_id: "lead", contact_id: "contact", created_at: now },
  ] }), true, now);
  assert.equal(thread.conversationId, "original-thread");
  const [ambiguous] = buildCustomerJourneys(evidence({ sources: [source, { ...source, id: "another-source" }] }), true, now);
  assert.ok(ambiguous.warnings.some((warning) => warning.includes("More than one")));
  assert.ok(!ambiguous.actions?.some((action) => action.kind === "command" && action.command === "progress_inquiry"));
});
test("a mutable recovery timestamp cannot make historical bookings eligible for reminders", () => {
  const state = evidence({ approvals: [booking], appointments: [{ id: "appointment", approval_id: "booking", status: "booked", updated_at: version }],
    jobs: [{ id: "job", approval_id: "booking", kind: "calendar.book", status: "succeeded", external_ref: "event", receipt_recorded_at: "2026-11-17T10:00:00Z", updated_at: now }],
    lifecycleEnabledAt: "2026-11-17T11:00:00Z" });
  assert.ok(!buildCustomerJourneys(state, true, now)[0].actions?.some((action) => action.kind === "command" && action.command === "prepare_reminder"));
  state.lifecycleEnabledAt = "2026-11-17T09:00:00Z";
  assert.ok(buildCustomerJourneys(state, true, now)[0].actions?.some((action) => action.kind === "command" && action.command === "prepare_reminder"));
});
test("stored offered slots expire at the boundary and cannot be replaced by browser times or labels", () => {
  const slot = { start_iso: "2026-11-18T09:00:00-06:00", end_iso: "2026-11-18T10:00:00-06:00", label: "Nov 18, 9 AM Central" };
  const offer = { expires_at: "2026-11-17T15:15:00Z", slots: [slot] };
  assert.equal(selectStoredJourneySlot(offer, slot, now), 1);
  assert.throws(() => selectStoredJourneySlot(offer, slot, offer.expires_at), /expired/);
  assert.throws(() => selectStoredJourneySlot(offer, { ...slot, label: "Another time" }, now), /exact/);
});
test("idempotent owner request comparison tolerates JSONB key order while rejecting altered decisions", () => {
  assert.equal(sameJourneyRequest({ key: "same", qualification: { service: "Consult", identityConfirmed: true } }, { qualification: { identityConfirmed: true, service: "Consult" }, key: "same" }), true);
  assert.equal(sameJourneyRequest({ selected: 1 }, { selected: 2 }), false);
  assert.equal(JourneyCommand.safeParse({ action: "progress_inquiry", key: "bad", targetId: "bad", expectedRevision: "anything", clientId: "forged" }).success, false);
});

const targetId = "4bfb598d-5c6f-4bc2-b124-83b90f24206c", key = "7173a013-c44c-4ac0-a6d7-7a993c3659e1";
const actor = { partnerId: "partner", clientId: "client", actorId: "owner", canWrite: true };
function replayRepository(command: unknown, result: Record<string, unknown>, actorId = actor.actorId) {
  const filters: [string, unknown][] = [];
  const admin = { from(table: string) {
    assert.equal(table, "business_owner_commands", "a lost-response retry must replay before reading changed work or source");
    const query = { select() { return query; }, eq(field: string, value: unknown) { filters.push([field, value]); return query; },
      async maybeSingle() { return { data: { actor_id: actorId, command: { owner_request: command }, result }, error: null }; } };
    return query;
  }, rpc() { assert.fail("a saved result must not repeat its mutation"); } } as unknown as SupabaseClient;
  return { admin, filters };
}
test("a lost selection response replays before removed work and retains server tenant/actor scope", async () => {
  const command = { action: "select_intake_slot", key, targetId, expectedRevision: "4", offerId: targetId,
    slot: { start_iso: "2026-11-18T15:00:00Z", end_iso: "2026-11-18T16:00:00Z", label: "9 AM Central" } };
  const { admin, filters } = replayRepository(command, { id: key, message: "Selection saved.", replayed: false, workId: targetId });
  const saved = await executeJourneyCommand(admin, actor, command);
  assert.equal(saved.replayed, true);
  assert.ok(filters.some(([field, value]) => field === "partner_id" && value === actor.partnerId));
  assert.ok(filters.some(([field, value]) => field === "client_id" && value === actor.clientId));
});
test("saved request receipts reject another actor, a changed customer target and uncorrelated success", async () => {
  const command = { action: "progress_inquiry", key, targetId, expectedRevision: "source|lead|contact|3",
    qualification: { service: "Consultation", identityConfirmed: true, bookingRequested: true } };
  const result = { id: key, message: "Scheduling saved.", replayed: false, leadId: targetId };
  await assert.rejects(executeJourneyCommand(replayRepository(command, result, "another-owner").admin, actor, command), /different decision/);
  await assert.rejects(executeJourneyCommand(replayRepository({ ...command, targetId: key }, result).admin, actor, command), /different decision/);
  await assert.rejects(executeJourneyCommand(replayRepository(command, { ...result, leadId: key }).admin, actor, command), /did not confirm/);
});
