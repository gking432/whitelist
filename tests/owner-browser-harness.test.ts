import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createChunks, stringToBase64URL } from "@supabase/ssr";
import { assertMailpitContainer, browserEnvironment, browserOptions, cleanupMailbox, diagnoseOwnerWorkspaceAccess, freshMailboxEntries, mailpitMailboxEntries, main, ownerSessionTokenFromCookies, readOwnerBrowserSession, observedOwnerSessionIdentity, OWNER_BROWSER_CONFIRMATION, PLAYWRIGHT_VERSION, redactBrowserFailure, verificationLinkFromMessage, verifyObservedOwnerSession, type OwnerBrowserSessionCookie } from "../scripts/verify-owner-browser.mjs";
import { browserFixtureIdentity } from "../scripts/owner-browser-fixtures.mjs";
import { collectWorkspacePreferencePosts, inspectWorkspacePreferenceResponse, readWorkspacePreferenceSnapshot, observeNewWorkspaceActivity, runOwnerWorkspaceScenarios, withOwnerBrowserDeadline, workspaceActivityFixture, type WorkspaceActivityRequest, type WorkspaceActivityResponse } from "../scripts/owner-workspace-browser-scenarios.mjs";

const hosted = { CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_ENV: "/tmp/owner-browser-env", RUNNER_TEMP: "/tmp/owner-browser-runner",
  OWNER_BROWSER_CONFIRMATION, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-public-key", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
  OWNER_BROWSER_PLAYWRIGHT_MODULE: "/tmp/owner-browser-runner/owner-browser/node_modules/playwright/index.mjs" };
test("browser acceptance defaults to blocked before contacting an app, database, browser or auth service", async () => {
  await assert.rejects(main([], {} as NodeJS.ProcessEnv), /restricted to a disposable GitHub-hosted CI runner/);
  assert.throws(() => browserEnvironment({ ...hosted, OWNER_BROWSER_CONFIRMATION: "yes" }), /OWNER_BROWSER_CONFIRMATION/);
  assert.throws(() => browserEnvironment({ ...hosted, RUNNER_ENVIRONMENT: "self-hosted" }), /GitHub-hosted/);
  assert.throws(() => browserEnvironment({ ...hosted, NORTHSTAR_DEV_AUTO_LOGIN: "true" }), /forbids development auto-login/);
  assert.equal(PLAYWRIGHT_VERSION, "1.65.1");
});
test("only explicit loopback API/app origins and a pinned external CI module location are accepted", () => {
  assert.equal(browserEnvironment(hosted).appUrl, "http://127.0.0.1:3000");
  for (const changes of [{ NEXT_PUBLIC_SUPABASE_URL: "https://production.supabase.co" }, { NEXT_PUBLIC_SUPABASE_URL: "http://user:secret@127.0.0.1:54321" },
    { OWNER_BROWSER_APP_URL: "http://127.0.0.1:3001" }, { OWNER_BROWSER_APP_URL: "http://127.0.0.1:3000?target=prod" },
    { OWNER_BROWSER_PLAYWRIGHT_MODULE: "/Users/owner/project/node_modules/playwright/index.mjs" }, { OWNER_BROWSER_ARTIFACTS: "/Users/owner/evidence" }])
    assert.throws(() => browserEnvironment({ ...hosted, ...changes }));
  assert.equal(browserEnvironment({ ...hosted, OWNER_BROWSER_PLAYWRIGHT_MODULE: "" }, false).modulePath, "", "Read-only preflight does not need a browser dependency.");
});
test("only the real GoTrue verification link bound to this app and first-owner path can be followed", () => {
  const target = { supabaseUrl: "http://127.0.0.1:54321", appUrl: "http://127.0.0.1:3000" };
  const destination = `${target.appUrl}/auth/confirm?next=%2Fstart`;
  const link = `${target.supabaseUrl}/auth/v1/verify?token=synthetic-once&type=magiclink&redirect_to=${encodeURIComponent(destination)}`;
  assert.equal(verificationLinkFromMessage({ HTML: `<a href="${link.replaceAll("&", "&amp;")}">Sign in</a>` }, target), link);
  for (const bad of [link.replace("127.0.0.1:54321", "evil.test"), link.replace("type=magiclink", "type=recovery"), link.replace(encodeURIComponent(destination), encodeURIComponent("https://evil.test/auth/confirm?next=%2Fstart")), link.replace("token=synthetic-once", "missing=token")])
    assert.equal(verificationLinkFromMessage({ Text: bad }, target), null);
  assert.equal(verificationLinkFromMessage({ Text: "No actual sign-in link" }, target), null);
});
test("diagnostics remove verification links, session tokens and explicit credentials", () => {
  const message = "service=secret-value http://127.0.0.1:54321/auth/v1/verify?token=one-use&type=magiclink access_token=token-one refresh_token=token-two code=code-three";
  const redacted = redactBrowserFailure(message, ["secret-value"]);
  for (const sensitive of ["secret-value", "one-use", "token-one", "token-two", "code-three"]) assert.equal(redacted.includes(sensitive), false);
  assert.match(redacted, /redacted/);
});
test("re-login ignores consumed messages and requires a newly observed mailbox ID", () => {
  const old = { id: "consumed-before-logout" }, fresh = { id: "new-one-use-message" };
  assert.deepEqual(freshMailboxEntries([old, fresh, { id: null }], [old.id]), [fresh]);
  assert.deepEqual(freshMailboxEntries([old], [old.id]), []);
  assert.throws(() => freshMailboxEntries({ message: "unusable" }, []), /unsupported response/);
});
test("the legacy Inbucket container must be the pinned running Mailpit image with the configured port", () => {
  const container = { Name: "/supabase_inbucket_partner-platform", State: { Running: true }, Config: { Image: "public.ecr.aws/supabase/mailpit:v1.22.3" }, NetworkSettings: { Ports: { "8025/tcp": [{ HostPort: "54324" }] } } };
  assert.doesNotThrow(() => assertMailpitContainer([container], "http://127.0.0.1:54324"));
  for (const change of [{ Name: "/unrelated" }, { State: { Running: false } }, { Config: { Image: "inbucket/inbucket:latest" } }, { Config: { Image: "axllent/mailpit:latest" } }, { NetworkSettings: { Ports: { "8025/tcp": [{ HostPort: "54325" }] } } }])
    assert.throws(() => assertMailpitContainer([{ ...container, ...change }], "http://127.0.0.1:54324"), /pinned Mailpit/);
});
test("Mailpit search results require exact recipients and complete bounded message IDs", () => {
  const email = "owner-browser-012345abcdef-phone@example.test";
  const old = { ID: "consumed-message", To: [{ Address: email }] }, fresh = { ID: "new-message", To: [{ Address: email.toUpperCase() }] };
  const wrong = { ID: "wrong-recipient", To: [{ Name: email, Address: `other-${email}` }] };
  const response = { start: 0, messages_count: 3, messages: [fresh, old, wrong] };
  const entries = mailpitMailboxEntries(response, email);
  assert.deepEqual(entries, [{ id: fresh.ID }, { id: old.ID }]);
  assert.deepEqual(freshMailboxEntries(entries, [old.ID]), [{ id: fresh.ID }]);
  assert.deepEqual(mailpitMailboxEntries({ start: 0, messages_count: 0, messages: [] }, email), []);
  for (const invalid of [[], { ...response, messages_count: 4 }, { ...response, start: 50 }, { start: 0, messages_count: 1, messages: [{ ...fresh, ID: "latest" }] }])
    assert.throws(() => mailpitMailboxEntries(invalid, email), /unsupported/);
});
test("Mailpit cleanup sends only exact synthetic-recipient IDs and never an empty global delete", async () => {
  const email = "owner-browser-012345abcdef-phone@example.test", calls: { url: URL; method: string; body?: BodyInit | null }[] = [];
  const request = (messages: unknown[]) => async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); calls.push({ url, method: init?.method || "GET", body: init?.body });
    return url.pathname === "/api/v1/search" ? Response.json({ start: 0, messages_count: messages.length, messages }) : new Response("ok");
  };
  const target = { inbucketUrl: "http://127.0.0.1:54324" };
  await cleanupMailbox(target, email, request([]));
  assert.equal(calls.length, 1); assert.equal(calls[0].url.searchParams.get("query"), `to:${email}`); assert.equal(calls[0].method, "GET");
  calls.length = 0;
  await cleanupMailbox(target, email, request([{ ID: "owned-message", To: [{ Address: email }] }, { ID: "foreign-message", To: [{ Address: "other@example.test" }] }]));
  assert.equal(calls.length, 2); assert.equal(calls[1].method, "DELETE"); assert.equal(calls[1].url.pathname, "/api/v1/messages");
  assert.deepEqual(JSON.parse(String(calls[1].body)), { IDs: ["owned-message"] });
});
test("fixture identities are bounded synthetic tags and plan mode never claims a completed browser run", () => {
  const fixture = browserFixtureIdentity("012345abcdef");
  assert.equal(fixture.owners.length, 2); assert.notEqual(fixture.owners[0].email, fixture.owners[1].email);
  assert.ok(fixture.owners.every((owner: { email: string }) => owner.email.startsWith("owner-browser-012345abcdef-") && owner.email.endsWith("@example.test")));
  assert.throws(() => browserFixtureIdentity("real-customer"), /fixture tag/);
  assert.deepEqual(browserOptions(["--preflight"]), { plan: false, preflight: true });
  assert.throws(() => browserOptions(["--plan", "--preflight"]), /Use no arguments/);
  const plan = spawnSync(process.execPath, ["scripts/verify-owner-browser.mjs", "--plan"], { encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH } });
  assert.equal(plan.status, 0); assert.equal(JSON.parse(plan.stdout).status, "not_run"); assert.doesNotMatch(plan.stdout, /acceptance passed/);
});
test("workspace evidence fixtures contain only scoped enum/day aggregates in the actual business timezone", () => {
  const owner = { userId: "11111111-1111-4111-8111-111111111111", clientId: "22222222-2222-4222-8222-222222222222", label: "desktop" as const }, partnerId = "33333333-3333-4333-8333-333333333333";
  const rows = workspaceActivityFixture(owner, partnerId, new Date("2026-11-18T00:30:00Z"));
  assert.equal(rows.length, 8); assert.equal(rows[0].activity_date, "2026-11-17");
  assert.equal(new Set(rows.filter((row) => row.module === "messages").map((row) => row.activity_date)).size, 5);
  assert.equal(new Set(rows.filter((row) => row.module === "appointments").map((row) => row.activity_date)).size, 3);
  assert.ok(rows.every((row) => row.user_id === owner.userId && row.client_id === owner.clientId && row.partner_id === partnerId && Object.keys(row).sort().join(",") === "activity_date,client_id,module,partner_id,user_id"));
  assert.equal(workspaceActivityFixture({ ...owner, label: "phone" }, partnerId).filter((row) => row.module === "appointments").length, 5);
  assert.throws(() => workspaceActivityFixture({ ...owner, userId: "unknown" }, partnerId), /exact disposable/);
});
test("workspace scenario service fixtures refuse to run without the hosted disposable CI guard", async () => {
  await assert.rejects(runOwnerWorkspaceScenarios({ env: {} } as Parameters<typeof runOwnerWorkspaceScenarios>[0]), /disposable GitHub-hosted/);
});
test("browser deadlines fail a stalled operation and preserve genuine operation failures", async () => {
  assert.equal(await withOwnerBrowserDeadline("completed unit operation", async () => "completed", 100), "completed");
  const original = new Error("Real operation failed");
  await assert.rejects(withOwnerBrowserDeadline("failed unit operation", () => { throw original; }, 100), (error) => error === original);
  await assert.rejects(withOwnerBrowserDeadline("stalled response body", () => new Promise(() => {}), 10), { name: "OwnerBrowserDeadlineError", message: "Owner browser deadline exceeded: stalled response body (10ms)." });
  for (const timeout of [0, -1, NaN, Infinity, 180001]) await assert.rejects(withOwnerBrowserDeadline("invalid deadline", () => "must not run", timeout), /finite bounded/);
});
test("a late failing operation after its deadline does not create an unhandled waiter", async () => {
  let rejectOperation: (reason: Error) => void = () => {};
  const operation = new Promise<never>((_, reject) => { rejectOperation = reject; });
  await assert.rejects(withOwnerBrowserDeadline("stalled channel", () => operation, 10), /stalled channel/);
  rejectOperation(new Error("Channel closed after bounded cleanup"));
  await Promise.resolve();
});
test("workspace activity requires real visibility inside the diagnosed stage without untimed tab activation", async () => {
  const phases: string[] = [], prefix = "owner-browser-012345abcdef";
  const values: Record<string, object> = { first_owner_workspaces: { error: null, data: { id: "receipt" } }, client_businesses: { error: null, data: { timezone: "America/Chicago" } }, agent_team_settings: { error: null, data: { status: "paused", channel_authority: { email: "off" } } }, action_jobs: { error: null, count: 0 }, agent_work_items: { error: null, count: 0 } };
  const queries: string[] = [];
  const admin = { from(table: string) { queries.push(table); const response = values[table]; assert.ok(response); const builder = { select() { return builder; }, eq() { return builder; }, async single() { return response; }, then(resolve: (value: object) => unknown) { return Promise.resolve(response).then(resolve); } }; return builder; } };
  const page = { async waitForFunction() { throw new Error("Document did not become visible"); }, async bringToFront() { assert.fail("An untimed front activation must not precede the tracked stage."); } };
  const owner = { userId: "11111111-1111-4111-8111-111111111111", clientId: "22222222-2222-4222-8222-222222222222", label: "desktop", marker: `${prefix}-desktop-source`, receiptId: "receipt", name: "Synthetic owner", page };
  const options = { admin, fixture: { prefix, partnerId: "33333333-3333-4333-8333-333333333333" }, owners: [owner, { ...owner, userId: "44444444-4444-4444-8444-444444444444", label: "phone" }], target: {}, env: hosted, step: async (_label: string, action: () => Promise<void>) => action(), phase: async (label: string) => { phases.push(label); }, screenshot: async () => {} };
  await assert.rejects(runOwnerWorkspaceScenarios(options as unknown as Parameters<typeof runOwnerWorkspaceScenarios>[0]), /did not become visible/);
  assert.equal(phases.at(-1), "desktop: require real document visibility");
  assert.deepEqual(queries, ["first_owner_workspaces", "client_businesses", "agent_team_settings", "action_jobs", "agent_work_items"]);
});

function activityObserverFixture(automatic = false) {
  const listeners = new Set<(request: WorkspaceActivityRequest) => void>(), registration: string[] = [];
  let predicate: (response: WorkspaceActivityResponse) => boolean = () => false, resolve: (response: WorkspaceActivityResponse) => void = () => {}, reject: (error: Error) => void = () => {};
  const request = (overrides: { url?: string; method?: string; action?: string; area?: string } = {}): WorkspaceActivityRequest => ({ url: () => overrides.url || "http://127.0.0.1:3000/api/business/workspace-preferences", method: () => overrides.method || "POST", postDataJSON: () => ({ action: overrides.action || "activity", module: overrides.area || "messages" }) });
  const emit = (value: WorkspaceActivityRequest) => { for (const listener of listeners) listener(value); };
  const respond = (value: WorkspaceActivityRequest) => { const response = { request: () => value, status: () => 200 }; if (!predicate(response)) return false; resolve(response); return true; };
  const page = {
    on(_event: "request", listener: (request: WorkspaceActivityRequest) => void) { registration.push("request listener"); listeners.add(listener); },
    off(_event: "request", listener: (request: WorkspaceActivityRequest) => void) { listeners.delete(listener); },
    waitForResponse(match: (response: WorkspaceActivityResponse) => boolean, options: { timeout: number }) { registration.push("response waiter"); assert.equal(options.timeout, 20000); predicate = match; return new Promise<WorkspaceActivityResponse>((done, fail) => { resolve = done; reject = fail; }); },
    async waitForFunction() {},
    async goto(url: string) { if (automatic && new URL(url).pathname === "/client/messages") { const value = request(); emit(value); assert.equal(respond(value), true); } },
  };
  return { page, request, emit, respond, listeners, registration, fail: (error: Error) => reject(error) };
}
test("activity observations exclude old navigation responses and match only a new exact collector request", async () => {
  const fixture = activityObserverFixture(), old = fixture.request(); fixture.emit(old);
  const pending = observeNewWorkspaceActivity(fixture.page, "http://127.0.0.1:3000", "messages");
  assert.deepEqual(fixture.registration, ["request listener", "response waiter"]);
  assert.equal(fixture.respond(old), false);
  for (const wrong of [{ area: "appointments" }, { action: "save" }, { method: "GET" }, { url: "https://outside.invalid/api/business/workspace-preferences" }]) {
    const value = fixture.request(wrong); fixture.emit(value); assert.equal(fixture.respond(value), false);
  }
  const current = fixture.request(); fixture.emit(current); assert.equal(fixture.respond(current), true);
  assert.equal((await pending).request(), current); assert.equal(fixture.listeners.size, 0);
  const repeated = observeNewWorkspaceActivity(fixture.page, "http://127.0.0.1:3000", "messages");
  assert.equal(fixture.respond(current), false, "A second navigation must observe another new request.");
  const next = fixture.request(); fixture.emit(next); assert.equal(fixture.respond(next), true); assert.equal((await repeated).request(), next);
});
test("failed activity observation removes its request listener without changing the failure", async () => {
  const fixture = activityObserverFixture(), error = new Error("Actual collector did not respond");
  const pending = observeNewWorkspaceActivity(fixture.page, "http://127.0.0.1:3000", "messages"); fixture.fail(error);
  await assert.rejects(pending, (value) => value === error); assert.equal(fixture.listeners.size, 0);
});
test("HTTP200 with two empty activity reads cannot pass the real navigation persistence proof", async () => {
  const prefix = "owner-browser-012345abcdef", fixture = activityObserverFixture(true), queries: string[] = [], filters: [string, unknown][] = [];
  const values: Record<string, object> = { first_owner_workspaces: { error: null, data: { id: "receipt" } }, client_businesses: { error: null, data: { timezone: "America/Chicago" } }, agent_team_settings: { error: null, data: { status: "paused", channel_authority: { email: "off" } } }, action_jobs: { error: null, count: 0 }, agent_work_items: { error: null, count: 0 }, owner_workspace_activity: { error: null, data: [] } };
  const admin = { from(table: string) { queries.push(table); const value = values[table]; assert.ok(value); const builder = { select() { return builder; }, eq(key: string, content: unknown) { if (table === "owner_workspace_activity") filters.push([key, content]); return builder; }, async single() { return value; }, then(resolve: (result: object) => unknown) { return Promise.resolve(value).then(resolve); } }; return builder; } };
  const owner = { userId: "11111111-1111-4111-8111-111111111111", clientId: "22222222-2222-4222-8222-222222222222", label: "desktop", marker: `${prefix}-desktop-source`, receiptId: "receipt", name: "Synthetic owner", page: fixture.page };
  const options = { admin, fixture: { prefix, partnerId: "33333333-3333-4333-8333-333333333333" }, owners: [owner, { ...owner, userId: "44444444-4444-4444-8444-444444444444", label: "phone" }], target: { appUrl: "http://127.0.0.1:3000" }, env: hosted, step: async (_key: string, action: () => Promise<void>) => action(), screenshot: async () => {} };
  await assert.rejects(runOwnerWorkspaceScenarios(options as unknown as Parameters<typeof runOwnerWorkspaceScenarios>[0]), /Exactly one scoped activity row/);
  assert.equal(queries.filter((table) => table === "owner_workspace_activity").length, 1, "Failure precedes repeat opens and synthetic aggregate insertion.");
  assert.deepEqual(filters.slice(0, 4), [["user_id", owner.userId], ["client_id", owner.clientId], ["partner_id", options.fixture.partnerId], ["module", "messages"]]);
  assert.match(String(filters[4][1]), /^\d{4}-\d{2}-\d{2}$/); assert.equal(filters[4][0], "activity_date");
});
test("a header timeout cannot erase the other concurrent preference response or retry either command", async () => {
  const calls: unknown[] = [], receipt = { snapshot: { preferences: { revision: 3, displayName: "Actual saved value" } } };
  const request = async (_url: string | URL | Request, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body)); calls.push(command); assert.ok(init?.signal);
    if (command.requestKey === "first") throw new DOMException("Sensitive transport text must not be copied", "TimeoutError");
    return Response.json(receipt);
  };
  const bodies = [{ requestKey: "first" }, { requestKey: "second" }];
  const result = await collectWorkspacePreferencePosts({ path: "/api/business/workspace-preferences", bodies }, request);
  assert.deepEqual(result[0], { complete: false, status: null, body: null, failedAt: "headers", reason: "timeout" });
  assert.deepEqual(result[1], { complete: true, status: 200, body: receipt, failedAt: null, reason: null });
  assert.deepEqual(calls, bodies, "Only the original two requests execute, without an automatic retry or fallback.");
  assert.equal(JSON.stringify(result).includes("Sensitive transport"), false);
});
test("preference diagnostics retain a409 header when its JSON body times out, without accepting the result", async () => {
  let index = 0;
  const request = async () => {
    if (index++ === 0) { const response = new Response(null, { status: 409 }); response.json = async () => { throw new DOMException("body timeout", "TimeoutError"); }; return response; }
    return Response.json({ snapshot: { preferences: { revision: 5 } } });
  };
  const result = await collectWorkspacePreferencePosts({ path: "/api/business/workspace-preferences", bodies: [{}, {}] }, request);
  assert.deepEqual(result[0], { complete: false, status: 409, body: null, failedAt: "json_body", reason: "timeout" });
  assert.equal(result[1].complete, true); assert.equal(result[1].status, 200);
  assert.equal(result.every((outcome) => outcome.complete), false, "Expected header statuses alone cannot make a race pass.");
});
test("invalid preference JSON remains a failed body outcome rather than a successful receipt", async () => {
  const result = await collectWorkspacePreferencePosts({ path: "/api/business/workspace-preferences", bodies: [{}] }, async () => new Response("invalid json", { status: 200 }));
  assert.deepEqual(result, [{ complete: false, status: 200, body: null, failedAt: "json_body", reason: "invalid_json" }]);
});

const sessionUser = "11111111-1111-4111-8111-111111111111", otherSessionUser = "22222222-2222-4222-8222-222222222222";
const oldSessionId = "33333333-3333-4333-8333-333333333333", freshSessionId = "44444444-4444-4444-8444-444444444444";
function sessionToken(userId: string, sessionId: string) {
  return `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ role: "authenticated", sub: userId, session_id: sessionId })).toString("base64url")}.synthetic-signature`;
}
const cookieTarget = { appUrl: "http://127.0.0.1:3000", supabaseUrl: "http://127.0.0.1:54321" }, cookieKey = "sb-127-auth-token";
function sessionCookie(token = sessionToken(sessionUser, freshSessionId), changes: Partial<OwnerBrowserSessionCookie> = {}): OwnerBrowserSessionCookie {
  const identity = observedOwnerSessionIdentity(token);
  return { name: cookieKey, value: `base64-${stringToBase64URL(JSON.stringify({ access_token: token, refresh_token: "synthetic-refresh-value", user: { id: identity?.userId } }))}`, domain: "127.0.0.1", path: "/", secure: false, httpOnly: false, sameSite: "Lax", expires: -1, ...changes };
}
test("normal-browser session proof reads only the application's cookies and the exact SDK project key", async () => {
  const token = sessionToken(sessionUser, freshSessionId), cookie = sessionCookie(token), reads: string[] = [];
  const context = { async cookies(url: string) { reads.push(url); return [sessionCookie(sessionToken(otherSessionUser, oldSessionId), { name: "sb-other-project-auth-token" }), cookie]; } };
  assert.equal(await readOwnerBrowserSession(context, cookieTarget), token);
  assert.deepEqual(reads, [cookieTarget.appUrl]);
  await assert.rejects(ownerSessionTokenFromCookies([cookie], { ...cookieTarget, supabaseUrl: "https://other-project.supabase.co" }), /project's applicable session cookie/);
});
test("the installed SSR full and contiguous chunk encodings preserve the same current session", async () => {
  const cookie = sessionCookie(), chunks = createChunks(cookie.name, cookie.value, 80).map((chunk, index) => ({ ...cookie, ...chunk, expires: 10000 + index / 1000 }));
  assert.ok(chunks.length > 1);
  assert.equal(await ownerSessionTokenFromCookies(chunks.reverse(), cookieTarget, 1000), await ownerSessionTokenFromCookies([cookie], cookieTarget, 1000));
  const old = sessionCookie(sessionToken(sessionUser, oldSessionId));
  let current = [old]; const context = { async cookies() { return current; } };
  assert.equal(await readOwnerBrowserSession(context, cookieTarget), sessionToken(sessionUser, oldSessionId));
  current = [cookie]; assert.equal(await readOwnerBrowserSession(context, cookieTarget), sessionToken(sessionUser, freshSessionId), "Each normal redirect reads the current browser cookie; no prior login token cache or delayed event can overwrite it.");
});
test("session cookie selection excludes other host, path, secure-only and expired cookies", async () => {
  const token = sessionToken(sessionUser, freshSessionId), actual = sessionCookie(token);
  const unrelated = [sessionCookie(undefined, { domain: "evil127.0.0.1" }), sessionCookie(undefined, { domain: "localhost" }), sessionCookie(undefined, { path: "/client" }), sessionCookie(undefined, { path: "" }), sessionCookie(undefined, { secure: true }), sessionCookie(undefined, { expires: 1000 }), sessionCookie(undefined, { expires: 0 }), sessionCookie(undefined, { name: `${cookieKey}-code-verifier` })];
  assert.equal(await ownerSessionTokenFromCookies([...unrelated, actual], cookieTarget, 1000), token);
  await assert.rejects(ownerSessionTokenFromCookies(unrelated, cookieTarget, 1000), /project's applicable session cookie/);
  const target = { appUrl: "https://owner.example.test/client/today", supabaseUrl: "https://project.supabase.co" };
  const domainCookie = sessionCookie(token, { name: "sb-project-auth-token", domain: ".example.test", path: "/client", secure: true });
  assert.equal(await ownerSessionTokenFromCookies([domainCookie], target), token);
  await assert.rejects(ownerSessionTokenFromCookies([{ ...domainCookie, path: "/client/to" }], target), /project's applicable session cookie/);
  await assert.rejects(ownerSessionTokenFromCookies([{ ...domainCookie, domain: ".ample.test" }], target), /project's applicable session cookie/);
});
test("duplicate applicable cookies and full-plus-chunk generations are ambiguous and cannot supply proof", async () => {
  const cookie = sessionCookie(), chunks = createChunks(cookie.name, cookie.value, 80).map((chunk) => ({ ...cookie, ...chunk }));
  for (const values of [[cookie, cookie], [cookie, { ...cookie, domain: ".127.0.0.1" }], [cookie, ...chunks], [...chunks, chunks[0]], [...chunks.slice(0, -1), { ...chunks.at(-1)!, sameSite: "Strict" as const }]])
    await assert.rejects(ownerSessionTokenFromCookies(values, cookieTarget), /duplicated|ambiguous/);
});
test("missing, noncanonical and extra chunks fail closed instead of using an available prefix", async () => {
  const cookie = sessionCookie(), chunks = createChunks(cookie.name, cookie.value, 80).map((chunk) => ({ ...cookie, ...chunk }));
  for (const values of [[], chunks.slice(1), chunks.filter((_, index) => index !== 1), [...chunks, { ...cookie, name: `${cookieKey}.99` }], [...chunks, { ...cookie, name: `${cookieKey}.01` }], [...chunks, { ...cookie, name: `${cookieKey}.unknown` }], chunks.slice(0, -1)])
    await assert.rejects(ownerSessionTokenFromCookies(values, cookieTarget), /applicable|chunks/);
});
test("malformed and mismatched session carriers fail with generic errors containing no cookie values", async () => {
  const token = sessionToken(sessionUser, freshSessionId), cookie = sessionCookie(token);
  const badValues = ["", "base64-%%%synthetic-sensitive-carrier", "base64-abc=", "base64-Zh", "base64-" + stringToBase64URL("not JSON synthetic-sensitive-carrier"), JSON.stringify({ access_token: token }), "base64-" + stringToBase64URL(JSON.stringify({ access_token: token, user: { id: otherSessionUser } })), "base64-" + stringToBase64URL(JSON.stringify({ access_token: "invalid-jwt", user: { id: sessionUser } })), "base64-" + stringToBase64URL("[]")];
  for (const value of badValues) await assert.rejects(ownerSessionTokenFromCookies([{ ...cookie, value }], cookieTarget), (error) => {
    assert.ok(error instanceof Error);
    for (const secret of [token, sessionUser, otherSessionUser, freshSessionId, "synthetic-sensitive-carrier"]) assert.equal(error.message.includes(secret), false);
    return true;
  });
});
test("browser cookie acquisition has a fixed five-second bound and does not disclose transport errors", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let calls = 0;
    const pending = readOwnerBrowserSession({ cookies: async () => { calls++; return new Promise<OwnerBrowserSessionCookie[]>(() => {}); } }, cookieTarget);
    const rejected = assert.rejects(pending, /normal owner login \(5000ms\)/);
    await Promise.resolve(); t.mock.timers.tick(5000); await rejected; assert.equal(calls, 1);
  } finally { t.mock.timers.reset(); }
  await assert.rejects(readOwnerBrowserSession({ cookies: async () => { throw new Error("synthetic-sensitive-carrier"); } }, cookieTarget), (error) => error instanceof Error && error.message === "The normal login session cookies could not be read.");
});
test("fresh-session proof requires a live RPC actor matching the captured subject and intended owner", async () => {
  const target = { supabaseUrl: "http://127.0.0.1:54321", anonKey: "synthetic-public-key" }, old = sessionToken(sessionUser, oldSessionId), fresh = sessionToken(sessionUser, freshSessionId);
  const calls: string[] = [];
  const request = async (url: string | URL | Request, options?: RequestInit) => {
    calls.push(String(url)); assert.equal(new Headers(options?.headers).get("authorization"), `Bearer ${fresh}`); assert.equal(options?.body, "{}"); assert.ok(options?.signal);
    return Response.json(sessionUser);
  };
  assert.deepEqual(await verifyObservedOwnerSession(target, fresh, sessionUser, old, request), { userId: sessionUser, sessionId: freshSessionId });
  assert.deepEqual(calls, [`${target.supabaseUrl}/rest/v1/rpc/current_session_actor`]);
  await assert.rejects(verifyObservedOwnerSession(target, old, sessionUser, old, request), /distinct genuine GoTrue session/);
  await assert.rejects(verifyObservedOwnerSession(target, fresh, otherSessionUser, old, request), /intended owner/);
  await assert.rejects(verifyObservedOwnerSession(target, fresh, sessionUser, old, async () => Response.json(otherSessionUser)), /live session actor/);
  await assert.rejects(verifyObservedOwnerSession(target, fresh, sessionUser, old, async () => new Response(null, { status: 403 })), /actual current GoTrue session/);
  assert.equal(observedOwnerSessionIdentity("invalid"), null);
  assert.equal(observedOwnerSessionIdentity(sessionToken("unknown-user", freshSessionId)), null);
  assert.equal(observedOwnerSessionIdentity(sessionToken(sessionUser, "missing-session")), null);
});

function originalPreference403(error: unknown, operation: string): boolean {
  assert.ok(error instanceof assert.AssertionError);
  assert.equal(error.actual, 403); assert.equal(error.expected, 200);
  assert.ok(error.message.includes(`${operation} must return its actual HTTP 200 response.`));
  return true;
}

test("a preference403 records the exact operation and only fixed error/access categories", async () => {
  const operation = "phone: suggestion Save POST", phases: string[] = [];
  const secrets = ["synthetic-access-token", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  let diagnoses = 0;
  const response = { status: () => 403, json: async () => ({ error: "Business workspace access is required.", rawBody: secrets[0], userId: secrets[1], sessionId: secrets[2] }) };
  await assert.rejects(inspectWorkspacePreferenceResponse(response, { operation, phase: async (label: string) => { phases.push(label); }, diagnose403: async () => {
    diagnoses++; return { cookieReadable: true, cookieSubjectMatches: false, sameInitialSession: true, actorVerified: false, goTrueStatus: 403,
      goTrueUserMatches: false, membershipStatus: "disabled", ownerRole: false, token: secrets[0], userId: secrets[1], sessionId: secrets[2], headers: { authorization: secrets[0] }, arbitrary: "do-not-serialize" };
  } }), (error: unknown) => originalPreference403(error, operation));
  assert.equal(diagnoses, 1);
  assert.ok(phases.includes(`${operation}: response HTTP 403`));
  assert.ok(phases.includes(`${operation}: HTTP 403; error=access_denied`));
  const line = phases.find((label) => label.includes("; diagnosis=")); assert.ok(line);
  assert.deepEqual(JSON.parse(line.slice(line.indexOf("; diagnosis=") + "; diagnosis=".length)), {
    cookieReadable: true, cookieSubjectMatches: false, sameInitialSession: true, actorVerified: false, goTrueStatus: 403,
    goTrueUserMatches: false, membershipStatus: "disabled", ownerRole: false,
  });
  for (const secret of [...secrets, "rawBody", "userId", "sessionId", "authorization", "do-not-serialize"]) assert.equal(phases.join("\n").includes(secret), false);

  const unknown: string[] = [];
  await assert.rejects(inspectWorkspacePreferenceResponse({ status: () => 403, json: async () => ({ error: secrets[0] }) }, {
    operation: "phone: saved snapshot GET", phase: async (label: string) => { unknown.push(label); },
    diagnose403: async () => ({ cookieReadable: secrets[0], goTrueStatus: 999, membershipStatus: secrets[1], ownerRole: "true" }),
  }, true), (error: unknown) => originalPreference403(error, "phone: saved snapshot GET"));
  assert.ok(unknown.some((label) => label.includes("error=unknown_error")));
  const safe = unknown.find((label) => label.includes("; diagnosis=")); assert.ok(safe);
  const parsed = JSON.parse(safe.slice(safe.indexOf("; diagnosis=") + "; diagnosis=".length));
  assert.equal(parsed.cookieReadable, null); assert.equal(parsed.goTrueStatus, null); assert.equal(parsed.membershipStatus, "unknown"); assert.equal(parsed.ownerRole, null);
  for (const secret of secrets) assert.equal(unknown.join("\n").includes(secret), false);
});

test("JSON, diagnosis and phase failures cannot replace the original preference403 assertion", async () => {
  for (const failure of ["body", "diagnosis", "phase"] as const) {
    const operation = `phone: ${failure} saved snapshot GET`, phases: string[] = []; let diagnoses = 0;
    await assert.rejects(inspectWorkspacePreferenceResponse({ status: () => 403, json: async () => {
      if (failure === "body") throw new Error("sensitive-body-error"); return { error: "Business workspace access is required." };
    } }, { operation, phase: async (label: string) => { phases.push(label); if (failure === "phase") throw new Error("sensitive-phase-error"); }, diagnose403: async () => {
      diagnoses++; if (failure === "diagnosis") throw new Error("sensitive-diagnosis-error"); return { actorVerified: false };
    } }, true), (error: unknown) => {
      originalPreference403(error, operation); assert.ok(error instanceof Error); assert.equal(error.message.includes("sensitive-"), false); return true;
    });
    assert.equal(diagnoses, 1, "The one read-only diagnosis is attempted without repairing or retrying the failed command.");
    if (failure === "body") assert.ok(phases.some((label) => label.includes("error=response_json_unavailable")));
  }
});

test("preference failure preserves sanitized original response evidence before later diagnosis", async () => {
  for (const status of [403, 503]) {
    const phases: string[] = [], operation = `phone: original ${status} snapshot GET`;
    const original = { stage: "session_actor", kind: status === 403 ? "denied" : "unavailable", status: 503, code: "PGRST003", possibleSessionCookie: true };
    let headers = 0;
    await assert.rejects(inspectWorkspacePreferenceResponse({ status: () => status, headers: async () => { headers++; return {
      "x-workspace-context": JSON.stringify({ ...original, token: "private-token", user: "private-user" }), "set-cookie": "private-cookie",
    }; }, json: async () => ({ error: status === 403 ? "Business workspace access is required." : "Your preferences could not be loaded. Try again." }) }, {
      operation, phase: async label => { phases.push(label); }, diagnose403: async () => { phases.push("later-diagnosis"); return { actorVerified: true }; },
    }, true), (error: unknown) => {
      assert.ok(error instanceof assert.AssertionError); assert.equal(error.actual, status); assert.equal(error.expected, 200); return true;
    });
    assert.equal(headers, 1);
    const index = phases.findIndex(label => label.includes("; original_context=")); assert.ok(index >= 0);
    assert.deepEqual(JSON.parse(phases[index].split("; original_context=")[1]), original);
    if (status === 403) assert.ok(index < phases.indexOf("later-diagnosis"));
    assert.doesNotMatch(phases.join("\n"), /private-token|private-user|private-cookie|set-cookie/);
  }
  for (const raw of ["not JSON", JSON.stringify({ stage: "secret", kind: "denied", status: 403, code: null }), "x".repeat(769)]) {
    const phases: string[] = [];
    await assert.rejects(inspectWorkspacePreferenceResponse({ status: () => 403, headers: () => ({ "x-workspace-context": raw }), json: async () => ({}) }, {
      operation: "phone: malformed original metadata", phase: async label => { phases.push(label); },
    }), error => originalPreference403(error, "phone: malformed original metadata"));
    assert.ok(phases.some(label => label.endsWith("; original_context=null"))); assert.equal(phases.join("\n").includes("secret"), false);
  }
  await assert.rejects(inspectWorkspacePreferenceResponse({ status: () => 403, headers: () => { throw Error("private-header"); }, json: async () => ({}) }, {
    operation: "phone: broken headers",
  }), error => originalPreference403(error, "phone: broken headers"));
});

test("snapshotGET makes one actual request on403 and requires complete valid200 JSON", async () => {
  const operation = "phone: before suggestion snapshot GET", appUrl = "http://127.0.0.1:3000";
  let gets = 0, jsonReads = 0, diagnoses = 0;
  const failed = { request: { get: async (url: string, options?: { timeout: number }) => {
    gets++; assert.equal(url, `${appUrl}/api/business/workspace-preferences`); assert.deepEqual(options, { timeout: 15000 });
    return { status: () => 403, json: async () => { jsonReads++; return { error: "Invalid request origin." }; } };
  } } };
  await assert.rejects(readWorkspacePreferenceSnapshot(failed, appUrl, { operation, diagnose403: async () => { diagnoses++; return {}; } }), (error: unknown) => originalPreference403(error, operation));
  assert.deepEqual({ gets, jsonReads, diagnoses }, { gets: 1, jsonReads: 1, diagnoses: 1 });

  const snapshot = { available: true, canEdit: true, preferences: { revision: 6, displayName: "Phone owner", order: ["messages", "appointments", "todo", "money"], pinned: ["money"] }, activity: [] };
  const ok = { request: { get: async () => { gets++; return { status: () => 200, json: async () => { jsonReads++; return snapshot; } }; } } };
  assert.deepEqual(await readWorkspacePreferenceSnapshot(ok, appUrl, { operation, diagnose403: async () => { diagnoses++; return {}; } }), snapshot);
  assert.deepEqual({ gets, jsonReads, diagnoses }, { gets: 2, jsonReads: 2, diagnoses: 1 });
  const broken = { request: { get: async () => { gets++; return { status: () => 200, json: async () => { jsonReads++; throw new Error("lost body"); } }; } } };
  await assert.rejects(readWorkspacePreferenceSnapshot(broken, appUrl, { operation }), /actual complete JSON response/);
  assert.deepEqual({ gets, jsonReads, diagnoses }, { gets: 3, jsonReads: 3, diagnoses: 1 });
  const unavailable = { request: { get: async () => ({ status: () => 200, json: async () => ({ ...snapshot, canEdit: false }) }) } };
  await assert.rejects(readWorkspacePreferenceSnapshot(unavailable, appUrl, { operation }), assert.AssertionError);
});

test("successful observedSavePOST does not read an unused CDP body or run403 diagnostics", async () => {
  let reads = 0, diagnoses = 0; const phases: string[] = [];
  const result = await inspectWorkspacePreferenceResponse({ status: () => 200, json: async () => { reads++; throw new Error("unused CDP body must not be read"); } }, {
    operation: "phone: suggestion Save POST", phase: async (label: string) => { phases.push(label); }, diagnose403: async () => { diagnoses++; throw new Error("not a403"); },
  });
  assert.equal(result, undefined); assert.equal(reads, 0); assert.equal(diagnoses, 0);
  assert.deepEqual(phases, ["phone: suggestion Save POST: response HTTP 200", "phone: suggestion Save POST: HTTP 200 completed"]);
});

test("bounded JSON or403-diagnosis timeout still ends in the original403 with noGET retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    for (const hung of ["body", "diagnosis"] as const) {
      let signalStart: () => void = () => {}; const started = new Promise<void>((resolve) => { signalStart = resolve; });
      let gets = 0, diagnoses = 0, settled = false;
      const operation = `phone: ${hung} timeout snapshot GET`;
      const page = { request: { get: async () => { gets++; return { status: () => 403, json: async () => {
        if (hung === "body") { signalStart(); return new Promise<unknown>(() => {}); }
        return { error: "Business workspace access is required." };
      } }; } } };
      const pending = readWorkspacePreferenceSnapshot(page, "http://127.0.0.1:3000", { operation, diagnose403: async () => {
        diagnoses++; if (hung === "diagnosis") { signalStart(); return new Promise<unknown>(() => {}); } return {};
      } });
      const rejected = assert.rejects(pending, (error: unknown) => { settled = true; return originalPreference403(error, operation); });
      await started; const budget = hung === "body" ? 10000 : 20000;
      t.mock.timers.tick(budget - 1); await Promise.resolve(); assert.equal(settled, false);
      t.mock.timers.tick(1); await rejected;
      assert.equal(gets, 1); assert.equal(diagnoses, 1); assert.equal(settled, true);
    }
  } finally { t.mock.timers.reset(); }
});


test("failed-access diagnosis reads only the exact fixture membership and live identity boundaries", async () => {
  const token = sessionToken(sessionUser, freshSessionId), cookie = sessionCookie(token);
  const owner = { context: { cookies: async () => [cookie] }, userId: sessionUser, clientId: "55555555-5555-4555-8555-555555555555", membershipId: "66666666-6666-4666-8666-666666666666" };
  const partnerId = "77777777-7777-4777-8777-777777777777", target = { ...cookieTarget, anonKey: "synthetic-public-key" };
  const filters: [string, string][] = [], requests: string[] = [];
  let membershipResult: { error: unknown; data: { status: string; role: string } | null } = { error: null, data: { status: "active", role: "client_owner" } };
  const builder = {
    select(columns: string): unknown { assert.equal(columns, "status,role"); return builder; },
    eq(key: string, value: string): unknown { filters.push([key, value]); return builder; },
    async maybeSingle() { return membershipResult; },
  };
  const admin = { from(table: string) { assert.equal(table, "memberships"); return builder; } } as unknown as Parameters<typeof diagnoseOwnerWorkspaceAccess>[3];
  const request = async (url: string | URL | Request, options?: RequestInit) => {
    const path = new URL(String(url)).pathname; requests.push(path);
    assert.equal(new Headers(options?.headers).get("authorization"), `Bearer ${token}`); assert.ok(options?.signal);
    if (path === "/rest/v1/rpc/current_session_actor") { assert.equal(options?.method, "POST"); assert.equal(options?.body, "{}"); return Response.json(sessionUser); }
    assert.equal(path, "/auth/v1/user"); assert.notEqual(options?.method, "POST"); return Response.json({ id: sessionUser });
  };
  const result = await diagnoseOwnerWorkspaceAccess(owner, target, token, admin, partnerId, request);
  assert.deepEqual(result, { cookieReadable: true, cookieSubjectMatches: true, sameInitialSession: true, actorVerified: true,
    goTrueStatus: 200, goTrueUserMatches: true, membershipStatus: "active", ownerRole: true });
  assert.deepEqual(filters, [["id", owner.membershipId], ["user_id", owner.userId], ["client_id", owner.clientId], ["partner_id", partnerId]]);
  assert.deepEqual(requests.sort(), ["/auth/v1/user", "/rest/v1/rpc/current_session_actor"]);
  for (const secret of [token, sessionUser, freshSessionId, owner.clientId, owner.membershipId, partnerId]) assert.equal(JSON.stringify(result).includes(secret), false);

  membershipResult = { error: null, data: { status: "disabled", role: "client_viewer" } };
  const denied = await diagnoseOwnerWorkspaceAccess(owner, target, token, admin, partnerId, async (url) =>
    new Response("sensitive-provider-body", { status: String(url).includes("/auth/v1/user") ? 429 : 403 }));
  assert.equal(denied.actorVerified, false); assert.equal(denied.goTrueStatus, 429); assert.equal(denied.goTrueUserMatches, null);
  assert.equal(denied.membershipStatus, "disabled"); assert.equal(denied.ownerRole, false);
  assert.equal(JSON.stringify(denied).includes("sensitive-provider-body"), false);

  membershipResult = { error: { message: "sensitive-db-error" }, data: null }; let unavailableRequests = 0;
  const unavailable = await diagnoseOwnerWorkspaceAccess({ ...owner, context: { cookies: async () => { throw new Error("sensitive-cookie-error"); } } }, target, token, admin, partnerId, async () => { unavailableRequests++; throw new Error("unexpected identity request"); });
  assert.equal(unavailable.cookieReadable, false); assert.equal(unavailable.actorVerified, false);
  assert.equal(unavailable.membershipStatus, "unknown"); assert.equal(unavailable.ownerRole, null); assert.equal(unavailableRequests, 0);
  for (const secret of ["sensitive-db-error", "sensitive-cookie-error", token]) assert.equal(JSON.stringify(unavailable).includes(secret), false);
});
