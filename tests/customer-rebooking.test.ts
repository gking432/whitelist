import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCustomerRebookingCommand, planCustomerRebooking, reviewCustomerRebooking, supabaseCustomerRebookingRepository,
  type CustomerRebookingContext, type QualifyCustomerRebooking } from "../lib/scheduling/customer-rebooking.ts";
import { runIntakeScheduling, type IntakeSchedulingDependencies, type IntakeSchedulingOffer, type IntakeSchedulingWork } from "../lib/agents/inquiry-progression.ts";

const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const version = "2026-11-18T10:00:00.123456Z", now = new Date("2026-11-18T12:00:00Z");
const actor = { partnerId: id(1), clientId: id(2), actorId: id(3), canWrite: true };
const tenant = { partner_id: actor.partnerId, client_id: actor.clientId };
function fixture() {
  const command: QualifyCustomerRebooking = { action: "qualify_rebooking", key: id(4), bookingApprovalId: id(5), expectedAppointmentUpdatedAt: version,
    expectedLeadUpdatedAt: version, expectedContactUpdatedAt: version, sourceRecordId: null, sourceConnectionId: null, externalId: null, expectedSourceUpdatedAt: null,
    conversationId: id(6), expectedConversationRevision: 8, expectedActivityId: id(9), expectedActivityAt: version, expectedAuthorityRevision: 7,
    qualification: { service: "Follow-up visit", preference: "Next week", identityConfirmed: true, bookingRequested: true, instructionsReviewed: true } };
  const context: CustomerRebookingContext = {
    original: { ...tenant, id: id(5), contactId: id(7), leadId: id(8), sourceRecordId: null, sourceConnectionId: null, externalId: null, conversationId: id(6), receipt: "calendar:receipt", outcome: "succeeded" },
    appointment: { ...tenant, approvalId: id(5), contactId: id(7), leadId: id(8), status: "cancelled", updatedAt: version, endAt: "2026-11-17T18:00:00Z", completedAt: null },
    contact: { ...tenant, id: id(7), updatedAt: version, tags: [] }, lead: { ...tenant, id: id(8), contactId: id(7), updatedAt: version, status: "scheduled" },
    conversation: { ...tenant, id: id(6), connectionId: id(10), revision: 8, contactId: id(7), leadId: id(8), identityStatus: "owner_verified", mode: "agent", optedOut: false, state: "open" },
    source: null, activity: { id: id(9), at: version }, customerHandlingBlocked: false, competingAcceptedBooking: false, taskId: id(11),
    authority: { revision: 7, status: "active", channels: { calendar: "require_approval", website: "off", sms: "off", email: "off", instagram: "off" } },
  };
  return { command, context };
}
const offer: IntakeSchedulingOffer = { slots: [{ start_iso: "2026-11-19T16:00:00Z", end_iso: "2026-11-19T17:00:00Z", label: "Thursday at 10 AM" }], timezone: "America/Chicago", provider: "google_workspace", calendar_connection_id: id(20), checked_at: now.toISOString(), expires_at: "2026-11-18T12:15:00Z" };
function work(): IntakeSchedulingWork {
  const { command, context } = fixture(), plan = planCustomerRebooking(actor, command, context, now);
  return { ...tenant, id: id(30), kind: "booking_request", conversation_id: plan.work.conversationId, source_lead_id: plan.work.sourceLeadId,
    approval_id: null, claim_token: id(31), revision: 2, input: plan.work.input, result: {} };
}
function harness(patch: Partial<IntakeSchedulingDependencies> = {}) {
  const calls = { offers: [] as IntakeSchedulingOffer[], proposals: [] as Record<string, unknown>[], finished: [] as { status: string; summary: string; result: Record<string, unknown> }[], checks: 0 };
  const dependencies: IntakeSchedulingDependencies = {
    now: () => now, check: async () => { calls.checks++; return { allowed: true, reason: "Current", contact: { id: id(7), name: "Reviewed customer", email: null, phone: null }, leadId: id(8), taskId: id(11) }; },
    authority: async () => ({ allowed: true, reason: "Current", revision: 7 }), availability: async () => offer, available: async () => true,
    saveOffer: async (_item, saved) => { calls.offers.push(saved); }, propose: async (_item, metadata) => { calls.proposals.push(metadata); },
    outcome: async () => ({ approval: { status: "approved", expires_at: null }, job: { id: id(40), status: "succeeded", external_ref: "new-booking-receipt", attempt_count: 1, outcome_detail: null } }),
    finish: async (_item, status, summary, result) => { calls.finished.push({ status, summary, result }); }, ...patch,
  };
  return { calls, dependencies };
}

test("fresh conversation review queues existing scheduling work with current versions and no copied offer or customer message", () => {
  const { command, context } = fixture(), plan = planCustomerRebooking(actor, command, context, now);
  assert.equal(plan.state, "queued");
  assert.equal(plan.work.kind, "booking_request");
  assert.equal(plan.work.input.origin, "owner_conversation");
  assert.equal(plan.work.conversationId, context.conversation!.id);
  assert.equal(plan.work.input.activity_id, command.expectedActivityId);
  assert.equal(plan.work.input.instructions_reviewed, true);
  assert.equal(plan.work.input.service, command.qualification.service);
  for (const field of ["slot", "offer", "outbound_message", "offered_slots"]) assert.equal(field in plan.work.input, false);
});
test("changed intake source/customer versions can be deliberately reviewed without losing the original exact adoption link", () => {
  const { command, context } = fixture();
  context.original = { ...context.original, sourceRecordId: id(12), sourceConnectionId: id(13), externalId: "stable-form-id", conversationId: null };
  context.conversation = null;
  context.source = { ...tenant, id: id(12), connectionId: id(13), externalId: "stable-form-id", updatedAt: version, nativeLeadId: id(8), linkedContactId: id(7), eligible: true, taskId: id(11) };
  Object.assign(command, { sourceRecordId: id(12), sourceConnectionId: id(13), externalId: "stable-form-id", expectedSourceUpdatedAt: version, conversationId: null, expectedConversationRevision: null });
  const plan = planCustomerRebooking(actor, command, context, now);
  assert.equal(plan.work.input.origin, "owner_intake");
  assert.equal(plan.work.input.source_updated_at, version);
  assert.equal(plan.work.input.rebooking_origin_approval_id, command.bookingApprovalId);
  context.source.nativeLeadId = id(99);
  assert.throws(() => planCustomerRebooking(actor, command, context, now));
});
test("review rejects stale microsecond versions, new cross-channel replies, foreign identities, suppression and human takeover", () => {
  const mutations = [
    (c: CustomerRebookingContext) => { c.contact.updatedAt = "2026-11-18T10:00:00.123457Z"; },
    (c: CustomerRebookingContext) => { c.activity = { id: id(99), at: version }; },
    (c: CustomerRebookingContext) => { c.conversation!.revision++; },
    (c: CustomerRebookingContext) => { c.conversation!.contactId = id(99); },
    (c: CustomerRebookingContext) => { c.lead.client_id = id(99); },
    (c: CustomerRebookingContext) => { c.contact.tags = [" opt  out "]; },
    (c: CustomerRebookingContext) => { c.conversation!.mode = "human"; },
    (c: CustomerRebookingContext) => { c.customerHandlingBlocked = true; },
    (c: CustomerRebookingContext) => { c.competingAcceptedBooking = true; },
    (c: CustomerRebookingContext) => { c.original.receipt = null; },
    (c: CustomerRebookingContext) => { c.appointment.status = "booked"; },
    (c: CustomerRebookingContext) => { c.appointment.status = "completed"; },
  ];
  for (const mutate of mutations) { const { command, context } = fixture(); mutate(context); assert.throws(() => planCustomerRebooking(actor, command, context, now)); }
  const { command, context } = fixture(); context.appointment.status = "completed"; context.appointment.completedAt = "2026-11-18T11:00:00Z";
  assert.equal(planCustomerRebooking(actor, command, context, now).state, "queued");
});
test("each fresh review requires explicit instruction acknowledgement and current authority; no silent permission escalation", () => {
  const { command, context } = fixture();
  for (const field of ["identityConfirmed", "bookingRequested", "instructionsReviewed"]) assert.throws(() => parseCustomerRebookingCommand({ ...command, qualification: { ...command.qualification, [field]: false } }));
  assert.throws(() => parseCustomerRebookingCommand({ ...command, inferredCustomer: true }));
  assert.throws(() => planCustomerRebooking({ ...actor, canWrite: false }, command, context, now));
  context.authority.channels.calendar = "observe";
  const plan = planCustomerRebooking(actor, command, context, now);
  assert.equal(plan.state, "needs_setup"); assert.deepEqual(plan.missing, ["calendar_authority"]);
});
test("owner conversation scheduling saves real offers and prepares provenance on exact explicit selection", async () => {
  const item = work(), first = harness();
  await runIntakeScheduling(item, first.dependencies);
  assert.equal(first.calls.offers.length, 1); assert.equal(first.calls.proposals.length, 0);
  item.result = { offer };
  item.input = { ...item.input, slot: offer.slots[0], selection_index: 1, provider: offer.provider, calendar_connection_id: offer.calendar_connection_id, timezone: offer.timezone };
  const selected = harness(); await runIntakeScheduling(item, selected.dependencies);
  const metadata = selected.calls.proposals[0];
  assert.equal(metadata.origin, "owner_conversation"); assert.equal(metadata.customer_rebooking_work_id, item.id);
  assert.equal(metadata.conversation_id, item.conversation_id); assert.equal(metadata.activity_id, id(9));
  assert.equal("intake_work_id" in metadata, false); assert.equal("outbound_message" in metadata, false);
});
test("new source activity interrupts the scheduling pipeline and accepted outcomes remain receipt-backed", async () => {
  let checks = 0;
  const changed = harness({ check: async () => ({ allowed: ++checks === 1, reason: "New customer reply" }) });
  await runIntakeScheduling(work(), changed.dependencies);
  assert.equal(changed.calls.offers.length, 0); assert.equal(changed.calls.finished[0].status, "blocked");
  const item = work(); item.approval_id = id(40);
  const accepted = harness({ check: async () => { throw new Error("Cannot recreate accepted work"); } });
  await runIntakeScheduling(item, accepted.dependencies);
  assert.equal(accepted.calls.offers.length, 0); assert.equal(accepted.calls.proposals.length, 0);
  assert.equal(accepted.calls.finished[0].result.booked, true);
  assert.match(accepted.calls.finished[0].summary, /original customer conversation/);
});
test("foreign thread and unreviewed scheduling assignments are rejected before dependency calls", async () => {
  for (const change of [(w: IntakeSchedulingWork) => { w.conversation_id = id(99); }, (w: IntakeSchedulingWork) => { w.input.instructions_reviewed = false; }]) {
    const item = work(), h = harness(); change(item); await assert.rejects(runIntakeScheduling(item, h.dependencies)); assert.equal(h.calls.checks, 0);
  }
});
test("rebooking service preserves exact owner request, scopes one atomic RPC and validates receipt identity", async () => {
  const { command } = fixture(), payload = { ...command, owner_request: { action: "qualify_rebooking", key: command.key, targetId: command.bookingApprovalId } };
  const result = { id: id(50), bookingApprovalId: id(5), leadId: id(8), taskId: id(11), workId: id(30), state: "queued", missing: [], message: "Review saved; no booking sent.", replayed: false };
  const calls: unknown[] = [], admin = { async rpc(name: string, args: unknown) { calls.push({ name, args }); return { data: result, error: null }; } } as unknown as SupabaseClient;
  assert.equal((await reviewCustomerRebooking(supabaseCustomerRebookingRepository(admin), actor, payload)).workId, id(30));
  assert.deepEqual(calls, [{ name: "review_customer_rebooking", args: { p_partner: actor.partnerId, p_client: actor.clientId, p_actor: actor.actorId, p_command: payload } }]);
  await assert.rejects(reviewCustomerRebooking({ async apply() { return { ...result, bookingApprovalId: id(99) }; } }, actor, payload));
  const selection = { action: "select_intake_slot", key: id(51), workId: id(30), expectedWorkRevision: 3, slot: 1 };
  await reviewCustomerRebooking(supabaseCustomerRebookingRepository(admin), actor, selection);
  assert.equal((calls[1] as { name: string }).name, "select_customer_rebooking_slot");
});
