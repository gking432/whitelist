import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertGuestGoogleCallbackDenial, assertGuestGoogleStartDenial, assertGuestPrivateDenial, classifyGuestOnboardingRequest, createGuestOnboardingRequestGuard, guestDraftIdentity, inspectGuestGoogleCallbackHttp, inspectGuestGoogleStartHttp, runGoogleOnboardingBrowserScenarios, type GoogleHttpEvidence, type GoogleOnboardingBrowserReport } from "../scripts/google-onboarding-browser-scenarios.mjs";

const origin = "http://127.0.0.1:3000", draftId = "11111111-1111-4111-8111-111111111111", requestKey = "22222222-2222-4222-8222-222222222222";
const localDraft = { version: 1, draftId, requestKey, step: 1, values: { name: "Synthetic browser draft", description: "No account or business is created by these local answers.", timezone: "America/Chicago" }, expiresAt: 1800000000000 };

test("guest evidence refuses credentialed or non-origin targets before opening any browser context", async () => {
  let contexts = 0;
  for (const appUrl of ["invalid", "https://user:secret@example.test", "https://example.test/start", "https://example.test/?token=secret", "file:///tmp/site"]) await assert.rejects(runGoogleOnboardingBrowserScenarios({ browser: { newContext: async () => { contexts++; return {}; } }, appUrl, artifacts: "/tmp/guest-onboarding-test" }));
  assert.equal(contexts, 0);
});

test("local-answer traffic fails closed for Auth, private APIs, writes, external providers and encoded bypass paths", () => {
  assert.equal(classifyGuestOnboardingRequest(origin, `${origin}/start?_rsc=opaque`, "GET"), "read");
  assert.equal(classifyGuestOnboardingRequest(origin, `${origin}/_next/static/chunk.js`, "HEAD"), "read");
  assert.equal(classifyGuestOnboardingRequest(origin, `${origin}/preview`, "GET"), "read");
  for (const path of ["/auth/google/start", "/auth/v1/authorize", "/api/business/onboarding", "/rest/v1/businesses", "/client", "/partner/example", "/admin", "/login?next=%2Fstart", "/%61pi/business/context"]) assert.equal(classifyGuestOnboardingRequest(origin, `${origin}${path}`, "GET"), "private_or_auth");
  for (const path of ["/api%2fbusiness", "/x%2f..%2fauth", "/%2561pi", "/%ZZ"]) assert.equal(classifyGuestOnboardingRequest(origin, `${origin}${path}`, "GET"), "invalid");
  assert.equal(classifyGuestOnboardingRequest(origin, `${origin}/start`, "POST"), "non_read");
  for (const url of ["https://accounts.google.com/o/oauth2/v2/auth", "https://project.supabase.co/auth/v1/authorize"]) assert.equal(classifyGuestOnboardingRequest(origin, url, "GET"), "external");
  assert.equal(classifyGuestOnboardingRequest(origin, "not-a-url", "GET"), "invalid");
});

test("request and interception events retain one immutable forbidden decision and do not double-count it", () => {
  const observed: string[] = [], guard = createGuestOnboardingRequestGuard(origin, value => observed.push(value));
  const request = { url: () => `${origin}/auth/google/start`, method: () => "POST" };
  assert.equal(guard(request), "non_read"); assert.equal(guard(request), "non_read");
  assert.equal(guard({ url: () => `${origin}/start`, method: () => "GET" }), "read"); assert.deepEqual(observed, ["non_read", "read"]);
});

test("refresh evidence accepts only bounded complete local draft identity without actor, account or token fields", () => {
  assert.deepEqual(guestDraftIdentity(localDraft), { draftId, requestKey });
  for (const draft of [{ ...localDraft, actorId: draftId }, { ...localDraft, access_token: "private" }, { ...localDraft, draftId: "unknown" }, { ...localDraft, requestKey: "" }, { ...localDraft, step: 4 }, { ...localDraft, values: { ...localDraft.values, name: "x".repeat(101) } }, { ...localDraft, values: { name: "Missing answer shape" } }, null, []]) assert.throws(() => guestDraftIdentity(draft));
});

test("the one anonymous private probe requires actual403 and its exact safe JSON rather than200, unavailable, Origin failure or private data", () => {
  const body = { error: "Owner access is required to set up this business." }; assert.doesNotThrow(() => assertGuestPrivateDenial(403, body));
  for (const status of [200, 302, 401, 503]) assert.throws(() => assertGuestPrivateDenial(status, body));
  for (const value of [{ ...body, records: [] }, { error: "Invalid request origin." }, { error: "private SQL/token diagnostic" }, null, []]) assert.throws(() => assertGuestPrivateDenial(403, value), (error: unknown) => error instanceof Error && !error.message.includes("private SQL/token"));
});

test("deliberate Google start HTTP checks require exact origin/body/config denials without private JSON", () => {
  for (const [check, status, error] of [["missing_origin", 403, "origin_denied"], ["foreign_origin", 403, "origin_denied"], ["invalid_body", 422, "invalid_request"], ["extra_body", 422, "invalid_request"], ["oversized_body", 422, "invalid_request"], ["unavailable", 503, "google_unavailable"]] as const) {
    assert.doesNotThrow(() => assertGuestGoogleStartDenial(check, status, { error }));
    for (const wrongStatus of [200, 302, 307]) assert.throws(() => assertGuestGoogleStartDenial(check, wrongStatus, { error }));
    for (const body of [{ error, url: "https://accounts.google.com" }, { error: "private-token-detail" }, null, []]) assert.throws(() => assertGuestGoogleStartDenial(check, status, body), (failure: unknown) => failure instanceof Error && !failure.message.includes("private-token-detail"));
  }
  assert.throws(() => assertGuestGoogleStartDenial("unknown", 200, {}));
});

test("callback HTTP probes require native307, canonical fixed outcome and no body or leaked URL fields", () => {
  for (const outcome of ["failed", "expired", "unavailable"]) assert.doesNotThrow(() => assertGuestGoogleCallbackDenial(origin, 307, `${origin}/start?google=${outcome}`, outcome, new Uint8Array()));
  for (const status of [200, 302, 303, 403, 503]) assert.throws(() => assertGuestGoogleCallbackDenial(origin, status, `${origin}/start?google=failed`, "failed", new Uint8Array()));
  for (const location of [undefined, "not-url", "https://foreign.invalid/start?google=failed", `${origin}/client?google=failed`, `${origin}/start?google=failed&token=private-token-detail`, `${origin}/start?google=failed&google=failed`, `${origin}/start?google=return`, `${origin}/start?google=failed#private-token-detail`]) assert.throws(() => assertGuestGoogleCallbackDenial(origin, 307, location, "failed", new Uint8Array()), (failure: unknown) => failure instanceof Error && !failure.message.includes("private-token-detail"));
  assert.throws(() => assertGuestGoogleCallbackDenial(origin, 307, `${origin}/start?google=failed`, "failed", new TextEncoder().encode("private-token-detail")), (failure: unknown) => failure instanceof Error && !failure.message.includes("private-token-detail"));
});

test("a failed Google start keeps its completed actual403 before the unchanged422 assertion, without reflecting private body fields", async () => {
  const ledger: GoogleHttpEvidence = { checks: [], requestCount: 0, strictDenialPassed: false }; let attempts = 0, bodies = 0;
  await assert.rejects(inspectGuestGoogleStartHttp(ledger, { view: "desktop", check: "invalid_body", canonicalOrigin: true }, async () => {
    attempts++; return { status: () => 403, body: async () => { bodies++; return Buffer.from(JSON.stringify({ error: "origin_denied", token: "private-token-detail", actorId: draftId })); } };
  }), failure => failure instanceof assert.AssertionError && failure.actual === 403 && failure.expected === 422);
  assert.equal(attempts, 1); assert.equal(bodies, 1); assert.equal(ledger.requestCount, 1); assert.equal(ledger.strictDenialPassed, false);
  assert.deepEqual(ledger.checks, [{ view: "desktop", check: "invalid_body", method: "POST", path: "/auth/google/start", status: 403, outcome: null, observedError: "origin_denied", canonicalOriginSupplied: true }]);
  assert.doesNotMatch(JSON.stringify(ledger), /private-token-detail|actorId|11111111/);
});
test("unknown errors, malformed JSON and callback Locations retain only fixed diagnostic enums while the original strict check still fails", async () => {
  const ledger: GoogleHttpEvidence = { checks: [], requestCount: 0, strictDenialPassed: false };
  for (const raw of [JSON.stringify({ error: "private-token-detail", uid: draftId }), '{"error":"private-token-detail",broken', ""]) {
    await assert.rejects(inspectGuestGoogleStartHttp(ledger, { view: "phone", check: "invalid_body", canonicalOrigin: true }, async () => ({ status: () => 422, body: async () => Buffer.from(raw) })), failure => failure instanceof Error && !failure.message.includes("private-token-detail"));
    assert.equal(ledger.checks.at(-1)?.observedError, "unknown");
  }
  await assert.rejects(inspectGuestGoogleCallbackHttp(ledger, { view: "phone", check: "unknown_query", expectedOutcome: "failed", appUrl: origin }, async () => ({ status: () => 307, body: async () => Buffer.alloc(0), headers: () => ({ location: `https://foreign.invalid/start?google=return&token=private-token-detail&uid=${draftId}` }) })), failure => failure instanceof Error && !failure.message.includes("private-token-detail"));
  assert.equal(ledger.checks.at(-1)?.outcome, "return"); assert.equal(ledger.checks.at(-1)?.canonicalLocation, false);
  await assert.rejects(inspectGuestGoogleCallbackHttp(ledger, { view: "phone", check: "missing_attempt", expectedOutcome: "failed", appUrl: origin }, async () => ({ status: () => 403, body: async () => Buffer.from("private-token-detail"), headers: () => ({ location: `${origin}/start?google=untrusted-private-token-detail` }) })), failure => failure instanceof assert.AssertionError && failure.actual === 403 && failure.expected === 307);
  assert.equal(ledger.checks.at(-1)?.outcome, "unknown"); assert.equal(ledger.checks.at(-1)?.status, 403); assert.equal(ledger.requestCount, 5); assert.equal(ledger.checks.length, 5);
  assert.doesNotMatch(JSON.stringify(ledger), /private-token-detail|foreign.invalid|uid|11111111/);
});
test("actual attempted count includes a lost response without retrying or claiming a completed safe observation", async () => {
  const ledger: GoogleHttpEvidence = { checks: [], requestCount: 0, strictDenialPassed: false }, original = new Error("Synthetic original body interruption"); let attempts = 0;
  await assert.rejects(inspectGuestGoogleStartHttp(ledger, { view: "desktop", check: "unavailable", canonicalOrigin: true }, async () => { attempts++; return { status: () => 503, body: async () => { throw original; } }; }), failure => failure === original);
  assert.equal(attempts, 1); assert.equal(ledger.requestCount, 1); assert.deepEqual(ledger.checks, []); assert.equal(ledger.strictDenialPassed, false);
});
test("the full strict wire pass retains22 deliberate observations and attempts across both anonymous views", async () => {
  const ledger: GoogleHttpEvidence = { checks: [], requestCount: 0, strictDenialPassed: false };
  for (const view of ["desktop", "phone"] as const) {
    for (const [check, status, error] of [["missing_origin", 403, "origin_denied"], ["foreign_origin", 403, "origin_denied"], ["invalid_body", 422, "invalid_request"], ["extra_body", 422, "invalid_request"], ["oversized_body", 422, "invalid_request"], ["unavailable", 503, "google_unavailable"]] as const) await inspectGuestGoogleStartHttp(ledger, { view, check, canonicalOrigin: !["missing_origin", "foreign_origin"].includes(check) }, async () => ({ status: () => status, body: async () => Buffer.from(JSON.stringify({ error })) }));
    for (const check of ["missing_attempt", "tampered_attempt", "unavailable_callback", "unknown_query", "duplicate_attempt"] as const) {
      const expectedOutcome = check === "unavailable_callback" ? "unavailable" : "failed";
      await inspectGuestGoogleCallbackHttp(ledger, { view, check, expectedOutcome, appUrl: origin }, async () => ({ status: () => 307, body: async () => Buffer.alloc(0), headers: () => ({ location: `${origin}/start?google=${expectedOutcome}` }) }));
    }
  }
  assert.equal(ledger.requestCount, 22); assert.equal(ledger.checks.length, 22); assert.ok(ledger.checks.filter(check => check.method === "POST").every(check => check.observedError !== "unknown"));
  assert.ok(ledger.checks.filter(check => check.method === "GET").every(check => check.canonicalLocation === true));
});

test("an interrupted guest page closes its context and final evidence failure cannot replace the original failure", async () => {
  const artifacts = await mkdtemp(join(tmpdir(), "guest-onboarding-evidence-")), original = new Error("Synthetic interrupted public page");
  let closed = 0; const reports: GoogleOnboardingBrowserReport[] = [];
  try {
    await assert.rejects(runGoogleOnboardingBrowserScenarios({ appUrl: origin, artifacts, browser: { newContext: async () => ({ cookies: async () => [], on() {}, route: async () => {}, newPage: async () => ({ setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, on() {}, goto: async () => { throw original; } }), close: async () => { closed++; } }) }, onProgress: async report => { reports.push(report); if (report.cleanup === "complete") throw new Error("Synthetic evidence write failure"); } }), (error: unknown) => error === original);
    assert.equal(closed, 1); const actual = JSON.parse(await readFile(join(artifacts, "google-onboarding-report.json"), "utf8")) as GoogleOnboardingBrowserReport;
    assert.equal(actual.status, "failed"); assert.equal(actual.cleanup, "complete"); assert.equal(actual.checks[0].status, "failed"); assert.equal(reports.at(-1)?.cleanup, "complete"); assert.equal(actual.googleConsentProved, false); assert.equal(actual.authenticatedHandoffProved, false);
  } finally { await rm(artifacts, { recursive: true, force: true }); }
});
