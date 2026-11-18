import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { isSameOrigin } from "../lib/auth/same-origin.ts";
const { NextRequest } = createRequire(import.meta.url)("next/server");

test("actual installed NextURL loopback normalization cannot reject the configured browser origin", () => {
  for (const app of ["http://127.0.0.1:3000", "http://[::1]:3000", "http://localhost:3000"]) {
    const request = new NextRequest(`${app}/api/business/workspace-preferences`, { headers: { origin: app, host: new URL(app).host } });
    assert.equal(request.nextUrl.origin, "http://localhost:3000");
    assert.equal(isSameOrigin(request.headers.get("origin"), app), true);
    assert.equal(isSameOrigin("https://outside.invalid", app), false);
  }
});
test("origin checks retain exact canonical scheme, host and port, rejecting missing or malformed values", () => {
  const canonical = "https://workspace.example.test/settings";
  assert.equal(isSameOrigin("https://workspace.example.test", canonical), true);
  for (const origin of [null, "null", "", "http://workspace.example.test", "https://workspace.example.test:444", "https://workspace.example.test.evil.invalid", "https://outside.invalid", "https://workspace.example.test/", "https://user@workspace.example.test", "https://workspace.example.test\n"]) assert.equal(isSameOrigin(origin, canonical), false);
  assert.equal(isSameOrigin("https://workspace.example.test", "invalid"), false);
  assert.equal(isSameOrigin("http://localhost:3000", "http://127.0.0.1:3000"), false);
});
