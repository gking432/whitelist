// These verify harness validation/failure propagation only, never execute SQL.
import assert from "node:assert/strict";
import test from "node:test";
const url = new URL("../scripts/owner-onboarding-concurrency.mjs", import.meta.url);
const { runOwnerOnboardingConcurrency, OWNER_ONBOARDING_CONCURRENCY_CASES } = await import(url.href);
const literal = (value: unknown) => `'${String(value).replaceAll("'", "''")}'`;

test("onboarding race module refuses unnamed targets and incomplete dependencies before SQL", async () => {
  let calls = 0;
  const deps = { query: async () => { calls++; }, readReport: () => ({}), heldTransaction: async () => {}, isolationAssertion: () => "", literal, reportPrefix: "synthetic-report" };
  for (const database of ["postgres", "production", "customer_test;other"]) await assert.rejects(runOwnerOnboardingConcurrency({ database }, deps), /named disposable/);
  await assert.rejects(runOwnerOnboardingConcurrency({ database: "customer_test" }, {}));
  assert.equal(calls, 0); assert.equal(OWNER_ONBOARDING_CONCURRENCY_CASES, 4);
});
test("an actual query failure is not retried or translated and still attempts only exact scoped cleanup", async () => {
  const sql: string[] = [], original = Object.assign(new Error("Synthetic backend serialization failure"), { code: "40001" });
  const deps = {
    query: async (_target: unknown, source: string) => { sql.push(source); if (sql.length === 1) throw original; return JSON.stringify({ remaining: 0 }); },
    readReport: (output: string) => JSON.parse(output), heldTransaction: async () => { throw new Error("Must not reach a race"); }, isolationAssertion: () => "-- explicit test isolation", literal, reportPrefix: "synthetic-report",
  };
  await assert.rejects(runOwnerOnboardingConcurrency({ database: "customer_test" }, deps), (error: unknown) => error === original);
  assert.equal(sql.length, 2);
  assert.match(sql[0], /explicit test isolation/);
  assert.match(sql[1], /delete from public\.partners where id='[a-f0-9-]+' and slug='cj-acceptance-[a-f0-9-]+-onboarding-races'/);
  assert.match(sql[1], /delete from auth\.users where \(id=/);
  assert.doesNotMatch(sql[1], /truncate|drop table|disable trigger/i);
});
test("cleanup uncertainty remains fatal after fixture failure and cannot turn a backend deadlock into semantic success", async () => {
  const original = Object.assign(new Error("Synthetic backend deadlock"), { code: "40P01" }); let calls = 0;
  const prior = console.error, messages: unknown[][] = []; console.error = (...values: unknown[]) => { messages.push(values); };
  try {
    await assert.rejects(runOwnerOnboardingConcurrency({ database: "customer_test" }, {
      query: async () => { calls++; throw calls === 1 ? original : new Error("Synthetic cleanup unavailable"); }, readReport: () => ({}), heldTransaction: async () => {}, isolationAssertion: () => "", literal, reportPrefix: "synthetic-report",
    }), (error: unknown) => error === original);
  } finally { console.error = prior; }
  assert.equal(calls, 2); assert.deepEqual(messages, [["FAIL: onboarding race cleanup also failed."]]);
});
test("the fourth harness case requires an actual preference RPC holder and an observed actor wait before any business row lock", async () => {
  const queries: string[] = [], holders: string[] = [];
  await assert.rejects(runOwnerOnboardingConcurrency({ database: "customer_test" }, {
    query: async (_target: unknown, sql: string) => { queries.push(sql); return sql; },
    readReport: (_output: string, kind: string) => {
      if (kind === "onboarding_race_fixture") return { clients: 4, sessions: 2, legacyRevision: "a".repeat(32), raceRevision: "b".repeat(32), preferenceRevision: "c".repeat(32) };
      if (kind === "onboarding_observed_wait") return { blocked: 1, businessRowLocks: 1 };
      if (kind === "onboarding_context_waiter") return { revision: "1", step: "connections" };
      if (["onboarding_legacy_waiter", "onboarding_owner_waiter"].includes(kind)) return { code: "PT409" };
      if (kind === "onboarding_race_cleanup") return { remaining: 0 };
      throw new Error("Unexpected mocked harness branch");
    },
    heldTransaction: async (_target: unknown, setup: string, during: () => Promise<void>) => { holders.push(setup); await during(); },
    isolationAssertion: () => "-- explicit disposable test guard", literal, reportPrefix: "synthetic-report",
  }), /must block on its exact actor holder before acquiring any business row-lock relation/);
  assert.equal(holders.length, 4);
  assert.match(holders[3], /set local role authenticated/); assert.match(holders[3], /select public\.save_owner_workspace_preferences\(/);
  assert.doesNotMatch(holders[3], /select .*auth\.users.*for update|insert into public\.owner_workspace_preferences/i);
  assert.ok(queries.some(sql => sql.includes("onboarding_preference_result") && sql.includes("set local role service_role") && sql.includes("public.save_business_profile(")));
  assert.ok(queries.at(-1)!.includes("delete from public.partners where id="));
  assert.ok(queries.at(-1)!.includes("public.owner_workspace_preferences where partner_id="));
});
