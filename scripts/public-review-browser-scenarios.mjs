// Public navigation only. The supplied browser owns its toolchain; every
// context here is fresh, anonymous and closed without creating any session.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const areas = [
  { key: "today", label: "Today", path: "/preview" },
  { key: "messages", label: "Messages", path: "/preview/messages" },
  { key: "todo", label: "To-do", path: "/preview/todo" },
  { key: "calendar", label: "Calendar", path: "/preview/calendar" },
  { key: "money", label: "Money", path: "/preview/money" },
  { key: "manager", label: "Manager", path: "/preview/manager" },
  { key: "apps", label: "Apps", path: "/preview/apps" },
];
export function publicReviewTarget(appUrl, artifacts) {
  let url; try { url = new URL(appUrl); } catch { throw new Error("Public review requires an explicit application origin."); }
  assert.ok(["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash, "Public review requires an explicit application origin without credentials, path or query.");
  assert.ok(typeof artifacts === "string" && isAbsolute(artifacts), "Public review screenshots require an explicit absolute artifact directory.");
  return { appUrl: url.origin, artifacts };
}
export function classifyPublicReviewRequest(appUrl, requestUrl, method, setupIntent = false) {
  let url; try { url = new URL(requestUrl); } catch { return "invalid"; }
  if (url.origin !== appUrl) return "external";
  if (!/^(GET|HEAD)$/.test(method)) return "non_read";
  if (/^\/(api(?:\/|$)|auth(?:\/|$)|rest\/v1(?:\/|$)|graphql(?:\/|$)|storage\/v1(?:\/|$)|functions\/v1(?:\/|$))/.test(url.pathname)) return "backend";
  if (!setupIntent && (/^\/start(?:\/|$)/.test(url.pathname) || /^\/login\/?$/.test(url.pathname) && ["next", "error", "agency"].some((key) => url.searchParams.has(key)))) return "setup_without_intent";
  return "read";
}
export function createPublicReviewRequestGuard(appUrl, record = () => {}) {
  let setupIntent = false;
  const observed = new WeakMap();
  return {
    permitSetup() { setupIntent = true; },
    classify(request) {
      if (!observed.has(request)) { const kind = classifyPublicReviewRequest(appUrl, request.url(), request.method(), setupIntent); observed.set(request, kind); record(kind); }
      return observed.get(request);
    },
  };
}
export function assertPublicReviewDenied(status, body, allowUnavailable = false) {
  const plain = body && typeof body === "object" && !Array.isArray(body);
  assert.ok(plain && Object.keys(body).length === 1 && typeof body.error === "string" && body.error.trim().length > 0 && body.error.length <= 1000, "A protected anonymous endpoint must return only a complete bounded public error.");
  if ([401, 403].includes(status)) {
    assert.ok(new Set(["Business owner access is required.", "Business owner write access is required.", "Business workspace access is required.", "Sign in with business owner access.", "Unauthorized", "Authentication required."]).has(body.error), "An anonymous denial must contain a known public authentication error, without private diagnostics or an unrelated Origin failure.");
    return "denied";
  }
  const availability = new Set(["Data service unavailable.", "The data service is unavailable.", "Business context could not be loaded. Check the data service and current migration.", "The saved preference could not be confirmed. Reload it before trying again."]);
  assert.ok(allowUnavailable === true && status === 503 && availability.has(body.error), `Anonymous private API must deny access with HTTP401/403; received ${status}.`);
  return "configuration_unavailable";
}
export function assertPublicReviewRect(rect, viewport, unobscured) {
  assert.ok(rect && viewport && [rect.x, rect.y, rect.width, rect.height, viewport.width, viewport.height].every(Number.isFinite) && rect.width >= 44 && rect.height >= 44 && rect.x >= -0.5 && rect.y >= -0.5 && rect.x + rect.width <= viewport.width + 0.5 && rect.y + rect.height <= viewport.height + 0.5, "A public navigation/control target must fit the screen and provide a44px touch target.");
  assert.equal(unobscured, true, "A public navigation/control target must be unobscured at its actual browser hit point.");
}
async function deadline(label, action, milliseconds = 15000) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Public review timed out: ${label}.`)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
async function targetGeometry(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const rect = await locator.boundingBox(), unobscured = await locator.evaluate((node) => { const box = node.getBoundingClientRect(), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); return hit === node || node.contains(hit); });
  assertPublicReviewRect(rect, page.viewportSize(), unobscured);
}
async function assertPage(page, appUrl, area) {
  const url = new URL(page.url()); assert.ok(url.origin === appUrl && url.pathname === area.path && !url.search && !url.hash, "The anonymous entry/navigation must reach the exact public workstation area.");
  await page.locator(`[data-public-review][data-preview-area="${area.key}"]`).waitFor({ state: "visible" });
  const body = await page.locator("body").innerText();
  assert.ok(!/owner-browser-[a-f0-9]{12}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(body), "A public preview must not expose private tenant, identity or fixture records.");
  assert.ok(!/Your next chapter|A little less busy|Less busywork\. More time|AI voice|AI scheduling|AI workflows/i.test(body), "The public entry must display the current workstation, without the former marketing or voice-promotion page.");
  assert.equal(await page.locator('input[type="email"],input[type="password"]').count(), 0, "The public workstation must not present a sign-in form.");
  assert.equal(await page.getByRole("button", { name: "Send sign-in link", exact: true }).count(), 0);
  assert.equal(await page.locator("[data-personal-assistant-launcher],[data-personal-assistant-onboarding]").count(), 0, "Private actor preferences must not mount in the public workstation.");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, "Public desktop/phone content must not clip horizontally.");
  const scope = page.locator(`[data-preview-area="${area.key}"]`);
  if (area.key === "today") { await scope.getByText("No updates yet.", { exact: false }).first().waitFor(); assert.equal(await scope.locator("[data-work-section]").count(), 0); }
  else if (area.key === "messages") { assert.equal(await scope.getByRole("link", { name: "Connect a messaging app", exact: true }).getAttribute("href"), "/preview/apps"); }
  else if (area.key === "todo") { await scope.getByRole("heading", { name: "To-do", exact: true }).waitFor(); assert.equal(await scope.locator('section[aria-label="Your work"],section[aria-label="Agent work"]').count(), 0); }
  else if (area.key === "manager") { assert.equal(await scope.getByRole("textbox", { name: "Message your manager", exact: true }).isDisabled(), true); assert.equal(await scope.getByRole("button", { name: "Send message", exact: true }).isDisabled(), true); }
  else if (area.key === "calendar") { await scope.getByRole("heading", { name: "Calendar", exact: true }).waitFor(); await scope.getByText("No upcoming appointments have been imported.", { exact: true }).waitFor(); }
  else if (area.key === "money") { await scope.getByRole("heading", { name: "Money", exact: true }).waitFor(); await scope.getByText("No invoice or payment records are available here yet.", { exact: true }).waitFor(); }
  else { await scope.getByRole("heading", { name: "Apps & connections", exact: true }).waitFor(); await scope.getByText("No accounts connected.", { exact: true }).waitFor(); }
  const enabledWrites = await scope.getByRole("button", { name: /^(save|send|create|connect|approve|resume|pause|disconnect)\b/i }).all();
  for (const button of enabledWrites) assert.equal(await button.isDisabled(), true, "Public preview write controls must be absent or disabled.");
}
export async function runPublicReviewBrowserScenarios({ browser, appUrl, artifacts, phase = async () => {}, allowUnavailable = false }) {
  const target = publicReviewTarget(appUrl, artifacts); appUrl = target.appUrl;
  assert.equal(typeof allowUnavailable, "boolean");
  const report = { version: 1, status: "in_progress", activeStep: null, checks: [], screenshots: [], views: {}, privateApi: { checks: [], strictDenialPassed: false, configurationUnavailable: 0 }, cleanup: "not_started", limits: ["Fresh anonymous browser contexts only; no session/cookie injection, storageState, authentication creation or provider/model request.", "View traffic is restricted to same-origin GET/HEAD; deliberate anonymous private API probes use a separate fresh context.", "Network assertions describe browser-observed traffic, not an instrumented server egress trace.", "Explicitly allowed configuration-unavailable503 responses reveal no data but do not establish a successful authorization-denial proof."] };
  const contexts = []; let failure;
  await mkdir(artifacts, { recursive: true });
  const publish = async () => { const destination = join(artifacts, "public-review-report.json"); await writeFile(`${destination}.tmp`, JSON.stringify(report, null, 2)); await rename(`${destination}.tmp`, destination); };
  const stage = async (name, action) => {
    report.activeStep = name; await publish(); await phase(`public review: ${name}`);
    try { await deadline(name, action, 45000); report.checks.push({ key: name, status: "passed" }); report.activeStep = null; await publish(); }
    catch (error) { report.checks.push({ key: name, status: "failed" }); throw error; }
  };
  try {
    for (const [label, viewport] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
      const context = await deadline("fresh anonymous context", () => browser.newContext({ viewport, isMobile: label === "phone", hasTouch: label === "phone", locale: "en-US", timezoneId: "America/Chicago", serviceWorkers: "block" })); contexts.push(context);
      assert.equal((await context.cookies()).length, 0, "Public review must begin in a fresh context with no existing identity.");
      const network = { read: 0, non_read: 0, backend: 0, external: 0, invalid: 0, setup_without_intent: 0, pageErrors: 0 };
      report.views[label] = { viewport, network, anonymous: true, areas: [] };
      const requestGuard = createPublicReviewRequestGuard(appUrl, (kind) => { network[kind]++; });
      context.on("request", requestGuard.classify);
      // Keep the original request's decision: entering the explicit setup
      // stage later must never turn an earlier prefetch into permitted work.
      await context.route("**/*", async (route) => { if (requestGuard.classify(route.request()) === "read") await route.continue(); else await route.abort(); });
      const page = await context.newPage(); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(30000); page.on("pageerror", () => { network.pageErrors++; });
      const safe = () => { for (const kind of ["non_read", "backend", "external", "invalid", "setup_without_intent", "pageErrors"]) assert.equal(network[kind], 0, `Anonymous public view must have no ${kind} activity.`); };
      const capture = async (name) => { safe(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false); const filename = `public-${label}-${name}.png`; await page.screenshot({ path: join(artifacts, filename), fullPage: true, animations: "disabled", timeout: 15000 }); report.screenshots.push(filename); };
      for (const [name, path] of [["root", "/"], ["client", "/client"], ["login", "/login"]]) await stage(`${label}: anonymous ${name} enters workstation`, async () => {
        await page.goto(`${appUrl}${path}`); await page.waitForURL((url) => url.origin === appUrl && url.pathname === "/preview", { timeout: 15000 }); await assertPage(page, appUrl, areas[0]); await capture(name);
      });
      for (const area of areas) await stage(`${label}: ${area.key} local empty navigation`, async () => {
        let navigation = page.getByRole("navigation", { name: "Business navigation", exact: true });
        if (label === "phone" && ["money", "manager", "apps"].includes(area.key)) {
          const more = page.locator("summary").filter({ hasText: /^\s*More\s*$/ }); await targetGeometry(page, more); await more.click();
          navigation = page.getByRole("navigation", { name: "More business navigation", exact: true });
          if (area.key === "money") await capture("more-navigation");
        }
        const link = navigation.getByRole("link", { name: area.label, exact: true }); await targetGeometry(page, link); assert.equal(await link.getAttribute("href"), area.path); await link.click();
        await page.waitForURL((url) => url.origin === appUrl && url.pathname === area.path, { timeout: 15000 }); await assertPage(page, appUrl, area); await capture(area.key); report.views[label].areas.push(area.key);
      });
      await stage(`${label}: local Apps disclosure and scroll`, async () => {
        const disclosure = page.locator("summary").filter({ hasText: /^\s*What appears here\s*$/ }); await targetGeometry(page, disclosure); await disclosure.click();
        assert.equal(await disclosure.evaluate((node) => node.parentElement.open), true); await capture("apps-expanded");
        await disclosure.scrollIntoViewIfNeeded(); await targetGeometry(page, disclosure); await disclosure.click(); assert.equal(await disclosure.evaluate((node) => node.parentElement.open), false);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await targetGeometry(page, page.getByRole("navigation", { name: "Business navigation", exact: true }).getByRole("link", { name: "Today", exact: true }));
        safe(); assert.ok(!(await context.cookies()).some((cookie) => /^sb-.*-auth-token(?:\.\d+)?$/.test(cookie.name)), "The public review must not create an authenticated session.");
      });
      await stage(`${label}: explicit setup opens real owner sign in`, async () => {
        const setup = page.getByRole("link", { name: "Set up your business", exact: true }).first();
        await targetGeometry(page, setup); assert.equal(await setup.getAttribute("href"), "/start"); safe();
        // This is the only deliberate setup action in the anonymous journey.
        // Merely displaying, scrolling to or inspecting the CTA cannot opt in.
        requestGuard.permitSetup(); await setup.click();
        await page.waitForURL((url) => url.origin === appUrl && url.pathname === "/login" && url.searchParams.get("next") === "/start", { timeout: 15000 });
        await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
        assert.equal(await page.locator('input[type="email"]').inputValue(), "", "Explicit owner setup must show a real blank email form without submitting a fixture or creating a session.");
        await page.getByRole("button", { name: "Send sign-in link", exact: true }).waitFor();
        assert.equal(await page.locator("[data-public-review]").count(), 0, "Owner setup must leave the public preview for the real authentication boundary.");
        assert.ok(!/AI voice|AI scheduling|AI workflows|Less busywork\. More time/i.test(await page.locator("body").innerText()), "Explicit sign-in must remain the minimal owner gate without the old voice promotion.");
        safe(); await capture("setup-sign-in");
        assert.ok(!(await context.cookies()).some((cookie) => /^sb-.*-auth-token(?:\.\d+)?$/.test(cookie.name)), "Visiting setup without submitting email must not create an authenticated session.");
      });
    }
    await stage("anonymous protected APIs reveal no private data", async () => {
      const context = await browser.newContext({ serviceWorkers: "block" }); contexts.push(context); assert.equal((await context.cookies()).length, 0);
      for (const [method, path] of [["GET", "/api/connections"], ["GET", "/api/business/context"], ["GET", "/api/business/personal-assistant"], ["POST", "/api/business/personal-assistant"]]) {
        const response = await deadline("anonymous protected API headers", () => method === "GET" ? context.request.get(`${appUrl}${path}`, { timeout: 15000, maxRedirects: 0 }) : context.request.post(`${appUrl}${path}`, { headers: { Origin: appUrl }, data: { key: randomUUID(), revision: 0, settings: { answer: "skipped", assistant: null } }, timeout: 15000, maxRedirects: 0 }));
        const bytes = await deadline("anonymous protected API body", () => response.body()); assert.ok(bytes.length > 0 && bytes.length <= 4096, "Anonymous denial must return a complete bounded error body.");
        let body; try { body = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("Anonymous protected API must return a complete JSON denial."); }
        const result = assertPublicReviewDenied(response.status(), body, allowUnavailable); report.privateApi.checks.push({ method, path, status: response.status(), result });
        if (result === "configuration_unavailable") report.privateApi.configurationUnavailable++;
      }
      report.privateApi.strictDenialPassed = report.privateApi.configurationUnavailable === 0;
    });
    report.status = "passed";
  } catch (error) { report.status = "failed"; failure = error; }
  finally {
    report.cleanup = "running";
    const closed = await Promise.allSettled(contexts.map((context) => deadline("close anonymous context", () => context.close())));
    if (closed.some((outcome) => outcome.status === "rejected")) { report.cleanup = "failed"; report.status = "failed"; failure ||= new Error("An anonymous public context could not be closed."); } else report.cleanup = "complete";
    try { await publish(); } catch (error) { failure ||= error; }
  }
  if (failure) throw failure;
  return report;
}
