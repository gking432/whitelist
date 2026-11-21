import assert from "node:assert/strict";
import test from "node:test";
import { assertOAuthConflictHttpScope, collectOAuthConsumeRace, readOAuthWireResponse, runOAuthConflictHttp, type OAuthHttpScope } from "../scripts/oauth-conflict-http.mjs";

const id = (value: string) => `${value.repeat(8)}-${value.repeat(4)}-4${value.repeat(3)}-8${value.repeat(3)}-${value.repeat(12)}`;
const scope = { fixture: { prefix: "owner-browser-012345abcdef", partnerId: id("1") }, target: { appUrl: "http://127.0.0.1:3000", supabaseUrl: "http://127.0.0.1:54321", anonKey: "synthetic-anon-key", serviceKey: "synthetic-service-key" }, env: { CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_ENV: "/tmp/synthetic-env", OWNER_BROWSER_CONFIRMATION: "owner-browser-disposable" }, owners: ["2", "3"].map((value, index) => ({ label: index ? "phone" : "desktop", userId: id(value), clientId: id(index ? "4" : "5"), membershipId: id("6"), receiptId: id("7"), marker: `owner-browser-012345abcdef-${index}`, page: {}, context: {} })) } as unknown as OAuthHttpScope;
const errorBody = (code: string) => JSON.stringify({ code, message: "Synthetic database decision", details: null, hint: null });

test("OAuth transport refuses non-CI, hosted origins and missing service credentials before any fixture or session call", async () => {
  assertOAuthConflictHttpScope(scope);
  for (const changes of [{ env: {} }, { target: { ...scope.target, serviceKey: "" } }, { target: { ...scope.target, serviceKey: scope.target.anonKey } }, { target: { ...scope.target, supabaseUrl: "https://production.supabase.co" } }, { owners: [scope.owners[0], scope.owners[0]] }]) assert.throws(() => assertOAuthConflictHttpScope({ ...scope, ...changes } as OAuthHttpScope));
  let called = false;
  await assert.rejects(runOAuthConflictHttp({ ...scope, env: {}, readSession: async () => { called = true; throw new Error(); } } as unknown as Parameters<typeof runOAuthConflictHttp>[0]), /disposable GitHub-hosted/);
  assert.equal(called, false);
});

test("native void success must complete its one empty204 body, while JSONB begin must supply all durable pins", async () => {
  let requests = 0, bodies = 0;
  const result = await readOAuthWireResponse(async () => { requests++; return { status: 204, text: async () => { bodies++; return ""; } }; }, { status: 204 });
  assert.deepEqual(result, { status: 204, body: null }); assert.equal(requests, 1); assert.equal(bodies, 1);
  const complete = { attemptId: id("1"), connectionId: id("2"), expectedAccountId: null };
  assert.deepEqual((await readOAuthWireResponse(async () => ({ status: 200, text: async () => JSON.stringify(complete) }), { status: 200, begin: true })).body, complete);
  for (const [status, text] of [[200, "null"], [204, "null"], [204, " "]] as const) await assert.rejects(readOAuthWireResponse(async () => ({ status, text: async () => text }), { status: 204 }));
  for (const body of [{ ...complete, connectionId: "wrong" }, { attemptId: complete.attemptId }, { ...complete, token: "sensitive" }]) await assert.rejects(readOAuthWireResponse(async () => ({ status: 200, text: async () => JSON.stringify(body) }), { status: 200, begin: true }));
});

test("PT409 semantic conflicts and P0002 replay denial retain different actual statuses and complete bounded JSON", async () => {
  for (const [status, code] of [[409, "PT409"], [500, "P0002"], [400, "22023"], [403, "42501"], [401, "42501"]] as const) {
    const response = await readOAuthWireResponse(async () => ({ status, text: async () => errorBody(code) }), { status, code }); assert.equal(response.body?.code, code);
  }
  await assert.rejects(readOAuthWireResponse(async () => ({ status: 500, text: async () => errorBody("P0002") }), { status: 409, code: "PT409" }));
  for (const body of [{ code: "PT409", message: "Incomplete" }, { code: "40001", message: "Transient", details: null, hint: null }, { code: "PT409", message: "x".repeat(4001), details: null, hint: null }, { code: "PT409", message: "Changed", details: null, hint: null, token: "sensitive" }]) await assert.rejects(readOAuthWireResponse(async () => ({ status: 409, text: async () => JSON.stringify(body) }), { status: 409, code: "PT409" }));
});

test("lost, malformed and oversized HTTP bodies fail without retrying or disclosing transport or credential text", async () => {
  let calls = 0;
  for (const action of [async () => { throw new Error("secret JWT"); }, async () => ({ status: 409, text: async () => { throw new Error("secret token"); } }), async () => ({ status: 409, text: async () => "secret malformed JSON" }), async () => ({ status: 409, text: async () => "x".repeat(32769) })]) {
    await assert.rejects(readOAuthWireResponse(async () => { calls++; return action(); }, { status: 409, code: "PT409" }), (error: unknown) => error instanceof Error && !error.message.includes("secret"));
  }
  assert.equal(calls, 4);
});

test("consume CAS waits for both original200 row arrays and never treats transport loss or duplicate consumers as success", async () => {
  const row = { id: id("1") }; let release: (value: { status: number; body: { id: string }[] }) => void = () => {};
  const delayed = new Promise<{ status: number; body: { id: string }[] }>((resolve) => { release = resolve; });
  let finished = false;
  const collecting = collectOAuthConsumeRace([async () => ({ status: 200, body: [row] }), async () => delayed]).then((value) => { finished = true; return value; });
  await Promise.resolve(); assert.equal(finished, false); release({ status: 200, body: [] }); assert.equal((await collecting).length, 2);
  await assert.rejects(collectOAuthConsumeRace([async () => ({ status: 200, body: [row] }), async () => ({ status: 200, body: [row] })]), /Exactly one/);
  await assert.rejects(collectOAuthConsumeRace([async () => { throw new Error("secret transport"); }, async () => ({ status: 200, body: [] })]), (error: unknown) => error instanceof Error && !error.message.includes("secret"));
  await assert.rejects(collectOAuthConsumeRace([async () => ({ status: 409, body: [] }), async () => ({ status: 200, body: [row] })]), /native HTTP200/);
});

test("an interrupted session preserves its original failure across exact cleanup and failed final evidence publication", async () => {
  for (const { cleanupFails, finalPublicationFails } of [{ cleanupFails: false, finalPublicationFails: false }, { cleanupFails: true, finalPublicationFails: false }, { cleanupFails: false, finalPublicationFails: true }]) {
    const filters: { table: string; name: string; value: string }[] = [], reports: { status: string; fixtureCleanup: string; cleanupRemaining: Record<string, number> | null }[] = [];
    class CleanupQuery {
      table: string; deleting = false;
      constructor(table: string) { this.table = table; }
      delete() { this.deleting = true; return this; }
      select() { return this; }
      eq(name: string, value: string) { filters.push({ table: this.table, name, value }); return this; }
      then(resolve: (value: { error: null | { code: string }; data: null; count: number }) => unknown) { return Promise.resolve(resolve({ error: cleanupFails && this.deleting ? { code: "SYNTHETIC" } : null, data: null, count: 0 })); }
    }
    const originalFailure = new Error("Synthetic session interruption");
    const options = { ...scope, admin: { from: (table: string) => new CleanupQuery(table) }, readSession: async () => { throw originalFailure; }, verifySession: async () => { throw new Error("Must not proceed"); }, onProgress: async (report: { status: string; fixtureCleanup: string; cleanupRemaining: Record<string, number> | null }) => { reports.push(report); if (finalPublicationFails && report.fixtureCleanup === "complete") throw new Error("Synthetic final publication failure"); } } as unknown as Parameters<typeof runOAuthConflictHttp>[0];
    await assert.rejects(runOAuthConflictHttp(options), (error: unknown) => error === originalFailure);
    assert.equal(reports.at(-1)?.status, "failed"); assert.equal(reports.at(-1)?.fixtureCleanup, cleanupFails ? "failed" : "complete");
    assert.ok(filters.some((entry) => entry.table === "client_businesses" && entry.name === "partner_id" && entry.value === scope.fixture.partnerId));
    assert.ok(filters.some((entry) => entry.table === "client_businesses" && entry.name === "slug" && entry.value.startsWith(`${scope.fixture.prefix}-oauth-transport-`)));
    assert.equal(JSON.stringify(reports).includes("synthetic-service-key"), false);
    if (!cleanupFails) assert.ok(Object.values(reports.at(-1)!.cleanupRemaining!).every((value) => value === 0));
  }
});
