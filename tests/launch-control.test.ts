import assert from "node:assert/strict";
import test from "node:test";

import { computeLaunchReadiness } from "../lib/launch/readiness.ts";
import { buildLaunchTestPlan } from "../lib/launch/test-plan.ts";

test("the launch plan covers package workflows with the fewest useful scenarios", () => {
  const plan = buildLaunchTestPlan([
    "new_lead_intake",
    "ai_intake_router",
    "missed_call_rescue",
    "estimate_follow_up",
    "review_request",
  ]);

  assert.deepEqual(plan.uncoveredTemplateKeys, []);
  assert.deepEqual(
    plan.scenarios.map((scenario) => scenario.scenarioKey),
    ["missed_call", "estimate_follow_up", "job_completed"],
  );
});

test("unknown workflow templates block launch instead of being silently skipped", () => {
  const plan = buildLaunchTestPlan(["new_lead_intake", "future_workflow"]);

  assert.deepEqual(plan.uncoveredTemplateKeys, ["future_workflow"]);
});

test("lead intake alone uses the website lead scenario", () => {
  const plan = buildLaunchTestPlan(["new_lead_intake"]);

  assert.deepEqual(plan.scenarios, [
    {
      scenarioKey: "website_lead",
      expectedTemplateKeys: ["new_lead_intake"],
    },
  ]);
});

test("readiness separates sandbox testing from connection-gated go-live", () => {
  const deployment = { id: "deployment-1", packageId: "package-1", status: "needs_setup" };
  const workflow = {
    id: "workflow-1",
    name: "Lead intake",
    status: "active",
    runtimeMode: "sandbox",
    templateKey: "new_lead_intake",
    approvalRequired: true,
  };
  const requirement = {
    id: "crm",
    category: "crm",
    connectableToday: true,
  };

  const readiness = computeLaunchReadiness({
    packageId: "package-1",
    deployment,
    requiredTemplateKeys: ["new_lead_intake"],
    integrationRequirements: [requirement],
    workflows: [workflow],
    connections: [],
    evidence: null,
  });

  assert.equal(readiness.canRunTests, true);
  assert.equal(readiness.canGoLive, false);
  assert.deepEqual(readiness.missingIntegrationIds, ["crm"]);
});

test("current test evidence and configured connections unlock go-live", () => {
  const readiness = computeLaunchReadiness({
    packageId: "package-1",
    deployment: { id: "deployment-1", packageId: "package-1", status: "ready" },
    requiredTemplateKeys: ["new_lead_intake"],
    integrationRequirements: [
      { id: "lead_source", category: null, connectableToday: true },
    ],
    workflows: [
      {
        id: "workflow-1",
        name: "Lead intake",
        status: "active",
        runtimeMode: "sandbox",
        templateKey: "new_lead_intake",
        approvalRequired: true,
      },
    ],
    connections: [
      {
        id: "connection-1",
        displayName: "Automation bridge",
        status: "connected",
        runtimeMode: "sandbox",
        credentialStatus: "configured",
        provider: {
          provider_key: "generic_inbound_webhook",
          category: "webhook",
          supports_inbound: true,
        },
      },
    ],
    evidence: {
      id: "launch-1",
      deploymentId: "deployment-1",
      status: "ready",
      passed: true,
    },
  });

  assert.equal(readiness.canGoLive, true);
  assert.deepEqual(readiness.targetWorkflowIds, ["workflow-1"]);
  assert.deepEqual(readiness.targetConnectionIds, ["connection-1"]);
});

test("live runtimes prevent package tests until rollback", () => {
  const readiness = computeLaunchReadiness({
    packageId: "package-1",
    deployment: { id: "deployment-1", packageId: "package-1", status: "ready" },
    requiredTemplateKeys: ["new_lead_intake"],
    integrationRequirements: [],
    workflows: [
      {
        id: "workflow-1",
        name: "Lead intake",
        status: "active",
        runtimeMode: "live",
        templateKey: "new_lead_intake",
        approvalRequired: true,
      },
    ],
    connections: [],
    evidence: null,
  });

  assert.equal(readiness.hasLiveRuntime, true);
  assert.equal(readiness.canRunTests, false);
});
