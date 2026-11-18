#!/usr/bin/env node
// Genuine owner authentication/browser acceptance, restricted to the existing
// disposable GitHub Supabase stack. No dotenv, local install, auth-cookie
// injection, dev auto-login, external provider request or production target.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { assertHostedCi, sanitizeCiFailure, SOURCE_CONTAINER } from "./ci-bootstrap-customer-journey-db.mjs";
import { assertEmptyBrowserTarget, browserFixtureIdentity, cleanupBrowserFixtures, prepareBrowserCatalog, readCreatedOwner } from "./owner-browser-fixtures.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PLAYWRIGHT_VERSION = "1.65.1";
export const OWNER_BROWSER_CONFIRMATION = "owner-browser-disposable";
export const BROWSER_COVERAGE = ["real login UI and fresh one-use GoTrue/Inbucket verification", "visible first-owner creation and reload without duplicate business", "empty Today and current Apps for the same business", "queued source imports rendered on desktop and phone", "two-owner source and endpoint isolation", "normal UI sign-out and stale signed user token denial", "real re-login preserves business, membership and creation receipt", "revoked membership denies current reads and cannot create another business", "synthetic-only cleanup"];
export function browserOptions(args) {
  if (args.length > 1 || args.some((arg) => !["--plan", "--preflight"].includes(arg))) throw new Error("Use no arguments, --plan, or --preflight.");
  return { plan: args[0] === "--plan", preflight: args[0] === "--preflight" };
}
function loopback(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an explicit loopback HTTP origin.`); }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error(`${name} must be an explicit loopback HTTP origin.`);
  return url.origin;
}
export function browserEnvironment(env, requireBrowser = true) {
  assertHostedCi(env);
  if (env.OWNER_BROWSER_CONFIRMATION !== OWNER_BROWSER_CONFIRMATION) throw new Error(`OWNER_BROWSER_CONFIRMATION must equal ${OWNER_BROWSER_CONFIRMATION}. No browser, auth or database was contacted.`);
  if (env.NORTHSTAR_DEV_AUTO_LOGIN === "true" || env.NEXT_PUBLIC_DEV_AUTO_LOGIN === "true") throw new Error("Owner acceptance forbids development auto-login.");
  const appUrl = loopback(env.OWNER_BROWSER_APP_URL || "http://127.0.0.1:3000", "OWNER_BROWSER_APP_URL");
  if (new URL(appUrl).port !== "3000") throw new Error("Use loopback port3000, matching the audited Supabase redirect allowlist.");
  const supabaseUrl = loopback(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY || !env.RUNNER_TEMP) throw new Error("The actual disposable Supabase keys and GitHub runner temporary directory are required.");
  const modulePath = env.OWNER_BROWSER_PLAYWRIGHT_MODULE ? resolve(env.OWNER_BROWSER_PLAYWRIGHT_MODULE) : "";
  if (requireBrowser && (!isAbsolute(env.OWNER_BROWSER_PLAYWRIGHT_MODULE || "") || !modulePath.startsWith(resolve(env.RUNNER_TEMP) + sep) || !modulePath.endsWith(`${sep}node_modules${sep}playwright${sep}index.mjs`))) throw new Error("Use the explicitly pinned CI-only Playwright module under RUNNER_TEMP.");
  const artifacts = resolve(env.OWNER_BROWSER_ARTIFACTS || join(env.RUNNER_TEMP, "owner-browser-evidence"));
  if (!artifacts.startsWith(resolve(env.RUNNER_TEMP) + sep)) throw new Error("Browser evidence must stay under the disposable runner temporary directory.");
  return { appUrl, supabaseUrl, modulePath, artifacts, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY };
}
export function redactBrowserFailure(value, secrets = []) {
  let safe = sanitizeCiFailure(String(value));
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) safe = safe.split(secret).join("[redacted]");
  return safe.replace(/https?:\/\/[^\s"'<>]*\/auth\/v1\/verify[^\s"'<>]*/gi, "[redacted verification link]")
    .replace(/((?:access_token|refresh_token|token_hash|code_verifier|token|code)=)[^\s&#"'<>]+/gi, "$1[redacted]");
}
export function verificationLinkFromMessage(message, target) {
  const html = typeof message?.body?.html === "string" ? message.body.html : "", plain = typeof message?.body?.text === "string" ? message.body.text : "";
  const candidates = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((item) => item[1]);
  candidates.push(...plain.match(/https?:\/\/[^\s<>"']+/g) || []);
  for (const raw of candidates) {
    try {
      const url = new URL(raw.replaceAll("&amp;", "&"));
      if (url.origin !== target.supabaseUrl || url.pathname !== "/auth/v1/verify" || !["signup", "magiclink"].includes(url.searchParams.get("type")) || !url.searchParams.get("token")) continue;
      const destination = new URL(url.searchParams.get("redirect_to"));
      if (destination.origin === target.appUrl && destination.pathname === "/auth/confirm" && destination.searchParams.get("next") === "/start") return url.href;
    } catch { /* Never navigate to an unbound email URL. */ }
  }
  return null;
}
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
export function freshMailboxEntries(messages, priorIds) {
  if (!Array.isArray(messages)) throw new Error("The actual email mailbox returned an unsupported response.");
  const prior = new Set(priorIds);
  return messages.filter((message) => typeof message?.id === "string" && message.id && !prior.has(message.id)).reverse();
}
function run(command, args, timeout = 30000) { return execFileSync(command, args, { cwd: root, shell: false, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout, maxBuffer: 1024 * 1024 }); }
async function inspectTarget(env, target) {
  const cli = join(root, "node_modules/.bin/supabase");
  const status = JSON.parse(run(cli, ["status", "--output", "json"]));
  if (loopback(status.API_URL, "Supabase status API_URL") !== target.supabaseUrl || status.ANON_KEY !== target.anonKey || status.SERVICE_ROLE_KEY !== target.serviceKey) throw new Error("Browser keys/API do not match the actual disposable Supabase CLI stack.");
  const database = new URL(status.DB_URL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || database.pathname !== "/postgres") throw new Error("Browser acceptance must use the real API-backed loopback Supabase database, not a copied SQL database.");
  const inspected = JSON.parse(run("docker", ["inspect", SOURCE_CONTAINER]));
  if (inspected.length !== 1 || inspected[0].Name !== `/${SOURCE_CONTAINER}` || !String(inspected[0].Config?.Image).includes("supabase/postgres") ||
      !inspected[0].NetworkSettings?.Ports?.["5432/tcp"]?.some((port) => port.HostPort === (database.port || "5432"))) throw new Error("The actual API-backed Supabase container identity/port could not be confirmed.");
  const inbucketUrl = loopback(env.OWNER_BROWSER_INBUCKET_URL || status.INBUCKET_URL || status.MAILPIT_URL || "http://127.0.0.1:54324", "OWNER_BROWSER_INBUCKET_URL");
  const config = await readFile(join(root, "supabase/config.toml"), "utf8");
  const configuredPort = config.match(/\[inbucket\]\s*\nenabled\s*=\s*true[\s\S]*?\nport\s*=\s*(\d+)/)?.[1];
  if (new URL(inbucketUrl).port !== configuredPort) throw new Error("The loopback mailbox port differs from the pinned Supabase configuration.");
  return { ...target, inbucketUrl };
}
async function mailboxMessages(target, email) {
  const response = await fetch(`${target.inbucketUrl}/api/v1/mailbox/${encodeURIComponent(email.split("@")[0])}`, { signal: AbortSignal.timeout(5000) });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error("The actual email mailbox could not be read.");
  const messages = await response.json();
  if (!Array.isArray(messages)) throw new Error("The actual email mailbox returned an unsupported response.");
  return messages;
}
async function mailboxLink(target, email, priorIds) {
  const mailbox = encodeURIComponent(email.split("@")[0]);
  for (let attempt = 0; attempt < 60; attempt++) {
    for (const entry of freshMailboxEntries(await mailboxMessages(target, email), priorIds)) {
        const detail = await fetch(`${target.inbucketUrl}/api/v1/mailbox/${mailbox}/${encodeURIComponent(entry.id)}`, { signal: AbortSignal.timeout(5000) });
        if (!detail.ok) continue;
        const link = verificationLinkFromMessage(await detail.json(), target);
        if (link) return link;
    }
    await delay(500);
  }
  throw new Error("The login form did not produce a usable one-use GoTrue email link in the actual disposable mailbox.");
}
async function loginUi(page, target, email) {
  const priorIds = (await mailboxMessages(target, email)).map((message) => message.id);
  await page.goto(`${target.appUrl}/login?next=%2Fstart`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send sign-in link", exact: true }).click();
  await page.waitForFunction(() => /Check your email|rate.?limit|too many requests|security purposes|only request this after/i.test(document.body.innerText), undefined, { timeout: 30000 });
  const text = await page.locator("body").innerText();
  if (/rate.?limit|too many requests|security purposes|only request this after/i.test(text)) throw new Error("The real disposable GoTrue email login was rate limited. No older email, generated link, injected session or gate bypass was used; review the scoped CI mail configuration.");
  await visible(page, "Check your email");
  await page.goto(await mailboxLink(target, email, priorIds));
}
function observedAuthenticatedToken(value) {
  try {
    const payload = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString());
    return payload.role === "authenticated" && typeof payload.sub === "string" && typeof payload.session_id === "string" ? value : null;
  } catch { return null; }
}
async function startApp(env, target) {
  await readFile(join(root, ".next/BUILD_ID"), "utf8");
  await new Promise((done, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error("Owner acceptance refuses to reuse an existing app on port3000.")));
    probe.listen(3000, new URL(target.appUrl).hostname, () => probe.close(done));
  });
  const childEnv = { ...env, NODE_ENV: "production", APP_URL: target.appUrl, NEXT_PUBLIC_APP_URL: target.appUrl, NEXT_TELEMETRY_DISABLED: "1", NORTHSTAR_DEV_AUTO_LOGIN: "false" };
  for (const key of Object.keys(childEnv)) if (/^(OPENAI_|ANTHROPIC_|TWILIO_|GOOGLE_(?:CLIENT|OAUTH)|MICROSOFT_(?:CLIENT|OAUTH)|HUBSPOT_(?:CLIENT|OAUTH)|STRIPE_|AI_GATEWAY_|VERCEL_AI_GATEWAY_)/.test(key)) childEnv[key] = "";
  const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "start", "--hostname", new URL(target.appUrl).hostname, "--port", "3000"], { cwd: root, env: childEnv, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  let logs = ""; child.stdout.on("data", (data) => { logs = (logs + data).slice(-18000); }); child.stderr.on("data", (data) => { logs = (logs + data).slice(-18000); });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`The owner app exited before startup: ${redactBrowserFailure(logs, [target.anonKey, target.serviceKey])}`);
    try { const response = await fetch(`${target.appUrl}/login`, { signal: AbortSignal.timeout(3000) }); if (response.ok) return { child, logs: () => logs }; } catch { /* Startup still pending. */ }
    await delay(250);
  }
  child.kill("SIGTERM"); throw new Error("The genuine production app did not become ready on the configured loopback origin.");
}
async function sourceImport(env, target, fixture, owner) {
  const protectedPath = join(env.RUNNER_TEMP, `${fixture.prefix}-${owner.label}.json`), reportPath = join(target.artifacts, `${owner.label}-source-report.json`);
  await writeFile(protectedPath, JSON.stringify({ version: 1, confirmation: OWNER_BROWSER_CONFIRMATION, runId: fixture.prefix.slice("owner-browser-".length), partnerId: fixture.partnerId, clientId: owner.clientId, ownerId: owner.userId, marker: owner.marker }), { mode: 0o600, flag: "wx" });
  try {
    run(join(root, "node_modules/.bin/tsx"), ["scripts/verify-owner-connected-data.ts", "--fixture", protectedPath, "--report", reportPath], 120000);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    if (report.version !== 1 || report.clientId !== owner.clientId || report.marker !== owner.marker || !report.expected || !["invoiceNumber", "customerName", "inquiryTitle"].every((key) => typeof report.expected[key] === "string" && report.expected[key].includes(owner.marker))) throw new Error("The actual queued source-import report was not confirmed for this owner.");
    if (report.proof?.actualQueue !== true || report.proof?.actualCanonicalRpc !== true || report.proof?.ownerManagerSourcesMatch !== true || report.proof?.externalNetworkRequests !== 0 || report.proof?.teamPaused !== true || report.proof?.sandboxPreserved !== true) throw new Error("The queued source-import helper did not confirm its actual bounded data path and preserved authority.");
    return report;
  } finally { await rm(protectedPath, { force: true }); }
}
async function visible(page, text) { await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 30000 }); }
async function screenshot(page, target, name) {
  assert.ok(["/client", "/start", "/login"].some((prefix) => new URL(page.url()).pathname.startsWith(prefix)));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false, "Owner content must fit the actual desktop/phone viewport.");
  await page.screenshot({ path: join(target.artifacts, `${name}.png`), fullPage: true, animations: "disabled" });
}
async function signOutUi(page, target) {
  let button = page.getByRole("button", { name: "Sign out", exact: true });
  if (!(await button.first().isVisible().catch(() => false))) {
    const menu = page.getByText("Menu", { exact: true });
    if (await menu.isVisible().catch(() => false)) await menu.click();
  }
  button = page.getByRole("button", { name: "Sign out", exact: true });
  await button.first().click();
  await page.waitForURL((url) => url.origin === target.appUrl && url.pathname === "/login", { timeout: 30000 });
  await page.getByRole("button", { name: "Send sign-in link", exact: true }).waitFor({ state: "visible" });
  assert.equal((await page.request.get(`${target.appUrl}/api/connections`)).status(), 403);
}
export async function main(args = process.argv.slice(2), env = process.env) {
  const options = browserOptions(args);
  if (options.plan) { console.log(JSON.stringify({ kind: "owner_browser_plan", status: "not_run", playwrightVersion: PLAYWRIGHT_VERSION, coverage: BROWSER_COVERAGE })); return; }
  const target = await inspectTarget(env, browserEnvironment(env, !options.preflight));
  const admin = createClient(target.supabaseUrl, target.serviceKey, { auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15000) }) } });
  await assertEmptyBrowserTarget(admin);
  if (options.preflight) { console.log("Owner browser preflight verified the empty API-backed disposable CI stack; no fixture, browser or authentication was created."); return; }
  const installed = JSON.parse(await readFile(join(dirname(target.modulePath), "package.json"), "utf8"));
  if (installed.name !== "playwright" || installed.version !== PLAYWRIGHT_VERSION) throw new Error(`Use audited Playwright ${PLAYWRIGHT_VERSION} in the explicit CI-only module path.`);
  await mkdir(target.artifacts, { recursive: true });
  const fixture = browserFixtureIdentity(randomBytes(6).toString("hex")), checks = [], contexts = [], diagnostics = [];
  let app, browser, failure, remainingFixtures = null;
  const step = async (key, action) => {
    try { await action(); checks.push({ key, status: "passed" }); console.log(`Owner browser: ${key}`); }
    catch (error) { checks.push({ key, status: "failed" }); throw new Error(`${key}: ${error.message}`); }
  };
  try {
    await prepareBrowserCatalog(admin, fixture);
    app = await startApp(env, target);
    const playwright = await import(pathToFileURL(target.modulePath).href);
    browser = await playwright.chromium.launch({ headless: true });
    const owners = [], observedTokens = new Map();
    for (const owner of fixture.owners) {
      const context = await browser.newContext({ viewport: owner.label === "phone" ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: owner.label === "phone", hasTouch: owner.label === "phone", locale: "en-US", timezoneId: "America/Chicago" });
      contexts.push(context); const page = await context.newPage(); page.setDefaultTimeout(30000);
      context.on("request", (request) => { if (JSON.stringify(request.headers()).includes(target.serviceKey) || (request.postData() || "").includes(target.serviceKey)) diagnostics.push("A service credential reached the browser."); });
      // Capture only a genuine GoTrue user token in this Node process's memory.
      // Never inject it into a browser, log it or write it into any artifact.
      page.on("request", (request) => { const url = new URL(request.url()); if (url.origin !== target.supabaseUrl || url.pathname !== "/auth/v1/user") return; const token = observedAuthenticatedToken((request.headers().authorization || "").replace(/^Bearer /i, "")); if (token) observedTokens.set(owner.label, token); });
      page.on("response", (response) => { const url = new URL(response.url()); if (url.origin !== target.supabaseUrl || url.pathname !== "/auth/v1/token" || response.status() !== 200) return; void response.json().then((data) => { const token = observedAuthenticatedToken(data.access_token || ""); if (token) observedTokens.set(owner.label, token); }).catch(() => {}); });
      page.on("pageerror", (error) => diagnostics.push(redactBrowserFailure(error.message, [target.anonKey, target.serviceKey])));
      await context.route("**/*", async (route) => { const origin = new URL(route.request().url()).origin; if (![target.appUrl, target.supabaseUrl].includes(origin)) { diagnostics.push("An external browser request was blocked."); await route.abort(); } else await route.continue(); });
      await step(`${owner.label}: real email login`, async () => {
        await loginUi(page, target, owner.email); await page.waitForURL((url) => url.origin === target.appUrl && url.pathname === "/start"); await page.getByRole("button", { name: "Create my business", exact: true }).waitFor({ state: "visible" });
      });
      let created;
      await step(`${owner.label}: visible create once`, async () => {
        await page.getByLabel("Business name", { exact: true }).fill(owner.name); await page.getByLabel("Business description", { exact: true }).fill("Synthetic browser acceptance business: project planning and customer coordination."); await page.getByLabel("Timezone", { exact: true }).fill("America/Chicago"); await page.getByRole("button", { name: "Create my business", exact: true }).click(); await page.waitForURL((url) => url.pathname === "/client/onboarding");
        created = await readCreatedOwner(admin, fixture, owner); await page.goto(`${target.appUrl}/start`); await page.waitForURL((url) => url.pathname === "/client"); assert.equal((await readCreatedOwner(admin, fixture, owner)).clientId, created.clientId);
      });
      await step(`${owner.label}: empty Today and Apps reload`, async () => {
        await page.waitForFunction((name) => document.title.includes(name), owner.name);
        await screenshot(page, target, `${owner.label}-empty-today`);
        const workspace = await page.request.get(`${target.appUrl}/api/business/workspace`); assert.equal(workspace.status(), 200); const saved = await workspace.json(); assert.ok(Array.isArray(saved.records)); assert.equal(saved.records.length, 0, "A new owner must not receive sample business records.");
        const empty = await page.request.get(`${target.appUrl}/api/connections`); assert.equal(empty.status(), 200); const source = await empty.json(); assert.equal(source.apps.length, 0); for (const field of ["messages", "appointments", "invoices", "payments", "leads", "customers", "crmDeals"]) assert.equal((source[field] || []).length, 0);
        await page.goto(`${target.appUrl}/client/apps`); await page.getByRole("heading", { name: "Apps & connections", exact: true }).waitFor(); await page.reload(); assert.equal((await readCreatedOwner(admin, fixture, owner)).clientId, created.clientId);
      });
      owners.push({ ...created, context, page });
    }
    for (const owner of owners) await step(`${owner.label}: actual queued source import`, async () => { owner.sources = await sourceImport(env, target, fixture, owner); });
    for (const owner of owners) {
      const other = owners.find((candidate) => candidate.userId !== owner.userId);
      await step(`${owner.label}: imported source views and isolation`, async () => {
        const { page, sources } = owner;
        await page.goto(`${target.appUrl}/client/apps`); await visible(page, sources.expected.customerName); await screenshot(page, target, `${owner.label}-source-apps`); assert.equal((await page.locator("body").innerText()).includes(other.marker), false);
        await page.goto(`${target.appUrl}/client/money`); await visible(page, sources.expected.invoiceNumber); await screenshot(page, target, `${owner.label}-source-money`); assert.equal((await page.locator("body").innerText()).includes(other.marker), false);
        await page.goto(`${target.appUrl}/client/messages`); await visible(page, sources.expected.inquiryTitle); assert.equal((await page.locator("body").innerText()).includes(other.marker), false);
        if (sources.expected.appointmentTitle) { await page.goto(`${target.appUrl}/client/calendar`); await visible(page, sources.expected.appointmentTitle); }
        const scoped = await page.request.get(`${target.appUrl}/api/connections?clientId=${other.clientId}`); assert.equal(scoped.status(), 200); const ownData = JSON.stringify(await scoped.json()); assert.ok(ownData.includes(owner.marker)); assert.equal(ownData.includes(other.marker), false);
        for (const [kind, ref] of Object.entries(other.sources.sourceRefs || {})) {
          const endpoint = kind === "invoice" ? "invoice-follow-up" : kind === "hubspot" ? "crm-gateway" : null; if (!endpoint) continue;
          const denied = await page.request.get(`${target.appUrl}/api/business/${endpoint}?${new URLSearchParams({ connectionId: ref.connectionId, recordId: ref.recordId })}`); assert.ok([403, 404].includes(denied.status()), "A foreign source review must fail closed.");
        }
      });
    }
    let signedOutToken;
    await step("phone: normal owner UI sign out", async () => { signedOutToken = observedTokens.get("phone"); assert.ok(signedOutToken, "A genuine browser GoTrue session token must be observed for revocation proof."); await owners[1].page.goto(`${target.appUrl}/client/apps`); await signOutUi(owners[1].page, target); });
    await step("phone: stale signed session denied by real RPCs", async () => {
      for (const [rpc, body] of [["current_session_actor", {}], ["provision_first_owner", { p_key: randomUUID(), p_business: { name: owners[1].name, description: "Synthetic browser acceptance business: project planning and customer coordination.", timezone: "America/Chicago" } }]]) {
        const response = await fetch(`${target.supabaseUrl}/rest/v1/rpc/${rpc}`, { method: "POST", headers: { apikey: target.anonKey, Authorization: `Bearer ${signedOutToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
        assert.ok([401, 403].includes(response.status), "The real logged-out signed user token cannot resolve an actor or provision again.");
      }
    });
    await step("phone: real re-login preserves original workspace", async () => {
      const owner = owners[1]; await loginUi(owner.page, target, owner.email); await owner.page.waitForURL((url) => url.origin === target.appUrl && url.pathname === "/client");
      assert.equal(await owner.page.getByRole("button", { name: "Create my business", exact: true }).count(), 0);
      const persisted = await readCreatedOwner(admin, fixture, owner); assert.equal(persisted.clientId, owner.clientId); assert.equal(persisted.membershipId, owner.membershipId); assert.equal(persisted.receiptId, owner.receiptId);
      assert.notEqual(observedTokens.get("phone"), signedOutToken, "Re-login must obtain a new genuine Auth session.");
      await owner.page.goto(`${target.appUrl}/client/apps`); await visible(owner.page, owner.sources.expected.customerName); await screenshot(owner.page, target, "phone-relogin-persisted");
    });
    await step("desktop: revoked membership and no re-provision", async () => {
      const owner = owners[0], disabled = await admin.from("memberships").update({ status: "disabled" }).eq("id", owner.membershipId).eq("user_id", owner.userId).eq("client_id", owner.clientId); assert.equal(disabled.error, null);
      assert.equal((await owner.page.request.get(`${target.appUrl}/api/connections`)).status(), 403); await owner.page.goto(`${target.appUrl}/client`); await visible(owner.page, "Business setup unavailable"); assert.equal(await owner.page.getByRole("button", { name: "Create my business", exact: true }).count(), 0); await screenshot(owner.page, target, "desktop-revoked-access"); await signOutUi(owner.page, target);
    });
    assert.deepEqual(diagnostics, [], "The real browser must have no uncaught page errors, external requests or service-key exposure.");
  } catch (error) { failure = error; }
  finally {
    for (const context of contexts) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (app) { app.child.kill("SIGTERM"); await new Promise((done) => { if (app.child.exitCode !== null) done(); else { app.child.once("exit", done); setTimeout(() => { app.child.kill("SIGKILL"); done(); }, 5000).unref(); } }); }
    try { remainingFixtures = await cleanupBrowserFixtures(admin, fixture); } catch (error) { failure ||= error; }
    for (const owner of fixture.owners) await fetch(`${target.inbucketUrl}/api/v1/mailbox/${encodeURIComponent(owner.email.split("@")[0])}`, { method: "DELETE", signal: AbortSignal.timeout(5000) }).catch(() => {});
    const report = { kind: "owner_browser_acceptance", status: failure ? "failed" : "passed", playwrightVersion: PLAYWRIGHT_VERSION, checks, remainingFixtures, diagnostics, limitations: ["Synthetic queued provider transport only; no live OAuth, customer import or provider/model call."], ...(failure ? { error: redactBrowserFailure(failure.message, [target.anonKey, target.serviceKey]), serverLog: redactBrowserFailure(app?.logs() || "", [target.anonKey, target.serviceKey]) } : {}) };
    await writeFile(join(target.artifacts, "owner-browser-report.json"), JSON.stringify(report, null, 2));
  }
  if (failure) throw new Error(redactBrowserFailure(failure.message, [target.anonKey, target.serviceKey]));
  console.log(`Owner browser acceptance passed ${checks.length} genuine browser/source stages; synthetic fixtures remaining: ${remainingFixtures}.`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch((error) => { console.error(`BLOCKED/FAIL owner browser: ${redactBrowserFailure(error.message)}`); process.exitCode = 1; });
