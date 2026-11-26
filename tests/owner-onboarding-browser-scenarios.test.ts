import assert from "node:assert/strict";
import test from "node:test";
import { assertOnboardingSave, assertOnboardingSnapshot, observeOnboardingPost, onboardingApi, runOwnerOnboardingBrowserScenarios, type OnboardingBrowserContext, type OnboardingObservedRequest, type OnboardingObservedResponse } from "../scripts/owner-onboarding-browser-scenarios.mjs";
import type { OnboardingRequest } from "../lib/business/onboarding-contract.ts";

const actor = "10000000-0000-4000-8000-000000000001", business = "20000000-0000-4000-8000-000000000001", key = "30000000-0000-4000-8000-000000000001";
const target = { appUrl: "http://127.0.0.1:3000" }, scopeKey = `${actor}:${business}`;
const snapshot = { available: true, canEdit: true, profileRevision: "actual-profile-version", answers: { description: "Owner supplied description." }, progress: { revision: 2, step: "connections", skipped: [], finished: false } };
const command: OnboardingRequest = { action: "navigate", step: "connections", key, revision: 1 };
const response = { snapshot, result: { id: key, key, revision: 2, profileRevision: snapshot.profileRevision, replayed: false, cancelledWork: 0 } };
test("onboarding wire proof rejects partial facts/progress and mismatched durable request receipts", () => {
  assertOnboardingSnapshot(snapshot); assertOnboardingSave(response, command, false);
  for (const value of [{ ...snapshot, answers: {} }, { ...snapshot, progress: { ...snapshot.progress, step: "invented" } }, { ...snapshot, progress: { ...snapshot.progress, step: "done" } }, { ...snapshot, progress: { ...snapshot.progress, revision: -1 } }, { ...snapshot, progress: { ...snapshot.progress, skipped: ["assistant", "assistant"] } }]) assert.throws(() => assertOnboardingSnapshot(value));
  for (const result of [{ ...response.result, key: actor }, { ...response.result, replayed: undefined }, { ...response.result, revision: 3 }, { ...response.result, cancelledWork: -1 }, { ...response.result, profileRevision: "" }]) assert.throws(() => assertOnboardingSave({ ...response, result }, command, false));
  assert.throws(() => assertOnboardingSave(response, command, true));
});
test("onboarding HTTP preserves the genuine cookie context and exact server scope, completes JSON and never retries a conflict", async () => {
  const calls: { method: string; url: string; options: unknown }[] = []; let reads = 0;
  const context: OnboardingBrowserContext = { request: {
    get: async (url, options) => { calls.push({ method: "GET", url, options }); return { status: () => 200, json: async () => { reads++; return snapshot; } }; },
    post: async (url, options) => { calls.push({ method: "POST", url, options }); return { status: () => 409, json: async () => { reads++; return { error: "Reload saved setup." }; } }; },
  } };
  await onboardingApi(context, target, scopeKey); await onboardingApi(context, target, scopeKey, command, { expected: [409] });
  assert.equal(calls.length, 2); assert.equal(reads, 2); assert.equal(calls[0].url, `${target.appUrl}/api/business/onboarding`);
  assert.deepEqual(calls[0].options, { headers: { "X-Workstation-Scope": scopeKey }, timeout: 15000 });
  assert.deepEqual(calls[1].options, { headers: { "X-Workstation-Scope": scopeKey, Origin: target.appUrl }, data: command, timeout: 15000 });
});
test("unexpected access denial and malformed successful JSON remain failures with no healing request or secret error leakage", async () => {
  let attempts = 0;
  const context = (status: number, json: () => Promise<unknown>): OnboardingBrowserContext => ({ request: { get: async () => { attempts++; return { status: () => status, json }; }, post: async () => { throw new Error("Unexpected mutation while reading onboarding."); } } });
  await assert.rejects(onboardingApi(context(403, async () => ({ error: "Owner access is required to set up this business." })), target, scopeKey), (error) => error instanceof assert.AssertionError && error.actual === 403 && error.expected === 200);
  assert.equal(attempts, 1);
  await assert.rejects(onboardingApi(context(200, async () => { throw new Error("private-cookie-token"); }), target, scopeKey), (error) => error instanceof Error && /complete JSON unavailable/.test(error.message) && !error.message.includes("private-cookie-token"));
  assert.equal(attempts, 2);
  await assert.rejects(onboardingApi(context(200, async () => ({ available: true })), target, scopeKey), /snapshot must be complete/);
  assert.equal(attempts, 3);
});
test("wizard click proof binds only its new exact action and always removes its listener", async () => {
  let listener: ((request: OnboardingObservedRequest) => void) | undefined, predicate: ((response: OnboardingObservedResponse) => boolean) | undefined, resolve: (response: OnboardingObservedResponse) => void = () => {}, detached = 0;
  const pending = new Promise<OnboardingObservedResponse>(done => { resolve = done; });
  const page = { on: (_event: "request", fn: (request: OnboardingObservedRequest) => void) => { listener = fn; }, off: () => { listener = undefined; detached++; }, waitForResponse: (fn: (response: OnboardingObservedResponse) => boolean) => { predicate = fn; return pending; } };
  const request = (body: unknown, path = "/api/business/onboarding", method = "POST") => ({ url: () => target.appUrl + path, method: () => method, postDataJSON: () => body });
  const result = (request: OnboardingObservedRequest, status = 200) => ({ request: () => request, status: () => status });
  const prior = request(command), current = request(command), wrong = request({ ...command, step: "done" });
  await observeOnboardingPost(page, target.appUrl, { action: "navigate", step: "connections" }, async () => {
    assert.equal(predicate!(result(prior)), false); listener!(wrong); assert.equal(predicate!(result(wrong)), false);
    listener!(request(command, "/other")); listener!(request(command, "/api/business/onboarding", "GET")); assert.equal(predicate!(result(current)), false);
    listener!(current); assert.equal(predicate!(result(current)), true); resolve(result(current));
  });
  assert.equal(detached, 1);
  await assert.rejects(observeOnboardingPost({ ...page, waitForResponse: async () => result(current, 409) }, target.appUrl, { action: "navigate" }, async () => {}), /actually return HTTP 200/); assert.equal(detached, 2);
  await assert.rejects(observeOnboardingPost({ ...page, waitForResponse: async () => { throw new Error("bounded response deadline"); } }, target.appUrl, { action: "navigate" }, async () => {}), /bounded response deadline/); assert.equal(detached, 3);
});
test("new onboarding acceptance refuses unconfirmed/non-hosted targets before any session, browser or database access", async () => {
  let contacted = false;
  await assert.rejects(runOwnerOnboardingBrowserScenarios({ env: {}, admin: { from() { contacted = true; } } } as unknown as Parameters<typeof runOwnerOnboardingBrowserScenarios>[0]), /disposable GitHub-hosted/);
  assert.equal(contacted, false);
});
