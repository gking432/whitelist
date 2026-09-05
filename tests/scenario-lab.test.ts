import assert from "node:assert/strict";
import test from "node:test";

import {
  getLabScenario,
  LAB_SCENARIOS,
  sanitizeLabValues,
} from "../lib/testing/scenarios.ts";

test("scenario catalog has unique keys and executable expectations", () => {
  const keys = LAB_SCENARIOS.map((scenario) => scenario.key);

  assert.equal(keys.length, 11);
  assert.equal(new Set(keys).size, keys.length);

  for (const scenario of LAB_SCENARIOS) {
    assert.ok(scenario.eventType.length > 0);
    assert.ok(scenario.expectation.templates.length > 0);
    assert.ok(scenario.fields.length > 0);
  }
});

test("every scenario default survives sanitization for its declared fields", () => {
  for (const scenario of LAB_SCENARIOS) {
    assert.deepEqual(
      sanitizeLabValues(scenario, scenario.defaults),
      scenario.defaults,
      scenario.key,
    );
  }
});

test("sanitizer trims, limits, and rejects fields outside the scenario", () => {
  const scenario = getLabScenario("inbound_sms");

  assert.ok(scenario);

  const sanitized = sanitizeLabValues(scenario, {
    name: "  Test Person  ",
    phone: `  ${"1".repeat(700)}  `,
    email: "not-allowed@example.com",
    message: `  ${"m".repeat(4500)}  `,
  });

  assert.equal(sanitized.name, "Test Person");
  assert.equal(sanitized.phone?.length, 500);
  assert.equal(sanitized.message?.length, 4000);
  assert.equal(sanitized.email, undefined);
});

test("high-risk lab paths require approval or escalation assertions", () => {
  const lead = getLabScenario("website_lead");
  const scheduling = getLabScenario("scheduling_request");
  const urgent = getLabScenario("urgent_lead");

  assert.ok(lead && lead.expectation.minimumApprovals >= 1);
  assert.ok(scheduling && scheduling.expectation.minimumApprovals >= 2);
  assert.equal(scheduling?.expectation.bookingProposal, true);
  assert.equal(urgent?.expectation.routingCategory, "urgent_emergency");
  assert.equal(getLabScenario("does_not_exist"), undefined);
});
