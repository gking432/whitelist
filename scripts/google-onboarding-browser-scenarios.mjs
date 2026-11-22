// Anonymous local-draft evidence only. This module never signs in, injects a
// session, contacts Google, provisions a workspace or writes a backend fixture.
import assert from "node:assert/strict";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertPublicReviewRect, publicReviewTarget } from "./public-review-browser-scenarios.mjs";

const questions = ["What is your business called?", "What does your business do?", "What timezone does your business use?", "Ready to continue with Google?"];
const unavailable = "Google sign-in is not available here yet. Your answers stay in this tab.";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function classifyGuestOnboardingRequest(appUrl, requestUrl, method) {
  let url; try { url = new URL(requestUrl); } catch { return "invalid"; }
  if (url.origin !== appUrl) return "external";
  if (url.username || url.password || /%(?:2f|5c|25)/i.test(url.pathname)) return "invalid";
  if (!/^(GET|HEAD)$/.test(method)) return "non_read";
  let path; try { path = decodeURIComponent(url.pathname); } catch { return "invalid"; }
  if (/^\/(?:api|auth|rest\/v1|graphql|storage\/v1|functions\/v1|client|partner|admin|login)(?:\/|$)/.test(path)) return "private_or_auth";
  return "read";
}
export function createGuestOnboardingRequestGuard(appUrl, record = () => {}) {
  const observed = new WeakMap();
  return (request) => { if (!observed.has(request)) { const kind = classifyGuestOnboardingRequest(appUrl, request.url(), request.method()); observed.set(request, kind); record(kind); } return observed.get(request); };
}
export function guestDraftIdentity(value) {
  const object = row => row && typeof row === "object" && !Array.isArray(row);
  if (!object(value) || Object.keys(value).length !== 6 || !["version", "draftId", "requestKey", "step", "values", "expiresAt"].every(key => Object.hasOwn(value, key)) || value.version !== 1 || !uuid.test(value.draftId) || !uuid.test(value.requestKey) || !Number.isInteger(value.step) || value.step < 0 || value.step > 3 || !Number.isSafeInteger(value.expiresAt) || !object(value.values) || Object.keys(value.values).length !== 3 || !["name", "description", "timezone"].every(key => typeof value.values[key] === "string")) throw new Error("The local guest draft must retain only its complete bounded presentation contract.");
  assert.ok(value.values.name.length <= 100 && value.values.description.length <= 2000 && value.values.timezone.length <= 100, "Guest draft answers must remain bounded.");
  return { draftId: value.draftId, requestKey: value.requestKey };
}
export function assertGuestPrivateDenial(status, body) {
  assert.equal(status, 403, "The genuine anonymous onboarding API probe must remain HTTP403.");
  assert.ok(body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 1 && body.error === "Owner access is required to set up this business.", "Anonymous onboarding must return only its known complete public denial.");
}
const startDenials = { missing_origin: [403, "origin_denied"], foreign_origin: [403, "origin_denied"], invalid_body: [422, "invalid_request"], extra_body: [422, "invalid_request"], oversized_body: [422, "invalid_request"], unavailable: [503, "google_unavailable"] };
export function assertGuestGoogleStartDenial(check, status, body) {
  const expected = startDenials[check];
  assert.ok(expected, "Only the fixed anonymous Google start denial checks are accepted.");
  assert.equal(status, expected[0], "The actual anonymous Google start status must match its strict boundary.");
  assert.ok(body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 1 && body.error === expected[1], "Google start must return only the exact fixed public error code.");
}
export function assertGuestGoogleCallbackDenial(appUrl, status, location, expectedOutcome, bytes) {
  assert.ok(["failed", "expired", "unavailable"].includes(expectedOutcome), "Only a fixed anonymous callback denial is expected.");
  assert.equal(status, 307, "Anonymous callback denial must be the fixed native307 redirect.");
  let url; try { url = new URL(location); } catch { throw new Error("Callback denial must have a complete fixed redirect."); }
  assert.ok(url.origin === appUrl && url.pathname === "/start" && !url.username && !url.password && !url.hash && [...url.searchParams.keys()].length === 1 && url.searchParams.getAll("google").length === 1 && url.searchParams.get("google") === expectedOutcome, "Callback denial must return only to the canonical start route and known outcome.");
  assert.ok(bytes && bytes.length === 0, "The callback redirect must not return any private response body.");
}
async function readPublicJson(response, label) {
  const bytes = await deadline(`${label} body`, () => response.body());
  assert.ok(bytes.length > 0 && bytes.length <= 4096, "The public route denial must have a complete bounded JSON body.");
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw new Error("The public route denial must return complete JSON."); }
}
const observedStartErrors = ["origin_denied", "invalid_request", "google_unavailable"];
const callbackChecks = ["missing_attempt", "tampered_attempt", "unavailable_callback", "unknown_query", "duplicate_attempt"];
const observedCallbackOutcomes = ["failed", "expired", "unavailable", "denied", "changed", "return"];
async function publicHttpBody(response, label) {
  const bytes = await deadline(`${label} body`, () => response.body());
  assert.ok(bytes.length <= 4096, "The public route response must have a complete bounded body.");
  return bytes;
}
/** Keep the completed wire observation even when the unchanged strict
 * validator rejects it. Only fixed enums/booleans/statuses enter evidence. */
export async function inspectGuestGoogleStartHttp(ledger, probe, send) {
  assert.ok(["desktop", "phone"].includes(probe.view) && Object.hasOwn(startDenials, probe.check) && typeof probe.canonicalOrigin === "boolean", "Only the fixed Google start evidence checks are accepted.");
  ledger.requestCount++;
  const response = await deadline("anonymous Google start headers", send), status = response.status();
  const bytes = await publicHttpBody(response, "anonymous Google start");
  let body, parsed = false;
  try { body = JSON.parse(Buffer.from(bytes).toString("utf8")); parsed = true; } catch { /* Record only the fixed unknown enum. */ }
  const observedError = body && typeof body === "object" && !Array.isArray(body) && observedStartErrors.includes(body.error) ? body.error : "unknown";
  ledger.checks.push({ view: probe.view, check: probe.check, method: "POST", path: "/auth/google/start", status, outcome: null, observedError, canonicalOriginSupplied: probe.canonicalOrigin });
  assert.ok(bytes.length > 0, "The public route denial must have a complete bounded JSON body.");
  if (!parsed) throw new Error("The public route denial must return complete JSON.");
  assertGuestGoogleStartDenial(probe.check, status, body);
}
export async function inspectGuestGoogleCallbackHttp(ledger, probe, send) {
  assert.ok(["desktop", "phone"].includes(probe.view) && callbackChecks.includes(probe.check) && ["failed", "expired", "unavailable"].includes(probe.expectedOutcome), "Only the fixed Google callback evidence checks are accepted.");
  ledger.requestCount++;
  const response = await deadline("anonymous Google callback headers", send), status = response.status();
  const bytes = await publicHttpBody(response, "anonymous Google callback"), location = response.headers().location;
  let outcome = "unknown", canonicalLocation = false;
  try {
    const url = new URL(location), value = url.searchParams.get("google");
    if (observedCallbackOutcomes.includes(value)) outcome = value;
    canonicalLocation = url.origin === probe.appUrl && url.pathname === "/start" && !url.username && !url.password && !url.hash && [...url.searchParams.keys()].length === 1 && url.searchParams.getAll("google").length === 1 && observedCallbackOutcomes.includes(value);
  } catch { /* An untrusted Location is never copied into the report. */ }
  ledger.checks.push({ view: probe.view, check: probe.check, method: "GET", path: "/auth/google/callback", status, outcome, observedError: null, canonicalLocation });
  assertGuestGoogleCallbackDenial(probe.appUrl, status, location, probe.expectedOutcome, bytes);
}
async function deadline(label, action, milliseconds = 15000) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Guest onboarding timed out: ${label}.`)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
async function geometry(page, control) {
  await control.scrollIntoViewIfNeeded();
  const rect = await control.boundingBox(), unobscured = await control.evaluate(node => { const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit === node || node.contains(hit); });
  assertPublicReviewRect(rect, page.viewportSize(), unobscured);
}
async function assertQuestion(page, appUrl, step) {
  const url = new URL(page.url()); assert.ok(url.origin === appUrl && url.pathname === "/start" && !url.search && !url.hash, "Anonymous questions must remain on the actual public start route.");
  const form = page.locator(`[data-guest-owner-form][data-guest-step="${step}"]`); await form.waitFor({ state: "visible" });
  const heading = form.getByRole("heading", { name: questions[step], exact: true }); await heading.waitFor({ state: "visible" });
  const presentation = await heading.evaluate(node => { const style = getComputedStyle(node), rect = node.getBoundingClientRect(); return { font: parseFloat(style.fontSize), align: style.textAlign, center: rect.left + rect.width / 2, width: innerWidth }; });
  assert.ok(presentation.font >= 28 && presentation.align === "center" && Math.abs(presentation.center - presentation.width / 2) <= 2, "The actual question must be large and centered.");
  assert.equal(await form.locator('input:not([type="hidden"]):visible,textarea:visible,select:visible').count(), step === 3 ? 0 : 1, "Only the current answer may be visible.");
  assert.equal(await page.locator('input[type="email"],input[type="password"],nav,[data-personal-assistant-launcher],[data-work-section]').count(), 0, "Public questions must not expose private app chrome or request email/password.");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, "Guest desktop/phone questions must not clip horizontally.");
  assert.doesNotMatch(await page.locator("body").innerText(), /owner-browser-[a-f0-9]{12}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i, "No private fixture data or source identifiers may appear.");
  return form;
}
async function draft(page) {
  const raw = await page.evaluate(() => sessionStorage.getItem("workstation:guest-owner:v1"));
  assert.ok(raw && raw.length <= 16384, "The actual tab must retain its bounded draft before refresh.");
  let value; try { value = JSON.parse(raw); } catch { throw new Error("The retained guest draft must be complete JSON."); }
  return guestDraftIdentity(value);
}

export async function runGoogleOnboardingBrowserScenarios({ browser, appUrl, artifacts, phase = async () => {}, onProgress = async () => {} }) {
  const target = publicReviewTarget(appUrl, artifacts); appUrl = target.appUrl;
  const report = { version: 1, status: "in_progress", activeStep: null, checks: [], screenshots: [], views: {}, privateApi: { checks: [], strictDenialPassed: false }, authHttp: { checks: [], requestCount: 0, strictDenialPassed: false }, cleanup: "not_started", googleConsentProved: false, authenticatedHandoffProved: false,
    limits: ["Fresh anonymous contexts and synthetic local answers only; no cookie/token injection, real Google consent, authenticated handoff, workspace provisioning or provider/model action.", "Network assertions observe browser traffic only. They are not a server egress trace or database snapshot. Deliberate APIRequestContext probes are reported separately; callback redirects are never followed.", "The configured isolated run proves Google-unavailable behavior; missing-Auth-config question rendering is covered separately by source/page tests.", "Official Auth protocol fixtures and the existing genuine email-login journey are distinct evidence; neither is presented here as real Google sign-in."] };
  const contexts = []; let failure;
  await mkdir(artifacts, { recursive: true });
  const publish = async () => { const path = join(artifacts, "google-onboarding-report.json"); await writeFile(`${path}.tmp`, JSON.stringify(report, null, 2)); await rename(`${path}.tmp`, path); await onProgress(JSON.parse(JSON.stringify(report))); };
  const stage = async (key, action) => {
    report.activeStep = key; await publish(); await phase(`guest Google onboarding: ${key}`);
    try { await deadline(key, action, 45000); report.checks.push({ key, status: "passed" }); report.activeStep = null; await publish(); }
    catch (error) { report.checks.push({ key, status: "failed" }); throw error; }
  };
  try {
    for (const [label, viewport] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
      const context = await deadline("fresh anonymous context", () => browser.newContext({ viewport, isMobile: label === "phone", hasTouch: label === "phone", locale: "en-US", timezoneId: "America/Chicago", serviceWorkers: "block" })); contexts.push(context);
      assert.equal((await context.cookies()).length, 0, "Guest onboarding begins with no cookies or identity.");
      const network = { read: 0, non_read: 0, private_or_auth: 0, external: 0, invalid: 0, pageErrors: 0 };
      const view = { viewport, network, anonymous: true, validationPreventsProgress: false, backAndRefreshRetainDraft: false, googleUnavailable: false, cookiesAfterQuestions: null };
      report.views[label] = view;
      const guard = createGuestOnboardingRequestGuard(appUrl, kind => { network[kind]++; });
      context.on("request", guard); await context.route("**/*", async route => { if (guard(route.request()) === "read") await route.continue(); else await route.abort(); });
      const page = await context.newPage(); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(30000); page.on("pageerror", () => { network.pageErrors++; });
      const safe = () => { for (const kind of ["non_read", "private_or_auth", "external", "invalid", "pageErrors"]) assert.equal(network[kind], 0, `Local guest answers must not produce ${kind} activity.`); };
      const capture = async name => { safe(); const filename = `google-guest-${label}-${name}.png`; await page.screenshot({ path: join(artifacts, filename), fullPage: true, animations: "disabled", timeout: 15000 }); report.screenshots.push(filename); };
      const name = `Disposable guest ${label}`, description = "Synthetic browser-only setup answers. No business or account is being provisioned.";
      let identity;
      await stage(`${label}: anonymous name question without Auth`, async () => {
        await page.goto(`${appUrl}/start`); const form = await assertQuestion(page, appUrl, 0);
        await page.waitForFunction(() => { const input = document.querySelector('[data-guest-step="0"] input:not([type="hidden"])'); return input instanceof HTMLInputElement && !input.disabled; });
        assert.equal(await form.getByRole("textbox", { name: "Business name", exact: true }).inputValue(), "", "A new context must not show another guest's draft."); await capture("name");
      });
      await stage(`${label}: blank answer validation stays local`, async () => {
        const form = await assertQuestion(page, appUrl, 0), next = form.getByRole("button", { name: "Next", exact: true }); await geometry(page, next); await next.click();
        await form.getByRole("alert").waitFor({ state: "visible" }); await assertQuestion(page, appUrl, 0); await capture("blank-validation"); view.validationPreventsProgress = true;
      });
      await stage(`${label}: name and description have one visible answer`, async () => {
        let form = await assertQuestion(page, appUrl, 0); await form.getByRole("textbox", { name: "Business name", exact: true }).fill(name); await capture("name-filled");
        await form.getByRole("button", { name: "Next", exact: true }).click(); form = await assertQuestion(page, appUrl, 1);
        await form.getByRole("textbox", { name: "Business description", exact: true }).fill(description); identity = await draft(page); await capture("description-filled");
      });
      await stage(`${label}: Back and refresh retain the same local draft`, async () => {
        let form = await assertQuestion(page, appUrl, 1); await geometry(page, form.getByRole("button", { name: "Back", exact: true })); await form.getByRole("button", { name: "Back", exact: true }).click();
        form = await assertQuestion(page, appUrl, 0); assert.equal(await form.getByRole("textbox", { name: "Business name", exact: true }).inputValue(), name);
        await form.getByRole("button", { name: "Next", exact: true }).click(); form = await assertQuestion(page, appUrl, 1); assert.equal(await form.getByRole("textbox", { name: "Business description", exact: true }).inputValue(), description);
        await page.reload(); form = await assertQuestion(page, appUrl, 1); assert.equal(await form.getByRole("textbox", { name: "Business description", exact: true }).inputValue(), description);
        assert.deepEqual(await draft(page), identity, "Back/refresh must preserve both original handoff identifiers."); await capture("back-refresh"); view.backAndRefreshRetainDraft = true;
      });
      await stage(`${label}: timezone validation cannot provision or sign in`, async () => {
        let form = await assertQuestion(page, appUrl, 1); await form.getByRole("button", { name: "Next", exact: true }).click(); form = await assertQuestion(page, appUrl, 2);
        const input = form.getByRole("textbox", { name: "Timezone", exact: true }); assert.equal(await input.inputValue(), ""); await input.fill("Invalid/BrowserFixture"); await form.getByRole("button", { name: "Next", exact: true }).click();
        await form.getByRole("alert").waitFor({ state: "visible" }); await assertQuestion(page, appUrl, 2); await capture("timezone-invalid"); await input.fill("America/Chicago"); await capture("timezone-filled");
      });
      await stage(`${label}: Google unavailable preserves answers without an Auth request`, async () => {
        let form = await assertQuestion(page, appUrl, 2); await form.getByRole("button", { name: "Next", exact: true }).click(); form = await assertQuestion(page, appUrl, 3);
        const google = form.getByRole("button", { name: "Continue with Google", exact: true }); assert.equal(await google.isDisabled(), true, "This isolated evidence target must not start real Google authorization."); await geometry(page, google); await form.getByText(unavailable, { exact: true }).waitFor();
        await page.reload(); form = await assertQuestion(page, appUrl, 3); assert.equal(await form.getByRole("button", { name: "Continue with Google", exact: true }).isDisabled(), true); assert.deepEqual(await draft(page), identity);
        await form.getByRole("button", { name: "Back", exact: true }).click(); form = await assertQuestion(page, appUrl, 2); assert.equal(await form.getByRole("textbox", { name: "Timezone", exact: true }).inputValue(), "America/Chicago");
        await form.getByRole("button", { name: "Next", exact: true }).click(); await assertQuestion(page, appUrl, 3); safe(); view.cookiesAfterQuestions = (await context.cookies()).length; assert.equal(view.cookiesAfterQuestions, 0, "Answering questions cannot create Auth or PKCE cookies."); assert.ok(network.read > 0); view.googleUnavailable = true; await capture("google-unavailable");
      });
      await stage(`${label}: genuine anonymous private API denial`, async () => {
        // APIRequestContext is separate from the observed page traffic. Exactly
        // one private read probe plus the fixed Auth denial probes below, all
        // using the same genuinely anonymous jar and no injected token.
        const response = await deadline("private denial headers", () => context.request.get(`${appUrl}/api/business/onboarding`, { timeout: 15000, maxRedirects: 0 }));
        const body = await readPublicJson(response, "private denial");
        assertGuestPrivateDenial(response.status(), body); report.privateApi.checks.push({ view: label, method: "GET", path: "/api/business/onboarding", status: response.status() }); safe(); assert.equal((await context.cookies()).length, 0);
        const ids = { draftId: "11111111-1111-4111-8111-111111111111", requestKey: "22222222-2222-4222-8222-222222222222" };
        const starts = [
          { check: "missing_origin", data: JSON.stringify(ids) },
          { check: "foreign_origin", origin: "https://foreign.synthetic.invalid", data: JSON.stringify(ids) },
          { check: "invalid_body", origin: appUrl, data: JSON.stringify({ ...ids, draftId: "not-a-uuid" }) },
          { check: "extra_body", origin: appUrl, data: JSON.stringify({ ...ids, next: "https://foreign.synthetic.invalid" }) },
          { check: "oversized_body", origin: appUrl, data: " ".repeat(1025) + JSON.stringify(ids) },
          { check: "unavailable", origin: appUrl, data: JSON.stringify(ids) },
        ];
        for (const probe of starts) {
          await inspectGuestGoogleStartHttp(report.authHttp, { view: label, check: probe.check, canonicalOrigin: probe.origin === appUrl },
            () => context.request.post(`${appUrl}/auth/google/start`, { headers: { "Content-Type": "application/json", ...(probe.origin ? { Origin: probe.origin } : {}) }, data: probe.data, timeout: 15000, maxRedirects: 0 }));
          assert.equal((await context.cookies()).length, 0, "Denied anonymous Google start probes must not create Auth, PKCE or handoff cookies.");
        }
        const callbacks = [
          { check: "missing_attempt", query: "code=unused", outcome: "failed" },
          { check: "tampered_attempt", query: "attempt=not-a-uuid&code=unused", outcome: "failed" },
          { check: "unavailable_callback", query: `attempt=${ids.draftId}&code=unused`, outcome: "unavailable" },
          { check: "unknown_query", query: `attempt=${ids.draftId}&code=unused&next=https%3A%2F%2Fforeign.synthetic.invalid`, outcome: "failed" },
          { check: "duplicate_attempt", query: `attempt=${ids.draftId}&attempt=${ids.draftId}&code=unused`, outcome: "failed" },
        ];
        for (const probe of callbacks) {
          await inspectGuestGoogleCallbackHttp(report.authHttp, { view: label, check: probe.check, expectedOutcome: probe.outcome, appUrl },
            () => context.request.get(`${appUrl}/auth/google/callback?${probe.query}`, { timeout: 15000, maxRedirects: 0 }));
          assert.equal((await context.cookies()).length, 0, "Denied callback probes must leave the genuine anonymous context without Auth cookies.");
        }
        safe();
      });
    }
    report.privateApi.strictDenialPassed = report.privateApi.checks.length === 2;
    report.authHttp.strictDenialPassed = report.authHttp.checks.length === 22 && report.authHttp.requestCount === 22;
    assert.ok(report.privateApi.strictDenialPassed && report.authHttp.strictDenialPassed, "Both genuine anonymous contexts must complete every strict HTTP denial check."); report.status = "passed";
  } catch (error) { failure = error; report.status = "failed"; }
  finally {
    report.cleanup = "running";
    const closed = await Promise.allSettled(contexts.map(context => deadline("close anonymous guest context", () => context.close())));
    if (closed.some(value => value.status === "rejected")) { report.cleanup = "failed"; report.status = "failed"; failure ??= new Error("A guest browser context could not be closed; acceptance failed."); } else report.cleanup = "complete";
    report.activeStep = null;
    try { await publish(); } catch { report.status = "failed"; failure ??= new Error("Final guest onboarding evidence could not be published."); }
  }
  if (failure) throw failure;
  return report;
}
