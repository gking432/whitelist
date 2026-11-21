import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseIntakeProgressionCommand, planIntakeQualification, progressIntakeInquiry, supabaseIntakeProgressionRepository,
  reviewedInternalAvailabilityWindows, type IntakeQualificationContext, type QualifyIntakeCommand } from "../lib/connections/intake-progression.ts";
import { intakeBookingOutcome, runIntakeScheduling, type IntakeSchedulingDependencies, type IntakeSchedulingOffer, type IntakeSchedulingWork } from "../lib/agents/inquiry-progression.ts";

const id = (number: number) => `20000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const now = "2026-11-18T12:00:00.000Z", version = "2026-11-18T11:00:00.123456Z";
const actor = { partnerId: id(1), clientId: id(2), actorId: id(3), canWrite: true };
const tenant = { partner_id: actor.partnerId, client_id: actor.clientId };
function qualification() {
  const command: QualifyIntakeCommand = { action: "qualify_intake", key: id(4), connectionId: id(5), recordId: id(6), externalId: "form-source", expectedSourceUpdatedAt: version, expectedLeadUpdatedAt: version, expectedContactUpdatedAt: version, expectedAuthorityRevision: 7,
    qualification: { service: "Consultation", preference: "Next week", identityConfirmed: true, bookingRequested: true } };
  const context: IntakeQualificationContext = {
    source: { ...tenant, id: id(6), connection_id: id(5), object_type: "lead", external_object_id: "form-source", updated_at: version, native_object_id: id(7), canonical_data: { provider: "generic_inbound_webhook", status: "new", description: "Maybe sometime" } },
    connection: { ...tenant, id: id(5), provider_key: "generic_inbound_webhook", status: "connected", runtime_mode: "live", config: { workspace_view_only: true } },
    lead: { ...tenant, id: id(7), contact_id: id(8), updated_at: version, status: "new" }, contact: { ...tenant, id: id(8), updated_at: version, tags: ["source_identity_unverified"] },
    link: { ...tenant, connection_id: id(5), object_type: "lead", external_object_id: "form-source", native_object_id: id(7), metadata: { source_record_id: id(6), contact_id: id(8), task_id: id(9) } },
    authority: { revision: 7, status: "active", channels: { calendar: "require_approval", email: "off", sms: "off", website: "off", instagram: "off" } },
  };
  return { command, context };
}
const offer: IntakeSchedulingOffer = { slots: [{ start_iso: "2026-11-19T16:00:00Z", end_iso: "2026-11-19T17:00:00Z", label: "Thursday at 10 AM" }], timezone: "America/Chicago", provider: "google_workspace", calendar_connection_id: id(20), checked_at: now, expires_at: "2026-11-18T12:15:00.000Z" };
function work(): IntakeSchedulingWork {
  const plan = planIntakeQualification(actor, qualification().command, qualification().context);
  return { ...tenant, id: id(30), kind: "booking_request", conversation_id: null, source_lead_id: id(7), approval_id: null, claim_token: id(31), revision: 2, input: plan.work!.input, result: {} };
}
function selectedWork() {
  const item = work();
  item.result = { phase: "selected_slot", offer };
  item.input = { ...item.input, slot: offer.slots[0], selection_index: 1, provider: offer.provider, calendar_connection_id: offer.calendar_connection_id, timezone: offer.timezone };
  return item;
}
function harness(patch: Partial<IntakeSchedulingDependencies> = {}) {
  const calls = { availability: 0, available: 0, check: 0, authority: 0, offers: [] as IntakeSchedulingOffer[], proposals: [] as Record<string, unknown>[], finished: [] as { status: string; summary: string; result: Record<string, unknown> }[] };
  const dependencies: IntakeSchedulingDependencies = {
    now: () => new Date(now),
    check: async () => { calls.check++; return { allowed: true, reason: "Current", contact: { id: id(8), name: "Owner confirmed customer", email: "customer@example.com", phone: null }, leadId: id(7), taskId: id(9) }; },
    authority: async () => { calls.authority++; return { allowed: true, reason: "Current", revision: 7 }; },
    availability: async () => { calls.availability++; const { expires_at: _expires, ...response } = offer; return response; },
    available: async () => { calls.available++; return true; },
    saveOffer: async (_work, saved) => { calls.offers.push(saved); },
    propose: async (_work, metadata) => { calls.proposals.push(metadata); },
    outcome: async () => ({ approval: { status: "pending", expires_at: null }, job: null }),
    finish: async (_work, status, summary, result) => { calls.finished.push({ status, summary, result }); },
    ...patch,
  };
  return { calls, dependencies };
}

test("owner qualification queues only the existing scheduling work kind with exact adopted source/customer pins", () => {
  const { command, context } = qualification();
  const plan = planIntakeQualification(actor, command, context);
  assert.equal(plan.state, "queued");
  assert.equal(plan.work!.kind, "booking_request");
  assert.equal(plan.work!.sourceLeadId, context.lead.id);
  assert.equal(plan.work!.input.origin, "owner_intake");
  assert.equal(plan.work!.input.intake_record_id, context.source.id);
  assert.equal(plan.work!.input.contact_updated_at, version);
  assert.equal("slot" in plan.work!.input, false);
  assert.equal("conversation_id" in plan.work!.input, false);
});
test("missing explicit qualification waits honestly; form prose cannot infer identity, customer intent or a time", () => {
  const { command, context } = qualification();
  command.qualification = { service: "", preference: "", identityConfirmed: false, bookingRequested: false };
  const plan = planIntakeQualification(actor, command, context);
  assert.equal(plan.state, "needs_details");
  assert.deepEqual(plan.missing, ["service", "identity_confirmation", "appointment_request"]);
  assert.equal(plan.work, null);
  command.qualification = { service: "Consultation", preference: "", identityConfirmed: true, bookingRequested: true };
  context.authority.channels.calendar = "observe";
  assert.equal(planIntakeQualification(actor, command, context).state, "needs_setup");
});
test("qualification rejects foreign/exchanged links, source changes, opt-outs and already scheduled leads", () => {
  for (const mutate of [
    (c: IntakeQualificationContext) => { c.contact.client_id = id(99); },
    (c: IntakeQualificationContext) => { c.source.native_object_id = id(99); },
    (c: IntakeQualificationContext) => { c.link.metadata.contact_id = id(99); },
    (c: IntakeQualificationContext) => { c.source.updated_at = "2026-11-18T11:00:00.123457Z"; },
    (c: IntakeQualificationContext) => { c.contact.tags.push("do-not-contact"); },
    (c: IntakeQualificationContext) => { c.contact.tags.push(" STOP "); },
    (c: IntakeQualificationContext) => { c.contact.tags.push("opt  out"); },
    (c: IntakeQualificationContext) => { c.lead.status = "scheduled"; },
    (c: IntakeQualificationContext) => { c.source.canonical_data = { deleted: true }; },
  ]) { const { command, context } = qualification(); mutate(context); assert.throws(() => planIntakeQualification(actor, command, context)); }
});
test("command service carries exact owner request through one scoped RPC and requires confirmed work on queued results", async () => {
  const { command } = qualification();
  const raw = { ...command, owner_request: { action: "progress_inquiry", key: command.key, service: "Consultation" } };
  assert.deepEqual(parseIntakeProgressionCommand(raw).owner_request, raw.owner_request);
  assert.throws(() => parseIntakeProgressionCommand({ ...raw, bypassPolicy: true }));
  const calls: unknown[] = [];
  const result = { id: id(40), sourceRecordId: id(6), leadId: id(7), taskId: id(9), workId: id(30), state: "queued", missing: [], message: "Availability queued; nothing booked.", replayed: false };
  const admin = { async rpc(name: string, args: unknown) { calls.push({ name, args }); return { data: result, error: null }; } } as unknown as SupabaseClient;
  assert.equal((await progressIntakeInquiry(supabaseIntakeProgressionRepository(admin), actor, raw)).workId, id(30));
  assert.deepEqual(calls, [{ name: "progress_owner_intake_inquiry", args: { p_partner: actor.partnerId, p_client: actor.clientId, p_actor: actor.actorId, p_command: raw } }]);
  await assert.rejects(progressIntakeInquiry({ async apply() { return { ...result, workId: null }; } }, actor, raw));
  await assert.rejects(progressIntakeInquiry({ async apply() { throw new Error("Should not be called"); } }, { ...actor, canWrite: false }, raw));
});
test("scheduler saves only real bounded availability and resumes its saved owner decision without refetching", async () => {
  const { calls, dependencies } = harness(), item = work();
  await runIntakeScheduling(item, dependencies);
  assert.deepEqual(calls.offers, [offer]);
  assert.equal(calls.proposals.length, 0);
  assert.equal(calls.availability, 1);
  item.result = { phase: "choose_slot", offer: calls.offers[0] };
  await runIntakeScheduling(item, dependencies);
  assert.equal(calls.availability, 1);
  assert.equal(calls.finished.at(-1)!.status, "waiting_approval");
});
test("stale customer state or authority interrupts availability before any offer or approval is committed", async () => {
  let checks = 0;
  const changed = harness({ check: async () => ({ allowed: ++checks === 1, reason: "Customer replied" }) });
  await runIntakeScheduling(work(), changed.dependencies);
  assert.equal(changed.calls.offers.length, 0);
  assert.equal(changed.calls.proposals.length, 0);
  assert.equal(changed.calls.finished[0].status, "blocked");
  let permissions = 0;
  const stopped = harness({ authority: async () => ({ allowed: ++permissions === 1, reason: "Owner stopped calendar", revision: 7 }) });
  await runIntakeScheduling(work(), stopped.dependencies);
  assert.equal(stopped.calls.offers.length, 0);
  const lost = harness({ saveOffer: async () => { throw new Error("Claim lost"); } });
  await assert.rejects(runIntakeScheduling(work(), lost.dependencies), /Claim lost/);
  assert.equal(lost.calls.finished.length, 0);
});
test("selected scheduling requires an exact saved offer and rechecks availability/policy before owner booking approval", async () => {
  const { calls, dependencies } = harness();
  await runIntakeScheduling(selectedWork(), dependencies);
  assert.equal(calls.available, 1);
  assert.equal(calls.proposals.length, 1);
  assert.equal(calls.proposals[0].calendar_connection_id, offer.calendar_connection_id);
  assert.equal(calls.proposals[0].intake_work_id, id(30));
  assert.equal(calls.proposals[0].authority_revision, 7);
  assert.equal("agent_work_id" in calls.proposals[0], false);
  const tampered = selectedWork();
  tampered.input.slot = { ...offer.slots[0], start_iso: "2026-11-19T17:00:00Z" };
  const invalid = harness();
  await runIntakeScheduling(tampered, invalid.dependencies);
  assert.equal(invalid.calls.available, 0);
  assert.equal(invalid.calls.proposals.length, 0);
  const unavailable = harness({ available: async () => false });
  await runIntakeScheduling(selectedWork(), unavailable.dependencies);
  assert.equal(unavailable.calls.proposals.length, 0);
  assert.match(unavailable.calls.finished[0].summary, /no longer available/);
});
test("a prepared or uncertain provider action is observed rather than recreated after source/authority changes", async () => {
  const item = selectedWork(); item.approval_id = id(41);
  const existing = harness({ check: async () => { throw new Error("Source should not restart an accepted operation"); }, outcome: async () => ({ approval: { status: "approved", expires_at: null }, job: { id: id(42), status: "succeeded", external_ref: "calendar-event-receipt", outcome_detail: "Booked", attempt_count: 1 } }) });
  await runIntakeScheduling(item, existing.dependencies);
  assert.equal(existing.calls.availability, 0);
  assert.equal(existing.calls.proposals.length, 0);
  assert.equal(existing.calls.finished[0].status, "completed");
  assert.equal(existing.calls.finished[0].result.needs_human_confirmation, true);
  const uncertain = intakeBookingOutcome({ approval: { status: "approved", expires_at: null }, job: { id: id(42), status: "uncertain", external_ref: null, outcome_detail: "Unknown", attempt_count: 1 } }, new Date(now));
  assert.equal(uncertain.status, "blocked");
  assert.equal(uncertain.result.booked, undefined);
  const missingReceipt = intakeBookingOutcome({ approval: { status: "approved", expires_at: null }, job: { id: id(42), status: "succeeded", external_ref: null, outcome_detail: null, attempt_count: 1 } }, new Date(now));
  assert.equal(missingReceipt.status, "blocked");
});
test("calendar failures and expired saved offers produce durable owner next steps without substituted slots", async () => {
  const missingCalendar = harness({ availability: async () => { throw new Error("Private provider error"); } });
  await runIntakeScheduling(work(), missingCalendar.dependencies);
  assert.equal(missingCalendar.calls.offers.length, 0);
  assert.equal(missingCalendar.calls.finished[0].result.phase, "needs_setup");
  assert.equal(missingCalendar.calls.finished[0].summary.includes("Private provider error"), false);
  const expired = work(); expired.result = { offer: { ...offer, checked_at: "2026-11-18T11:00:00Z", expires_at: "2026-11-18T11:15:00Z" } };
  const waiting = harness();
  await runIntakeScheduling(expired, waiting.dependencies);
  assert.equal(waiting.calls.availability, 0);
  assert.equal(waiting.calls.finished[0].result.phase, "needs_availability");
});
test("explicit rebooking starts a fresh offer and nonreceipt states never count as booked", async () => {
  const rebooking = work(); rebooking.input.rebooking_origin_approval_id = id(50);
  const fresh = harness();
  await runIntakeScheduling(rebooking, fresh.dependencies);
  assert.equal(fresh.calls.availability, 1);
  assert.equal(fresh.calls.offers.length, 1);
  for (const status of ["pending", "processing", "provider_pending", "failed", "skipped", "dry_run", "cancelled", "uncertain"]) {
    const result = intakeBookingOutcome({ approval: { status: "approved", expires_at: null }, job: { id: id(42), status, external_ref: null, outcome_detail: null, attempt_count: 1 } }, new Date(now));
    assert.notEqual(result.status, "completed", status);
    assert.equal(result.result.booked, undefined, status);
  }
});
test("internal availability uses saved owner hours as fallback and intersects configured native bounds without default-hour escape", () => {
  const activation = { status: "active" as const, booking_weekdays: [1, 2], booking_start_hour: 9, booking_end_hour: 17, booking_minutes: 30 };
  assert.deepEqual(reviewedInternalAvailabilityWindows([], activation), [
    { weekday: 1, start_time: "09:00", end_time: "17:00", appointment_minutes: 30 },
    { weekday: 2, start_time: "09:00", end_time: "17:00", appointment_minutes: 30 },
  ]);
  assert.deepEqual(reviewedInternalAvailabilityWindows([
    { weekday: 1, start_time: "08:00:00", end_time: "13:00:00", appointment_minutes: 30 },
    { weekday: 3, start_time: "09:00", end_time: "17:00", appointment_minutes: 30 },
  ], activation), [{ weekday: 1, start_time: "09:00", end_time: "13:00", appointment_minutes: 30 }]);
  assert.throws(() => reviewedInternalAvailabilityWindows([{ weekday: 3, start_time: "09:00", end_time: "17:00", appointment_minutes: 30 }], activation), /do not overlap/);
  assert.throws(() => reviewedInternalAvailabilityWindows([{ weekday: 1, start_time: "09:00", end_time: "17:00", appointment_minutes: 60 }], activation), /do not overlap/);
  assert.throws(() => reviewedInternalAvailabilityWindows([], null), /Set business availability/);
  assert.equal(reviewedInternalAvailabilityWindows([{ weekday: 1, start_time: "09:00:00.000001", end_time: "13:00", appointment_minutes: 30 }], activation)[0].start_time, "09:01");
});
