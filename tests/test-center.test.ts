import assert from "node:assert/strict";
import test from "node:test";

import { CAPABILITY_KEYS } from "../lib/packages/capabilities.ts";
import {
  FEATURE_TEST_DEFINITIONS,
  featureTestsForCapabilities,
} from "../lib/testing/test-center.ts";

test("every package capability has a concrete test-center definition", () => {
  assert.deepEqual(Object.keys(FEATURE_TEST_DEFINITIONS).sort(), [...CAPABILITY_KEYS].sort());
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
