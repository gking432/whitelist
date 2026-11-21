import assert from "node:assert/strict";
import test from "node:test";
import { confirmOnboardingContext, loadBusinessOnboarding, loadOnboardingContext, onboardingAuthorizationUrl, onboardingConnectionNotice, OnboardingRequestError, saveBusinessOnboarding, startOnboardingConnection } from "../components/onboarding/onboarding-client.ts";
import type { OnboardingRequest, OnboardingSnapshot } from "../lib/business/onboarding-contract.ts";

const actor = "11111111-1111-4111-8111-111111111111", client = "22222222-2222-4222-8222-222222222222", partner = "33333333-3333-4333-8333-333333333333", key = "44444444-4444-4444-8444-444444444444", scope = `${actor}:${client}`;
const snapshot: OnboardingSnapshot = { available: true, canEdit: true, profileRevision: "2026-11-21T12:00:00Z", answers: { description: "Owner-supplied description" }, progress: { revision: 2, step: "description", skipped: [], finished: false } };
const command: OnboardingRequest = { key, revision: 2, action: "answer", field: "description", value: "  A real owner answer.  ", expectedProfileRevision: snapshot.profileRevision };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const requestError = (status: number) => (error: unknown) => error instanceof OnboardingRequestError && error.status === status;

test("onboarding reads use the verified render scope and reject invalid scope or partial snapshots without retry", async () => {
  let calls = 0;
  const request: typeof fetch = async (path, options) => { calls++; assert.equal(path, "/api/business/onboarding"); assert.equal(new Headers(options?.headers).get("X-Workstation-Scope"), scope); assert.equal(options?.cache, "no-store"); assert.equal(options?.credentials, "same-origin"); assert.equal(options?.redirect, "error"); return response(snapshot); };
  assert.deepEqual(await loadBusinessOnboarding(scope, undefined, request), snapshot);
  await assert.rejects(loadBusinessOnboarding("client-body-is-not-authority", undefined, request), requestError(403)); assert.equal(calls, 1);
  await assert.rejects(loadBusinessOnboarding(scope, undefined, async () => { calls++; return response({ ...snapshot, progress: { revision: 2 } }); }), requestError(503)); assert.equal(calls, 2);
});

test("only the description delta is sent, and durable receipts must match the exact key and committed revision", async () => {
  let calls = 0; const bodies: unknown[] = [];
  const saved = { snapshot: { ...snapshot, progress: { ...snapshot.progress, step: "connections", revision: 3 }, answers: { description: "A real owner answer." } }, result: { id: key, key, revision: 3, profileRevision: snapshot.profileRevision, replayed: false, cancelledWork: 0 } };
  const request: typeof fetch = async (_path, options) => { calls++; bodies.push(JSON.parse(String(options?.body))); assert.equal(options?.method, "POST"); assert.equal(new Headers(options?.headers).get("X-Workstation-Scope"), scope); return response(saved); };
  const result = await saveBusinessOnboarding(scope, command, undefined, request);
  assert.equal(result.snapshot.progress.step, "connections");
  assert.deepEqual(bodies, [{ ...command, value: "A real owner answer." }]);
  for (const extra of [{ clientId: client }, { actorId: actor }, { profile: { services: "invented defaults" } }]) await assert.rejects(saveBusinessOnboarding(scope, { ...command, ...extra } as OnboardingRequest, undefined, request), requestError(400));
  assert.equal(calls, 1);
  for (const change of [{ key: actor }, { revision: 4 }]) await assert.rejects(saveBusinessOnboarding(scope, command, undefined, async () => response({ ...saved, result: { ...saved.result, ...change } })), requestError(503));
});

test("stale, denied, malformed and lost saves cannot become Next success or reveal raw errors and never retry", async () => {
  let calls = 0;
  for (const status of [403, 409, 503]) await assert.rejects(saveBusinessOnboarding(scope, command, undefined, async () => { calls++; return response({ error: "secret token / internal source id" }, status); }), (error: unknown) => requestError(status)(error) && error instanceof Error && !error.message.includes("secret"));
  await assert.rejects(saveBusinessOnboarding(scope, command, undefined, async () => { calls++; throw new Error("secret transport credentials"); }), requestError(503));
  await assert.rejects(saveBusinessOnboarding(scope, command, undefined, async () => { calls++; return new Response("not JSON"); }), requestError(503));
  await assert.rejects(loadBusinessOnboarding(scope, undefined, async () => { calls++; return new Response("x".repeat(32769)); }), requestError(503));
  assert.equal(calls, 6);
});

test("current facts must belong to this business and only an actually reviewed current receipt can confirm them", async () => {
  const context = { revision: snapshot.profileRevision, scope: { clientId: client, partnerId: partner }, canWrite: true, facts: [{ key: "description", state: "known", value: "Owner-supplied description", reviewed: false }] };
  await assert.rejects(loadOnboardingContext(scope, undefined, async () => response({ ...context, scope: { ...context.scope, clientId: actor } })), requestError(403));
  let sent: unknown;
  const result = { id: key, revision: 1, message: "Known facts reviewed.", replayed: false, cancelledWork: 0 };
  const reviewed = { ...context, facts: [{ ...context.facts[0], reviewed: true }] };
  const saved = await confirmOnboardingContext(scope, key, context.revision, undefined, async (_path, options) => { sent = JSON.parse(String(options?.body)); return response({ result, snapshot: reviewed }); });
  assert.equal(saved.facts[0].reviewed, true); assert.deepEqual(sent, { action: "review_context", key, expectedContextRevision: context.revision });
  for (const invalid of [context, { ...reviewed, revision: "changed" }, { ...reviewed, facts: [] }]) await assert.rejects(confirmOnboardingContext(scope, key, context.revision, undefined, async () => response({ result, snapshot: invalid })), requestError(503));
});

test("optional connections use only fixed supported OAuth targets and an exact selected reconnect id", async () => {
  let calls = 0, sent: unknown;
  const url = "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic-not-live";
  assert.equal(await startOnboardingConnection(scope, "google_workspace", client, undefined, async (_path, options) => { calls++; sent = JSON.parse(String(options?.body)); return response({ url }); }), url);
  assert.deepEqual(sent, { action: "connect", provider: "google_workspace", connectionId: client, returnTo: "onboarding" });
  await assert.rejects(startOnboardingConnection(scope, "stripe", undefined, undefined, async () => { calls++; return response({ url }); }), requestError(400));
  await assert.rejects(startOnboardingConnection(scope, "hubspot", "not-a-connection-id", undefined, async () => { calls++; return response({ url }); }), requestError(400));
  assert.equal(calls, 1);
  for (const unsafe of ["https://accounts.google.com.attacker.invalid/o/oauth2/v2/auth", "https://user@accounts.google.com/o/oauth2/v2/auth", "http://accounts.google.com/o/oauth2/v2/auth", "https://accounts.google.com/other", "https://accounts.google.com/o/oauth2/v2/auth#private", "https://app.hubspot.com/oauth/authorize"]) assert.throws(() => onboardingAuthorizationUrl(unsafe, "google_workspace"));
  assert.equal(onboardingAuthorizationUrl("https://app.hubspot.com/oauth/authorize?state=synthetic", "hubspot"), "https://app.hubspot.com/oauth/authorize?state=synthetic");
});

test("HubSpot reconnect accepts only the real generic or numeric-portal authorization paths", async () => {
  const url = "https://app.hubspot.com/oauth/810001/authorize?client_id=synthetic&state=not-live";
  assert.equal(onboardingAuthorizationUrl(url, "hubspot"), url);
  assert.equal(await startOnboardingConnection(scope, "hubspot", client, undefined, async () => response({ url })), url);
  for (const unsafe of ["https://app.hubspot.com/oauth/portal-name/authorize", "https://app.hubspot.com/oauth/-810001/authorize", "https://app.hubspot.com/oauth/810001/authorize/extra", "https://app.hubspot.com/oauth/810001%2F810002/authorize", "https://app.hubspot.com.attacker.invalid/oauth/810001/authorize", "https://user:secret@app.hubspot.com/oauth/810001/authorize", "https://app.hubspot.com:8443/oauth/810001/authorize", "http://app.hubspot.com/oauth/810001/authorize", "https://app.hubspot.com/oauth/810001/authorize#private"]) assert.throws(() => onboardingAuthorizationUrl(unsafe, "hubspot"));
});

test("return notices reject controls, oversized and absent presentation values", () => {
  const message = "Connection setup returned. Current account status is shown below.";
  assert.equal(onboardingConnectionNotice(message), message);
  for (const value of [undefined, null, "", " ", "a".repeat(301), "query\nstatus", "query\u0000status"]) assert.equal(onboardingConnectionNotice(value), null);
});
