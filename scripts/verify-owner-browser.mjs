#!/usr/bin/env node
// Genuine owner authentication/browser acceptance, restricted to the existing
// disposable GitHub Supabase stack. No dotenv, local install, auth-cookie
// injection, dev auto-login, external provider request or production target.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { combineChunks, stringFromBase64URL, stringToBase64URL } from "@supabase/ssr";
import { assertHostedCi, sanitizeCiFailure, SOURCE_CONTAINER } from "./ci-bootstrap-customer-journey-db.mjs";
import { assertEmptyBrowserTarget, browserFixtureIdentity, cleanupBrowserFixtures, prepareBrowserCatalog, readCreatedOwner } from "./owner-browser-fixtures.mjs";
import { assertOwnerWorkspaceNavigation, assertSavedWorkspacePreferences, runOwnerWorkspaceScenarios, withOwnerBrowserDeadline } from "./owner-workspace-browser-scenarios.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PLAYWRIGHT_VERSION = "1.65.1";
export const MAILPIT_VERSION = "1.22.3";
export const OWNER_BROWSER_CONFIRMATION = "owner-browser-disposable";
export const BROWSER_COVERAGE = ["real login UI and fresh one-use GoTrue/Mailpit verification", "visible first-owner creation and reload without duplicate business", "empty Today and current Apps for the same business", "queued source imports rendered on desktop and phone", "two-owner source and endpoint isolation", "normal UI sign-out and stale signed user token denial", "real re-login preserves business, membership and creation receipt", "same-browser account switch replaces prior business access without provisioning", "revoked membership denies both current sessions and cannot create another business", "synthetic-only cleanup"];
BROWSER_COVERAGE.push("deliberate owner-scoped Today preferences, source-backed usage suggestions, CAS, reset and exact retry");
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
  const html = typeof message?.HTML === "string" ? message.HTML : "", plain = typeof message?.Text === "string" ? message.Text : "";
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
  // Mailpit returns newest first. Never choose a consumed message or "latest".
  return messages.filter((message) => typeof message?.id === "string" && message.id && message.id !== "latest" && !prior.has(message.id));
}
function hasMailboxRecipient(message, email) {
  return Array.isArray(message?.To) && message.To.some((recipient) => typeof recipient?.Address === "string" && recipient.Address.toLowerCase() === email.toLowerCase());
}
export function mailpitMailboxEntries(response, email) {
  if (!Array.isArray(response?.messages) || response.start !== 0 || !Number.isSafeInteger(response.messages_count) || response.messages_count !== response.messages.length || response.messages.length > 50)
    throw new Error("The actual Mailpit mailbox returned an unsupported or truncated response.");
  if (response.messages.some((message) => typeof message?.ID !== "string" || !/^[a-z0-9-]{1,128}$/i.test(message.ID) || message.ID === "latest"))
    throw new Error("The actual Mailpit mailbox returned an unsupported message identity.");
  // Search is only a bounded lookup; independently require the exact recipient.
  return response.messages.filter((message) => hasMailboxRecipient(message, email)).map((message) => ({ id: message.ID }));
}
export function assertMailpitContainer(inspection, mailboxUrl) {
  const name = SOURCE_CONTAINER.replace("supabase_db_", "supabase_inbucket_");
  const container = Array.isArray(inspection) && inspection.length === 1 ? inspection[0] : null;
  if (container?.Name !== `/${name}` || container.State?.Running !== true || !String(container.Config?.Image).endsWith(`/mailpit:v${MAILPIT_VERSION}`) ||
      !container.NetworkSettings?.Ports?.["8025/tcp"]?.some((port) => port.HostPort === new URL(mailboxUrl).port))
    throw new Error("The pinned Mailpit image, running Supabase mailbox identity and loopback port could not be confirmed.");
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
  // CLI 2.107.0 keeps [inbucket]/INBUCKET_URL but runs Mailpit v1.22.3.
  // Primary source: supabase/cli@v2.107.0 apps/cli-go/internal/start/start.go
  // and pkg/config/templates/Dockerfile. Do not probe an unrelated mail server.
  assertMailpitContainer(JSON.parse(run("docker", ["inspect", SOURCE_CONTAINER.replace("supabase_db_", "supabase_inbucket_")])), inbucketUrl);
  return { ...target, inbucketUrl };
}
async function mailboxMessages(target, email, request = fetch) {
  const query = new URLSearchParams({ query: `to:${email}`, start: "0", limit: "50" });
  const response = await request(`${target.inbucketUrl}/api/v1/search?${query}`, { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("The actual email mailbox could not be read.");
  return mailpitMailboxEntries(await response.json(), email);
}
async function mailboxLink(target, email, priorIds) {
  for (let attempt = 0; attempt < 60; attempt++) {
    for (const entry of freshMailboxEntries(await mailboxMessages(target, email), priorIds)) {
        const detail = await fetch(`${target.inbucketUrl}/api/v1/message/${encodeURIComponent(entry.id)}`, { redirect: "error", signal: AbortSignal.timeout(5000) });
        if (!detail.ok) continue;
        const message = await detail.json();
        if (message?.ID !== entry.id || !hasMailboxRecipient(message, email)) throw new Error("The Mailpit message identity or exact recipient did not match the fresh login request.");
        const link = verificationLinkFromMessage(message, target);
        if (link) return link;
    }
    await delay(500);
  }
  throw new Error("The login form did not produce a usable one-use GoTrue email link in the actual disposable mailbox.");
}
export async function cleanupMailbox(target, email, request = fetch) {
  const ids = (await mailboxMessages(target, email, request)).map((message) => message.id);
  if (!ids.length) return; // Mailpit deletes ALL messages if IDs is empty/omitted.
  const response = await request(`${target.inbucketUrl}/api/v1/messages`, { method: "DELETE", redirect: "error", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ IDs: ids }), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Synthetic login message cleanup could not be confirmed.");
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
export function observedOwnerSessionIdentity(value) {
  const token = typeof value === "string" ? observedAuthenticatedToken(value) : null;
  if (!token) return null;
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    return uuid.test(claims.sub) && uuid.test(claims.session_id) && claims.is_anonymous !== true ? { userId: claims.sub, sessionId: claims.session_id } : null;
  } catch { return null; }
}
export async function ownerSessionTokenFromCookies(cookies, target, nowSeconds = Date.now() / 1000) {
  const app = new URL(target.appUrl), backend = new URL(target.supabaseUrl);
  // Match the installed supabase-js default storageKey, not a cookie-name scan.
  const key = `sb-${backend.hostname.split(".")[0]}-auth-token`;
  const applicable = Array.isArray(cookies) ? cookies.filter((cookie) => {
    if (typeof cookie?.name !== "string" || typeof cookie.domain !== "string" || typeof cookie.path !== "string") return false;
    const domain = cookie.domain.toLowerCase(), host = app.hostname.toLowerCase();
    const domainMatches = domain.startsWith(".") ? host === domain.slice(1) || host.endsWith(domain) : host === domain;
    const pathMatches = cookie.path.startsWith("/") && (app.pathname === cookie.path || app.pathname.startsWith(cookie.path.endsWith("/") ? cookie.path : `${cookie.path}/`));
    return domainMatches && pathMatches && (!cookie.secure || app.protocol === "https:") && (cookie.expires === -1 || Number.isFinite(cookie.expires) && cookie.expires > nowSeconds);
  }) : [];
  const selected = applicable.filter((cookie) => cookie.name === key || cookie.name.startsWith(`${key}.`));
  if (!selected.length) throw new Error("The normal login did not leave this project's applicable session cookie.");
  const values = new Map();
  for (const cookie of selected) {
    if (values.has(cookie.name) || typeof cookie.value !== "string" || !cookie.value || cookie.value.length > 32768)
      throw new Error("The normal login session cookie is duplicated, empty or unsupported.");
    values.set(cookie.name, cookie.value);
  }
  if (values.has(key) && values.size !== 1) throw new Error("The normal login session cookie contains ambiguous full and chunked generations.");
  if (!values.has(key)) {
    if (values.size > 32 || selected.some((cookie) => !/^(0|[1-9][0-9]*)$/.test(cookie.name.slice(key.length + 1))) ||
        Array.from({ length: values.size }, (_, index) => `${key}.${index}`).some((name) => !values.has(name)))
      throw new Error("The normal login session cookie chunks are missing, noncontiguous or unsupported.");
    const scopes = new Set(selected.map(({ domain, path, secure, httpOnly, sameSite }) => JSON.stringify({ domain, path, secure, httpOnly, sameSite })));
    if (scopes.size !== 1) throw new Error("The normal login session cookie chunks have ambiguous scopes or generations.");
  }
  const value = await combineChunks(key, (name) => values.get(name));
  let session;
  try {
    if (!value?.startsWith("base64-") || value.length > 32768) throw new Error();
    const encoded = value.slice(7);
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error();
    const decoded = stringFromBase64URL(encoded);
    if (stringToBase64URL(decoded) !== encoded) throw new Error();
    session = JSON.parse(decoded);
  } catch { throw new Error("The normal login session cookie is malformed or contains mismatched chunks."); }
  const identity = observedOwnerSessionIdentity(session?.access_token);
  if (!session || typeof session !== "object" || Array.isArray(session) || !identity ||
      session.user?.id !== identity.userId)
    throw new Error("The normal login session cookie does not contain a consistent signed-in owner session.");
  // Decoding is not authorization: the caller must verify this exact JWT with
  // current_session_actor, including fixture UID and a distinct prior session.
  return session.access_token;
}
export async function readOwnerBrowserSession(context, target) {
  // Read only cookies written by the normal email UI/app. No SDK session call,
  // browser storage evaluation, cookie write, token refresh or network observer.
  return withOwnerBrowserDeadline("read session cookies from the normal owner login", async () => {
    let cookies;
    try { cookies = await context.cookies(target.appUrl); }
    catch { throw new Error("The normal login session cookies could not be read."); }
    return ownerSessionTokenFromCookies(cookies, target);
  }, 5000);
}
export async function verifyObservedOwnerSession(target, token, expectedUserId, previousToken, request = fetch) {
  const identity = observedOwnerSessionIdentity(token), previous = previousToken ? observedOwnerSessionIdentity(previousToken) : null;
  assert.ok(identity && (!expectedUserId || identity.userId === expectedUserId), "The captured signed-in token must belong to the intended owner.");
  assert.ok(!previousToken || previous && identity.sessionId !== previous.sessionId, "Re-login must obtain a distinct genuine GoTrue session.");
  const result = await request(`${target.supabaseUrl}/rest/v1/rpc/current_session_actor`, { method: "POST", headers: { apikey: target.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10000) });
  assert.equal(result.status, 200, "The captured token must resolve an actual current GoTrue session.");
  const actor = await withOwnerBrowserDeadline("verify captured current-session actor body", () => result.json(), 5000);
  assert.ok(actor === identity.userId && (!expectedUserId || actor === expectedUserId), "The live session actor, signed token subject and intended owner must match.");
  return identity;
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
async function revealCustomerContext(page) {
  const summary = page.locator("summary").filter({ hasText: /^\s*Customer context\s*$/ });
  if (await summary.count() && !(await summary.evaluate((node) => node.parentElement.open))) await summary.click();
}
async function verifyIntakePauseResume(page, target, admin, fixture, owner) {
  const current = await page.request.get(`${target.appUrl}/api/connections`); assert.equal(current.status(), 200);
  const intake = (await current.json()).apps.filter((app) => app.provider === "generic_inbound_webhook");
  assert.equal(intake.length, 1); const account = intake[0]; assert.equal(account.paused, false); assert.ok(account.account?.includes(owner.marker));
  const card = page.getByRole("article", { name: `Website intake form account ${account.account || account.name}`, exact: true });
  const jobs = async () => {
    const result = await admin.from("integration_sync_jobs").select("id", { count: "exact", head: true }).eq("partner_id", fixture.partnerId).eq("client_id", owner.clientId);
    assert.equal(result.error, null); return result.count;
  };
  const jobsBefore = await jobs();
  // Only inbound intake is safe here: its resume returns before any provider pull.
  for (const [action, label, paused] of [["pause", "Pause intake", true], ["resume", "Resume intake", false]]) {
    const pending = page.waitForResponse((response) => {
      try { const body = response.request().postDataJSON(); return new URL(response.url()).pathname === "/api/connections" && response.request().method() === "POST" && body?.action === action && body.connectionId === account.id; } catch { return false; }
    }, { timeout: 15000 });
    void pending.catch(() => {});
    await card.getByRole("button", { name: label, exact: true }).click();
    const response = await pending, body = await withOwnerBrowserDeadline("read intake control response body", () => response.json(), 10000);
    assert.equal(response.status(), 200, `The exact intake ${action} must succeed${typeof body?.error === "string" ? `: ${body.error.slice(0, 300)}` : "."}`);
    const read = await page.request.get(`${target.appUrl}/api/connections`); assert.equal(read.status(), 200);
    const updated = (await read.json()).apps.find((app) => app.id === account.id); assert.ok(updated); assert.equal(updated.provider, "generic_inbound_webhook"); assert.equal(updated.paused, paused);
  }
  assert.equal(await jobs(), jobsBefore, "Intake controls must not enqueue any provider imports.");
  const team = await admin.from("agent_team_settings").select("status,channel_authority").eq("partner_id", fixture.partnerId).eq("client_id", owner.clientId).single();
  assert.equal(team.error, null); assert.equal(team.data.status, "paused"); assert.ok(Object.values(team.data.channel_authority).every((value) => value === "off"));
  for (const table of ["action_jobs", "agent_work_items"]) {
    const result = await admin.from(table).select("id", { count: "exact", head: true }).eq("partner_id", fixture.partnerId).eq("client_id", owner.clientId);
    assert.equal(result.error, null); assert.equal(result.count, 0, "Changing intake imports must not activate the team or enqueue an action.");
  }
}
async function screenshot(page, target, name) {
  assert.ok(["/client", "/start", "/login"].some((prefix) => new URL(page.url()).pathname.startsWith(prefix)));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false, "Owner content must fit the actual desktop/phone viewport.");
  await page.screenshot({ path: join(target.artifacts, `${name}.png`), fullPage: true, animations: "disabled" });
}
async function signOutUi(page, target) {
  let button = page.getByRole("button", { name: "Sign out", exact: true });
  if (!(await button.first().isVisible().catch(() => false))) {
    const menu = page.locator("summary").filter({ hasText: /^\s*More\s*$/ });
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
  let app, browser, failure, remainingFixtures = null, workspacePersonalization = null;
  let activeStep = null, currentPhase = "preparing browser acceptance", failurePhase = null, cleanupStatus = "not_started", checkpointTail = Promise.resolve();
  const cleanupErrors = [];
  const report = (status) => ({ kind: "owner_browser_acceptance", status, updatedAt: new Date().toISOString(), playwrightVersion: PLAYWRIGHT_VERSION,
    checks: [...checks], activeStep, phase: currentPhase, failurePhase, cleanupStatus, cleanupErrors: [...cleanupErrors], remainingFixtures, diagnostics: [...diagnostics], workspacePersonalization,
    limitations: ["Synthetic queued provider transport only; no live OAuth, customer import or provider/model call.", "Workspace recommendation dates are explicitly synthetic disposable fixtures; genuine navigation activity is tested separately.", "Session proof reads only the project's cookies set by the normal email login, then verifies the exact token against the live current-session RPC; no cookie injection, session creation or token refresh is used."],
    ...(failure ? { error: redactBrowserFailure(failure.message, [target.anonKey, target.serviceKey]), serverLog: redactBrowserFailure(app?.logs() || "", [target.anonKey, target.serviceKey]) } : {}) });
  const checkpoint = async (status = "in_progress") => {
    if (failure) status = "failed";
    const json = JSON.stringify(report(status), null, 2), destination = join(target.artifacts, "owner-browser-report.json");
    checkpointTail = checkpointTail.catch(() => {}).then(async () => { await writeFile(`${destination}.tmp`, json); await rename(`${destination}.tmp`, destination); });
    await withOwnerBrowserDeadline("persist sanitized browser evidence", () => checkpointTail, 5000);
  };
  const phase = async (label) => { if (failure) throw failure; currentPhase = label; console.log(`Owner browser phase: ${label}`); await checkpoint(); };
  const step = async (key, action) => {
    activeStep = key; currentPhase = "starting stage"; console.log(`Owner browser starting: ${key}`); await checkpoint();
    try { await withOwnerBrowserDeadline(`stage ${key}; inspect recorded phase`, action, 120000); checks.push({ key, status: "passed" }); activeStep = null; currentPhase = "stage completed"; console.log(`Owner browser: ${key}`); await checkpoint(); }
    catch (error) { checks.push({ key, status: "failed" }); failurePhase ||= currentPhase; failure = new Error(`${key}: ${error.message}`); console.error(`Owner browser failed: ${redactBrowserFailure(failure.message, [target.anonKey, target.serviceKey])}`); await checkpoint("failed"); throw failure; }
  };
  try {
    await prepareBrowserCatalog(admin, fixture);
    app = await startApp(env, target);
    const playwright = await import(pathToFileURL(target.modulePath).href);
    browser = await playwright.chromium.launch({ headless: true });
    const owners = [], sessionTokens = new Map();
    for (const owner of fixture.owners) {
      const context = await browser.newContext({ viewport: owner.label === "phone" ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: owner.label === "phone", hasTouch: owner.label === "phone", locale: "en-US", timezoneId: "America/Chicago" });
      contexts.push(context); context.setDefaultTimeout(30000); context.setDefaultNavigationTimeout(30000); const page = await context.newPage(); page.setDefaultTimeout(30000);
      context.on("request", (request) => { if (JSON.stringify(request.headers()).includes(target.serviceKey) || (request.postData() || "").includes(target.serviceKey)) diagnostics.push("A service credential reached the browser."); });
      page.on("pageerror", (error) => diagnostics.push(redactBrowserFailure(error.message, [target.anonKey, target.serviceKey])));
      await context.route("**/*", async (route) => { const origin = new URL(route.request().url()).origin; if (![target.appUrl, target.supabaseUrl].includes(origin)) { diagnostics.push("An external browser request was blocked."); await route.abort(); } else await route.continue(); });
      await step(`${owner.label}: real email login`, async () => {
        await loginUi(page, target, owner.email); await page.waitForURL((url) => url.origin === target.appUrl && url.pathname === "/start"); await page.getByRole("button", { name: "Create my business", exact: true }).waitFor({ state: "visible" });
        await phase(`${owner.label}: read session cookie from this initial normal login`); const token = await readOwnerBrowserSession(context, target);
        await phase(`${owner.label}: verify initial live session actor`); await verifyObservedOwnerSession(target, token); sessionTokens.set(owner.label, token);
      });
      let created;
      await step(`${owner.label}: visible create once`, async () => {
        await page.getByLabel("Business name", { exact: true }).fill(owner.name); await page.getByLabel("Business description", { exact: true }).fill("Synthetic browser acceptance business: project planning and customer coordination."); await page.getByLabel("Timezone", { exact: true }).fill("America/Chicago");
        await screenshot(page, target, `${owner.label}-filled-create-form`);
        await page.getByRole("button", { name: "Create my business", exact: true }).click(); await page.waitForURL((url) => url.pathname === "/client/onboarding");
        created = await readCreatedOwner(admin, fixture, owner); assert.ok(observedOwnerSessionIdentity(sessionTokens.get(owner.label))?.userId === created.userId, "The browser-created workspace must belong to the observed real session actor."); await page.goto(`${target.appUrl}/start`); await page.waitForURL((url) => url.pathname === "/client"); assert.equal((await readCreatedOwner(admin, fixture, owner)).clientId, created.clientId);
      });
      await step(`${owner.label}: empty Today and Apps reload`, async () => {
        await page.waitForFunction((name) => document.title.includes(name), owner.name);
        await assertOwnerWorkspaceNavigation(page, owner.name);
        assert.equal(await page.locator("[data-work-section]").count(), 0, "An empty Today must not show filler work sections.");
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
        await page.goto(`${target.appUrl}/client/apps`); await assertOwnerWorkspaceNavigation(page, owner.name); await screenshot(page, target, `${owner.label}-source-apps-collapsed`);
        const accountControls = page.locator("summary").filter({ hasText: /^\s*Account controls & details\s*$/ });
        assert.ok(await accountControls.count() > 0);
        for (let index = 0; index < await accountControls.count(); index++) await accountControls.nth(index).click();
        assert.equal(await page.getByRole("button", { name: "Pause updates", exact: true }).first().isEnabled(), true);
        await visible(page, "Partial coverage");
        await revealCustomerContext(page); await visible(page, sources.expected.customerName); await screenshot(page, target, `${owner.label}-source-apps`); assert.equal((await page.locator("body").innerText()).includes(other.marker), false);
        await verifyIntakePauseResume(page, target, admin, fixture, owner);
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
    workspacePersonalization = await runOwnerWorkspaceScenarios({ admin, fixture, owners, target, step, screenshot, phase, env });
    let signedOutToken;
    await step("phone: normal owner UI sign out", async () => { signedOutToken = sessionTokens.get("phone"); assert.ok(signedOutToken, "A genuine browser GoTrue session token must be observed for revocation proof."); await owners[1].page.goto(`${target.appUrl}/client/apps`); await signOutUi(owners[1].page, target); });
    await step("phone: stale signed session denied by real RPCs", async () => {
      for (const [rpc, body] of [["current_session_actor", {}], ["provision_first_owner", { p_key: randomUUID(), p_business: { name: owners[1].name, description: "Synthetic browser acceptance business: project planning and customer coordination.", timezone: "America/Chicago" } }]]) {
        const response = await fetch(`${target.supabaseUrl}/rest/v1/rpc/${rpc}`, { method: "POST", headers: { apikey: target.anonKey, Authorization: `Bearer ${signedOutToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
        assert.ok([401, 403].includes(response.status), "The real logged-out signed user token cannot resolve an actor or provision again.");
      }
    });
    await step("phone: real re-login preserves original workspace", async () => {
      const owner = owners[1];
      await loginUi(owner.page, target, owner.email); await owner.page.waitForURL((url) => url.origin === target.appUrl && url.pathname === "/client");
      await phase("phone: read session cookie from this normal re-login"); const token = await readOwnerBrowserSession(owner.context, target);
      await phase("phone: verify distinct live re-login session actor"); await verifyObservedOwnerSession(target, token, owner.userId, signedOutToken); sessionTokens.set("phone", token);
      assert.equal(await owner.page.getByRole("button", { name: "Create my business", exact: true }).count(), 0);
      const persisted = await readCreatedOwner(admin, fixture, owner); assert.equal(persisted.clientId, owner.clientId); assert.equal(persisted.membershipId, owner.membershipId); assert.equal(persisted.receiptId, owner.receiptId);
      await assertSavedWorkspacePreferences(owner.page, target.appUrl, owner.workspacePreferences);
      await owner.page.goto(`${target.appUrl}/client/apps`); await revealCustomerContext(owner.page); await visible(owner.page, owner.sources.expected.customerName); await screenshot(owner.page, target, "phone-relogin-persisted");
    });
    await step("phone: normal account switch replaces prior business access", async () => {
      const prior = owners[1], current = owners[0], page = prior.page;
      await signOutUi(page, target);
      const previousToken = sessionTokens.get("phone");
      await loginUi(page, target, current.email); await page.waitForURL((url) => url.origin === target.appUrl && url.pathname === "/client");
      await phase("phone: read session cookie after the normal account switch"); const token = await readOwnerBrowserSession(prior.context, target);
      await phase("phone: verify current switched-account live session"); await verifyObservedOwnerSession(target, token, current.userId, previousToken); sessionTokens.set("phone", token);
      await page.waitForFunction((name) => document.title.includes(name), current.name);
      assert.equal(await page.getByRole("button", { name: "Create my business", exact: true }).count(), 0);
      const persisted = await readCreatedOwner(admin, fixture, current); assert.equal(persisted.clientId, current.clientId); assert.equal(persisted.membershipId, current.membershipId); assert.equal(persisted.receiptId, current.receiptId);
      await assertSavedWorkspacePreferences(page, target.appUrl, current.workspacePreferences);
      assert.notDeepEqual(current.workspacePreferences, prior.workspacePreferences, "Distinct account preferences must not be substituted during the same-browser switch.");
      const scoped = await page.request.get(`${target.appUrl}/api/connections?clientId=${prior.clientId}`); assert.equal(scoped.status(), 200);
      const data = JSON.stringify(await scoped.json()); assert.ok(data.includes(current.marker)); assert.equal(data.includes(prior.marker), false, "The same browser must no longer read the previous account's sources.");
      await page.goto(`${target.appUrl}/client/apps`); await revealCustomerContext(page); await visible(page, current.sources.expected.customerName); assert.equal((await page.locator("body").innerText()).includes(prior.marker), false);
      await screenshot(page, target, "phone-switched-account");
      await page.goto(`${target.appUrl}/client/money`); await visible(page, current.sources.expected.invoiceNumber); assert.equal((await page.locator("body").innerText()).includes(prior.marker), false);
      for (const [kind, ref] of Object.entries(prior.sources.sourceRefs || {})) {
        const endpoint = kind === "invoice" ? "invoice-follow-up" : kind === "hubspot" ? "crm-gateway" : null; if (!endpoint) continue;
        const denied = await page.request.get(`${target.appUrl}/api/business/${endpoint}?${new URLSearchParams({ connectionId: ref.connectionId, recordId: ref.recordId })}`); assert.ok([403, 404].includes(denied.status()), "Switching accounts must deny exact source-review access to the previous business.");
      }
    });
    await step("desktop: revoked membership and no re-provision", async () => {
      const owner = owners[0], disabled = await admin.from("memberships").update({ status: "disabled" }).eq("id", owner.membershipId).eq("user_id", owner.userId).eq("client_id", owner.clientId); assert.equal(disabled.error, null);
      assert.equal((await owner.page.request.get(`${target.appUrl}/api/connections`)).status(), 403); await owner.page.goto(`${target.appUrl}/client`); await visible(owner.page, "Business setup unavailable"); assert.equal(await owner.page.getByRole("button", { name: "Create my business", exact: true }).count(), 0); await screenshot(owner.page, target, "desktop-revoked-access"); await signOutUi(owner.page, target);
    });
    await step("phone: switched session loses revoked business access", async () => {
      const page = owners[1].page;
      assert.equal((await page.request.get(`${target.appUrl}/api/connections`)).status(), 403);
      await page.goto(`${target.appUrl}/client`); await visible(page, "Business setup unavailable"); assert.equal(await page.getByRole("button", { name: "Create my business", exact: true }).count(), 0);
      await screenshot(page, target, "phone-switched-revoked-access"); await signOutUi(page, target);
    });
    assert.deepEqual(diagnostics, [], "The real browser must have no uncaught page errors, external requests or service-key exposure.");
  } catch (error) { failure ||= error; failurePhase ||= currentPhase; console.error(`Owner browser stopping: ${redactBrowserFailure(failure.message, [target.anonKey, target.serviceKey])}`); await checkpoint("failed"); }
  finally {
    const cleanupCheckpoint = async (status = failure ? "failed" : "in_progress") => {
      try { await checkpoint(status); }
      catch (error) { failure ||= error; failurePhase ||= currentPhase; console.error("Owner browser evidence checkpoint could not be written; scoped cleanup will still be attempted."); }
    };
    cleanupStatus = "running"; await cleanupCheckpoint();
    const clean = async (label, action, timeoutMs) => {
      currentPhase = label; await cleanupCheckpoint();
      try { return await withOwnerBrowserDeadline(label, action, timeoutMs); }
      catch (error) { cleanupErrors.push(label); failure ||= error; failurePhase ||= currentPhase; await cleanupCheckpoint("failed"); }
    };
    for (let index = 0; index < contexts.length; index++) await clean(`close browser context ${index + 1}`, () => contexts[index].close(), 5000);
    if (browser) await clean("close owned browser", () => browser.close(), 8000);
    if (app) await clean("stop owned app", async () => { app.child.kill("SIGTERM"); await new Promise((done) => { if (app.child.exitCode !== null) done(); else { app.child.once("exit", done); setTimeout(() => { app.child.kill("SIGKILL"); done(); }, 5000).unref(); } }); }, 6000);
    const cleaned = await clean("verify synthetic database fixture cleanup", () => cleanupBrowserFixtures(admin, fixture), 30000);
    if (cleaned === 0) remainingFixtures = 0; // Only the actual scoped empty-target check proves cleanup.
    for (const owner of fixture.owners) await clean(`clean synthetic ${owner.label} mailbox`, () => cleanupMailbox(target, owner.email), 12000);
    cleanupStatus = cleanupErrors.length ? "incomplete" : "complete"; currentPhase = "acceptance finished";
    await cleanupCheckpoint(failure ? "failed" : "passed");
  }
  if (failure) throw new Error(redactBrowserFailure(failure.message, [target.anonKey, target.serviceKey]));
  console.log(`Owner browser acceptance passed ${checks.length} genuine browser/source stages; synthetic fixtures remaining: ${remainingFixtures}.`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch((error) => {
  console.error(`BLOCKED/FAIL owner browser: ${redactBrowserFailure(error.message)}`); process.exitCode = 1;
  // The failed report and bounded scoped cleanup have already been attempted.
  // A leftover transport or child must not keep a failed disposable CLI alive.
  process.exit(1);
});
