import assert from "node:assert/strict";
import test from "node:test";

import { CAPABILITY_KEYS } from "../lib/packages/capabilities.ts";
import {
  FEATURE_TEST_DEFINITIONS,
  featureTestsForCapabilities,
} from "../lib/testing/test-center.ts";
import { featureTestProgress } from "../lib/testing/progress.ts";

test("every package capability has a concrete test-center definition", () => {
  assert.deepEqual(
    Object.keys(FEATURE_TEST_DEFINITIONS).sort(),
    [...CAPABILITY_KEYS].sort(),
  );
});

test("automated feature tests declare scenarios and an expected outcome", () => {
  for (const definition of Object.values(FEATURE_TEST_DEFINITIONS)) {
    assert.ok(definition.steps.length > 0);
    assert.ok(definition.expectedResult.length > 0);
    if (definition.testMode === "automated") {
      assert.ok(definition.scenarioKeys.length > 0, definition.capabilityKey);
    }
  }
});

test("the center shows only capabilities included in the package", () => {
  assert.deepEqual(
    featureTestsForCapabilities(["lead_intake", "review_requests"]).map(
      (definition) => definition.capabilityKey,
    ),
    ["lead_intake", "review_requests"],
  );
});

test("feature progress uses the latest result for the current package", () => {
  const progress = featureTestProgress(
    ["lead_intake", "reports_portal"],
    [
      {
        capability_key: "lead_intake",
        status: "passed",
        created_at: "2026-07-25T12:00:00.000Z",
      },
      {
        capability_key: "lead_intake",
        status: "failed",
        created_at: "2026-07-25T11:00:00.000Z",
      },
      {
        capability_key: "reports_portal",
        status: "failed",
        created_at: "2026-07-25T10:00:00.000Z",
      },
      {
        capability_key: "northstar_crm",
        status: "passed",
        created_at: "2026-07-25T09:00:00.000Z",
      },
    ],
  );

  assert.equal(progress.passed, 1);
  assert.equal(progress.complete, false);
  assert.deepEqual(progress.missingKeys, []);
  assert.deepEqual(progress.failedKeys, ["reports_portal"]);
});

test("an empty capability set is already complete", () => {
  assert.equal(featureTestProgress([], []).complete, true);
});
