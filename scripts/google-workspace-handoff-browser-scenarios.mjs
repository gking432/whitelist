// Disposable hosted-CI navigation protocol fixtures only. The owners signed in
// through the real email UI. Only the app's encrypted handoff cookie is seeded;
// Auth cookies, access tokens and refresh tokens are never injected or changed.
import assert from "node:assert/strict";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assertFoundationHttpScope } from "./owner-foundation-conflict-http.mjs";
import { onboardingApi } from "./owner-onboarding-browser-scenarios.mjs";
import { withOwnerBrowserDeadline } from "./owner-workspace-browser-scenarios.mjs";

const cookieName = "workstation_google_onboarding_handoff";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ttl = 600000;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const unchanged = (actual, expected, message) => assert.ok(isDeepStrictEqual(actual, expected), message);
const bound = (name, action, milliseconds = 20000) => withOwnerBrowserDeadline(name, action, milliseconds);

export function assertGoogleHandoffScope(options) {
  assertFoundationHttpScope(options);
  assert.ok(typeof options.env.SECRETS_ENCRYPTION_KEY === "string" && Buffer.from(options.env.SECRETS_ENCRYPTION_KEY, "base64").length === 32,
    "Synthetic handoff fixtures require the disposable CI encryption key.");
}

/** This only creates a navigation carrier. It cannot create an Auth session. */
export function googleHandoffFixtureCookie(appUrl, encryptionKey, handoff) {
  const origin = new URL(appUrl);
  assert.ok(origin.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) && origin.port === "3000" && origin.pathname === "/" && !origin.username && !origin.password && !origin.search && !origin.hash,
    "Handoff fixture cookies are restricted to the disposable loopback app.");
  // The production shape has eight fields. No token, provider credential or
  // caller-controlled cookie name is accepted at this test boundary.
  assert.ok(object(handoff) && Object.keys(handoff).length === 8 && Object.keys(handoff).every(key => ["version", "attemptId", "draftId", "requestKey", "actorId", "sessionId", "issuedAt", "expiresAt"].includes(key)) && handoff.version === 1 &&
    [handoff.attemptId, handoff.draftId, handoff.requestKey, handoff.actorId, handoff.sessionId].every(value => typeof value === "string" && uuid.test(value)) &&
    Number.isSafeInteger(handoff.issuedAt) && handoff.issuedAt >= 0 && Number.isSafeInteger(handoff.expiresAt) && handoff.expiresAt === handoff.issuedAt + ttl,
  "Use the exact production handoff shape.");
  const key = Buffer.from(encryptionKey, "base64"); assert.equal(key.length, 32, "Use only the disposable CI encryption key.");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(handoff), "utf8"), cipher.final()]);
  return { name: cookieName, value: ["v1", iv.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join("."), url: origin.origin,
    httpOnly: true, secure: false, sameSite: "Lax", expires: Math.floor(Date.now() / 1000) + 600 };
}

export function assertGoogleHandoffUnchanged(before, after) {
  unchanged(after, before, "Handoff navigation must preserve the exact original business facts, authority, source, receipts and execution history.");
}

/** The caller has already observed a real browser-generated Server Action.
 * Retain only the headers required to replay that exact request; never Cookie,
 * Authorization, SDK auth storage or a guessed action identifier. */
export async function captureGoogleHandoffAction(request, appUrl) {
  const url = new URL(request.url());
  assert.ok(url.origin === appUrl && url.pathname === "/start" && url.search === "?google=return" && !url.hash && request.method() === "POST", "Only the exact observed handoff action can be replayed.");
  const body = request.postDataBuffer(); assert.ok(Buffer.isBuffer(body) && body.byteLength > 0 && body.byteLength <= 1048576, "The actual action body must be complete and bounded.");
  const headers = { Origin: appUrl, Referer: `${appUrl}/start?google=return` };
  for (const key of ["content-type", "next-action", "accept", "next-router-state-tree"]) {
    const value = await bound("observed handoff action header", () => request.headerValue(key), 5000);
    if (value !== null) { assert.ok(typeof value === "string" && value.length > 0 && value.length <= 32768 && !/[\r\n]/.test(value), "The observed action headers must be bounded."); headers[key] = value; }
  }
  assert.ok(headers["next-action"] && headers["content-type"], "Replay requires the real hydrated action request, without inventing an action identifier.");
  return { body, headers };
}

async function observeAction(page, appUrl, trigger) {
  const requests = new WeakSet();
  const listener = request => { const url = new URL(request.url()); if (url.origin === appUrl && url.pathname === "/start" && request.method() === "POST") requests.add(request); };
  page.on("request", listener);
  try {
    const waiting = page.waitForResponse(response => requests.has(response.request()), { timeout: 20000 }); void waiting.catch(() => {});
    await trigger(); const response = await waiting;
    assert.equal(response.status(), 200, "The genuine handoff action must complete its normal HTTP200 response; its visible result is checked separately.");
    assert.equal(await bound("handoff action transport completion", () => response.finished()), null, "The actual browser action response must finish.");
    return captureGoogleHandoffAction(response.request(), appUrl);
  } finally { page.off("request", listener); }
}

async function baseline(admin, fixture, owner) {
  const rows = {};
  for (const [table, order] of [
    ["business_workspace_profiles", "client_id"], ["client_knowledge_profiles", "id"], ["business_context_reviews", "client_id"], ["agent_team_settings", "client_id"],
    ["client_businesses", "id"], ["integration_connections", "id"], ["integration_canonical_records", "id"], ["action_jobs", "id"], ["agent_work_items", "id"],
    ["integration_sync_jobs", "id"], ["approval_items", "id"], ["ai_call_usage", "id"], ["usage_events", "id"], ["voice_usage_events", "call_session_id"], ["first_owner_workspaces", "id"],
  ]) {
    let query = admin.from(table).select("*").eq("partner_id", fixture.partnerId);
    query = table === "client_businesses" ? query.eq("id", owner.clientId) : query.eq("client_id", owner.clientId);
    const result = await query.order(order).limit(101);
    assert.ok(!result.error && Array.isArray(result.data) && result.data.length <= 100, "The exact disposable business/effect baseline must be complete."); rows[table] = result.data;
  }
  const member = await admin.from("memberships").select("*").eq("id", owner.membershipId).eq("user_id", owner.userId).eq("partner_id", fixture.partnerId).eq("client_id", owner.clientId).single();
  assert.ok(!member.error && member.data?.role === "client_owner" && member.data.status === "active", "The original genuine owner membership must remain active."); rows.membership = member.data;
  assert.equal(rows.agent_team_settings[0]?.status, "paused", "Synthetic handoffs cannot activate the original paused team.");
  return rows;
}

async function receipt(admin, fixture, owner, key) {
  const row = await admin.from("business_owner_commands").select("*").eq("partner_id", fixture.partnerId).eq("client_id", owner.clientId).eq("request_key", key).maybeSingle();
  assert.equal(row.error, null, "The exact handoff command receipt must be readable."); return row.data;
}

async function entry(target, token, request) {
  let response;
  try { response = await request(`${target.supabaseUrl}/rest/v1/rpc/get_first_owner_entry`, { method: "POST", headers: { apikey: target.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error("The genuine owner's entry RPC did not complete."); }
  assert.equal(response.status, 200, "The actual authenticated entry RPC must complete successfully.");
  let text; try { text = await response.text(); } catch { throw new Error("The genuine owner's entry RPC body did not complete."); }
  assert.ok(text.length > 0 && Buffer.byteLength(text) <= 32768, "Entry JSON must be bounded and complete.");
  let value; try { value = JSON.parse(text); } catch { throw new Error("The genuine owner's entry RPC must return complete JSON."); }
  unchanged(value, { state: "existing", destination: "/client" }, "A genuine existing client owner must resume that workspace, including when also a platform owner.");
}

/** Always finish all exact cleanup operations. Evidence publication cannot hide
 * the original failed assertion, and cannot turn a successful run into a pass. */
export async function finishGoogleHandoffEvidence(report, operations, publish, originalFailure) {
  report.fixtureCleanup = "running"; let failure = originalFailure;
  for (const [key, operation] of operations) {
    try { await operation(); }
    catch { report.cleanupErrors.push(key); report.status = "failed"; failure ??= new Error("The exact handoff fixture cleanup failed."); }
  }
  report.fixtureCleanup = report.cleanupErrors.length ? "failed" : "complete";
  if (failure) report.status = "failed";
  try { await publish(); }
  catch { report.status = "failed"; failure ??= new Error("The final handoff evidence could not be published."); }
  if (failure) throw failure;
}

export async function runGoogleWorkspaceHandoffBrowserScenarios({ admin, fixture, owners, target, readSession, verifySession, screenshot,
  phase = async () => {}, onProgress = async () => {}, env = process.env, request = fetch }) {
  assertGoogleHandoffScope({ fixture, owners, target, env });
  const report = { version: 1, status: "in_progress", activeStep: null, checks: [], fixtureCleanup: "not_started", cleanupErrors: [], remainingMemberships: null, remainingHandoffCookies: null, savedPresentationRestored: false,
    originalOwnerStateUnchanged: false, authSessionInjected: false, googleConsentProved: false, googleCodeExchangeProved: false, providerCalls: 0, modelCalls: 0,
    limitations: ["Synthetic encrypted navigation handoffs bound to genuine email-login actor/session pairs. No Google consent, Google callback exchange or new Auth session is proved.",
      "The handoff fixture cookie uses the disposable HTTP loopback transport. Production secure-cookie flags and Google identity-only SDK exchange are covered separately.",
      "Existing owners only: actual existing-workspace actions, dual-role precedence, progress CAS and receipts are exercised. New-business Google adoption remains separately unproved.",
      "Only intended owner progress/navigation and its durable command receipts may change; facts, authority, imported sources and execution/model/provider histories remain exact.",
      "No provider/model operation is initiated by this module. Persisted effects are compared exactly; this is not a server egress packet trace."] };
  const publish = () => onProgress(JSON.parse(JSON.stringify(report)));
  const stage = async (key, action) => {
    report.activeStep = key; await publish(); await phase(`synthetic Google navigation: ${key}`);
    try { await bound(`Google navigation ${key}`, action, 120000); report.checks.push({ key, status: "passed" }); report.activeStep = null; await publish(); }
    catch (error) { report.status = "failed"; report.checks.push({ key, status: "failed" }); throw error; }
  };
  const originals = new Map(), memberships = [], restores = []; let failure;
  try {
    for (const owner of owners) {
      const { page, context } = owner, scope = `${owner.userId}:${owner.clientId}`;
      let saved, identity, original, membershipId;
      const call = (body, operation) => onboardingApi(context, target, scope, body, { phase, operation });
      const set = carrier => context.addCookies([carrier]);
      const make = (changes = {}) => ({ version: 1, attemptId: randomUUID(), draftId: randomUUID(), requestKey: randomUUID(), actorId: owner.userId, sessionId: identity.sessionId, issuedAt: Date.now(), ...changes });
      const cookie = value => googleHandoffFixtureCookie(target.appUrl, env.SECRETS_ENCRYPTION_KEY, { ...value, expiresAt: value.issuedAt + ttl });
      const current = async () => (await call(undefined, `${owner.label}: actual current handoff progress`)).body;
      const verifyUnchanged = async () => assertGoogleHandoffUnchanged(original, await baseline(admin, fixture, owner));
      const form = async () => { const value = page.locator('[data-google-workspace-handoff="connect"]'); await value.waitFor({ state: "visible" }); return value; };
      const render = async carrier => {
        await set(carrier); await page.goto(`${target.appUrl}/start?google=return`); const value = await form();
        assert.equal(await page.locator('[data-google-workspace-handoff="create"], [data-first-owner-form], [data-guest-owner-form]').count(), 0);
        await value.getByRole("heading", { name: "Connect your apps?", exact: true }).waitFor();
        await value.getByText(`Your existing workspace, ${owner.name}, is ready to resume. Your saved business answers will stay as they are.`, { exact: true }).waitFor();
        assert.equal(await value.getByRole("button", { name: "Continue to apps", exact: true }).isEnabled(), true);
        return value;
      };
      const denied = async (value, message) => {
        await observeAction(page, target.appUrl, () => value.getByRole("button", { name: "Continue to apps", exact: true }).click());
        await value.getByText(message, { exact: true }).waitFor(); assert.equal(await value.getByRole("button", { name: "Continue to apps", exact: true }).isEnabled(), false);
      };
      await stage(`${owner.label}: genuine existing-owner baseline`, async () => {
        const token = await readSession(context, target); identity = await verifySession(target, token, owner.userId);
        assert.ok(identity?.userId === owner.userId && uuid.test(identity.sessionId), "The actual current email-login actor/session must verify before seeding a navigation fixture.");
        await entry(target, token, request); original = await baseline(admin, fixture, owner); originals.set(owner.label, { owner, original });
        saved = await current(); restores.push({ owner, step: saved.progress.step, snapshot: saved });
        assert.equal(saved.progress.finished, true, "Handoff acceptance follows the existing completed owner journey.");
        membershipId = randomUUID(); memberships.push({ id: membershipId, userId: owner.userId });
        const added = await admin.from("memberships").insert({ id: membershipId, user_id: owner.userId, role: "platform_owner", status: "active" });
        assert.equal(added.error, null, "The synthetic same-run dual-role membership must use the real schema.");
        await entry(target, token, request);
      });
      await stage(`${owner.label}: invalid carriers cannot expose an adoption form`, async () => {
        const initial = await current();
        for (const variant of ["forged", "expired", "wrong actor", "wrong session"]) {
          const value = make(variant === "expired" ? { issuedAt: Date.now() - ttl - 1000 } : variant === "wrong actor" ? { actorId: owners.find(other => other !== owner).userId } : variant === "wrong session" ? { sessionId: randomUUID() } : {});
          const carrier = cookie(value); if (variant === "forged") carrier.value = "v1.Zm9yZ2Vk.Zm9yZ2Vk.Zm9yZ2Vk";
          await set(carrier); await page.goto(`${target.appUrl}/start?google=return`); await page.waitForURL(url => url.origin === target.appUrl && url.pathname === "/client");
          assert.equal(await page.locator("[data-google-workspace-handoff]").count(), 0, "An invalid carrier must not mount the private adoption/connection confirmation.");
          unchanged(await current(), initial, "Invalid navigation carriers must leave the exact persisted progress unchanged.");
        }
        await verifyUnchanged();
      });
      await stage(`${owner.label}: rendered draft tampering is denied`, async () => {
        const value = make(), initial = await current(), panel = await render(cookie(value));
        await panel.locator('input[name="draftId"]').evaluate((node, changed) => { node.value = changed; }, randomUUID());
        await denied(panel, "That Google setup attempt expired or changed. Start again; your draft stays in this tab.");
        unchanged(await current(), initial, "A tampered hidden draft must not write progress."); assert.equal(await receipt(admin, fixture, owner, value.requestKey), null);
        await verifyUnchanged();
      });
      await stage(`${owner.label}: session changes after rendering are denied`, async () => {
        const value = make(), initial = await current(), panel = await render(cookie(value));
        await set(cookie({ ...value, sessionId: randomUUID() }));
        await denied(panel, "That Google setup attempt expired or changed. Start again; your draft stays in this tab.");
        unchanged(await current(), initial, "A stale-session carrier must not write progress."); assert.equal(await receipt(admin, fixture, owner, value.requestKey), null);
        await verifyUnchanged();
      });
      await stage(`${owner.label}: concurrent saved progress remains a real CAS conflict`, async () => {
        const value = make(), initial = await current(), panel = await render(cookie(value));
        const concurrent = { key: randomUUID(), revision: initial.progress.revision, action: "navigate", step: initial.progress.step };
        const committed = (await call(concurrent, `${owner.label}: explicit competing progress commit`)).body.snapshot;
        await denied(panel, "Your setup changed elsewhere. Open saved setup before continuing.");
        unchanged(await current(), committed, "The losing real Server Action must not overwrite the committed owner progress."); assert.equal(await receipt(admin, fixture, owner, value.requestKey), null);
        // An explicit reload must replace the document and the frozen action
        // state, without silently submitting or changing saved progress.
        await set(cookie(value));
        const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }); void navigation.catch(() => {});
        await panel.getByRole("link", { name: "Reload setup", exact: true }).click(); await navigation;
        const refreshed = await form();
        assert.equal(await refreshed.locator('input[name="revision"]').inputValue(), String(committed.progress.revision), "A new document must receive the actual current revision.");
        assert.equal(await refreshed.getByRole("button", { name: "Continue to apps", exact: true }).isEnabled(), true, "Explicit reload must clear the old frozen action state.");
        unchanged(await current(), committed, "Reloading setup alone must not write progress or resubmit the failed command."); assert.equal(await receipt(admin, fixture, owner, value.requestKey), null);
        await verifyUnchanged();
      });
      await stage(`${owner.label}: dual-role resume, exact action replay and changed-key denial`, async () => {
        const value = make(), carrier = cookie(value), before = await current(), panel = await render(carrier);
        await screenshot(page, target, `google-handoff-${owner.label}-existing-workspace`);
        const captured = await observeAction(page, target.appUrl, () => panel.getByRole("button", { name: "Continue to apps", exact: true }).click());
        await page.waitForURL(url => url.origin === target.appUrl && url.pathname === "/client/onboarding");
        await page.locator('[data-business-onboarding][data-onboarding-step="connections"]').waitFor({ state: "visible" });
        const completed = await current(); assert.equal(completed.progress.step, "connections"); assert.equal(completed.progress.revision, before.progress.revision + 1);
        const committed = await receipt(admin, fixture, owner, value.requestKey); assert.ok(committed && committed.actor_id === owner.userId, "The exact existing-owner navigation must persist its real actor-bound durable receipt.");
        assert.equal((await context.cookies(target.appUrl)).filter(item => item.name === cookieName).length, 0, "Successful adoption must retire its handoff carrier.");
        // Reuse the actual captured body/action reference with current genuine
        // browser cookies. No guessed header, token or session is supplied.
        await set(carrier);
        const replay = await context.request.post(`${target.appUrl}/start?google=return`, { headers: captured.headers, data: captured.body, timeout: 20000, maxRedirects: 0 });
        assert.equal(replay.status(), 200, "Exact durable action replay must complete its native response.");
        let replayText; try { replayText = await replay.text(); } catch { throw new Error("The exact action replay response did not complete."); }
        assert.ok(replayText.length > 0 && Buffer.byteLength(replayText) <= 1048576, "The replay's native Flight response must be complete and bounded.");
        unchanged(await current(), completed, "Exact captured-action replay must not advance progress again."); unchanged(await receipt(admin, fixture, owner, value.requestKey), committed, "Exact replay must retain the original durable receipt bytes.");
        assert.equal((await context.cookies(target.appUrl)).filter(item => item.name === cookieName).length, 0, "Exact replay must reach the successful handoff retirement branch.");
        // A newly rendered form has the current revision. Reusing the old key
        // with those changed command bytes must be denied, never silently heal.
        const changed = await render(carrier);
        await denied(changed, "Your setup changed elsewhere. Open saved setup before continuing.");
        unchanged(await current(), completed, "Changed-body/key replay must not create another progress revision."); unchanged(await receipt(admin, fixture, owner, value.requestKey), committed, "Changed-key denial must preserve the accepted receipt.");
        await screenshot(page, target, `google-handoff-${owner.label}-changed-key-denied`);
        await verifyUnchanged();
      });
    }
    report.originalOwnerStateUnchanged = true; report.status = "passed";
  } catch (error) { failure = error; report.status = "failed"; }
  finally {
    const operations = [
      ...restores.map(({ owner, step }) => [`${owner.label}: restore saved presentation`, async () => {
        const scope = `${owner.userId}:${owner.clientId}`, before = (await onboardingApi(owner.context, target, scope, undefined, { phase, operation: `${owner.label}: cleanup current progress` })).body;
        if (before.progress.step !== step) await onboardingApi(owner.context, target, scope, { key: randomUUID(), revision: before.progress.revision, action: "navigate", step }, { phase, operation: `${owner.label}: restore original saved presentation` });
        const restored = (await onboardingApi(owner.context, target, scope, undefined, { phase, operation: `${owner.label}: verify restored progress` })).body;
        assert.equal(restored.progress.step, step, "Cleanup must restore the saved presentation through the real owner API.");
      }]),
      ...memberships.map(value => ["remove exact synthetic dual-role membership", async () => {
        const removed = await admin.from("memberships").delete().eq("id", value.id).eq("user_id", value.userId).eq("role", "platform_owner").is("partner_id", null).is("client_id", null);
        assert.equal(removed.error, null, "Only the exact registered synthetic global membership may be removed.");
      }]),
      ...owners.map(owner => [`${owner.label}: remove only handoff fixture cookie`, async () => {
        await owner.context.clearCookies({ name: cookieName });
        assert.equal((await owner.context.cookies(target.appUrl)).filter(item => item.name === cookieName).length, 0);
      }]),
      ["verify handoff cookie cleanup", async () => {
        let remaining = 0;
        for (const owner of owners) remaining += (await owner.context.cookies(target.appUrl)).filter(item => item.name === cookieName).length;
        assert.equal(remaining, 0, "No synthetic handoff carrier may remain in either genuine owner context."); report.remainingHandoffCookies = 0;
      }],
      ["verify exact membership cleanup", async () => {
        if (!memberships.length) { report.remainingMemberships = 0; return; }
        const remaining = await admin.from("memberships").select("id", { count: "exact", head: true }).in("id", memberships.map(value => value.id));
        assert.ok(!remaining.error && remaining.count === 0, "No synthetic global membership may remain."); report.remainingMemberships = 0;
      }],
      ...[...originals.values()].map(({ owner, original }) => [`${owner.label}: final exact business invariants`, async () => assertGoogleHandoffUnchanged(original, await baseline(admin, fixture, owner))]),
      ["verify original saved presentation", async () => {
        for (const { owner, step, snapshot } of restores) {
          const actual = (await onboardingApi(owner.context, target, `${owner.userId}:${owner.clientId}`, undefined, { phase, operation: `${owner.label}: final presentation check` })).body;
          assert.equal(actual.progress.step, step, "The actual saved owner presentation must match its original step after cleanup.");
          unchanged({ ...actual, progress: { ...actual.progress, revision: 0 } }, { ...snapshot, progress: { ...snapshot.progress, revision: 0 } }, "Only the intended presentation revision may differ after restoring the exact original saved setup.");
        }
        report.savedPresentationRestored = true;
      }],
    ];
    await finishGoogleHandoffEvidence(report, operations, publish, failure);
  }
  return report;
}
