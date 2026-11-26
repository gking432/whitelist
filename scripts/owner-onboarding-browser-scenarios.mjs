// Disposable CI acceptance only. All owner writes use the normal browser's
// existing cookie session; this module never creates auth or provider sessions.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertFoundationHttpScope, collectFoundationHttpRace, readFoundationHttpJson } from "./owner-foundation-conflict-http.mjs";
import { withOwnerBrowserDeadline } from "./owner-workspace-browser-scenarios.mjs";

const endpoint = "/api/business/onboarding";
const steps = ["description", "connections", "assistant", "assistant_choice", "review", "permissions", "done"];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const same = (value, expected, message) => assert.ok(JSON.stringify(value) === JSON.stringify(expected), message);
export function assertOnboardingSnapshot(value) {
  assert.ok(object(value) && value.available === true && value.canEdit === true && typeof value.profileRevision === "string" && value.profileRevision.length > 0 && value.profileRevision.length <= 80 &&
    object(value.answers) && (value.answers.description === null || typeof value.answers.description === "string" && value.answers.description.length <= 10000) && object(value.progress) &&
    Number.isSafeInteger(value.progress.revision) && value.progress.revision >= 0 && steps.includes(value.progress.step) && typeof value.progress.finished === "boolean" && value.progress.finished === (value.progress.step === "done") &&
    Array.isArray(value.progress.skipped) && value.progress.skipped.length <= 6 && new Set(value.progress.skipped).size === value.progress.skipped.length && value.progress.skipped.every(step => steps.includes(step) && step !== "done"), "The actual saved onboarding snapshot must be complete and internally consistent.");
  return value;
}
export function assertOnboardingSave(value, command, replayed) {
  const snapshot = assertOnboardingSnapshot(value?.snapshot), receipt = value.result;
  assert.ok(object(receipt) && uuid.test(receipt.id) && receipt.key === command.key && Number.isSafeInteger(receipt.revision) && receipt.revision === command.revision + 1 && typeof receipt.replayed === "boolean" && receipt.replayed === replayed &&
    typeof receipt.profileRevision === "string" && receipt.profileRevision.length > 0 && receipt.profileRevision.length <= 80 && Number.isSafeInteger(receipt.cancelledWork) && receipt.cancelledWork >= 0 && snapshot.progress.revision >= receipt.revision,
  "The actual onboarding write must return the exact request's complete durable receipt.");
  return value;
}
function scopeHeaders(scopeKey) {
  const parts = scopeKey.split(":"); assert.ok(parts.length === 2 && parts.every(value => uuid.test(value)), "Use the genuinely created actor and business scope.");
  return { "X-Workstation-Scope": scopeKey };
}
export async function onboardingApi(context, target, scopeKey, body, { expected = [200], phase = async () => {}, operation = "owner onboarding", origin = target.appUrl, omitScope = false } = {}) {
  const headers = omitScope ? {} : scopeHeaders(scopeKey);
  const result = await readFoundationHttpJson(() => body === undefined
    ? context.request.get(`${target.appUrl}${endpoint}`, { headers, timeout: 15000 })
    : context.request.post(`${target.appUrl}${endpoint}`, { headers: { ...headers, Origin: origin }, data: body, timeout: 15000 }), { expected, operation, phase });
  if (result.status === 200) body === undefined ? assertOnboardingSnapshot(result.body) : assertOnboardingSave(result.body, body, result.body?.result?.replayed);
  else assert.ok(object(result.body) && typeof result.body.error === "string" && result.body.error.length > 0 && result.body.error.length <= 4000, "A denied/conflicting onboarding request must still complete its actual error JSON.");
  return result;
}
export async function observeOnboardingPost(page, appUrl, expected, action) {
  const requests = new WeakSet();
  const record = request => {
    try { const body = request.postDataJSON(); if (request.url() === `${appUrl}${endpoint}` && request.method() === "POST" && object(body) && Object.entries(expected).every(([key, value]) => body[key] === value)) requests.add(request); }
    catch { /* Unrelated browser requests cannot prove this explicit action. */ }
  };
  page.on("request", record);
  try {
    const response = page.waitForResponse(value => requests.has(value.request()), { timeout: 20000 }); void response.catch(() => {});
    await action(); assert.equal((await response).status(), 200, "The exact new wizard command must actually return HTTP 200.");
  }
  finally { page.off("request", record); }
  // No unused CDP body access: the client-consumed visible saved step and the
  // following mandatory complete-JSON GET prove persistence independently.
}
async function atStep(page, step) {
  assert.ok(steps.includes(step));
  await page.locator(`[data-business-onboarding][data-onboarding-step="${step}"] [data-question-screen][aria-busy="false"]`).waitFor({ state: "visible" });
  return page.locator(`[data-business-onboarding][data-onboarding-step="${step}"]`);
}
async function clickStep(page, target, scopeKey, from, to, label, command, phase) {
  await phase(`onboarding ${from}: explicit ${label}`);
  const panel = await atStep(page, from);
  await observeOnboardingPost(page, target.appUrl, command, () => panel.getByRole("button", { name: label, exact: true }).click());
  await atStep(page, to);
  const saved = (await onboardingApi(page.context(), target, scopeKey, undefined, { phase, operation: `onboarding ${from}: saved ${to}` })).body;
  assert.equal(saved.progress.step, to); return saved;
}
export async function assertOnboardingLayout(page) {
  assert.equal(new URL(page.url()).pathname, "/client/onboarding");
  for (const selector of ["[data-personal-assistant-launcher]", "[data-live-call-overlay]", "[data-call-surface]", "nav", "aside"]) assert.equal(await page.locator(selector).count(), 0, "The exact question route must not mount workspace, assistant, call or navigation chrome.");
  assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
  assert.equal(await page.locator("[data-question-screen]").count(), 1);
  const viewport = page.viewportSize(), heading = await page.getByRole("heading", { level: 1 }).boundingBox();
  assert.ok(viewport && heading && heading.x >= 0 && heading.y >= 0 && heading.x + heading.width <= viewport.width + 1 && Math.abs(heading.x + heading.width / 2 - viewport.width / 2) <= 2, "The single large question must be centered and horizontally unclipped.");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  const button = page.locator("[data-question-screen]").getByRole("button").filter({ hasText: /^(Next|Finish setup|Open workspace|Confirm known facts)$/ }).first();
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox(); assert.ok(box && box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= viewport.width + 1, "The primary question action must be touch accessible.");
}
export async function finishInitialOwnerOnboarding({ page, target, scopeKey, businessName, phase = async () => {} }) {
  scopeHeaders(scopeKey);
  await phase("initial onboarding: saved description");
  const description = (await atStep(page, "description")).getByLabel("Business description", { exact: true });
  await description.waitFor({ state: "visible" }); assert.ok((await description.inputValue()).trim().length > 0, "The wizard must retain the actual provisioned description.");
  await page.getByText(`A sentence or two about ${businessName} is enough. You can add services, hours and policies later.`, { exact: true }).waitFor();
  await assertOnboardingLayout(page);
  await clickStep(page, target, scopeKey, "description", "connections", "Next", { action: "answer", field: "description" }, phase);
  await clickStep(page, target, scopeKey, "connections", "assistant", "Skip for now", { action: "skip", step: "connections" }, phase);
  await clickStep(page, target, scopeKey, "assistant", "review", "Skip for now", { action: "skip", step: "assistant" }, phase);
  const review = await atStep(page, "review"), checkbox = review.getByRole("checkbox", { name: "I confirm these known facts.", exact: true });
  await checkbox.waitFor({ state: "visible" }); assert.equal(await checkbox.isChecked(), false); await checkbox.check();
  // Confirming known facts invokes its own real context command before the
  // observed progress command; no readiness or authority approval is inferred.
  await clickStep(page, target, scopeKey, "review", "permissions", "Confirm known facts", { action: "navigate", step: "permissions" }, phase);
  await page.getByRole("radio", { name: "Keep current permissions", exact: true }).check();
  await clickStep(page, target, scopeKey, "permissions", "done", "Finish setup", { action: "navigate", step: "done" }, phase);
  await page.getByRole("button", { name: "Open workspace", exact: true }).click();
  await page.waitForURL(url => url.pathname === "/client");
}

async function baseline(admin, fixture, owner) {
  const state = {};
  for (const [table, fields, order] of [
    ["business_workspace_profiles", "profile,updated_at", "client_id"], ["client_knowledge_profiles", "*", "id"], ["business_context_reviews", "*", "client_id"], ["agent_team_settings", "*", "client_id"],
    ["integration_connections", "*", "id"], ["action_jobs", "*", "id"], ["agent_work_items", "*", "id"], ["integration_sync_jobs", "*", "id"], ["ai_call_usage", "*", "id"], ["usage_events", "*", "id"], ["voice_usage_events", "*", "call_session_id"],
  ]) {
    const read = await admin.from(table).select(fields).eq("partner_id", fixture.partnerId).eq("client_id", owner.clientId).order(order).limit(101);
    assert.ok(!read.error && Array.isArray(read.data) && read.data.length <= 100, "The disposable onboarding business/effect baseline must be complete."); state[table] = read.data;
  }
  assert.ok(state.integration_connections.length === 0 && state.action_jobs.length === 0 && state.agent_work_items.length === 0 && state.integration_sync_jobs.length === 0, "Onboarding acceptance must run before imported sources or execution work.");
  assert.equal(state.agent_team_settings[0]?.status, "paused");
  const authority = state.agent_team_settings[0]?.channel_authority;
  assert.ok(object(authority) && ["website", "email", "sms", "instagram", "calendar"].every(channel => authority[channel] === "off"), "New owner onboarding must start with every authority off.");
  return state;
}
async function scopedRead(owner, target, path) {
  return readFoundationHttpJson(() => owner.context.request.get(`${target.appUrl}${path}`, { headers: scopeHeaders(`${owner.userId}:${owner.clientId}`), timeout: 15000 }), { operation: "onboarding source facts" });
}
export async function runOwnerOnboardingBrowserScenarios({ admin, fixture, owners, target, phase = async () => {}, onProgress = async () => {}, screenshot, env = process.env }) {
  assertFoundationHttpScope({ fixture, owners, target, env });
  const report = { version: 1, status: "in_progress", activeStep: null, checks: [], fixtureCleanup: "not_started", modelCalls: false, providerWrites: false, businessStatePreserved: false,
    limitations: ["Real owner sessions and saved UI/API progress; provider authorization and external account creation are not exercised.", "Description re-save is an intentional no-op of the actual provisioned answer, preserving source/review/authority pins before imports.", "Assistant choice/save remains covered by the retained personal-assistant groups; this module proves skipping retains the existing private choice."] };
  const publish = () => onProgress({ ...report, checks: report.checks.map(check => ({ ...check })), limitations: [...report.limitations] });
  const stage = async (key, run) => {
    report.activeStep = key; await phase(`onboarding: ${key}`); await publish();
    try { await withOwnerBrowserDeadline(`onboarding ${key}`, run, 120000); report.checks.push({ key, status: "passed" }); report.activeStep = null; await publish(); }
    catch (error) { report.status = "failed"; report.checks.push({ key, status: "failed" }); await publish().catch(() => {}); throw error; }
  };
  const originals = new Map(); let failure;
  try {
    for (const owner of owners) {
      const page = owner.page, scopeKey = `${owner.userId}:${owner.clientId}`, other = owners.find(value => value.userId !== owner.userId);
      const call = (body, options = {}) => onboardingApi(owner.context, target, scopeKey, body, { phase, ...options });
      let initial, assistant, facts;
      await stage(`${owner.label}: source-backed completed baseline`, async () => {
        originals.set(owner.label, await baseline(admin, fixture, owner)); initial = (await call()).body; assert.equal(initial.progress.finished, true);
        assert.ok(typeof initial.answers.description === "string" && initial.answers.description.length > 0);
        facts = (await scopedRead(owner, target, "/api/business/context")).body;
        assert.ok(facts.facts.some(fact => fact.state === "unknown"), "Unanswered business fields must remain unknown, without DTO defaults becoming facts.");
        assistant = (await scopedRead(owner, target, "/api/business/personal-assistant")).body;
        assert.equal(assistant.preferences.answer, "unanswered"); assert.equal(assistant.preferences.assistant, null);
      });
      await stage(`${owner.label}: fullscreen revisit and real Back navigation`, async () => {
        await page.goto(`${target.appUrl}/client/onboarding`); await atStep(page, "done"); await assertOnboardingLayout(page);
        for (const [from, to] of [["done", "permissions"], ["permissions", "review"], ["review", "assistant"], ["assistant", "connections"], ["connections", "description"]]) await clickStep(page, target, scopeKey, from, to, "Back", { action: "navigate", step: to }, phase);
        assert.equal(await page.getByLabel("Business description", { exact: true }).inputValue(), initial.answers.description); await assertOnboardingLayout(page);
        await screenshot(page, target, `onboarding-${owner.label}-description`);
      });
      await stage(`${owner.label}: one answer validation refresh and saved no-op`, async () => {
        const answer = page.getByLabel("Business description", { exact: true }); assert.equal(await page.locator("[data-question-answer] textarea, [data-question-answer] input").count(), 1);
        await answer.fill(""); assert.equal(await page.getByRole("button", { name: "Next", exact: true }).isEnabled(), false);
        await screenshot(page, target, `onboarding-${owner.label}-required-answer`); await page.reload(); await atStep(page, "description");
        assert.equal(await page.getByLabel("Business description", { exact: true }).inputValue(), initial.answers.description);
        const saved = await clickStep(page, target, scopeKey, "description", "connections", "Next", { action: "answer", field: "description" }, phase);
        assert.equal(saved.profileRevision, initial.profileRevision); assert.equal(saved.answers.description, initial.answers.description);
      });
      await stage(`${owner.label}: optional apps unavailable truthful and progress retained`, async () => {
        const accounts = (await scopedRead(owner, target, "/api/connections")).body; assert.equal(accounts.apps.length, 0);
        await page.getByText("No apps connected yet.", { exact: true }).waitFor();
        for (const provider of accounts.providers.filter(value => value.setup === "oauth" && !value.available)) {
          const button = page.getByRole("button", { name: `${provider.label} Setup unavailable`, exact: true }); await button.waitFor(); assert.equal(await button.isEnabled(), false);
        }
        await assertOnboardingLayout(page); await screenshot(page, target, `onboarding-${owner.label}-optional-apps`);
        await page.goto(`${target.appUrl}/client/onboarding?connection=denied`); await atStep(page, "connections");
        await page.locator("[data-onboarding-connection-notice]").getByText("App access was not approved. You can try again or skip for now.", { exact: true }).waitFor();
        await page.getByText("No apps connected yet.", { exact: true }).waitFor();
        await screenshot(page, target, `onboarding-${owner.label}-connection-denied`);
        await page.goto(`${target.appUrl}/client/onboarding?connection=connected&step=done`); await atStep(page, "connections");
        await page.locator("[data-onboarding-connection-notice]").getByText("You’re back from app setup. Check the saved connection status below.", { exact: true }).waitFor();
        await page.getByText("No apps connected yet.", { exact: true }).waitFor();
        assert.equal((await scopedRead(owner, target, "/api/connections")).body.apps.length, 0, "An untrusted callback query cannot manufacture a saved account or advance progress.");
        await page.reload(); await atStep(page, "connections"); assert.equal((await call()).body.progress.step, "connections");
        await clickStep(page, target, scopeKey, "connections", "assistant", "Skip for now", { action: "skip", step: "connections" }, phase);
      });
      await stage(`${owner.label}: optional assistant skip retains exact private choice`, async () => {
        await page.getByRole("radio", { name: "Yes", exact: true }).waitFor(); await assertOnboardingLayout(page);
        assert.equal(await page.getByRole("radio", { name: "Yes", exact: true }).isChecked(), false); assert.equal(await page.getByRole("radio", { name: "No", exact: true }).isChecked(), false);
        await clickStep(page, target, scopeKey, "assistant", "review", "Skip for now", { action: "skip", step: "assistant" }, phase);
        same((await scopedRead(owner, target, "/api/business/personal-assistant")).body.preferences, assistant.preferences, "Skipping the question must not create, reset or revise a private preference.");
      });
      await stage(`${owner.label}: explicit facts decision cannot activate work`, async () => {
        const checkbox = page.getByRole("checkbox", { name: "I confirm these known facts.", exact: true }); await checkbox.waitFor();
        assert.equal(await checkbox.isChecked(), false); assert.equal(await page.getByRole("button", { name: "Confirm known facts", exact: true }).isEnabled(), false);
        await checkbox.check(); assert.equal(await page.getByRole("button", { name: "Confirm known facts", exact: true }).isEnabled(), true);
        await assertOnboardingLayout(page); await screenshot(page, target, `onboarding-${owner.label}-known-facts`);
        // The initial helper already exercised real review. Revisit makes no
        // second review/authority write, so its source pins can be exact.
        await clickStep(page, target, scopeKey, "review", "permissions", "Skip for now", { action: "skip", step: "review" }, phase);
        same((await scopedRead(owner, target, "/api/business/context")).body.facts, facts.facts, "A local checkbox and skipped repeat review must not rewrite known or missing facts.");
      });
      await stage(`${owner.label}: real scoped HTTP CAS replay and denied mutations`, async () => {
        let saved = (await call()).body;
        const a = { action: "navigate", step: "description", key: randomUUID(), revision: saved.progress.revision }, b = { ...a, key: randomUUID(), step: "connections" };
        const race = await collectFoundationHttpRace([a, b].map(command => () => call(command, { expected: [200, 409], operation: `onboarding ${owner.label}: concurrent progress` })));
        same(race.map(value => value.status).sort(), [200, 409], "Exactly one genuine owner progress request must win a shared revision.");
        const winner = race[0].status === 200 ? a : b, receipt = race.find(value => value.status === 200).body.result;
        const replay = (await call(winner, { operation: `onboarding ${owner.label}: exact lost-response replay` })).body; assertOnboardingSave(replay, winner, true); assert.equal(replay.result.id, receipt.id);
        await call({ ...winner, step: "done" }, { expected: [409] });
        saved = (await call()).body;
        await call({ action: "answer", field: "description", value: initial.answers.description, expectedProfileRevision: "00000000000000000000000000000000", key: randomUUID(), revision: saved.progress.revision }, { expected: [409] });
        await onboardingApi(owner.context, target, `${other.userId}:${other.clientId}`, undefined, { expected: [403], phase });
        await onboardingApi(owner.context, target, `${other.userId}:${other.clientId}`, { action: "navigate", step: "done", key: randomUUID(), revision: saved.progress.revision }, { expected: [403], phase });
        await call(undefined, { expected: [403], omitScope: true });
        await call({ action: "navigate", step: "done", key: randomUUID(), revision: saved.progress.revision, actorId: other.userId }, { expected: [400] });
        await call({ action: "navigate", step: "done", key: randomUUID(), revision: saved.progress.revision }, { expected: [403], origin: "https://foreign.invalid" });
      });
      await stage(`${owner.label}: finish and revisit preserve exact business controls`, async () => {
        const current = (await call()).body;
        await call({ action: "navigate", step: "permissions", key: randomUUID(), revision: current.progress.revision });
        await page.reload(); await atStep(page, "permissions");
        assert.equal(await page.getByRole("button", { name: "Finish setup", exact: true }).isEnabled(), false);
        await page.getByRole("radio", { name: "Keep current permissions", exact: true }).check();
        await clickStep(page, target, scopeKey, "permissions", "done", "Finish setup", { action: "navigate", step: "done" }, phase);
        await page.reload(); await atStep(page, "done"); await assertOnboardingLayout(page); await screenshot(page, target, `onboarding-${owner.label}-finished`);
        same(await baseline(admin, fixture, owner), originals.get(owner.label), "Revisit, optional skips and preference progress must leave the exact profile, knowledge, review, authority and execution baseline intact.");
        await page.getByRole("button", { name: "Open workspace", exact: true }).click(); await page.waitForURL(url => url.pathname === "/client");
        const menu = page.locator("summary").filter({ hasText: owner.label === "phone" ? /^\s*More\s*$/ : /^\s*More tools\s*$/ });
        await menu.click();
        await page.getByRole("link", { name: "Workspace setup", exact: true }).filter({ visible: true }).click();
        await atStep(page, "done"); await assertOnboardingLayout(page);
        assert.equal((await call()).body.progress.finished, true, "The owner's actual workspace menu must reopen saved setup without resetting it.");
        await page.getByRole("button", { name: "Open workspace", exact: true }).click(); await page.waitForURL(url => url.pathname === "/client");
      });
    }
    report.businessStatePreserved = true; report.fixtureCleanup = "complete"; report.status = "passed"; await publish();
  } catch (error) { failure = error; report.status = "failed"; report.fixtureCleanup = "failed"; await publish().catch(() => {}); }
  // There are no synthetic rows to delete or privileged baseline writes to
  // roll back. A failed owner operation stays failed for the runner's exact
  // business/user cleanup; it is never healed or retried here.
  if (failure) throw failure; return report;
}
