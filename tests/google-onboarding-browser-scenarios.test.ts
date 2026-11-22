import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertGuestGoogleCallbackDenial, assertGuestGoogleStartDenial, assertGuestPrivateDenial, classifyGuestOnboardingRequest, createGuestOnboardingRequestGuard, guestDraftIdentity, runGoogleOnboardingBrowserScenarios, type GoogleOnboardingBrowserReport } from "../scripts/google-onboarding-browser-scenarios.mjs";

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

test("an interrupted guest page closes its context and final evidence failure cannot replace the original failure", async () => {
  const artifacts = await mkdtemp(join(tmpdir(), "guest-onboarding-evidence-")), original = new Error("Synthetic interrupted public page");
  let closed = 0; const reports: GoogleOnboardingBrowserReport[] = [];
  try {
    await assert.rejects(runGoogleOnboardingBrowserScenarios({ appUrl: origin, artifacts, browser: { newContext: async () => ({ cookies: async () => [], on() {}, route: async () => {}, newPage: async () => ({ setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, on() {}, goto: async () => { throw original; } }), close: async () => { closed++; } }) }, onProgress: async report => { reports.push(report); if (report.cleanup === "complete") throw new Error("Synthetic evidence write failure"); } }), (error: unknown) => error === original);
    assert.equal(closed, 1); const actual = JSON.parse(await readFile(join(artifacts, "google-onboarding-report.json"), "utf8")) as GoogleOnboardingBrowserReport;
    assert.equal(actual.status, "failed"); assert.equal(actual.cleanup, "complete"); assert.equal(actual.checks[0].status, "failed"); assert.equal(reports.at(-1)?.cleanup, "complete"); assert.equal(actual.googleConsentProved, false); assert.equal(actual.authenticatedHandoffProved, false);
  } finally { await rm(artifacts, { recursive: true, force: true }); }
});
