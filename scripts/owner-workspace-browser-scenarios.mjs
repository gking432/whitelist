// Imported only by the guarded, genuinely authenticated disposable-CI journey.
// Service access creates explicitly synthetic usage dates and one pending review;
// preference commands themselves always use the real browser session.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertHostedCi } from "./ci-bootstrap-customer-journey-db.mjs";

const modules = ["messages", "appointments", "todo", "money"];
const labels = { messages: "Messages", appointments: "Appointments", todo: "To-do", money: "Money" };
const endpoint = "/api/business/workspace-preferences";
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

async function snapshot(page, appUrl) {
  const result = await page.request.get(`${appUrl}${endpoint}`); assert.equal(result.status(), 200);
  const saved = await result.json(); assert.equal(saved.available, true); assert.equal(saved.canEdit, true);
  assert.ok(saved.preferences && Number.isSafeInteger(saved.preferences.revision));
  return saved;
}
export async function assertSavedWorkspacePreferences(page, appUrl, expected) {
  const saved = await snapshot(page, appUrl);
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
async function post(page, commands) {
  return page.evaluate(async ({ path, bodies }) => Promise.all(bodies.map(async (body) => {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  })), { path: endpoint, bodies: commands });
}
function preferenceResponse(page, action) {
  return page.waitForResponse((response) => {
    try { return new URL(response.url()).pathname === endpoint && response.request().method() === "POST" && response.request().postDataJSON()?.action === action; }
    catch { return false; }
  });
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
async function saveUi(page, appUrl, settings) {
  const controls = await panel(page); await controls.getByLabel("Preferred name", { exact: true }).fill(settings.displayName || "");
  await setOrder(controls, settings.order);
  for (const area of modules) await controls.getByLabel(`Pin ${labels[area]}`, { exact: true }).setChecked(settings.pinned.includes(area));
  const pending = preferenceResponse(page, "save"); await controls.getByRole("button", { name: "Save preferences", exact: true }).click();
  const response = await pending; assert.equal(response.status(), 200, "A real preference save must succeed before showing success.");
  const saved = await snapshot(page, appUrl); assert.deepEqual({ ...saved.preferences, revision: 0 }, { ...settings, revision: 0 }); return saved.preferences;
}
async function assertSafety(admin, fixture, owner) {
  const team = await admin.from("agent_team_settings").select("status,channel_authority").eq("partner_id", fixture.partnerId).eq("client_id", owner.clientId).single();
  assert.equal(team.error, null); assert.equal(team.data.status, "paused"); assert.ok(Object.values(team.data.channel_authority).every((value) => value === "off"));
  for (const table of ["action_jobs", "agent_work_items"]) {
    const result = await admin.from(table).select("id", { count: "exact", head: true }).eq("partner_id", fixture.partnerId).eq("client_id", owner.clientId);
    assert.equal(result.error, null); assert.equal(result.count, 0, "Personalizing presentation must not create execution work.");
  }
}

export async function runOwnerWorkspaceScenarios({ admin, fixture, owners, target, step, screenshot, env = process.env }) {
  assertHostedCi(env); assert.equal(env.OWNER_BROWSER_CONFIRMATION, "owner-browser-disposable");
  assert.equal(owners.length, 2); assert.match(fixture.prefix, /^owner-browser-[a-f0-9]{12}$/);
  const proof = { actualPreferenceApi: true, realNavigationActivity: true, syntheticActivityDays: true, concurrentCompareAndSwap: true, exactRetry: true, partialCoverageVisible: true, owners: [] };
  for (const owner of owners) {
    assert.ok(owner.marker.startsWith(`${fixture.prefix}-`)); const page = owner.page;
    await page.bringToFront();
    const other = owners.find((candidate) => candidate.userId !== owner.userId);
    await step(`${owner.label}: scoped workspace activity and real navigation`, async () => {
      const receipt = await admin.from("first_owner_workspaces").select("id").eq("user_id", owner.userId).eq("client_id", owner.clientId).eq("partner_id", fixture.partnerId).single(); assert.equal(receipt.error, null); assert.equal(receipt.data.id, owner.receiptId);
      const business = await admin.from("client_businesses").select("timezone").eq("id", owner.clientId).eq("partner_id", fixture.partnerId).single(); assert.equal(business.error, null);
      await assertSafety(admin, fixture, owner);
      const activityResponse = page.waitForResponse((response) => {
        try { return new URL(response.url()).pathname === endpoint && response.request().method() === "POST" && response.request().postDataJSON()?.action === "activity" && response.request().postDataJSON()?.module === "messages"; } catch { return false; }
      });
      await page.goto(`${target.appUrl}/client/messages`);
      const activityResult = await activityResponse, activityBody = await activityResult.json().catch(() => null);
      assert.equal(activityResult.status(), 200, `Real navigation activity was rejected${typeof activityBody?.error === "string" ? `: ${activityBody.error.slice(0, 300)}` : "."}`);
      const once = await admin.from("owner_workspace_activity").select("activity_date").eq("user_id", owner.userId).eq("client_id", owner.clientId).eq("partner_id", fixture.partnerId).eq("module", "messages"); assert.equal(once.error, null);
      await page.goto(`${target.appUrl}/client`); await page.goto(`${target.appUrl}/client/messages`);
      const twice = await admin.from("owner_workspace_activity").select("activity_date").eq("user_id", owner.userId).eq("client_id", owner.clientId).eq("partner_id", fixture.partnerId).eq("module", "messages"); assert.equal(twice.error, null); assert.deepEqual(twice.data, once.data, "Repeated real opens record one enum per business day.");
      const activity = workspaceActivityFixture(owner, fixture.partnerId, new Date(), business.data.timezone);
      const inserted = await admin.from("owner_workspace_activity").upsert(activity); assert.equal(inserted.error, null);
      const saved = await snapshot(page, target.appUrl); assert.equal(saved.activity.find((value) => value.module === (owner.label === "desktop" ? "messages" : "appointments"))?.days, 5);
    });
    await step(`${owner.label}: deliberate Today preferences survive reload`, async () => {
      await page.goto(`${target.appUrl}/client`); await assertOwnerWorkspaceNavigation(page, owner.name);
      const imported = await page.request.get(`${target.appUrl}/api/connections`); assert.equal(imported.status(), 200);
      assert.ok((await imported.json()).apps.some((app) => app.streams?.some((stream) => stream.partial === true)), "The actual imported form stream has bounded partial coverage, not fabricated complete history.");
      const brief = page.getByRole("region", { name: "Your daily brief", exact: true });
      assert.doesNotMatch(await brief.innerText(), /All clear for now|Nothing needs your attention/i, "The real partial connected-data case must not render an all-clear claim.");
      await screenshot(page, target, `${owner.label}-workspace-before`);
      const area = owner.label === "desktop" ? "messages" : "appointments";
      assert.ok(await page.locator(`[data-work-section='${area === "messages" ? "intake" : "appointments"}']`).count() > 0, "Suggestions need actual matching Today work.");
      const unchanged = await snapshot(page, target.appUrl); assert.deepEqual(unchanged.preferences.order, modules, "Usage evidence cannot silently shuffle Today.");
      const settings = { displayName: `${owner.label === "desktop" ? "Desktop" : "Phone"} owner`, order: owner.label === "desktop" ? ["appointments", "messages", "todo", "money"] : [...modules], pinned: [] };
      const manual = await saveUi(page, target.appUrl, settings); await page.reload();
      const controls = await panel(page);
      await controls.locator(`[data-workspace-recommendation='${area}']`).waitFor({ state: "visible" });
      await controls.getByRole("button", { name: `Make ${labels[area]} first`, exact: true }).click();
      assert.deepEqual((await snapshot(page, target.appUrl)).preferences, manual, "Choosing a suggestion only changes the draft until Save.");
      const response = preferenceResponse(page, "save"); await controls.getByRole("button", { name: "Save preferences", exact: true }).click(); assert.equal((await response).status(), 200);
      await page.reload();
      owner.workspacePreferences = (await snapshot(page, target.appUrl)).preferences;
      assert.equal(owner.workspacePreferences.order[0], area); assert.equal(owner.workspacePreferences.displayName, settings.displayName);
      await page.getByText(settings.displayName, { exact: false }).first().waitFor({ state: "visible" });
      await screenshot(page, target, `${owner.label}-workspace-after`);
      const foreign = await page.request.get(`${target.appUrl}${endpoint}?clientId=${other.clientId}`); assert.equal(foreign.status(), 200); assert.deepEqual((await foreign.json()).preferences, owner.workspacePreferences);
    });
    await step(`${owner.label}: preference CAS and exact retry`, async () => {
      const current = (await snapshot(page, target.appUrl)).preferences;
      const commands = ["A", "B"].map((name) => ({ action: "save", requestKey: randomUUID(), revision: current.revision, displayName: `${owner.label} race ${name}`, order: current.order, pinned: current.pinned }));
      const result = await post(page, commands); assert.deepEqual(result.map((item) => item.status).sort(), [200, 409]);
      const winner = result.findIndex((item) => item.status === 200), accepted = result[winner].body.snapshot;
      const retry = (await post(page, [commands[winner]]))[0]; assert.equal(retry.status, 200); assert.deepEqual(retry.body.snapshot.preferences, accepted.preferences);
      const changed = (await post(page, [{ ...commands[winner], displayName: "Changed same-key attempt" }]))[0]; assert.equal(changed.status, 409);
      const forbidden = await page.request.post(`${target.appUrl}${endpoint}`, { headers: { Origin: "https://outside.invalid" }, data: commands[winner] }); assert.equal(forbidden.status(), 403);
      const unknown = (await post(page, [{ ...commands[winner], requestKey: randomUUID(), revision: accepted.preferences.revision, userId: other.userId, clientId: other.clientId }]))[0]; assert.equal(unknown.status, 400);
      await page.reload(); await saveUi(page, target.appUrl, owner.workspacePreferences);
    });
    await step(`${owner.label}: reset and urgent decision precedence`, async () => {
      const controls = await panel(page), response = preferenceResponse(page, "reset"); await controls.getByRole("button", { name: "Reset preferences", exact: true }).click(); assert.equal((await response).status(), 200);
      await page.reload(); const reset = await snapshot(page, target.appUrl); assert.deepEqual(reset.preferences.order, modules); assert.deepEqual(reset.preferences.pinned, []); assert.equal(reset.preferences.displayName, null);
      const settings = { displayName: `${owner.label === "desktop" ? "Desktop" : "Phone"} owner`, order: owner.label === "desktop" ? ["appointments", "messages", "todo", "money"] : [...modules], pinned: ["money"] };
      owner.workspacePreferences = await saveUi(page, target.appUrl, settings);
      await page.reload(); await assertSavedWorkspacePreferences(page, target.appUrl, owner.workspacePreferences);
      const ordinary = await page.locator("[data-work-section]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-work-section")).filter((key) => !["attention", "money-source-review"].includes(key)));
      assert.equal(ordinary[0], "connected-invoices", "A saved Money pin moves actual money rows first after reload.");
      assert.ok(ordinary.includes("appointments") && ordinary.includes("intake"));
      assert.equal(ordinary.indexOf("appointments") < ordinary.indexOf("intake"), owner.label === "desktop", "The remaining actual work follows each owner's saved manual order.");
      const savedControls = await panel(page); await savedControls.getByLabel("Preferred name", { exact: true }).waitFor({ state: "visible" });
      await screenshot(page, target, `${owner.label}-workspace-preferences-open`);
      const id = randomUUID(), title = `${owner.marker} synthetic owner decision`;
      const approval = await admin.from("approval_items").insert({ id, partner_id: fixture.partnerId, client_id: owner.clientId, type: "content_draft", status: "pending", title, summary: "Synthetic disposable presentation review. No customer message or action is authorized.", proposed_payload: {} }); assert.equal(approval.error, null);
      try {
        await page.reload(); await page.getByText(title, { exact: true }).first().waitFor({ state: "visible" });
        const keys = await page.locator("[data-work-section]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-work-section"))); assert.equal(keys[0], "attention", "An owner decision stays first even with Money pinned.");
        assert.ok(keys.includes("connected-invoices")); await screenshot(page, target, `${owner.label}-workspace-urgent`); await assertSafety(admin, fixture, owner);
      } finally { const removed = await admin.from("approval_items").delete().eq("id", id).eq("partner_id", fixture.partnerId).eq("client_id", owner.clientId); assert.equal(removed.error, null); }
      proof.owners.push({ label: owner.label, preferences: owner.workspacePreferences, recommendation: owner.label === "desktop" ? "messages" : "appointments" });
    });
  }
  await assertSavedWorkspacePreferences(owners[0].page, target.appUrl, owners[0].workspacePreferences);
  await assertSavedWorkspacePreferences(owners[1].page, target.appUrl, owners[1].workspacePreferences);
  return proof;
}
