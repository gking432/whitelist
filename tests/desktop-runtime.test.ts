import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { normalizeAppUrl } = require("../desktop/runtime-config.cjs") as {
  normalizeAppUrl: (value: unknown, allowLocalhost?: boolean) => string | null;
};

test("packaged desktop servers require HTTPS", () => {
  assert.equal(normalizeAppUrl("https://partner.example.com/setup?token=secret"), "https://partner.example.com");
  assert.equal(normalizeAppUrl("http://partner.example.com"), null);
  assert.equal(normalizeAppUrl("http://localhost:3010"), null);
  assert.equal(normalizeAppUrl("https://192.168.1.10"), null);
  assert.equal(normalizeAppUrl("https://metadata.local"), null);
  assert.equal(normalizeAppUrl("https://127.0.0.2"), null);
  assert.equal(normalizeAppUrl("https://[::1]"), null);
  assert.equal(normalizeAppUrl("https://[fc00::1]"), null);
  assert.equal(normalizeAppUrl("https://0.0.0.0"), null);
});

test("desktop development can use localhost without weakening remote URLs", () => {
  assert.equal(normalizeAppUrl("http://localhost:3010/path", true), "http://localhost:3010");
  assert.equal(normalizeAppUrl("http://127.0.0.1:3010", true), "http://127.0.0.1:3010");
  assert.equal(normalizeAppUrl("http://192.168.1.10:3010", true), null);
});

test("desktop server URLs never retain credentials, queries, or fragments", () => {
  assert.equal(normalizeAppUrl("https://user:password@example.com"), null);
  assert.equal(normalizeAppUrl("not a url"), null);
  assert.equal(normalizeAppUrl("https://example.com/a?key=secret#private"), "https://example.com");
});
