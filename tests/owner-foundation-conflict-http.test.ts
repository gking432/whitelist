import assert from "node:assert/strict";
import test from "node:test";
import { assertFoundationApprovalDecision, assertFoundationHttpScope, collectFoundationHttpRace, readFoundationHttpJson, runOwnerFoundationConflictHttp, type FoundationScope } from "../scripts/owner-foundation-conflict-http.mjs";

const id = (value: string) => `${value.repeat(8)}-${value.repeat(4)}-4${value.repeat(3)}-8${value.repeat(3)}-${value.repeat(12)}`;
const scope = { fixture: { prefix: "owner-browser-012345abcdef", partnerId: id("1") }, target: { appUrl: "http://127.0.0.1:3000", supabaseUrl: "http://127.0.0.1:54321", anonKey: "synthetic-public-key" },
  env: { CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_ENV: "/tmp/synthetic-env", OWNER_BROWSER_CONFIRMATION: "owner-browser-disposable" },
  owners: ["2", "3"].map((value, index) => ({ label: index ? "phone" : "desktop", userId: id(value), clientId: id(index ? "4" : "5"), membershipId: id("6"), receiptId: id("7"), marker: `owner-browser-012345abcdef-${index}`, page: {}, context: {} })) } as unknown as FoundationScope;

test("foundation evidence refuses missing hosted confirmation, remote targets and unbound scopes before requests", async () => {
  assertFoundationHttpScope(scope);
  for (const changes of [{ env: {} }, { target: { ...scope.target, appUrl: "https://production.example" } }, { target: { ...scope.target, supabaseUrl: "https://production.supabase.co" } }, { fixture: { ...scope.fixture, prefix: "real-business" } }, { owners: [scope.owners[0], scope.owners[0]] }]) assert.throws(() => assertFoundationHttpScope({ ...scope, ...changes } as FoundationScope));
  let contacted = false;
  await assert.rejects(runOwnerFoundationConflictHttp({ ...scope, env: {}, readSession: async () => { contacted = true; throw new Error(); } } as unknown as Parameters<typeof runOwnerFoundationConflictHttp>[0]), /disposable GitHub-hosted/);
  assert.equal(contacted, false);
});
test("every HTTP outcome requires a complete JSON body without retrying a failed or successful request", async () => {
  const phases: string[] = []; let calls = 0, bodies = 0;
  const result = await readFoundationHttpJson(async () => { calls++; return { status: () => 409, json: async () => { bodies++; return { status: "error", httpStatus: 409 }; } }; }, { operation: "phone: synthetic conflict", expected: [409], phase: async (label) => { phases.push(label); } });
  assert.equal(result.status, 409); assert.equal(calls, 1); assert.equal(bodies, 1); assert.match(phases.at(-1)!, /HTTP 409; JSON complete/);
  await assert.rejects(readFoundationHttpJson(async () => ({ status: () => 200, json: async () => { throw new Error("sensitive transport text"); } }), { operation: "desktop: source GET" }), /HTTP 200; complete JSON unavailable/);
  await assert.rejects(readFoundationHttpJson(async () => { throw new Error("sensitive transport text"); }, { operation: "desktop: source GET" }), (error) => error instanceof Error && !error.message.includes("sensitive transport"));
});
test("an unexpected403 preserves its original failure and sanitized diagnosis, even with unreadable JSON", async () => {
  const phases: string[] = []; let calls = 0, diagnosed = 0;
  await assert.rejects(readFoundationHttpJson(async () => { calls++; return { status: () => 403, json: async () => { throw new Error("secret JWT and cookie carrier"); } }; }, { operation: "phone: actual context GET", phase: async (value) => { phases.push(value); }, diagnose403: async () => { diagnosed++; throw new Error("secret diagnostic body"); } }), (error) => error instanceof assert.AssertionError && error.actual === 403 && error.expected === 200);
  assert.equal(calls, 1); assert.equal(diagnosed, 1); assert.ok(phases.some((value) => value.includes("response_json_unavailable")));
  assert.equal(phases.join("\n").includes("secret"), false);
});
test("race collection waits for both original outcomes and never converts one failed response into a winner", async () => {
  const calls: number[] = []; let finish: (value: { status: number }) => void = () => {};
  const other = new Promise<{ status: number }>((resolve) => { finish = resolve; });
  const pending = collectFoundationHttpRace([async () => { calls.push(1); throw new Error("sensitive failure"); }, async () => { calls.push(2); return other; }]);
  const rejected = assert.rejects(pending, /Every foundation race attempt/); await Promise.resolve(); assert.deepEqual(calls, [1, 2]); finish({ status: 409 }); await rejected;
  assert.deepEqual(await collectFoundationHttpRace([async () => ({ status: 200 }), async () => ({ status: 409 })]), [{ status: 200 }, { status: 409 }]);
});
test("approval decision evidence rejects partial, mismatched, oversized or undocumented receipts", () => {
  const complete = { status: "success", httpStatus: 200, message: "Approval recorded." };
  assertFoundationApprovalDecision({ status: 200, body: complete }, true);
  assertFoundationApprovalDecision({ status: 409, body: { status: "error", httpStatus: 409, message: "Already resolved.", fieldErrors: { note: "Review the saved decision." } } }, false);
  for (const body of [{ ...complete, message: "" }, { ...complete, message: "x".repeat(4001) }, { ...complete, httpStatus: 409 }, { ...complete, undocumented: "sensitive" }, { ...complete, fieldErrors: { note: 5 } }, { ...complete, fieldErrors: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [String(i), "x"])) }]) assert.throws(() => assertFoundationApprovalDecision({ status: 200, body }, true));
});
