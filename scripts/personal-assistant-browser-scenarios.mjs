// Genuine-cookie, disposable hosted-CI acceptance. No auth writes, provider,
// model, billing, voice or assistant conversation is created by this module.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assertFoundationHttpScope, collectFoundationHttpRace, readFoundationHttpJson } from "./owner-foundation-conflict-http.mjs";
import { withOwnerBrowserDeadline } from "./owner-workspace-browser-scenarios.mjs";

const path = "/api/business/personal-assistant";
const labels = { muse: "Muse", chatgpt_dot: "ChatGPT Dot", grok: "Grok", other: "Another assistant", workstation: "Workstation assistant (ours)" };
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, expected) => object(value) && Object.keys(value).sort().join(",") === [...expected].sort().join(",");
const same = (value, expected, message) => assert.ok(isDeepStrictEqual(value, expected), message);
export const personalAssistantScopeHeader = (owner) => ({ "X-Workstation-Scope": `${owner.userId}:${owner.clientId}` });
export function assertPersonalAssistantSnapshot(value) {
  assert.ok(keys(value, ["version", "preferences", "connection", "available", "canEdit"]) && value.version === 1 && value.available === true && value.canEdit === true, "A complete personal assistant snapshot is required.");
  const p = value.preferences, c = value.connection;
  assert.ok(keys(p, ["answer", "assistant", "revision"]) && ["unanswered", "yes", "no", "skipped"].includes(p.answer) && Number.isSafeInteger(p.revision) && p.revision >= 0, "The saved assistant preference must be complete and versioned.");
  assert.ok(p.answer === "yes" ? ["muse", "chatgpt_dot", "grok", "other"].includes(p.assistant) : p.answer === "no" ? [null, "workstation"].includes(p.assistant) : p.assistant === null, "Assistant selection must match the explicit answer.");
  const state = p.assistant === "workstation" ? "setup_needed" : p.assistant ? "unavailable" : "not_selected";
  assert.ok(keys(c, ["state", "label", "detail", "canChat"]) && c.state === state && c.label === (labels[p.assistant] || "Personal assistant") && c.canChat === false && typeof c.detail === "string" && c.detail.length > 0 && c.detail.length <= 1000, "An unavailable or unconfigured assistant must never claim working chat.");
  return value;
}
export async function personalAssistantApi(context, target, owner, body, { expected = [200], phase = async () => {}, operation = "personal assistant", origin = target.appUrl, scope = owner } = {}) {
  const response = await readFoundationHttpJson(() => body === undefined
    ? context.request.get(`${target.appUrl}${path}`, { headers: personalAssistantScopeHeader(scope), timeout: 15000 })
    : context.request.post(`${target.appUrl}${path}`, { headers: { Origin: origin, ...personalAssistantScopeHeader(scope) }, data: body, timeout: 15000 }), { expected, phase, operation });
  if (response.status === 200) assertPersonalAssistantSnapshot(response.body);
  else assert.ok(keys(response.body, ["error"]) && typeof response.body.error === "string" && response.body.error.length <= 1000, "Denied personal preference requests must return a bounded public error.");
  return response;
}
export async function assertSavedPersonalAssistant(context, target, owner, expected, phase = async () => {}) {
  const response = await personalAssistantApi(context, target, owner, undefined, { phase, operation: "personal assistant saved choice GET" });
  same(response.body.preferences, expected, "The current genuine session must read its own persisted assistant choice.");
}
export async function personalAssistantRpc(target, token, name, body, expected, request = fetch, profile) {
  assert.ok(["get_owner_personal_assistant", "save_owner_personal_assistant", "personal_assistant"].includes(name), "Only the bounded preference RPC probes are permitted.");
  const response = await request(`${target.supabaseUrl}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: target.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(profile ? { "Content-Profile": profile } : {}) }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(10000) });
  assert.ok(expected.includes(response.status), `Personal preference RPC must return its expected status; received ${response.status}.`);
  const value = await withOwnerBrowserDeadline("personal preference RPC JSON", () => response.json(), 10000);
  if (response.status === 200) {
    assert.ok(keys(value, ["preferences", "available", "canEdit"]) && value.available === true && value.canEdit === true, "The user-scoped RPC must return a complete stored snapshot.");
    assertPersonalAssistantSnapshot({ version: 1, ...value, connection: { state: value.preferences.assistant === "workstation" ? "setup_needed" : value.preferences.assistant ? "unavailable" : "not_selected", label: labels[value.preferences.assistant] || "Personal assistant", detail: "Stored preference only.", canChat: false } });
  } else assert.ok(object(value) && typeof value.code === "string", "A denied RPC must supply a complete PostgREST error.");
  return { status: response.status, body: value };
}
export async function assertPersonalAssistantDenied({ context, target, owner, token, phase = async () => {}, request = fetch }) {
  await personalAssistantApi(context, target, owner, undefined, { expected: [403], phase, operation: "inaccessible assistant GET" });
  await personalAssistantApi(context, target, owner, { key: randomUUID(), revision: 0, settings: { answer: "skipped", assistant: null } }, { expected: [403], phase, operation: "inaccessible assistant POST" });
  for (const [name, body] of [["get_owner_personal_assistant", { p_client: owner.clientId }], ["save_owner_personal_assistant", { p_client: owner.clientId, p_key: randomUUID(), p_revision: 0, p_settings: { answer: "skipped", assistant: null } }]]) await personalAssistantRpc(target, token, name, body, [401, 403], request);
}
// Observe only new requests initiated after this listener was installed. A
// successful response from a previous save cannot satisfy a later UI click.
export async function observePersonalAssistantSave(page, appUrl, action) {
  const current = new WeakSet();
  const record = (request) => { if (request.url() === `${appUrl}${path}` && request.method() === "POST") current.add(request); };
  page.on("request", record);
  try {
    const pending = page.waitForResponse((response) => current.has(response.request()), { timeout: 15000 });
    // Attach a rejection handler immediately, including when the UI click fails.
    pending.catch(() => {});
    await action();
    const response = await pending;
    assert.equal(response.status(), 200, "The clicked assistant preference save must actually succeed.");
    const value = assertPersonalAssistantSnapshot(await withOwnerBrowserDeadline("assistant UI receipt", () => response.json(), 10000));
    return value;
  } finally { page.off("request", record); }
}
async function stored(admin, fixture, owner) {
  const read = await admin.from("owner_personal_assistant_preferences").select("settings,revision,request_key,request_revision").eq("partner_id", fixture.partnerId).eq("client_id", owner.clientId).eq("user_id", owner.userId).maybeSingle();
  assert.equal(read.error, null, "The exact scoped private preference evidence must be readable by the acceptance administrator."); return read.data;
}
async function assertStored(admin, fixture, owner, snapshot) {
  const row = await stored(admin, fixture, owner); assert.ok(row && row.revision === snapshot.preferences.revision && row.request_revision === row.revision - 1, "A successful UI/API save must have its actual durable revision.");
  same(row.settings, { answer: snapshot.preferences.answer, assistant: snapshot.preferences.assistant }, "The stored scoped preference must equal the actual response.");
}
async function effectState(admin, fixture, owners) {
  const result = {};
  for (const owner of owners) {
    const scoped = {};
    for (const table of ["agent_team_settings", "integration_connections", "action_jobs", "agent_work_items", "integration_sync_jobs", "ai_call_usage", "usage_events", "voice_usage_events"]) {
      const read = await admin.from(table).select("*").eq("partner_id", fixture.partnerId).eq("client_id", owner.clientId).order(table === "agent_team_settings" ? "client_id" : table === "voice_usage_events" ? "call_session_id" : "id").limit(101);
      assert.ok(!read.error && read.data.length <= 100, "Execution, connection and accounting evidence must be complete within its disposable fixture bound."); scoped[table] = read.data;
    }
    const budgets = await admin.from("ai_daily_token_budgets").select("scope_key,day,committed_tokens").in("scope_key", [`client:${owner.clientId}`, `partner:${fixture.partnerId}`]).order("scope_key").order("day").limit(101);
    assert.ok(!budgets.error && budgets.data.length <= 100, "AI accounting evidence must remain bounded and readable."); scoped.budgets = budgets.data;
    result[owner.label] = scoped;
  }
  return result;
}
async function launcher(page) {
  const root = page.locator("[data-personal-assistant-launcher]");
  if (!await root.evaluate((node) => node.open)) await root.getByText("Personal assistant", { exact: true }).click();
  const panel = page.locator("[data-personal-assistant-panel]"); await panel.waitFor({ state: "visible" });
  assert.equal(await panel.locator("textarea,[contenteditable=true],input:not([type=radio]):not([type=checkbox])").count(), 0, "Preference setup must not present a working chat composer.");
  return panel;
}
export async function assertDisplayedPersonalAssistant(page, expected) {
  const panel = await launcher(page);
  await panel.locator("form[data-personal-assistant-form][aria-busy=false]").waitFor();
  const label = labels[expected.assistant] || (expected.answer === "skipped" ? "Skipped for now" : expected.answer === "no" ? "No personal assistant selected" : "Not selected");
  await panel.locator("[data-personal-assistant-selected]").waitFor({ state: "visible" });
  await page.waitForFunction((expectedLabel) => document.querySelector("[data-personal-assistant-selected]")?.textContent?.trim() === expectedLabel, label, { timeout: 15000 });
  assert.equal((await panel.locator("[data-personal-assistant-selected]").innerText()).trim(), label, "The displayed private assistant must be the current actor's actual saved choice.");
  const status = expected.assistant === "workstation" ? "Setup needed" : expected.assistant ? "Integration unavailable" : "Not selected";
  assert.equal((await panel.locator("[data-personal-assistant-status]").innerText()).trim(), status);
  await panel.getByRole("button", { name: "Close personal assistant", exact: true }).click();
}
async function saveUi(page, target, container, reset = false) {
  const value = await observePersonalAssistantSave(page, target.appUrl, () => container.getByRole("button", { name: reset ? "Reset assistant preference" : "Save assistant preference", exact: true }).click());
  await container.getByRole("status").filter({ hasText: reset ? "Assistant preference reset." : "Assistant preference saved." }).waitFor();
  await container.locator("form[data-personal-assistant-form][aria-busy=false]").waitFor(); return value;
}
export async function assertPersonalAssistantGeometry(page) {
  const viewport = page.viewportSize(); assert.ok(viewport, "The real browser viewport must be explicit.");
  const summary = await page.locator("[data-personal-assistant-launcher] summary").boundingBox();
  assert.ok(summary && summary.width >= 44 && summary.height >= 44 && summary.x >= 0 && summary.y >= 0 && summary.x + summary.width <= viewport.width && summary.y + summary.height <= viewport.height, "The launcher must be visible, unclipped and touch accessible.");
  const panel = await page.locator("[data-personal-assistant-panel]").boundingBox();
  assert.ok(panel && panel.x >= 0 && panel.y >= 0 && panel.x + panel.width <= viewport.width && panel.y + panel.height <= viewport.height, "The open assistant preference panel must fit the actual viewport.");
  const nav = page.getByRole("navigation", { name: "Simple business navigation", exact: true });
  if (await nav.count()) { const box = await nav.boundingBox(); assert.ok(!box || summary.y + summary.height <= box.y || summary.y >= box.y + box.height, "The assistant launcher must not cover the mobile bottom navigation."); }
}
export async function runPersonalAssistantBrowserScenarios({ admin, fixture, owners, target, readSession, verifySession, screenshot, phase = async () => {}, onProgress = async () => {}, env = process.env, request = fetch }) {
  assertFoundationHttpScope({ fixture, owners, target, env });
  const report = { version: 1, status: "in_progress", activeStep: null, checks: [], fixtureCleanup: "not_started", retainedPreferencesForRelogin: true, modelCalls: false, providerWrites: false, owners: [], limitations: ["Preferences and unavailable/setup-needed launchers only; no assistant conversation, OAuth connection, voice, model or billing operation.", "Private-schema HTTP rejection proves the schema is not exposed; public wrappers are exercised with the genuine signed-in user's JWT.", "The call-surface collision check uses a labelled presentation-only DOM fixture, not a live call.", "Temporary membership/role fixtures are cleaned here; primary private preferences remain for re-login and are removed by the runner's exact business/user cleanup."] };
  const temporaryMemberships = [], roleRestores = [];
  const publish = () => onProgress({ ...report, checks: report.checks.map((check) => ({ ...check })), owners: report.owners.map((owner) => ({ ...owner })), limitations: [...report.limitations] });
  const stage = async (key, action) => {
    report.activeStep = key; await phase(`personal assistant: ${key}`); await publish();
    try { await withOwnerBrowserDeadline(`personal assistant ${key}`, action, 120000); report.checks.push({ key, status: "passed" }); report.activeStep = null; await publish(); }
    catch (error) { report.status = "failed"; report.checks.push({ key, status: "failed" }); await publish().catch(() => {}); throw error; }
  };
  let failure;
  try {
    const before = await effectState(admin, fixture, owners);
    for (const owner of owners) {
      const other = owners.find((candidate) => candidate.userId !== owner.userId), call = (body, options = {}) => personalAssistantApi(owner.context, target, owner, body, { phase, ...options });
      let token;
      await stage(`${owner.label}: optional scoped preference without setup effects`, async () => {
        token = await readSession(owner.context, target); await verifySession(target, token, owner.userId);
        const initial = (await call()).body; same(initial.preferences, { answer: "unanswered", assistant: null, revision: 0 }, "Creating and using a workspace must not require or manufacture an assistant preference.");
        assert.equal(await stored(admin, fixture, owner), null);
        await personalAssistantRpc(target, token, "get_owner_personal_assistant", { p_client: other.clientId }, [403], request);
      });
      await stage(`${owner.label}: skip save reload and explicit assistant choices`, async () => {
        const page = owner.page; await page.goto(`${target.appUrl}/client/onboarding`);
        let form = page.locator("[data-personal-assistant-onboarding]"); await form.getByRole("group", { name: "Do you use a personal AI assistant?", exact: true }).waitFor();
        await form.getByRole("radio", { name: "Skip for now", exact: true }).check(); let value = await saveUi(page, target, form);
        assert.equal(value.preferences.answer, "skipped"); await assertStored(admin, fixture, owner, value);
        await screenshot(page, target, `${owner.label}-personal-assistant-onboarding`); await page.reload(); form = page.locator("[data-personal-assistant-onboarding]");
        await page.waitForFunction(() => [...document.querySelectorAll("[data-personal-assistant-onboarding] input[type=radio]")].some((node) => node.value === "skipped" && node.checked));
        await form.getByRole("radio", { name: "Yes", exact: true }).check(); await form.getByRole("radio", { name: owner.label === "desktop" ? "Muse" : "Grok", exact: true }).check(); value = await saveUi(page, target, form); await assertStored(admin, fixture, owner, value);
        await page.goto(`${target.appUrl}/client`); let panel = await launcher(page); await panel.getByText("Integration unavailable", { exact: true }).waitFor(); await panel.getByText(labels[value.preferences.assistant], { exact: true }).first().waitFor();
        await assertPersonalAssistantGeometry(page); await screenshot(page, target, `${owner.label}-personal-assistant-launcher`);
        value = await saveUi(page, target, panel, true); assert.equal(value.preferences.answer, "unanswered"); await assertStored(admin, fixture, owner, value);
        await panel.getByRole("radio", { name: "No", exact: true }).check(); await panel.getByRole("checkbox", { name: "Prefer the Workstation assistant", exact: true }).check(); value = await saveUi(page, target, panel);
        assert.equal(value.connection.state, "setup_needed"); await panel.getByText("Setup needed", { exact: true }).waitFor(); await assertStored(admin, fixture, owner, value);
        await panel.evaluate((node) => { node.scrollTop = 0; });
        await screenshot(page, target, `${owner.label}-personal-assistant-ours-status`);
        // A DOM-only visible call surface exercises collision handling without
        // invoking any voice state, media permission or backend call.
        await page.evaluate(() => { const overlay = document.createElement("div"); overlay.dataset.personalAssistantCallFixture = "synthetic-presentation-only"; overlay.className = "fixed z-[80]"; overlay.style.cssText = "position:fixed;width:20px;height:20px;bottom:0;right:0;z-index:80"; document.body.append(overlay); });
        try { await page.waitForFunction(() => document.querySelector("[data-personal-assistant-launcher]")?.hidden === true); }
        finally { await page.evaluate(() => document.querySelector("[data-personal-assistant-call-fixture]")?.remove()); }
        await page.locator("[data-personal-assistant-launcher]").waitFor({ state: "visible" }); panel = await launcher(page);
        if (owner.label === "phone") { await panel.getByRole("button", { name: "Close personal assistant", exact: true }).click(); await page.goto(`${target.appUrl}/client/mobile`); await launcher(page); await assertPersonalAssistantGeometry(page); }
      });
      await stage(`${owner.label}: actual compare-and-swap exact replay and stale tab denial`, async () => {
        const current = (await call()).body, settings = [{ answer: "yes", assistant: "muse" }, { answer: "yes", assistant: "grok" }];
        const commands = settings.map((value) => ({ key: randomUUID(), revision: current.preferences.revision, settings: value }));
        const race = await collectFoundationHttpRace(commands.map((command) => () => call(command, { expected: [200, 409], operation: "personal assistant concurrent save" })));
        same(race.map((value) => value.status).sort(), [200, 409], "Exactly one real HTTP save must win the same revision.");
        const index = race.findIndex((value) => value.status === 200), won = race[index].body; assert.equal(won.preferences.revision, current.preferences.revision + 1); await assertStored(admin, fixture, owner, won);
        same((await call(commands[index])).body, won, "The exact latest-key retry must return its original saved snapshot.");
        await call({ ...commands[index], settings: commands[1 - index].settings }, { expected: [409], operation: "changed same key" });
        await call({ key: randomUUID(), revision: won.preferences.revision, settings: { answer: "skipped", assistant: null } }, { expected: [403], origin: "https://foreign.invalid", operation: "foreign origin" });
        for (const extra of [{ actorId: other.userId }, { clientId: other.clientId }]) await call({ key: randomUUID(), revision: won.preferences.revision, settings: { answer: "skipped", assistant: null }, ...extra }, { expected: [400], operation: "supplied actor or client denied" });
        for (const scope of [{ ...owner, userId: other.userId }, { ...owner, clientId: other.clientId }]) {
          await call(undefined, { scope, expected: [403], operation: "stale displayed scope GET" });
          await call({ key: randomUUID(), revision: won.preferences.revision, settings: { answer: "skipped", assistant: null } }, { scope, expected: [403], operation: "stale displayed scope POST" });
        }
        await assertSavedPersonalAssistant(owner.context, target, owner, won.preferences, phase);
      });
      await stage(`${owner.label}: private table and private schema unavailable to browser JWT`, async () => {
        const url = `${target.supabaseUrl}/rest/v1/owner_personal_assistant_preferences?user_id=eq.${owner.userId}&client_id=eq.${owner.clientId}`;
        for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
          const response = await request(url, { method, headers: { apikey: target.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify({ user_id: owner.userId, client_id: owner.clientId, partner_id: fixture.partnerId, settings: { answer: "no", assistant: null }, revision: 1, request_revision: 0, request_key: randomUUID() }) } : method === "PATCH" ? { body: JSON.stringify({ settings: { answer: "no", assistant: null } }) } : {}), redirect: "error", signal: AbortSignal.timeout(10000) });
          assert.equal(response.status, 403, "The browser JWT must have no direct preference table privilege.");
        }
        const denied = await personalAssistantRpc(target, token, "personal_assistant", { p_client: owner.clientId }, [406], request, "owner_onboarding");
        assert.equal(denied.body.code, "PGRST106", "Private helpers must remain outside the exposed Data API schemas.");
      });
      await stage(`${owner.label}: viewer and revoked membership cannot read or save`, async () => {
        const membership = await admin.from("memberships").select("role,status").eq("id", owner.membershipId).eq("user_id", owner.userId).eq("client_id", owner.clientId).eq("partner_id", fixture.partnerId).single(); assert.equal(membership.error, null);
        const restore = { owner, value: membership.data }; roleRestores.push(restore);
        const original = await stored(admin, fixture, owner);
        try {
          for (const changed of [{ role: "client_viewer" }, { role: membership.data.role, status: "disabled" }]) {
            const update = await admin.from("memberships").update(changed).eq("id", owner.membershipId).eq("user_id", owner.userId).eq("client_id", owner.clientId).eq("partner_id", fixture.partnerId); assert.equal(update.error, null);
            await assertPersonalAssistantDenied({ context: owner.context, target, owner, token, phase, request });
          }
        } finally { const restored = await admin.from("memberships").update(restore.value).eq("id", owner.membershipId).eq("user_id", owner.userId).eq("client_id", owner.clientId).eq("partner_id", fixture.partnerId); assert.equal(restored.error, null); }
        same(await stored(admin, fixture, owner), original, "Denied membership or role requests must preserve the saved private row.");
      });
      await stage(`${owner.label}: explicit final choice retained for re-login`, async () => {
        await owner.page.goto(`${target.appUrl}/client/onboarding`); const form = owner.page.locator("[data-personal-assistant-onboarding]");
        await form.getByRole("radio", { name: "Yes", exact: true }).check(); await form.getByRole("radio", { name: owner.label === "desktop" ? "Muse" : "Grok", exact: true }).check();
        const value = await saveUi(owner.page, target, form); owner.personalAssistantPreferences = value.preferences; await assertStored(admin, fixture, owner, value); report.owners.push({ label: owner.label, preferences: value.preferences });
      });
    }
    await stage("shared business membership keeps each actor's private choice separate", async () => {
      const [first, second] = owners, token = await readSession(second.context, target); await verifySession(target, token, second.userId);
      const entry = { id: randomUUID(), userId: second.userId, clientId: first.clientId }; temporaryMemberships.push(entry);
      const added = await admin.from("memberships").insert({ id: entry.id, user_id: entry.userId, client_id: entry.clientId, partner_id: fixture.partnerId, role: "client_manager", status: "active" }); assert.equal(added.error, null);
      const empty = await personalAssistantRpc(target, token, "get_owner_personal_assistant", { p_client: first.clientId }, [200], request); assert.equal(empty.body.preferences.revision, 0);
      const saved = await personalAssistantRpc(target, token, "save_owner_personal_assistant", { p_client: first.clientId, p_key: randomUUID(), p_revision: 0, p_settings: { answer: "no", assistant: "workstation" } }, [200], request); assert.equal(saved.body.preferences.revision, 1);
      await assertStored(admin, fixture, { ...second, clientId: first.clientId }, { preferences: saved.body.preferences });
      await assertSavedPersonalAssistant(first.context, target, first, first.personalAssistantPreferences, phase);
      // Remove the extra membership before using the second owner's normal
      // primary-business API context again. No primary context is switched.
      const removed = await admin.from("memberships").delete().eq("id", entry.id).eq("user_id", entry.userId).eq("client_id", entry.clientId).eq("partner_id", fixture.partnerId); assert.equal(removed.error, null);
      await personalAssistantRpc(target, token, "get_owner_personal_assistant", { p_client: first.clientId }, [403], request);
      await assertSavedPersonalAssistant(second.context, target, second, second.personalAssistantPreferences, phase);
    });
    await stage("preferences leave authority connections queues and model accounting unchanged", async () => { same(await effectState(admin, fixture, owners), before, "Assistant preference decisions must not change authority, connections, work, jobs, model/voice usage or budgets."); });
    report.status = "passed";
  } catch (error) { failure = error; report.status = "failed"; }
  finally {
    report.fixtureCleanup = "running"; await publish().catch(() => {});
    try {
      for (const restore of roleRestores) { const result = await admin.from("memberships").update(restore.value).eq("id", restore.owner.membershipId).eq("user_id", restore.owner.userId).eq("client_id", restore.owner.clientId).eq("partner_id", fixture.partnerId); assert.equal(result.error, null, "Temporary role fixtures must restore the exact original scoped membership."); }
      for (const entry of temporaryMemberships) {
        const removed = await admin.from("memberships").delete().eq("id", entry.id).eq("user_id", entry.userId).eq("client_id", entry.clientId).eq("partner_id", fixture.partnerId); assert.equal(removed.error, null);
        const cleared = await admin.from("owner_personal_assistant_preferences").delete().eq("user_id", entry.userId).eq("client_id", entry.clientId).eq("partner_id", fixture.partnerId); assert.equal(cleared.error, null);
        for (const [table, column, id] of [["memberships", "id", entry.id], ["owner_personal_assistant_preferences", "user_id", entry.userId]]) { const remaining = await admin.from(table).select(column, { count: "exact", head: true }).eq(column, id).eq("client_id", entry.clientId).eq("partner_id", fixture.partnerId); assert.ok(!remaining.error && remaining.count === 0, "Exact temporary actor fixtures must be removed."); }
      }
      report.fixtureCleanup = "complete";
    } catch (error) { report.fixtureCleanup = "failed"; report.status = "failed"; failure ||= error; }
    try { await publish(); } catch (error) { failure ||= error; report.status = "failed"; }
  }
  if (failure) throw failure;
  return report;
}
