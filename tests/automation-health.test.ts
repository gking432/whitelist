import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAutomationHealth,
  type AutomationConnection,
  type AutomationRun,
  type AutomationWorkflow,
} from "../lib/crm/automation-health.ts";

function workflow(
  overrides: Partial<AutomationWorkflow> = {},
): AutomationWorkflow {
  return {
    id: "workflow-1",
    name: "Speed to lead",
    status: "active",
    runtime_mode: "live",
    health_status: "healthy",
    last_run_at: "2026-07-24T18:00:00.000Z",
    template: {
      name: "Speed to lead",
      description: "Responds to new leads.",
      category: "lead_response",
      risk_level: "medium",
      required_provider_categories: ["sms"],
    },
    ...overrides,
  };
}

function run(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run-1",
    workflow_instance_id: "workflow-1",
    status: "succeeded",
    summary: "Lead received and reply drafted.",
    error_message: null,
    requires_approval: false,
    created_at: "2026-07-24T18:00:00.000Z",
    finished_at: "2026-07-24T18:00:10.000Z",
    ...overrides,
  };
}

const twilio: AutomationConnection = {
  id: "connection-1",
  display_name: "Main business number",
  status: "connected",
  runtime_mode: "live",
  provider: {
    provider_key: "twilio",
    display_name: "Twilio",
    category: "sms",
  },
};

test("healthy automation maps its real provider and successful outcome", () => {
  const result = buildAutomationHealth(
    [workflow()],
    [run()],
    [twilio],
    new Date("2026-07-25T12:00:00.000Z"),
  );

  assert.equal(result.healthyCount, 1);
  assert.equal(result.successRate, 100);
  assert.equal(result.items[0]?.connections[0]?.display_name, "Main business number");
  assert.equal(
    result.items[0]?.latestSuccess?.summary,
    "Lead received and reply drafted.",
  );
});

test("missing required provider marks an automation as needing attention", () => {
  const result = buildAutomationHealth(
    [workflow()],
    [],
    [],
    new Date("2026-07-25T12:00:00.000Z"),
  );

  assert.equal(result.needsAttentionCount, 1);
  assert.deepEqual(result.items[0]?.missingProviderCategories, ["sms"]);
});

test("a newer failure remains visible even after an earlier success", () => {
  const result = buildAutomationHealth(
    [workflow()],
    [
      run(),
      run({
        id: "run-2",
        status: "failed",
        summary: null,
        error_message: "Twilio rejected the message.",
        created_at: "2026-07-25T10:00:00.000Z",
        finished_at: "2026-07-25T10:00:03.000Z",
      }),
    ],
    [twilio],
    new Date("2026-07-25T12:00:00.000Z"),
  );

  assert.equal(result.items[0]?.state, "needs_attention");
  assert.equal(
    result.items[0]?.latestFailure?.error_message,
    "Twilio rejected the message.",
  );
  assert.equal(result.successRate, 50);
});

test("paused automations are inactive rather than unhealthy", () => {
  const result = buildAutomationHealth(
    [workflow({ status: "paused" })],
    [],
    [twilio],
    new Date("2026-07-25T12:00:00.000Z"),
  );

  assert.equal(result.items[0]?.state, "inactive");
  assert.equal(result.needsAttentionCount, 0);
});
