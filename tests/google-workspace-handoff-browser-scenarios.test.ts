import assert from "node:assert/strict";
import { createDecipheriv } from "node:crypto";
import test from "node:test";
import { assertGoogleHandoffScope, assertGoogleHandoffUnchanged, captureGoogleHandoffAction, finishGoogleHandoffEvidence, googleHandoffFixtureCookie, runGoogleWorkspaceHandoffBrowserScenarios,
  type GoogleHandoffActionRequest, type GoogleHandoffFixture, type GoogleHandoffReport, type GoogleHandoffScope } from "../scripts/google-workspace-handoff-browser-scenarios.mjs";

const id = (value: string) => `${value.repeat(8)}-${value.repeat(4)}-4${value.repeat(3)}-8${value.repeat(3)}-${value.repeat(12)}`;
const key = Buffer.alloc(32, 23).toString("base64");
const origin = "http://127.0.0.1:3000";
const fixture: GoogleHandoffFixture = { version: 1, attemptId: id("1"), draftId: id("2"), requestKey: id("3"), actorId: id("4"), sessionId: id("5"), issuedAt: 1000000, expiresAt: 1600000 };
const scope = { fixture: { prefix: "owner-browser-012345abcdef", partnerId: id("1") }, target: { appUrl: origin, supabaseUrl: "http://127.0.0.1:54321", anonKey: "synthetic-anon-key", serviceKey: "synthetic-service-key" },
  env: { CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_ENV: "/tmp/synthetic-env", OWNER_BROWSER_CONFIRMATION: "owner-browser-disposable", SECRETS_ENCRYPTION_KEY: key },
  owners: ["2", "3"].map((value, index) => ({ label: index ? "phone" : "desktop", userId: id(value), clientId: id(index ? "4" : "5"), membershipId: id("6"), receiptId: id("7"), marker: `owner-browser-012345abcdef-${index}`, page: {}, context: {} })) } as unknown as GoogleHandoffScope;

test("handoff fixtures reject hosted, non-CI or unscoped targets before reading or modifying any session", async () => {
  assertGoogleHandoffScope(scope);
  for (const changes of [{ env: {} }, { env: { ...scope.env, SECRETS_ENCRYPTION_KEY: "invalid" } }, { target: { ...scope.target, appUrl: "https://production.example" } }, { owners: [scope.owners[0], scope.owners[0]] }]) assert.throws(() => assertGoogleHandoffScope({ ...scope, ...changes } as GoogleHandoffScope));
  let sessions = 0;
  await assert.rejects(runGoogleWorkspaceHandoffBrowserScenarios({ ...scope, env: {}, readSession: async () => { sessions++; throw new Error(); } } as unknown as Parameters<typeof runGoogleWorkspaceHandoffBrowserScenarios>[0]), /disposable GitHub-hosted/);
  assert.equal(sessions, 0);
});

test("the fixture encrypts only the actor/session-bound navigation shape, never an Auth cookie or token", () => {
  const cookie = googleHandoffFixtureCookie(origin, key, fixture);
  assert.equal(cookie.name, "workstation_google_onboarding_handoff"); assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, "Lax"); assert.equal(cookie.secure, false);
  assert.equal(cookie.value.includes(fixture.actorId), false); assert.equal(cookie.value.includes(fixture.sessionId), false);
  const [version, iv, ciphertext, tag] = cookie.value.split("."); assert.equal(version, "v1");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "base64"), Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8"));
  assert.deepEqual(value, fixture);
  for (const bad of [{ ...fixture, access_token: "secret" }, { ...fixture, provider_token: "secret" }, { ...fixture, sessionId: null }, { ...fixture, expiresAt: fixture.expiresAt + 1 }]) assert.throws(() => googleHandoffFixtureCookie(origin, key, bad as GoogleHandoffFixture));
  assert.throws(() => googleHandoffFixtureCookie("https://production.example", key, fixture));
});

test("actual action replay retains only observed action headers and body with current browser cookies", async () => {
  const read: string[] = [], body = Buffer.from('1_$ACTION_ID=actual-observed&draftId=synthetic');
  const request: GoogleHandoffActionRequest = { url: () => `${origin}/start?google=return`, method: () => "POST", postDataBuffer: () => body,
    headerValue: async name => { read.push(name); return ({ "next-action": "observed-action", "content-type": "multipart/form-data; boundary=real", accept: "text/x-component", cookie: "secret", authorization: "Bearer secret" } as Record<string, string>)[name] ?? null; } };
  const captured = await captureGoogleHandoffAction(request, origin);
  assert.equal(captured.body, body); assert.deepEqual(read, ["content-type", "next-action", "accept", "next-router-state-tree"]);
  assert.equal(captured.headers.Origin, origin); assert.equal(captured.headers.Referer, `${origin}/start?google=return`); assert.equal(captured.headers["next-action"], "observed-action");
  assert.equal("cookie" in captured.headers, false); assert.equal("authorization" in captured.headers, false);
  for (const bad of [{ url: () => `${origin}/start?google=return&next=foreign` }, { url: () => "https://foreign.example/start?google=return" }, { method: () => "GET" }, { postDataBuffer: () => null }, { postDataBuffer: () => Buffer.alloc(1048577) }, { headerValue: async () => null }]) await assert.rejects(captureGoogleHandoffAction({ ...request, ...bad }, origin));
});

test("exact business invariants detect authority, source, receipt or paid-effect changes without echoing their contents", () => {
  const initial = { profile: { description: "private description" }, authority: { revision: 8, status: "paused" }, source: [{ updated_at: "original" }], receipt: [{ id: "prior" }], ai: [] };
  assertGoogleHandoffUnchanged(initial, structuredClone(initial));
  for (const changed of [{ ...initial, authority: { revision: 9, status: "active" } }, { ...initial, source: [] }, { ...initial, receipt: [] }, { ...initial, ai: [{ token: "secret private value" }] }]) assert.throws(() => assertGoogleHandoffUnchanged(initial, changed), error => error instanceof Error && !error.message.includes("secret") && !error.message.includes("private description"));
});

test("failed cleanup or evidence publication preserves the original assertion and still attempts every exact cleanup", async () => {
  const original = new Error("Original actual HTTP failure"), report: Pick<GoogleHandoffReport, "status" | "fixtureCleanup" | "cleanupErrors"> = { status: "failed", fixtureCleanup: "not_started", cleanupErrors: [] }, completed: string[] = [];
  await assert.rejects(finishGoogleHandoffEvidence(report, [["membership", async () => { completed.push("membership"); throw new Error("secret"); }], ["cookie", async () => { completed.push("cookie"); }]], async () => { completed.push("publish"); throw new Error("secret publication"); }, original), error => error === original);
  assert.deepEqual(completed, ["membership", "cookie", "publish"]); assert.deepEqual(report.cleanupErrors, ["membership"]); assert.equal(report.fixtureCleanup, "failed"); assert.equal(report.status, "failed");
});

test("a successful assertion cannot pass when cleanup or final publication fails", async () => {
  for (const publicationFails of [false, true]) {
    const report: Pick<GoogleHandoffReport, "status" | "fixtureCleanup" | "cleanupErrors"> = { status: "passed", fixtureCleanup: "not_started", cleanupErrors: [] };
    await assert.rejects(finishGoogleHandoffEvidence(report, [["cookie", async () => { if (!publicationFails) throw new Error("secret cookie"); }]], async () => { if (publicationFails) throw new Error("secret file"); }), error => error instanceof Error && !error.message.includes("secret"));
    assert.equal(report.status, "failed"); assert.equal(report.fixtureCleanup, publicationFails ? "complete" : "failed");
  }
});
