import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adoptIntake, IntakeAdoptionError, parseIntakeAdoptionCommand, planIntakeAdoption,
  sameIntakeRevision, supabaseIntakeAdoptionRepository,
  type IntakeAdoptionActor, type IntakeAdoptionCommand, type IntakeAdoptionConnection,
  type IntakeAdoptionRepository, type IntakeAdoptionResult, type IntakeAdoptionSource,
} from "../lib/connections/intake-adoption.ts";

const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const version = "2026-11-18T12:00:00.123456Z";
const actor: IntakeAdoptionActor = { partnerId: uuid(1), clientId: uuid(2), actorId: uuid(3), canWrite: true };
const command: IntakeAdoptionCommand = { action: "adopt_intake", key: uuid(4), connectionId: uuid(5), recordId: uuid(6), externalId: "form-source-12", expectedUpdatedAt: version, contact: { mode: "create" } };
const tenant = { partner_id: actor.partnerId, client_id: actor.clientId };
function fixture() {
  const source: IntakeAdoptionSource = { ...tenant, id: command.recordId, connection_id: command.connectionId, object_type: "lead", external_object_id: command.externalId, updated_at: version, native_object_id: null,
    canonical_data: { provider: "generic_inbound_webhook", status: "new", title: "Service question", name: "Submitted Person", email: "person@example.com", phone: "+15551234567", description: "Can you help with this request?" } };
  const connection: IntakeAdoptionConnection = { ...tenant, id: command.connectionId, provider_key: "generic_inbound_webhook", status: "connected", runtime_mode: "live", config: { workspace_view_only: true } };
  return { actor, command: structuredClone(command), source, connection };
}
const saved = (patch: Partial<IntakeAdoptionResult> = {}): IntakeAdoptionResult => ({ id: uuid(10), connectionId: command.connectionId, sourceRecordId: command.recordId, sourceUpdatedAt: version, contactId: uuid(11), leadId: uuid(12), taskId: uuid(13), createdContact: true, replayed: false, message: "Inquiry adopted for human review. Nothing was sent.", ...patch });
const status = (code: number) => (error: unknown) => error instanceof IntakeAdoptionError && error.status === code;

test("strict adoption requires exact source identity/version and an explicit create or existing contact choice", () => {
  assert.deepEqual(parseIntakeAdoptionCommand(command), command);
  for (const extra of [{ partnerId: uuid(99) }, { actorId: uuid(99) }, { runAgent: true }]) assert.throws(() => parseIntakeAdoptionCommand({ ...command, ...extra }), status(400));
  assert.throws(() => parseIntakeAdoptionCommand({ ...command, contact: {} }), status(400));
  assert.throws(() => parseIntakeAdoptionCommand({ ...command, contact: { mode: "existing", id: uuid(20) } }), status(400));
  assert.throws(() => parseIntakeAdoptionCommand({ ...command, externalId: "" }), status(400));
  assert.throws(() => parseIntakeAdoptionCommand({ ...command, expectedUpdatedAt: "2026-11-18T12:00:00.1234567Z" }), status(400));
});

test("new contact adoption preserves unverified source facts and creates only shared lead/human review work", () => {
  const input = fixture();
  const plan = planIntakeAdoption({ ...input, contact: { ...tenant, id: uuid(30), updated_at: version } });
  assert.equal(plan.contact.mode, "create");
  assert.deepEqual(plan.contact, { mode: "create", firstName: "Submitted Person", lastName: null, email: "person@example.com", phone: "+15551234567", source: "owner_intake_unverified", tags: ["source_identity_unverified"] });
  assert.equal(plan.source.externalId, command.externalId);
  assert.equal(plan.source.recordId, command.recordId);
  assert.equal(plan.lead.status, "new");
  assert.equal(plan.task.status, "open");
  assert.equal(plan.task.taskType, "intake_review");
  assert.equal(plan.actorId, actor.actorId);
  assert.equal("agentWork" in plan, false);
  assert.equal("send" in plan, false);
  input.source.canonical_data = { status: "new", title: "Anonymous question" };
  const unidentified = planIntakeAdoption(input).contact;
  assert.equal(unidentified.mode, "create");
  if (unidentified.mode === "create") assert.equal(unidentified.firstName, "Unidentified inquiry");
  input.source.canonical_data = { status: "new", title: `Inquiry from ${"x".repeat(200)}` };
  assert.equal(planIntakeAdoption(input).lead.title.length, 200);
});

test("existing contact is linked only by explicit scoped ID/version and its identity is never overwritten from a form", () => {
  const input = fixture(), contact = { ...tenant, id: uuid(30), updated_at: version };
  input.command.contact = { mode: "existing", id: contact.id, expectedUpdatedAt: version };
  const plan = planIntakeAdoption({ ...input, contact });
  assert.deepEqual(plan.contact, { mode: "existing", id: contact.id, updatedAt: version });
  assert.throws(() => planIntakeAdoption({ ...input, contact: { ...contact, client_id: uuid(99) } }), status(404));
  assert.throws(() => planIntakeAdoption({ ...input, contact: { ...contact, id: uuid(99) } }), status(404));
  assert.throws(() => planIntakeAdoption({ ...input, contact: { ...contact, updated_at: "2026-11-18T12:00:00.123457Z" } }), status(409));
});

test("source, account and record type boundaries reject cross-business, wrong-account and unstable identity claims", () => {
  const patches: Partial<IntakeAdoptionSource>[] = [{ partner_id: uuid(99) }, { client_id: uuid(99) }, { connection_id: uuid(99) }, { id: uuid(99) }, { external_object_id: "another-source" }, { object_type: "invoice" }];
  for (const patch of patches) {
    const input = fixture();
    assert.throws(() => planIntakeAdoption({ ...input, source: { ...input.source, ...patch } }), status(404));
  }
  const input = fixture();
  for (const patch of [{ client_id: uuid(99) }, { provider_key: "stripe" }, { id: uuid(99) }]) assert.throws(() => planIntakeAdoption({ ...input, connection: { ...input.connection, ...patch } }), status(404));
  assert.throws(() => planIntakeAdoption({ ...input, actor: { ...actor, canWrite: false } }), status(403));
});

test("paused/disconnected/failing sources, deletions, changed revisions and prior adoptions fail closed", () => {
  for (const patch of [{ status: "not_connected" }, { status: "needs_attention" }, { runtime_mode: "paused" }, { config: { workspace_view_only: false } }]) {
    const input = fixture();
    assert.throws(() => planIntakeAdoption({ ...input, connection: { ...input.connection, ...patch } }), status(409));
  }
  for (const data of [null, { status: "deleted" }, { status: "new", deleted: true }, { status: "new", deleted: "true" }, { status: "paid" }]) {
    const input = fixture();
    assert.throws(() => planIntakeAdoption({ ...input, source: { ...input.source, canonical_data: data } }), status(409));
  }
  const input = fixture();
  assert.throws(() => planIntakeAdoption({ ...input, stream: { status: "failing", last_error: null } }), status(409));
  assert.throws(() => planIntakeAdoption({ ...input, stream: { status: "idle", last_error: "Source changes need reconciliation." } }), status(409));
  assert.throws(() => planIntakeAdoption({ ...input, source: { ...input.source, updated_at: "2026-11-18T12:00:00.123457Z" } }), status(409));
  assert.throws(() => planIntakeAdoption({ ...input, source: { ...input.source, native_object_id: uuid(99) } }), status(409));
  assert.throws(() => planIntakeAdoption({ ...input, existingLink: { ...tenant, connection_id: command.connectionId, object_type: "lead", external_object_id: command.externalId, native_object_id: uuid(99) } }), status(409));
});

test("source version equality preserves database microseconds while accepting equivalent ISO offsets", () => {
  assert.equal(sameIntakeRevision(version, "2026-11-18T06:00:00.123456-06:00"), true);
  assert.equal(sameIntakeRevision("2026-11-18T12:00:00Z", "2026-11-18T12:00:00.000000+00:00"), true);
  assert.equal(Date.parse(version), Date.parse("2026-11-18T12:00:00.123457Z"));
  assert.equal(sameIntakeRevision(version, "2026-11-18T12:00:00.123457Z"), false);
  assert.equal(sameIntakeRevision(version, "invalid"), false);
});

test("service refuses unconfirmed or mismatched persisted results and rejects supplied scope before repository access", async () => {
  let calls = 0;
  const repository: IntakeAdoptionRepository = { async apply() { calls++; return saved(); } };
  await assert.rejects(adoptIntake(repository, { ...actor, canWrite: false }, command), status(403));
  await assert.rejects(adoptIntake(repository, actor, { ...command, clientId: uuid(99) }), status(400));
  assert.equal(calls, 0);
  for (const result of [null, {}, saved({ sourceRecordId: uuid(99) }), saved({ connectionId: uuid(99) }), saved({ sourceUpdatedAt: "2026-11-18T12:00:00.123457Z" }), saved({ createdContact: false }), { ...saved(), taskId: null }])
    await assert.rejects(adoptIntake({ async apply() { return result; } }, actor, command), status(503));
  const existing = { ...command, contact: { mode: "existing" as const, id: uuid(90), expectedUpdatedAt: version } };
  await assert.rejects(adoptIntake({ async apply() { return saved({ createdContact: false }); } }, actor, existing), status(503));
});

test("injected receipt repository replays an exact request before changed eligibility and rejects changed same-key commands", async () => {
  // Contract evidence only: actual transaction/idempotency semantics require the real RPC/Postgres check.
  const input = fixture();
  let receipt: { command: IntakeAdoptionCommand; actor: IntakeAdoptionActor; result: IntakeAdoptionResult } | null = null, writes = 0;
  const repository: IntakeAdoptionRepository = { async apply(currentActor, currentCommand) {
    if (receipt) {
      if (JSON.stringify(receipt.command) !== JSON.stringify(currentCommand) || JSON.stringify(receipt.actor) !== JSON.stringify(currentActor)) throw new IntakeAdoptionError("Request key reused.", 409);
      return { ...receipt.result, replayed: true };
    }
    planIntakeAdoption({ ...input, actor: currentActor, command: currentCommand });
    writes++;
    receipt = { command: structuredClone(currentCommand), actor: { ...currentActor }, result: saved() };
    return receipt.result;
  } };
  const first = await adoptIntake(repository, actor, command);
  input.source.canonical_data = { deleted: true };
  input.connection.runtime_mode = "paused";
  const retry = await adoptIntake(repository, actor, command);
  assert.equal(first.id, retry.id);
  assert.equal(retry.replayed, true);
  assert.equal(writes, 1);
  await assert.rejects(adoptIntake(repository, actor, { ...command, externalId: "changed-source" }), status(409));
});

test("Supabase adapter forwards only server actor scope and normalized command through one atomic RPC", async () => {
  const calls: unknown[] = [];
  const admin = { async rpc(name: string, args: unknown) { calls.push({ name, args }); return { data: saved(), error: null }; } } as unknown as SupabaseClient;
  const result = await adoptIntake(supabaseIntakeAdoptionRepository(admin), actor, command);
  assert.equal(result.leadId, uuid(12));
  assert.deepEqual(calls, [{ name: "adopt_owner_intake_record", args: { p_partner: actor.partnerId, p_client: actor.clientId, p_actor: actor.actorId, p_command: command } }]);
  const failure = { async rpc() { return { data: null, error: { code: "40001", message: "private database context" } }; } } as unknown as SupabaseClient;
  await assert.rejects(adoptIntake(supabaseIntakeAdoptionRepository(failure), actor, command), status(409));
});
