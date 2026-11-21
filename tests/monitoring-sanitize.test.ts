import assert from "node:assert/strict";
import test from "node:test";

import {
  monitoringFingerprint,
  monitoringPath,
  sanitizeMonitoringText,
} from "../lib/monitoring/sanitize.ts";

test("monitoring sanitizer removes credentials and customer identifiers", () => {
  const text = sanitizeMonitoringText(
    "Bearer abc.def.ghi failed for jane@example.com at 312-555-0199 with sk-secretsecretsecret",
  );
  assert.equal(text?.includes("jane@example.com"), false);
  assert.equal(text?.includes("312-555-0199"), false);
  assert.equal(text?.includes("sk-secret"), false);
  assert.equal(text?.includes("Bearer abc"), false);
});

test("monitoring paths discard query strings", () => {
  assert.equal(
    monitoringPath("https://app.example.com/client?email=jane@example.com"),
    "/client",
  );
});

test("monitoring fingerprints are stable and route-specific", () => {
  const first = monitoringFingerprint({
    source: "server",
    errorName: "Error",
    message: "Database unavailable",
    routePath: "/client",
  });
  const same = monitoringFingerprint({
    source: "server",
    errorName: "Error",
    message: "Database unavailable",
    routePath: "/client",
  });
  const other = monitoringFingerprint({
    source: "server",
    errorName: "Error",
    message: "Database unavailable",
    routePath: "/partner",
  });
  assert.equal(first, same);
  assert.notEqual(first, other);
});
