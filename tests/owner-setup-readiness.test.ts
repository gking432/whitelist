import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkOwnerSetupReadiness, OWNER_SETUP_READ_TIMEOUT_MS, readOwnerSetupReadiness, type OwnerSetupReadinessRepository } from "../lib/auth/owner-setup-readiness.ts";
import { EXPECTED_SCHEMA_VERSION } from "../lib/ops/schema-version.ts";

const unavailable = { available: false, message: "Business setup is temporarily unavailable. Please try again shortly." };
const available = { available: true, message: "Business setup is available." };
const repository = (data: unknown, error: unknown = null): OwnerSetupReadinessRepository => ({ readSchemaMarker: async () => ({ data, error }) });

test("missing admin/repository and missing, malformed or old markers fail closed with one safe decision", async () => {
  assert.deepEqual(await readOwnerSetupReadiness(null), unavailable);
  assert.deepEqual(await readOwnerSetupReadiness(undefined), unavailable);
  assert.deepEqual(await checkOwnerSetupReadiness(null), unavailable);
  for (const data of [null, undefined, [], {}, { current_migration: null }, { current_migration: 123 }, { current_migration: "" }, { current_migration: "malformed" }, { current_migration: "20260701000000_old_schema" }])
    assert.deepEqual(await checkOwnerSetupReadiness(repository(data)), unavailable);
});

test("current and compatible newer schema pass without returning markers or unrelated data", async () => {
  for (const marker of [EXPECTED_SCHEMA_VERSION, "20990101000000_future_compatible"])
    assert.deepEqual(await checkOwnerSetupReadiness(repository({ current_migration: marker, private_config: "never expose", credentials: "never expose" })), available);
});

test("errors and synchronous/asynchronous failures never expose diagnostics or turn a marker into success", async () => {
  for (const error of [{ message: "secret database host and token" }, "private identifier", false, 0]) {
    const result = await checkOwnerSetupReadiness(repository({ current_migration: EXPECTED_SCHEMA_VERSION }, error));
    assert.deepEqual(result, unavailable); assert.equal(JSON.stringify(result).includes("secret"), false);
  }
  for (const readSchemaMarker of [() => { throw new Error("secret synchronous config"); }, async () => { throw new Error("secret asynchronous host"); }])
    assert.deepEqual(await checkOwnerSetupReadiness({ readSchemaMarker }), unavailable);
});

test("one exact singleton marker query receives an abort signal and reads no tenant or extra columns", async () => {
  const calls: unknown[][] = [];
  const builder = {
    select: (column: string) => { calls.push(["select", column]); return builder; },
    eq: (column: string, value: unknown) => { calls.push(["eq", column, value]); return builder; },
    abortSignal: (signal: AbortSignal) => { calls.push(["signal", signal]); return builder; },
    maybeSingle: async () => { calls.push(["maybeSingle"]); return { data: { current_migration: EXPECTED_SCHEMA_VERSION }, error: null }; },
  };
  const admin = { from: (table: string) => { calls.push(["from", table]); return builder; } } as unknown as SupabaseClient;
  assert.deepEqual(await readOwnerSetupReadiness(admin), available);
  assert.deepEqual(calls.filter(([name]) => name !== "signal"), [["from", "platform_schema_state"], ["select", "current_migration"], ["eq", "singleton", true], ["maybeSingle"]]);
  assert.equal(calls.filter(([name]) => name === "signal").length, 1);
  assert.ok(calls.find(([name]) => name === "signal")?.[1] instanceof AbortSignal);
  assert.equal(OWNER_SETUP_READ_TIMEOUT_MS, 5000);
});

test("deadline aborts the read and returns unavailable even when the reader ignores cancellation", async () => {
  let calls = 0, signal: AbortSignal | undefined;
  const result = await checkOwnerSetupReadiness({ readSchemaMarker: (value) => { calls++; signal = value; return new Promise<{ data: unknown; error?: unknown }>(() => {}); } }, { timeoutMs: 5 });
  assert.deepEqual(result, unavailable); assert.equal(calls, 1); assert.equal(signal?.aborted, true);
});

test("late completion cannot upgrade a timeout, and invalid deadlines never call the reader", async () => {
  let complete: ((result: { data: unknown; error: unknown }) => void) | undefined;
  const result = await checkOwnerSetupReadiness({ readSchemaMarker: () => new Promise<{ data: unknown; error: unknown }>((resolve) => { complete = resolve; }) }, { timeoutMs: 5 });
  complete?.({ data: { current_migration: EXPECTED_SCHEMA_VERSION }, error: null });
  assert.deepEqual(result, unavailable);
  for (const timeoutMs of [0, -1, Infinity, NaN, 5001]) {
    let calls = 0;
    assert.deepEqual(await checkOwnerSetupReadiness({ readSchemaMarker: async () => { calls++; return { data: null }; } }, { timeoutMs }), unavailable);
    assert.equal(calls, 0);
  }
});
