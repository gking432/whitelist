import assert from "node:assert/strict";
import test from "node:test";
import { assertPublicReviewDenied, assertPublicReviewRect, classifyPublicReviewRequest, createPublicReviewRequestGuard, publicReviewTarget, runPublicReviewBrowserScenarios } from "../scripts/public-review-browser-scenarios.mjs";

test("public acceptance requires an explicit clean origin and artifact path before opening any context", async () => {
  assert.deepEqual(publicReviewTarget("http://127.0.0.1:3000", "/tmp/public-review-test"), { appUrl: "http://127.0.0.1:3000", artifacts: "/tmp/public-review-test" });
  for (const url of ["invalid", "file:///tmp/site", "https://user:secret@example.test", "https://example.test/client", "https://example.test/?token=secret", "https://example.test/#private"]) assert.throws(() => publicReviewTarget(url, "/tmp/public-review-test"));
  assert.throws(() => publicReviewTarget("https://example.test", "relative"));
  let opened = 0;
  await assert.rejects(runPublicReviewBrowserScenarios({ browser: { newContext: async () => { opened++; return {}; } }, appUrl: "https://user:secret@example.test", artifacts: "/tmp/public-review-test" })); assert.equal(opened, 0);
});
test("view transport separates local reads from writes, private APIs, Auth/DB paths and external providers", () => {
  const origin = "http://127.0.0.1:3000";
  assert.equal(classifyPublicReviewRequest(origin, `${origin}/preview/money?_rsc=opaque`, "GET"), "read");
  assert.equal(classifyPublicReviewRequest(origin, `${origin}/_next/static/chunk.js`, "HEAD"), "read");
  assert.equal(classifyPublicReviewRequest(origin, `${origin}/preview`, "POST"), "non_read");
  for (const path of ["/api/business/context", "/auth/v1/user", "/rest/v1/clients", "/graphql/v1", "/storage/v1/object/private", "/functions/v1/work"]) assert.equal(classifyPublicReviewRequest(origin, `${origin}${path}`, "GET"), "backend");
  assert.equal(classifyPublicReviewRequest(origin, "https://provider.example.test/oauth", "GET"), "external");
  assert.equal(classifyPublicReviewRequest(origin, "not-a-url", "GET"), "invalid");
  assert.equal(classifyPublicReviewRequest(origin, `${origin}/login`, "GET"), "read");
  for (const path of ["/start", "/start/", "/start?_rsc=prefetch", "/login?next=%2Fstart", "/login?error=expired", "/login?agency=example"]) {
    assert.equal(classifyPublicReviewRequest(origin, `${origin}${path}`, "GET"), "setup_without_intent");
    assert.equal(classifyPublicReviewRequest(origin, `${origin}${path}`, "GET", true), "read");
  }
  assert.equal(classifyPublicReviewRequest(origin, `${origin}/auth/v1/user`, "GET", true), "backend");
  assert.equal(classifyPublicReviewRequest(origin, `${origin}/start`, "POST", true), "non_read");
});
test("private anonymous probes cannot pass a200, redirect, partial receipt, private data or unproved503", () => {
  for (const status of [401, 403]) assert.equal(assertPublicReviewDenied(status, { error: "Business owner access is required." }), "denied");
  for (const [status, body] of [[200, { error: "No access" }], [302, { error: "Sign in" }], [403, { error: "No access", records: [] }], [403, { error: "" }], [403, { error: "x".repeat(1001) }], [403, null], [503, { error: "Data service unavailable." }], [503, { error: "Unknown backend condition" }]] as const) assert.throws(() => assertPublicReviewDenied(status, body));
  assert.equal(assertPublicReviewDenied(503, { error: "Data service unavailable." }, true), "configuration_unavailable");
  assert.throws(() => assertPublicReviewDenied(503, { error: "private diagnostic" }, true));
  assert.throws(() => assertPublicReviewDenied(403, { error: "private diagnostic" }));
  assert.throws(() => assertPublicReviewDenied(403, { error: "Invalid request origin." }), /unrelated Origin failure/);
});
test("a later setup click cannot retroactively permit an earlier prefetch or double-count its route event", () => {
  const origin = "http://127.0.0.1:3000", recorded: string[] = [];
  const guard = createPublicReviewRequestGuard(origin, (kind) => { recorded.push(kind); });
  const prefetched = { url: () => `${origin}/start?_rsc=prefetch`, method: () => "GET" };
  assert.equal(guard.classify(prefetched), "setup_without_intent"); guard.permitSetup();
  assert.equal(guard.classify(prefetched), "setup_without_intent");
  assert.equal(guard.classify({ url: () => `${origin}/start`, method: () => "GET" }), "read");
  assert.equal(guard.classify({ url: () => `${origin}/login?next=%2Fstart`, method: () => "GET" }), "read");
  assert.deepEqual(recorded, ["setup_without_intent", "read", "read"]);
});
test("phone public navigation must be touch-sized, entirely on screen and genuinely hit-testable", () => {
  const screen = { width: 390, height: 844 }, target = { x: 245, y: 120, width: 110, height: 44 };
  assertPublicReviewRect(target, screen, true);
  for (const rect of [null, { ...target, width: 43 }, { ...target, height: 30 }, { ...target, x: 350 }, { ...target, y: 825 }, { ...target, x: Number.NaN }]) assert.throws(() => assertPublicReviewRect(rect, screen, true));
  assert.throws(() => assertPublicReviewRect(target, screen, false));
});
