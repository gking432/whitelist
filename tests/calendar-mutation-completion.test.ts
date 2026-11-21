import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionJobRecord } from "../lib/jobs/record.ts";
import {
  completeCalendarMutation, maintainCalendarMutations, recoverCalendarMutationCompletions,
  type CalendarMutationCompletionResult,
} from "../lib/scheduling/calendar-mutation-completion.ts";

const id = (end: number) => `00000000-0000-4000-8000-${String(end).padStart(12, "0")}`;
const job = (values: Partial<ActionJobRecord> = {}): ActionJobRecord => ({
  id: id(1), partner_id: id(2), client_id: id(3), approval_id: id(4), kind: "calendar.cancel", status: "succeeded",
  connection_id: null, workflow_run_id: null, payload: { calendar_mutation_version: 1, booking_approval_id: id(8) }, attempt_count: 1,
  last_error: null, last_attempt_at: null, created_at: "2026-11-17T12:00:00Z", provider_receipt: { verified_at: "2026-11-17T12:01:00Z" }, ...values,
});
const completedResult = (jobId = id(1)): CalendarMutationCompletionResult => ({ state: "completed", jobId, bookingApprovalId: id(8), appointmentId: id(9) });
const reviewResult = (jobId = id(1)): CalendarMutationCompletionResult => ({ state: "review", jobId, bookingApprovalId: id(8), taskId: id(10), reason: "Current source requires review." });

test("completion uses only the exact scoped persistence RPC for successful approved mutation jobs", async () => {
  const calls: unknown[] = [];
  const admin = { rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { data: completedResult(), error: null }; },
    from: () => { throw new Error("Completion must not execute or rewrite a provider job"); } } as unknown as SupabaseClient;
  assert.deepEqual(await completeCalendarMutation(admin, job()), completedResult());
  assert.deepEqual(calls, [{ name: "complete_calendar_mutation", args: { p_partner: id(2), p_client: id(3), p_job: id(1) } }]);
  assert.deepEqual(await completeCalendarMutation(admin, job({ kind: "calendar.reschedule" })), completedResult());
});
test("uncertain, unrelated and malformed jobs never reach the completion RPC", async () => {
  let calls = 0;
  const admin = { rpc: async () => { calls++; throw new Error("Unexpected RPC"); } } as unknown as SupabaseClient;
  const invalid = [null, {}, [], job({ kind: "calendar.book" }), job({ kind: "email.send" }), job({ status: "uncertain" }),
    job({ status: "processing" }), job({ status: "provider_pending" }), job({ approval_id: null }), job({ id: "" }), job({ partner_id: "not-scoped" })];
  for (const value of invalid) assert.equal(await completeCalendarMutation(admin, value as ActionJobRecord), null);
  assert.equal(calls, 0);
});
test("a review outcome stays distinct from completed local state", async () => {
  const admin = { rpc: async () => ({ data: reviewResult(), error: null }) } as unknown as SupabaseClient;
  const record = job();
  assert.deepEqual(await completeCalendarMutation(admin, record), reviewResult());
  assert.equal(record.status, "succeeded");
});
test("RPC errors and invalid outcomes preserve the successful job and provider receipt", async () => {
  for (const response of [{ data: null, error: { message: "Database unavailable" } }, { data: null, error: null },
    { data: { state: "succeeded" }, error: null }, { data: { state: "completed" }, error: null },
    { data: { ...completedResult(), jobId: id(99) }, error: null }, { data: { ...completedResult(), bookingApprovalId: id(99) }, error: null },
    { data: { ...reviewResult(), taskId: null }, error: null }, { data: {}, error: null }, { data: [], error: null }]) {
    const record = job(), before = structuredClone(record);
    const admin = { rpc: async () => response } as unknown as SupabaseClient;
    await assert.rejects(completeCalendarMutation(admin, record), /successful calendar change remains recorded.*without repeating the calendar write/);
    assert.deepEqual(record, before);
  }
});
test("restart recovery continues after each failed projection and skips ineligible records", async () => {
  const records = [job(), job({ id: id(5), kind: "calendar.reschedule" }), job({ id: id(6) }), job({ id: id(7) }), job({ status: "uncertain" }), {}];
  const touched: string[] = [];
  const recover = () => recoverCalendarMutationCompletions({ list: async () => records, complete: async (record) => {
    touched.push(record.id);
    if (record.id === id(5)) throw new Error("Local source unavailable");
    return record.id === id(6) ? reviewResult(record.id) : completedResult(record.id);
  } });
  assert.deepEqual(await recover(), { completed: 2, review: 1, failed: 1, skipped: 2 });
  assert.deepEqual(touched, [id(1), id(5), id(6), id(7)]);
  assert.deepEqual(await recover(), { completed: 2, review: 1, failed: 1, skipped: 2 });
  assert.equal(records.filter((record) => "status" in record && record.status === "succeeded").length, 4);
});
test("injected malformed completion results fail one receipt without stopping the batch", async () => {
  const result = await recoverCalendarMutationCompletions({ list: async () => [job(), job({ id: id(5) })],
    complete: async (record) => record.id === id(1) ? { state: "queued" } as unknown as CalendarMutationCompletionResult : completedResult(record.id) });
  assert.deepEqual(result, { completed: 1, review: 0, failed: 1, skipped: 0 });
});
test("maintenance selects only a bounded due-success batch and never retries a provider operation", async () => {
  const calls: unknown[][] = [], completed: string[] = [];
  const builder: Record<string, (...args: unknown[]) => unknown> = Object.fromEntries(["select", "in", "eq", "not", "lte", "order"].map((name) => [name, (...args: unknown[]) => { calls.push([name, ...args]); return builder; }]));
  builder.limit = async (...args: unknown[]) => { calls.push(["limit", ...args]); return { data: [job(), job({ id: id(5) }), job({ id: id(6) })], error: null }; };
  const admin = { from: (table: string) => { calls.push(["from", table]); return builder; },
    rpc: async (name: string, args: { p_job: string }) => { assert.equal(name, "complete_calendar_mutation"); completed.push(args.p_job); return { data: completedResult(args.p_job), error: null }; } } as unknown as SupabaseClient;
  assert.deepEqual(await maintainCalendarMutations(admin, 2.9, () => "2026-11-17T13:00:00Z"), { completed: 2, review: 0, failed: 0, skipped: 0 });
  assert.deepEqual(completed, [id(1), id(5)]);
  assert.deepEqual(calls, [["from", "action_jobs"], ["select", "*"], ["in", "kind", ["calendar.cancel", "calendar.reschedule"]],
    ["eq", "status", "succeeded"], ["not", "calendar_reconcile_due_at", "is", null], ["lte", "calendar_reconcile_due_at", "2026-11-17T13:00:00Z"], ["order", "calendar_reconcile_due_at"], ["limit", 2]]);
});
test("maintenance rejects invalid clocks or unavailable source lists without touching successful receipts", async () => {
  let queries = 0, completions = 0;
  const admin = { from: () => { queries++; const builder: Record<string, (...args: unknown[]) => unknown> = { select: () => builder, in: () => builder, eq: () => builder,
    not: () => builder, lte: () => builder, order: () => builder, limit: async () => ({ data: null, error: { message: "Unavailable" } }) }; return builder; },
    rpc: async () => { completions++; throw new Error("Unexpected completion"); } } as unknown as SupabaseClient;
  await assert.rejects(maintainCalendarMutations(admin, 3, () => "invalid"), /clock could not be verified/);
  assert.equal(queries, 0);
  await assert.rejects(maintainCalendarMutations(admin, Number.NaN, () => "2026-11-17T13:00:00Z"), /Successful provider results remain recorded/);
  assert.equal(completions, 0);
});
