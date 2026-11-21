import assert from "node:assert/strict";
import test from "node:test";
import { assertPersonalAssistantSnapshot, observePersonalAssistantSave, personalAssistantApi, personalAssistantRpc, personalAssistantScopeHeader, runPersonalAssistantBrowserScenarios, type AssistantBrowserContext, type AssistantObservedRequest, type AssistantObservedResponse } from "../scripts/personal-assistant-browser-scenarios.mjs";

const snapshot = { version: 1, preferences: { answer: "yes", assistant: "muse", revision: 3 }, connection: { state: "unavailable", label: "Muse", detail: "Preference saved; connection unavailable.", canChat: false }, available: true, canEdit: true };
const owner = { userId: "synthetic-user", clientId: "synthetic-business" }, target = { appUrl: "http://127.0.0.1:3000", supabaseUrl: "http://127.0.0.1:54321", anonKey: "synthetic-public-key" };
test("assistant acceptance requires complete versioned preferences and never promotes unavailable status to working chat", () => {
  assertPersonalAssistantSnapshot(snapshot);
  for (const value of [{ ...snapshot, connected: true }, { ...snapshot, preferences: { ...snapshot.preferences, revision: -1 } }, { ...snapshot, preferences: { answer: "no", assistant: "muse", revision: 1 } }, { ...snapshot, connection: { ...snapshot.connection, canChat: true } }, { ...snapshot, connection: { ...snapshot.connection, state: "setup_needed" } }, { ...snapshot, connection: { ...snapshot.connection, label: "Other account" } }, { ...snapshot, connection: { ...snapshot.connection, detail: "x".repeat(1001) } }]) assert.throws(() => assertPersonalAssistantSnapshot(value));
  assertPersonalAssistantSnapshot({ ...snapshot, preferences: { answer: "no", assistant: "workstation", revision: 4 }, connection: { ...snapshot.connection, state: "setup_needed", label: "Workstation assistant (ours)" } });
});
test("assistant HTTP uses genuine cookie context once, with explicit current rendered scope and complete JSON", async () => {
  const calls: { method: string; url: string; options: unknown }[] = [];
  const context = { request: {
    get: async (url: string, options: unknown) => { calls.push({ method: "GET", url, options }); return { status: () => 200, json: async () => snapshot }; },
    post: async (url: string, options: unknown) => { calls.push({ method: "POST", url, options }); return { status: () => 409, json: async () => ({ error: "Reload the saved preference." }) }; },
  } } as unknown as AssistantBrowserContext;
  await personalAssistantApi(context, target, owner);
  await personalAssistantApi(context, target, owner, { key: "synthetic", revision: 3, settings: { answer: "skipped", assistant: null } }, { expected: [409] });
  assert.equal(calls.length, 2); assert.equal(calls[0].url, `${target.appUrl}/api/business/personal-assistant`);
  assert.deepEqual(calls[0].options, { headers: personalAssistantScopeHeader(owner), timeout: 15000 });
  const post = calls[1].options as { headers: Record<string, string> }; assert.equal(post.headers.Origin, target.appUrl); assert.equal(post.headers.Authorization, undefined); assert.equal(post.headers["X-Workstation-Scope"], "synthetic-user:synthetic-business");
  let attempts = 0;
  const failing = { request: { get: async () => { attempts++; return { status: () => 200, json: async () => { throw new Error("private body"); } }; } } } as unknown as AssistantBrowserContext;
  await assert.rejects(personalAssistantApi(failing, target, owner), /complete JSON unavailable/); assert.equal(attempts, 1);
});
test("a personal assistant click cannot consume an old or unrelated HTTP response and always removes its listener", async () => {
  let listener: ((request: AssistantObservedRequest) => void) | undefined, predicate: ((response: AssistantObservedResponse) => boolean) | undefined;
  let resolve: (response: AssistantObservedResponse) => void = () => {}; let removed = 0;
  const pending = new Promise<AssistantObservedResponse>((done) => { resolve = done; });
  const page = { on: (_event: "request", callback: (request: AssistantObservedRequest) => void) => { listener = callback; }, off: () => { removed++; listener = undefined; }, waitForResponse: (check: (response: AssistantObservedResponse) => boolean) => { predicate = check; return pending; } };
  const request = (url: string, method = "POST") => ({ url: () => url, method: () => method });
  const response = (request: AssistantObservedRequest, status = 200) => ({ request: () => request, status: () => status, json: async () => snapshot });
  const prior = request(`${target.appUrl}/api/business/personal-assistant`), current = request(`${target.appUrl}/api/business/personal-assistant`);
  const result = observePersonalAssistantSave(page, target.appUrl, async () => {
    assert.equal(predicate!(response(prior)), false);
    listener!(request(`${target.appUrl}/api/business/other`)); listener!(request(`${target.appUrl}/api/business/personal-assistant`, "GET"));
    assert.equal(predicate!(response(current)), false); listener!(current); assert.equal(predicate!(response(current)), true); resolve(response(current));
  });
  assert.deepEqual(await result, snapshot); assert.equal(removed, 1);
  await assert.rejects(observePersonalAssistantSave({ ...page, waitForResponse: async () => response(current, 409) }, target.appUrl, async () => {}), /actually succeed/); assert.equal(removed, 2);
});
test("RPC proof uses only the captured JWT at the fixed backend and fails a partial success without replay", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const request = (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ preferences: snapshot.preferences, available: true, canEdit: true }), { status: 200 }); }) as typeof fetch;
  await personalAssistantRpc(target, "captured-normal-cookie-token", "get_owner_personal_assistant", { p_client: owner.clientId }, [200], request);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, `${target.supabaseUrl}/rest/v1/rpc/get_owner_personal_assistant`);
  assert.equal((calls[0].init!.headers as Record<string, string>).Authorization, "Bearer captured-normal-cookie-token"); assert.equal(calls[0].init!.redirect, "error");
  let attempts = 0; await assert.rejects(personalAssistantRpc(target, "captured", "save_owner_personal_assistant", {}, [200], (async () => { attempts++; return Response.json({ preferences: snapshot.preferences }); }) as typeof fetch), /complete stored snapshot/); assert.equal(attempts, 1);
});
test("personal assistant acceptance refuses non-hosted targets before auth, database or network access", async () => {
  let touched = false;
  await assert.rejects(runPersonalAssistantBrowserScenarios({ env: {}, readSession: async () => { touched = true; return ""; } } as unknown as Parameters<typeof runPersonalAssistantBrowserScenarios>[0]), /disposable GitHub-hosted/);
  assert.equal(touched, false);
});
