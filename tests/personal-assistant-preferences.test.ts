import assert from "node:assert/strict";
import test from "node:test";
import { PersonalAssistantSaveSchema, PersonalAssistantSettingsSchema, PersonalAssistantSnapshotSchema, personalAssistantSnapshot } from "../lib/personal-assistant/preferences-contract.ts";
import { loadPersonalAssistantPreference, PersonalAssistantRequestError, savePersonalAssistantPreference } from "../lib/personal-assistant/preferences-client.ts";

const key = "11111111-1111-4111-8111-111111111111";
const scope = `${key}:${key}`;
const settings = { answer: "yes", assistant: "chatgpt_dot" } as const;
const snapshot = (revision = 1) => personalAssistantSnapshot({ preferences: { ...settings, revision }, available: true, canEdit: true });

test("assistant answers are explicit, reversible and cannot carry connection or actor authority", () => {
  for (const value of [{ answer: "unanswered", assistant: null }, { answer: "skipped", assistant: null }, { answer: "no", assistant: null }, { answer: "no", assistant: "workstation" }, ...["muse", "chatgpt_dot", "grok", "other"].map(assistant => ({ answer: "yes", assistant }))]) assert.equal(PersonalAssistantSettingsSchema.safeParse(value).success, true);
  for (const value of [{ answer: "yes", assistant: null }, { answer: "yes", assistant: "workstation" }, { answer: "no", assistant: "muse" }, { answer: "skipped", assistant: "grok" }, { answer: "yes", assistant: "unknown" }, { ...settings, connected: true }, { ...settings, actorId: key }]) assert.equal(PersonalAssistantSettingsSchema.safeParse(value).success, false);
  assert.equal(PersonalAssistantSaveSchema.safeParse({ key, revision: Number.MAX_SAFE_INTEGER, settings }).success, false);
});

test("selecting any assistant cannot establish a connection, conversation or shared-manager identity", () => {
  for (const assistant of ["muse", "chatgpt_dot", "grok", "other", "workstation"] as const) {
    const value = personalAssistantSnapshot({ preferences: { answer: assistant === "workstation" ? "no" : "yes", assistant, revision: 1 }, available: true, canEdit: true });
    assert.equal(value.connection.canChat, false);
    assert.equal(value.connection.state, assistant === "workstation" ? "setup_needed" : "unavailable");
    assert.equal(PersonalAssistantSnapshotSchema.safeParse(value).success, true);
    assert.equal(PersonalAssistantSnapshotSchema.safeParse({ ...value, connection: { ...value.connection, state: "connected", canChat: true } }).success, false);
    assert.equal(PersonalAssistantSnapshotSchema.safeParse({ ...value, connection: { ...value.connection, label: "Business manager" } }).success, false);
  }
});

test("client saves once through the real preference API and validates the exact saved choice", async () => {
  const calls: { url: string; input?: RequestInit }[] = [];
  const request: typeof fetch = async (url, input) => { calls.push({ url: String(url), input }); return Response.json(snapshot()); };
  assert.deepEqual(await savePersonalAssistantPreference(scope, { key, revision: 0, settings }, undefined, request), snapshot());
  assert.equal(calls.length, 1); assert.equal(calls[0].url, "/api/business/personal-assistant");
  assert.equal(calls[0].input?.credentials, "same-origin"); assert.equal(calls[0].input?.cache, "no-store");
  assert.equal(new Headers(calls[0].input?.headers).get("x-workstation-scope"), scope);
  assert.deepEqual(JSON.parse(String(calls[0].input?.body)), { key, revision: 0, settings });
  assert.deepEqual(await loadPersonalAssistantPreference(scope, undefined, request), snapshot());
  assert.equal(calls[1].input?.method, undefined);
});

test("conflicts, denied access and lost/malformed receipts never retry or manufacture success", async () => {
  for (const status of [400, 403, 409, 413, 503]) {
    let calls = 0;
    await assert.rejects(savePersonalAssistantPreference(scope, { key, revision: 0, settings }, undefined, async () => { calls++; return Response.json({ error: "private database diagnostic" }, { status }); }), (e: unknown) => e instanceof PersonalAssistantRequestError && e.status === status && !e.message.includes("private database"));
    assert.equal(calls, 1);
  }
  for (const response of [new Response("unfinished JSON"), Response.json({ ...snapshot(), connection: { state: "connected", canChat: true } }), Response.json(snapshot(9)), new Response("x".repeat(8193))]) {
    let calls = 0;
    await assert.rejects(savePersonalAssistantPreference(scope, { key, revision: 0, settings }, undefined, async () => { calls++; return response; }), (e: unknown) => e instanceof PersonalAssistantRequestError && e.status === 503);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(savePersonalAssistantPreference(scope, { key, revision: 0, settings }, undefined, async () => { calls++; throw new Error("secret transport error"); }), (e: unknown) => e instanceof PersonalAssistantRequestError && e.status === 503 && !e.message.includes("secret"));
  assert.equal(calls, 1);
});

test("caller cancellation keeps a deadline and invalid render scope never sends a request", async () => {
  const original = AbortSignal.timeout;
  const caller = new AbortController(); let calls = 0;
  try {
    AbortSignal.timeout = () => {
      const timer = new AbortController(); setTimeout(() => timer.abort(new DOMException("deadline", "TimeoutError")), 5); return timer.signal;
    };
    await assert.rejects(loadPersonalAssistantPreference(scope, caller.signal, async (_url, input) => {
      calls++; assert.notEqual(input?.signal, caller.signal);
      return await new Promise<Response>((_resolve, reject) => input?.signal?.addEventListener("abort", () => reject(input.signal?.reason), { once: true }));
    }), (error: unknown) => error instanceof PersonalAssistantRequestError && error.status === 503);
    assert.equal(calls, 1); assert.equal(caller.signal.aborted, false);
  } finally { AbortSignal.timeout = original; }
  calls = 0;
  await assert.rejects(loadPersonalAssistantPreference("untrusted-scope", undefined, async () => { calls++; return Response.json(snapshot()); }), (error: unknown) => error instanceof PersonalAssistantRequestError && error.status === 403);
  assert.equal(calls, 0);
});
