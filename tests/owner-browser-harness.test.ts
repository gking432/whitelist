import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { assertMailpitContainer, browserEnvironment, browserOptions, cleanupMailbox, freshMailboxEntries, mailpitMailboxEntries, main, OWNER_BROWSER_CONFIRMATION, PLAYWRIGHT_VERSION, redactBrowserFailure, verificationLinkFromMessage } from "../scripts/verify-owner-browser.mjs";
import { browserFixtureIdentity } from "../scripts/owner-browser-fixtures.mjs";
import { runOwnerWorkspaceScenarios, workspaceActivityFixture } from "../scripts/owner-workspace-browser-scenarios.mjs";

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
