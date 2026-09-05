import assert from "node:assert/strict";
import test from "node:test";

import {
  codeRequestReadyForValidation,
  supportReleaseCanComplete,
} from "../lib/support/release-gates.ts";
import {
  normalizeFeatureFlagKey,
  normalizeReleaseVersion,
  supportReleaseCanRollback,
} from "../lib/support/release-lifecycle.ts";

test("support without code work can proceed to requester validation", () => {
  assert.equal(codeRequestReadyForValidation(null), true);
});

test("linked code work must be ready before requester validation", () => {
  for (const status of ["requested", "building", "testing", "blocked"]) {
    assert.equal(codeRequestReadyForValidation(status), false);
  }
  assert.equal(codeRequestReadyForValidation("ready"), true);
});

test("release completion requires requester approval and ready code work", () => {
  assert.equal(
    supportReleaseCanComplete({
      releaseStatus: "requester_approved",
      codeRequestStatus: "ready",
    }),
    true,
  );
  assert.equal(
    supportReleaseCanComplete({
      releaseStatus: "requester_validation",
      codeRequestStatus: "ready",
    }),
    false,
  );
  assert.equal(
    supportReleaseCanComplete({
      releaseStatus: "requester_approved",
      codeRequestStatus: "queued",
    }),
    false,
  );
});

test("release versions are bounded tokens without whitespace", () => {
  assert.equal(normalizeReleaseVersion(" 1.2.0-rc.1 "), "1.2.0-rc.1");
  assert.equal(normalizeReleaseVersion("release 1"), null);
  assert.equal(normalizeReleaseVersion(""), null);
});

test("feature flag keys are scoped identifiers", () => {
  assert.equal(normalizeFeatureFlagKey(" connector.legacy-crm_v2 "), "connector.legacy-crm_v2");
  assert.equal(normalizeFeatureFlagKey("connector legacy"), null);
  assert.equal(normalizeFeatureFlagKey(""), null);
});

test("only a completed release can be rolled back", () => {
  assert.equal(supportReleaseCanRollback("released"), true);
  for (const status of ["draft", "requester_validation", "rolled_back", null]) {
    assert.equal(supportReleaseCanRollback(status), false);
  }
});
