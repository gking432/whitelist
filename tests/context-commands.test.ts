import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BusinessCommandError,
  ContextCommandSchema,
  normalizeContextCommand,
  parseManagerControl,
  isManagerControlIntent,
} from "../lib/business/context-commands.ts";

test("control-like requests cannot fall through to a model completion claim", () => {
  for (const request of ["Stop using Instagram", "stop using an unsupported app", "Pause everything and resume email", "disable bookings", "turn off SMS"])
    assert.equal(isManagerControlIntent(request), true);
  assert.equal(isManagerControlIntent("What needs me today?"), false);
  assert.equal(isManagerControlIntent("Review open leads"), false);
});
import {
  executeContextCommand,
  supabaseCommandRepository,
  type BusinessCommandActor,
  type CommandRepository,
} from "../lib/business/context-command-service.ts";
import type { BusinessCommandResult } from "../lib/business/context-contract.ts";

const actor: BusinessCommandActor = {
  partnerId: "00000000-0000-4000-8000-000000000001",
  clientId: "00000000-0000-4000-8000-000000000002",
  actorId: "00000000-0000-4000-8000-000000000003",
  canWrite: true,
};
const key = "00000000-0000-4000-8000-000000000004";
const control = { action: "manager_control", key, expectedRevision: 4, command: "pause team" } as const;
const receipt: BusinessCommandResult = {
  id: "00000000-0000-4000-8000-000000000005",
  revision: 5,
  message: "Team paused. Unsent work stopped; completed actions remain recorded.",
  cancelledWork: 2,
  replayed: false,
};
const expectStatus = (status: number) => (error: unknown) => {
  assert.ok(error instanceof BusinessCommandError);
  assert.equal(error.status, status);
  return true;
};

test("denied command actors cannot reach parsing or persistence", async () => {
  let writes = 0;
  const repository: CommandRepository = { async apply() { writes++; return receipt; } };
  await assert.rejects(executeContextCommand(repository, { ...actor, canWrite: false }, null), expectStatus(403));
  assert.equal(writes, 0);
});

test("commands reject browser scope, unversioned edits and unsupported modes before persistence", async () => {
  let writes = 0;
  const repository: CommandRepository = { async apply() { writes++; return receipt; } };
  const invalid = [
    { ...control, partnerId: actor.partnerId },
    { ...control, clientId: actor.clientId },
    { ...control, actorId: actor.actorId },
    { ...control, expectedRevision: undefined },
    { ...control, expectedRevision: -1 },
    { ...control, key: "not-an-idempotency-key" },
    { action: "set_authority", key, expectedRevision: 4, channel: "voice", mode: "draft" },
    { action: "set_authority", key, expectedRevision: 4, channel: "email", mode: "automatic" },
    { action: "review_context", key, expectedContextRevision: "" },
  ];
  for (const command of invalid) {
    assert.equal(ContextCommandSchema.safeParse(command).success, false);
    await assert.rejects(executeContextCommand(repository, actor, command));
  }
  assert.equal(writes, 0);
});

test("ambiguous or compound manager requests make no settings change", async () => {
  let writes = 0;
  const repository: CommandRepository = { async apply() { writes++; return receipt; } };
  for (const command of ["maybe pause team", "pause team and email customers", "don't stop using Instagram", "stop using Facebook", "resume"])
    await assert.rejects(executeContextCommand(repository, actor, { ...control, command }), expectStatus(422));
  assert.equal(writes, 0);
});

test("supported controls normalize unambiguous operation and preserve their request key", () => {
  assert.deepEqual(parseManagerControl(" Resume TEAM! "), { operation: "resume" });
  assert.deepEqual(parseManagerControl("stop using Instagram"), { operation: "stop", channel: "instagram" });
  assert.deepEqual(normalizeContextCommand(control), { ...control, operation: "pause" });
  assert.deepEqual(normalizeContextCommand({ action: "review_context", key, expectedContextRevision: "2026-11-17T01:00:00+00:00" }), {
    action: "review_context", key, expectedContextRevision: "2026-11-17T01:00:00+00:00",
  });
});

test("production repository sends authenticated scope and actor separately from browser command", async () => {
  let invocation: { name: string; args: unknown } | null = null;
  const admin = { async rpc(name: string, args: unknown) {
    invocation = { name, args };
    return { data: receipt, error: null };
  } } as unknown as SupabaseClient;
  const result = await executeContextCommand(supabaseCommandRepository(admin), actor, control);
  assert.deepEqual(result, receipt);
  assert.deepEqual(invocation, {
    name: "apply_business_context_command",
    args: { p_partner: actor.partnerId, p_client: actor.clientId, p_actor: actor.actorId, p_command: { ...control, operation: "pause" } },
  });
});

test("stale revisions and reused keys surface as refresh-required conflicts", async () => {
  for (const error of [
    { code: "40001", message: "revision mismatch" },
    { code: "P0001", message: "Authority changed" },
    { code: "P0001", message: "Request key reused" },
  ]) {
    const admin = { async rpc() { return { data: null, error }; } } as unknown as SupabaseClient;
    await assert.rejects(executeContextCommand(supabaseCommandRepository(admin), actor, control), expectStatus(409));
  }
});

test("missing current context review is actionable and does not claim permission escalation", async () => {
  const admin = { async rpc() { return { data: null, error: { code: "22023", message: "Review current profile first" } }; } } as unknown as SupabaseClient;
  await assert.rejects(executeContextCommand(supabaseCommandRepository(admin), actor, {
    action: "set_authority", key, expectedRevision: 4, channel: "email", mode: "require_approval",
  }), expectStatus(422));
});

test("persistence failures preserve a retryable service failure without exposing database diagnostics", async () => {
  const admin = { async rpc() { return { data: null, error: { code: "XX000", message: "private database detail" } }; } } as unknown as SupabaseClient;
  await assert.rejects(executeContextCommand(supabaseCommandRepository(admin), actor, control), (error) => {
    assert.ok(error instanceof BusinessCommandError);
    assert.equal(error.status, 503);
    assert.match(error.message, /same request key/);
    assert.doesNotMatch(error.message, /private database detail/);
    return true;
  });
});

test("a missing or malformed durable receipt never reports success", async () => {
  for (const value of [
    null,
    {},
    { ...receipt, id: "" },
    { ...receipt, revision: undefined },
    { ...receipt, revision: -1 },
    { ...receipt, message: undefined },
    { ...receipt, cancelledWork: -1 },
    { ...receipt, replayed: "true" },
  ]) {
    const repository: CommandRepository = { async apply() { return value as BusinessCommandResult; } };
    await assert.rejects(executeContextCommand(repository, actor, control), expectStatus(503));
  }
});

test("lost response retries retain the same key and revision for repository idempotency", async () => {
  const calls: unknown[] = [];
  let applied = false;
  const repository: CommandRepository = { async apply(persistedActor, command) {
    calls.push({ actor: persistedActor, command });
    if (!applied) {
      applied = true;
      throw new Error("Response lost after durable commit");
    }
    return { ...receipt, replayed: true };
  } };
  await assert.rejects(executeContextCommand(repository, actor, control), /Response lost/);
  const result = await executeContextCommand(repository, actor, control);
  assert.equal(result.replayed, true);
  assert.equal(result.id, receipt.id);
  assert.deepEqual(calls[0], calls[1]);
});
