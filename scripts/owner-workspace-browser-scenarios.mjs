// Imported only by the guarded, genuinely authenticated disposable-CI journey.
// Service access creates explicitly synthetic usage dates and one pending review;
// preference commands themselves always use the real browser session.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertHostedCi } from "./ci-bootstrap-customer-journey-db.mjs";

const modules = ["messages", "appointments", "todo", "money"];
const labels = { messages: "Messages", appointments: "Appointments", todo: "To-do", money: "Money" };
const endpoint = "/api/business/workspace-preferences";
export async function withOwnerBrowserDeadline(label, action, timeoutMs = 30000) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 180000) throw new Error("Use a finite bounded owner-browser deadline.");
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
      timer = setTimeout(() => { const error = new Error(`Owner browser deadline exceeded: ${label} (${timeoutMs}ms).`); error.name = "OwnerBrowserDeadlineError"; reject(error); }, timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
export function observeNewWorkspaceActivity(page, appUrl, area, timeoutMs = 20000) {
  if (!modules.includes(area) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error("Use a bounded supported activity observation.");
  const requests = new WeakSet();
  const onRequest = (request) => {
    try { const body = request.postDataJSON(); if (request.url() === `${appUrl}${endpoint}` && request.method() === "POST" && body?.action === "activity" && body.module === area) requests.add(request); }
    catch { /* Other requests do not count as the collector for this navigation. */ }
  };
  page.on("request", onRequest);
  try {
    const pending = page.waitForResponse((response) => requests.has(response.request()), { timeout: timeoutMs }).finally(() => page.off("request", onRequest));
    void pending.catch(() => {});
    return pending;
  } catch (error) { page.off("request", onRequest); throw error; }
}
export function workspaceActivityFixture(owner, partnerId, clock = new Date(), timeZone = "America/Chicago") {
  for (const value of [owner.userId, owner.clientId, partnerId]) if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new Error("Use exact disposable owner fixture IDs.");
  if (!["desktop", "phone"].includes(owner.label) || !Number.isFinite(clock.getTime())) throw new Error("Use a bounded synthetic workspace scenario.");
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(clock);
  const part = (type) => parts.find((value) => value.type === type).value;
  const midnight = Date.parse(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
  const dominant = owner.label === "desktop" ? "messages" : "appointments";
  return ["messages", "appointments"].flatMap((area) => Array.from({ length: area === dominant ? 5 : 3 }, (_, offset) => ({
    user_id: owner.userId, client_id: owner.clientId, partner_id: partnerId, module: area,
    activity_date: new Date(midnight - offset * 86400000).toISOString().slice(0, 10),
  })));
}

function preferenceErrorCategory(body) {
  return new Map([
    ["Business workspace access is required.", "access_denied"], ["Sign in with business owner access.", "access_denied"], ["Invalid request origin.", "origin_denied"],
    ["Your preferences could not be loaded. Try again.", "data_unavailable"], ["The data service is unavailable.", "data_unavailable"],
    ["Your preferences changed elsewhere. Reload saved preferences before saving.", "revision_conflict"],
    ["Check your name and Today preferences.", "invalid_request"], ["Your save could not be confirmed. Retry the same change.", "save_unavailable"],
  ]).get(body?.error) || "unknown_error";
}
function safeAccessDiagnosis(value) {
  const flag = (key) => { const item = value?.[key]; return typeof item === "boolean" ? item : null; };
  const status = value?.goTrueStatus, membership = value?.membershipStatus;
  return { cookieReadable: flag("cookieReadable"), cookieSubjectMatches: flag("cookieSubjectMatches"), sameInitialSession: flag("sameInitialSession"),
    actorVerified: flag("actorVerified"), goTrueStatus: Number.isSafeInteger(status) && status >= 100 && status <= 599 ? status : null,
    goTrueUserMatches: flag("goTrueUserMatches"), membershipStatus: ["active", "invited", "disabled", "missing"].includes(membership) ? membership : "unknown", ownerRole: flag("ownerRole") };
}
// Independent wire validation: this runner must remain plain Node22 JavaScript
// and must never print arbitrary response headers, messages or credentials.
function originalContextDiagnostic(raw) {
  if (typeof raw !== "string" || raw.length > 768) return null;
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !["configuration", "auth_user", "session_actor", "primary_membership", "client_scope", "portal_access", "portal_client", "workspace_sections", "impersonation"].includes(value.stage) ||
      !["denied", "unavailable"].includes(value.kind) ||
      (value.status !== null && (!Number.isInteger(value.status) || value.status < 100 || value.status > 599))) return null;
  const codes = ["42501", "40001", "40P01", "53300", "53400", "57014", "08000", "08001", "08003", "08006", "57P01", "57P02", "57P03",
    "PGRST000", "PGRST001", "PGRST002", "PGRST003", "PGRST100", "PGRST102", "PGRST116", "PGRST202", "PGRST203", "PGRST204", "PGRST300", "PGRST301", "PGRST302", "PGRST303",
    "bad_jwt", "invalid_jwt", "jwt_expired", "invalid_token", "no_authorization", "user_not_found", "session_not_found", "refresh_token_not_found", "refresh_token_already_used", "invalid_credentials", "user_banned",
    "unexpected_failure", "request_timeout", "over_request_rate_limit", "over_email_send_rate_limit", "validation_failed"];
  if (value.code !== null && !codes.includes(value.code)) return null;
  return { stage: value.stage, kind: value.kind, status: value.status, code: value.code, possibleSessionCookie: typeof value.possibleSessionCookie === "boolean" ? value.possibleSessionCookie : null };
}
export async function inspectWorkspacePreferenceResponse(response, { operation, phase = async () => {}, diagnose403 }, requireJson = false) {
  const status = response.status(); let body, bodyFailed = false;
  // A failure's evidence must never replace the original HTTP assertion.
  const record = async (text) => { if (status === 200) await phase(text); else try { await phase(text); } catch { /* Preserve the actual failed response. */ } };
  await record(`${operation}: response HTTP ${status}`);
  if (status !== 200) {
    let originalContext = null;
    try {
      originalContext = await withOwnerBrowserDeadline("read original preference context", async () => {
        const headers = await response.headers?.();
        return originalContextDiagnostic(headers?.["x-workspace-context"]);
      }, 5000);
    } catch { /* Header diagnostics cannot mask the original HTTP failure. */ }
    await record(`${operation}: HTTP ${status}; original_context=${JSON.stringify(originalContext)}`);
  }
  if (requireJson || status !== 200) {
    await record(`${operation}: read response JSON`);
    try { body = await withOwnerBrowserDeadline("read preference response JSON", () => response.json(), 10000); }
    catch { bodyFailed = true; }
  }
  if (status !== 200) {
    const category = bodyFailed ? "response_json_unavailable" : preferenceErrorCategory(body);
    await record(`${operation}: HTTP ${status}; error=${category}`);
    if (status === 403 && diagnose403) {
      let diagnosis = safeAccessDiagnosis();
      try {
        await record(`${operation}: HTTP 403 read-only access diagnosis`);
        diagnosis = safeAccessDiagnosis(await withOwnerBrowserDeadline("read-only failed-access diagnosis", diagnose403, 20000));
      } catch { /* Diagnosis cannot heal, retry or mask the original403. */ }
      await record(`${operation}: HTTP 403; error=${category}; diagnosis=${JSON.stringify(diagnosis)}`);
    }
  }
  assert.equal(status, 200, `${operation} must return its actual HTTP 200 response.`);
  assert.equal(bodyFailed, false, `${operation} must return its actual complete JSON response.`);
  await record(`${operation}: HTTP 200${requireJson ? ", JSON complete" : ""} completed`);
  return body;
}
export async function readWorkspacePreferenceSnapshot(page, appUrl, trace = { operation: "owner: preference snapshot GET" }) {
  await trace.phase?.(`${trace.operation}: request`);
  const result = await page.request.get(`${appUrl}${endpoint}`, { timeout: 15000 });
  const saved = await inspectWorkspacePreferenceResponse(result, trace, true); assert.equal(saved.available, true); assert.equal(saved.canEdit, true);
  assert.ok(saved.preferences && Number.isSafeInteger(saved.preferences.revision));
  return saved;
}
export async function assertSavedWorkspacePreferences(page, appUrl, expected, trace) {
  const saved = await readWorkspacePreferenceSnapshot(page, appUrl, trace);
  assert.deepEqual(saved.preferences, expected, "The actual signed-in account must retain only its own saved workspace preferences.");
}
export async function assertOwnerWorkspaceNavigation(page, businessName) {
  await page.getByRole("link").filter({ hasText: businessName }).first().waitFor({ state: "visible" });
  const navigation = page.getByRole("navigation", { name: "Business navigation", exact: true }); await navigation.waitFor({ state: "visible" });
  for (const name of ["Today", "Messages", "To-do", "Calendar"]) await navigation.getByRole("link", { name, exact: true }).waitFor({ state: "visible" });
  if (await navigation.getByRole("link", { name: "Money", exact: true }).count()) {
    for (const name of ["Money", "Manager", "Apps"]) await navigation.getByRole("link", { name, exact: true }).waitFor({ state: "visible" });
  } else {
    const more = page.locator("summary").filter({ hasText: /^\s*More\s*$/ });
    const wasOpen = await more.evaluate((node) => node.parentElement.open); if (!wasOpen) await more.click();
    const extra = page.getByRole("navigation", { name: "More business navigation", exact: true });
    for (const name of ["Money", "Manager", "Apps"]) await extra.getByRole("link", { name, exact: true }).waitFor({ state: "visible" });
    if (!wasOpen) await more.click();
  }
}
export async function collectWorkspacePreferencePosts({ path, bodies }, request = fetch) {
  return Promise.all(bodies.map(async (body) => {
    let status = null, failedAt = "headers";
    const signal = AbortSignal.timeout(15000);
    try {
      const response = await request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
      status = response.status; failedAt = "json_body";
      return { complete: true, status, body: await response.json(), failedAt: null, reason: null };
    } catch (error) {
      return { complete: false, status, body: null, failedAt, reason: signal.aborted || error?.name === "TimeoutError" ? "timeout" : error?.name === "SyntaxError" ? "invalid_json" : "request_failed" };
    }
  }));
}
async function post(page, commands, phase, operation) {
  const results = await withOwnerBrowserDeadline("authenticated preference POST and body", () => page.evaluate(collectWorkspacePreferencePosts, { path: endpoint, bodies: commands }), 20000);
  const diagnostics = results.map((result, index) => `attempt ${index + 1}: HTTP ${result.status ?? "no headers"}, ${result.complete ? "JSON complete" : `${result.failedAt}/${result.reason}`}`).join("; ");
  await phase(`${operation}: ${diagnostics}`);
  assert.ok(results.every((result) => result.complete), `${operation} did not complete every actual JSON response: ${diagnostics}`);
  return results;
}
function preferenceResponse(page, action) {
  const pending = page.waitForResponse((response) => {
    try { return new URL(response.url()).pathname === endpoint && response.request().method() === "POST" && response.request().postDataJSON()?.action === action; }
    catch { return false; }
  }, { timeout: 15000 });
  void pending.catch(() => {}); // A failed click must not leave an unhandled waiter.
  return pending;
}
async function panel(page) {
  const summary = page.locator("summary").filter({ hasText: /^\s*Customize Today\s*$/ }); await summary.waitFor({ state: "visible" });
  if (!(await summary.evaluate((node) => node.parentElement.open))) await summary.click();
  return summary.locator("..");
}
async function setOrder(controls, order) {
  for (let target = 0; target < order.length; target++) {
    let current = await controls.locator("[data-workspace-module]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-workspace-module")));
    for (let moves = 0; current.indexOf(order[target]) > target && moves < modules.length; moves++) {
      await controls.getByRole("button", { name: `Move ${labels[order[target]]} up`, exact: true }).click();
      current = await controls.locator("[data-workspace-module]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-workspace-module")));
    }
    assert.equal(current[target], order[target], "The real reorder control must change the visible module order.");
  }
}
async function acknowledged(controls, notice, trace) {
  await trace?.phase?.(`${trace.operation}: await visible save acknowledgement`);
  const status = controls.getByRole("status").filter({ hasText: notice });
  await status.waitFor({ state: "visible", timeout: 15000 }); assert.equal(await status.innerText(), notice);
  const save = controls.getByRole("button", { name: "Save preferences", exact: true });
  await save.waitFor({ state: "visible", timeout: 15000 });
  await save.click({ trial: true, timeout: 15000 }); // Wait for enabled/actionable without submitting again.
  assert.equal(await save.isEnabled(), true, "The real client must finish consuming its saved receipt before reloading.");
  await trace?.phase?.(`${trace.operation}: visible acknowledgement and enabled Save confirmed`);
}
async function saveUi(page, appUrl, settings, trace) {
  const controls = await panel(page); await controls.getByLabel("Preferred name", { exact: true }).fill(settings.displayName || "");
  await setOrder(controls, settings.order);
  for (const area of modules) await controls.getByLabel(`Pin ${labels[area]}`, { exact: true }).setChecked(settings.pinned.includes(area));
  await trace.phase?.(`${trace.operation}: submit manual Save POST`);
  const pending = preferenceResponse(page, "save"); await controls.getByRole("button", { name: "Save preferences", exact: true }).click();
  await inspectWorkspacePreferenceResponse(await pending, trace);
  await acknowledged(controls, "Today preferences saved.", trace);
  const saved = await readWorkspacePreferenceSnapshot(page, appUrl, { ...trace, operation: `${trace.operation}: saved snapshot GET` }); assert.deepEqual({ ...saved.preferences, revision: 0 }, { ...settings, revision: 0 }); return saved.preferences;
}
async function assertSafety(admin, fixture, owner) {
  const team = await admin.from("agent_team_settings").select("status,channel_authority").eq("partner_id", fixture.partnerId).eq("client_id", owner.clientId).single();
  assert.equal(team.error, null); assert.equal(team.data.status, "paused"); assert.ok(Object.values(team.data.channel_authority).every((value) => value === "off"));
  for (const table of ["action_jobs", "agent_work_items"]) {
    const result = await admin.from(table).select("id", { count: "exact", head: true }).eq("partner_id", fixture.partnerId).eq("client_id", owner.clientId);
    assert.equal(result.error, null); assert.equal(result.count, 0, "Personalizing presentation must not create execution work.");
  }
}

export async function runOwnerWorkspaceScenarios({ admin, fixture, owners, target, step, screenshot, phase = async () => {}, diagnoseAccess, env = process.env }) {
  assertHostedCi(env); assert.equal(env.OWNER_BROWSER_CONFIRMATION, "owner-browser-disposable");
  assert.equal(owners.length, 2); assert.match(fixture.prefix, /^owner-browser-[a-f0-9]{12}$/);
  const proof = { actualPreferenceApi: true, realNavigationActivity: true, syntheticActivityDays: true, concurrentCompareAndSwap: true, exactRetry: true, partialCoverageVisible: true, owners: [] };
  for (const owner of owners) {
    assert.ok(owner.marker.startsWith(`${fixture.prefix}-`)); const page = owner.page;
    const other = owners.find((candidate) => candidate.userId !== owner.userId);
    const trace = (operation) => ({ operation: `${owner.label}: ${operation}`, phase, diagnose403: diagnoseAccess ? () => diagnoseAccess(owner) : undefined });
    const snapshot = (operation) => readWorkspacePreferenceSnapshot(page, target.appUrl, trace(operation));
    const reload = async (operation) => { await phase(`${owner.label}: ${operation}: reload requested`); await page.reload(); await phase(`${owner.label}: ${operation}: reload completed`); };
    await step(`${owner.label}: scoped workspace activity and real navigation`, async () => {
      await phase(`${owner.label}: verify real owner receipt and business`);
      const receipt = await admin.from("first_owner_workspaces").select("id").eq("user_id", owner.userId).eq("client_id", owner.clientId).eq("partner_id", fixture.partnerId).single(); assert.equal(receipt.error, null); assert.equal(receipt.data.id, owner.receiptId);
      const business = await admin.from("client_businesses").select("timezone").eq("id", owner.clientId).eq("partner_id", fixture.partnerId).single(); assert.equal(business.error, null);
      await phase(`${owner.label}: verify stopped authority and empty outbox`);
      await assertSafety(admin, fixture, owner);
      // Playwright pages already behave as active pages. Avoid the unnecessary
      // untimed bringToFront channel call; require actual visibility instead.
      await phase(`${owner.label}: require real document visibility`);
      await page.waitForFunction(() => document.visibilityState === "visible", undefined, { timeout: 15000 });
      const activityResponse = observeNewWorkspaceActivity(page, target.appUrl, "messages");
      await phase(`${owner.label}: navigate Messages and observe collector response`);
      await page.goto(`${target.appUrl}/client/messages`, { timeout: 20000 });
      const activityResult = await activityResponse;
      await phase(`${owner.label}: real activity response HTTP ${activityResult.status()}`);
      assert.equal(activityResult.status(), 200, "The newly observed real navigation collector must succeed.");
      // This fire-and-forget collector has no decision receipt to consume. Check
      // its actual scoped database effect instead of the unused CDP JSON body.
      const today = workspaceActivityFixture(owner, fixture.partnerId, new Date(), business.data.timezone)[0].activity_date;
      await phase(`${owner.label}: verify once-per-day navigation persistence`);
      const readActivity = () => admin.from("owner_workspace_activity").select("activity_date").eq("user_id", owner.userId).eq("client_id", owner.clientId).eq("partner_id", fixture.partnerId).eq("module", "messages").eq("activity_date", today);
      const once = await readActivity(); assert.equal(once.error, null); assert.deepEqual(once.data, [{ activity_date: today }], "Exactly one scoped activity row must exist for the current business day before synthetic aggregate fixtures.");
      await phase(`${owner.label}: repeat real Messages navigation and collector`);
      await page.goto(`${target.appUrl}/client`, { timeout: 20000 });
      await page.waitForFunction(() => document.visibilityState === "visible", undefined, { timeout: 15000 });
      const repeatResponse = observeNewWorkspaceActivity(page, target.appUrl, "messages");
      await page.goto(`${target.appUrl}/client/messages`, { timeout: 20000 });
      const repeated = await repeatResponse; assert.equal(repeated.status(), 200, "The repeat open must complete its newly observed real collector before checking persistence.");
      const twice = await readActivity(); assert.equal(twice.error, null); assert.deepEqual(twice.data, once.data, "Repeated real opens retain exactly one enum row for the current business day.");
      await phase(`${owner.label}: save explicitly synthetic aggregate dates`);
      const activity = workspaceActivityFixture(owner, fixture.partnerId, new Date(), business.data.timezone);
      const inserted = await admin.from("owner_workspace_activity").upsert(activity); assert.equal(inserted.error, null);
      await phase(`${owner.label}: verify authenticated aggregate snapshot`);
      const saved = await snapshot("activity aggregate snapshot GET"); assert.equal(saved.activity.find((value) => value.module === (owner.label === "desktop" ? "messages" : "appointments"))?.days, 5);
    });
    await step(`${owner.label}: deliberate Today preferences survive reload`, async () => {
      await phase(`${owner.label}: preference Today navigation requested`); await page.goto(`${target.appUrl}/client`); await assertOwnerWorkspaceNavigation(page, owner.name); await phase(`${owner.label}: preference Today navigation completed`);
      await phase(`${owner.label}: preference source connections GET requested`);
      const imported = await page.request.get(`${target.appUrl}/api/connections`);
      const source = await inspectWorkspacePreferenceResponse(imported, trace("preference source connections GET"), true);
      assert.ok(source.apps.some((app) => app.streams?.some((stream) => stream.partial === true)), "The actual imported form stream has bounded partial coverage, not fabricated complete history.");
      const brief = page.getByRole("region", { name: "Your daily brief", exact: true });
      assert.doesNotMatch(await brief.innerText(), /All clear for now|Nothing needs your attention/i, "The real partial connected-data case must not render an all-clear claim.");
      await screenshot(page, target, `${owner.label}-workspace-before`);
      const area = owner.label === "desktop" ? "messages" : "appointments";
      assert.ok(await page.locator(`[data-work-section='${area === "messages" ? "intake" : "appointments"}']`).count() > 0, "Suggestions need actual matching Today work.");
      const unchanged = await snapshot("unchanged order snapshot GET"); assert.deepEqual(unchanged.preferences.order, modules, "Usage evidence cannot silently shuffle Today.");
      const settings = { displayName: `${owner.label === "desktop" ? "Desktop" : "Phone"} owner`, order: owner.label === "desktop" ? ["appointments", "messages", "todo", "money"] : [...modules], pinned: [] };
      const manual = await saveUi(page, target.appUrl, settings, trace("manual preference Save POST")); await reload("after manual preference Save");
      const controls = await panel(page);
      await controls.locator(`[data-workspace-recommendation='${area}']`).waitFor({ state: "visible" });
      await controls.getByRole("button", { name: `Make ${labels[area]} first`, exact: true }).click();
      assert.deepEqual((await snapshot("unsaved suggestion snapshot GET")).preferences, manual, "Choosing a suggestion only changes the draft until Save.");
      await phase(`${owner.label}: suggestion Save POST requested`);
      const response = preferenceResponse(page, "save"); await controls.getByRole("button", { name: "Save preferences", exact: true }).click();
      await inspectWorkspacePreferenceResponse(await response, trace("suggestion Save POST"));
      await acknowledged(controls, "Today preferences saved.", trace("suggestion Save POST"));
      await reload("after suggestion Save");
      owner.workspacePreferences = (await snapshot("saved suggestion snapshot GET")).preferences;
      assert.equal(owner.workspacePreferences.order[0], area); assert.equal(owner.workspacePreferences.displayName, settings.displayName);
      await page.getByText(settings.displayName, { exact: false }).first().waitFor({ state: "visible" });
      await screenshot(page, target, `${owner.label}-workspace-after`);
      await phase(`${owner.label}: foreign tenant query snapshot GET requested`);
      const foreign = await page.request.get(`${target.appUrl}${endpoint}?clientId=${other.clientId}`);
      const own = await inspectWorkspacePreferenceResponse(foreign, trace("foreign tenant query snapshot GET"), true); assert.deepEqual(own.preferences, owner.workspacePreferences);
    });
    await step(`${owner.label}: preference CAS and exact retry`, async () => {
      await phase(`${owner.label}: read saved preferences before CAS`);
      const current = (await snapshot("before CAS snapshot GET")).preferences;
      const commands = ["A", "B"].map((name) => ({ action: "save", requestKey: randomUUID(), revision: current.revision, displayName: `${owner.label} race ${name}`, order: current.order, pinned: current.pinned }));
      await phase(`${owner.label}: concurrent preference save race`);
      const result = await post(page, commands, phase, `${owner.label}: preference race`); assert.deepEqual(result.map((item) => item.status).sort(), [200, 409]);
      const winner = result.findIndex((item) => item.status === 200), accepted = result[winner].body.snapshot;
      await phase(`${owner.label}: exact same-key receipt retry`);
      const retry = (await post(page, [commands[winner]], phase, `${owner.label}: exact retry`))[0]; assert.equal(retry.status, 200); assert.deepEqual(retry.body.snapshot.preferences, accepted.preferences);
      await phase(`${owner.label}: changed same-key request rejection`);
      const changed = (await post(page, [{ ...commands[winner], displayName: "Changed same-key attempt" }], phase, `${owner.label}: changed same-key request`))[0]; assert.equal(changed.status, 409);
      await phase(`${owner.label}: foreign-origin request rejection`);
      const forbidden = await page.request.post(`${target.appUrl}${endpoint}`, { headers: { Origin: "https://outside.invalid" }, data: commands[winner] }); assert.equal(forbidden.status(), 403);
      await phase(`${owner.label}: supplied actor and tenant fields rejection`);
      const unknown = (await post(page, [{ ...commands[winner], requestKey: randomUUID(), revision: accepted.preferences.revision, userId: other.userId, clientId: other.clientId }], phase, `${owner.label}: unknown request fields`))[0]; assert.equal(unknown.status, 400);
      await phase(`${owner.label}: restore intended preferences after CAS`);
      await reload("restore intended preferences after CAS"); await saveUi(page, target.appUrl, owner.workspacePreferences, trace("restore preferences manual Save POST"));
    });
    await step(`${owner.label}: reset and urgent decision precedence`, async () => {
      await phase(`${owner.label}: Reset preferences POST requested`);
      const controls = await panel(page), response = preferenceResponse(page, "reset"); await controls.getByRole("button", { name: "Reset preferences", exact: true }).click();
      await inspectWorkspacePreferenceResponse(await response, trace("Reset preferences POST"));
      await acknowledged(controls, "Default preferences restored.", trace("Reset preferences POST"));
      await reload("after Reset preferences"); const reset = await snapshot("reset defaults snapshot GET"); assert.deepEqual(reset.preferences.order, modules); assert.deepEqual(reset.preferences.pinned, []); assert.equal(reset.preferences.displayName, null);
      const settings = { displayName: `${owner.label === "desktop" ? "Desktop" : "Phone"} owner`, order: owner.label === "desktop" ? ["appointments", "messages", "todo", "money"] : [...modules], pinned: ["money"] };
      owner.workspacePreferences = await saveUi(page, target.appUrl, settings, trace("pin and reorder Save POST"));
      await reload("verify pin and reorder"); await assertSavedWorkspacePreferences(page, target.appUrl, owner.workspacePreferences, trace("pin and reorder snapshot GET"));
      const ordinary = await page.locator("[data-work-section]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-work-section")).filter((key) => !["attention", "money-source-review"].includes(key)));
      assert.equal(ordinary[0], "connected-invoices", "A saved Money pin moves actual money rows first after reload.");
      assert.ok(ordinary.includes("appointments") && ordinary.includes("intake"));
      assert.equal(ordinary.indexOf("appointments") < ordinary.indexOf("intake"), owner.label === "desktop", "The remaining actual work follows each owner's saved manual order.");
      const savedControls = await panel(page); await savedControls.getByLabel("Preferred name", { exact: true }).waitFor({ state: "visible" });
      await screenshot(page, target, `${owner.label}-workspace-preferences-open`);
      const id = randomUUID(), title = `${owner.marker} synthetic owner decision`;
      const approval = await admin.from("approval_items").insert({ id, partner_id: fixture.partnerId, client_id: owner.clientId, type: "content_draft", status: "pending", title, summary: "Synthetic disposable presentation review. No customer message or action is authorized.", proposed_payload: {} }); assert.equal(approval.error, null);
      try {
        await reload("urgent decision precedence"); await page.getByText(title, { exact: true }).first().waitFor({ state: "visible" });
        const keys = await page.locator("[data-work-section]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-work-section"))); assert.equal(keys[0], "attention", "An owner decision stays first even with Money pinned.");
        assert.ok(keys.includes("connected-invoices")); await screenshot(page, target, `${owner.label}-workspace-urgent`); await assertSafety(admin, fixture, owner);
      } finally { const removed = await admin.from("approval_items").delete().eq("id", id).eq("partner_id", fixture.partnerId).eq("client_id", owner.clientId); assert.equal(removed.error, null); }
      proof.owners.push({ label: owner.label, preferences: owner.workspacePreferences, recommendation: owner.label === "desktop" ? "messages" : "appointments" });
    });
  }
  for (const owner of owners) await assertSavedWorkspacePreferences(owner.page, target.appUrl, owner.workspacePreferences, { operation: `${owner.label}: final preference snapshot GET`, phase, diagnose403: diagnoseAccess ? () => diagnoseAccess(owner) : undefined });
  return proof;
}
