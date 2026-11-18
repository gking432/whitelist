import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { browserEnvironment, browserOptions, freshMailboxEntries, main, OWNER_BROWSER_CONFIRMATION, PLAYWRIGHT_VERSION, redactBrowserFailure, verificationLinkFromMessage } from "../scripts/verify-owner-browser.mjs";
import { browserFixtureIdentity } from "../scripts/owner-browser-fixtures.mjs";

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
  assert.equal(verificationLinkFromMessage({ body: { html: `<a href="${link.replaceAll("&", "&amp;")}">Sign in</a>` } }, target), link);
  for (const bad of [link.replace("127.0.0.1:54321", "evil.test"), link.replace("type=magiclink", "type=recovery"), link.replace(encodeURIComponent(destination), encodeURIComponent("https://evil.test/auth/confirm?next=%2Fstart")), link.replace("token=synthetic-once", "missing=token")])
    assert.equal(verificationLinkFromMessage({ body: { text: bad } }, target), null);
  assert.equal(verificationLinkFromMessage({ body: { text: "No actual sign-in link" } }, target), null);
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
