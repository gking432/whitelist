import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOMATION_PACKS,
  V1_AUTOMATION_PACKS,
  getAutomationPack,
} from "../lib/automation-packs/catalog.ts";
import {
  automationPackReadiness,
  connectionMeetsAutomationRequirement,
  type AutomationConnection,
} from "../lib/automation-packs/readiness.ts";
import { n8nWorkflow } from "../lib/automation-packs/exports.ts";
import {
  buildZapierWorkflowRequest,
  deployZapierWorkflow,
} from "../lib/automation-packs/providers/zapier.ts";
import { deployN8nWorkflow } from "../lib/automation-packs/providers/n8n.ts";

const connection = (
  values: Partial<AutomationConnection> & {
    providerKey?: string;
    category?: string;
    supportsInbound?: boolean;
  } = {},
): AutomationConnection => ({
  id: values.id ?? "connection-1",
  status: values.status ?? "connected",
  provider:
    values.provider === null
      ? null
      : {
          provider_key: values.providerKey ?? "test-provider",
          category: values.category ?? "crm",
          supports_inbound: values.supportsInbound ?? false,
          ...values.provider,
        },
});

test("catalog contains fourteen researched packs and six launch packs", () => {
  assert.equal(AUTOMATION_PACKS.length, 14);
  assert.equal(V1_AUTOMATION_PACKS.length, 6);
  assert.deepEqual(
    V1_AUTOMATION_PACKS.map((pack) => pack.priority),
    [1, 2, 3, 4, 5, 6],
  );
  assert.equal(new Set(AUTOMATION_PACKS.map((pack) => pack.key)).size, 14);
});

test("every pack has a version, verification event, and test instructions", () => {
  for (const pack of AUTOMATION_PACKS) {
    assert.ok(pack.version > 0, pack.key);
    assert.ok(pack.eventTypes.includes(pack.eventType), pack.key);
    assert.ok(pack.verificationEventTypes.length > 0, pack.key);
    assert.ok(pack.testInstructions.length >= 3, pack.key);
    assert.ok(pack.platforms.length > 0, pack.key);
  }
});

test("inbound, category, and provider-key requirements match connected accounts", () => {
  const leadPack = getAutomationPack("universal-lead-capture")!;
  const missedCallPack = getAutomationPack("missed-call-rescue")!;
  const inbound = connection({
    providerKey: "generic_inbound_webhook",
    category: "inbound_webhook",
    supportsInbound: true,
  });
  const twilio = connection({ providerKey: "twilio", category: "sms" });

  assert.equal(
    connectionMeetsAutomationRequirement(
      leadPack.connectionRequirements[0],
      inbound,
    ),
    true,
  );
  assert.equal(
    connectionMeetsAutomationRequirement(
      missedCallPack.connectionRequirements[0],
      twilio,
    ),
    true,
  );
});

test("Northstar CRM satisfies the CRM requirement only in primary mode", () => {
  const pack = getAutomationPack("booking-confirmations")!;
  const connections = [
    connection({ category: "calendar" }),
    connection({ category: "sms" }),
  ];

  assert.deepEqual(
    automationPackReadiness(pack, connections).missingKeys,
    ["crm"],
  );
  assert.deepEqual(
    automationPackReadiness(pack, connections, {
      crmOperatingMode: "primary_crm",
    }).missingKeys,
    [],
  );
});

test("n8n exports remain importable for every catalog pack", () => {
  for (const pack of AUTOMATION_PACKS) {
    const workflow = n8nWorkflow(pack);

    assert.equal(workflow.name, `Northstar - ${pack.name}`);
    assert.equal(workflow.nodes.length, 3);
    assert.equal(workflow.meta.northstar_event_type, pack.eventType);
  }
});

test("Zapier builder requires trigger and action steps", () => {
  assert.throws(
    () =>
      buildZapierWorkflowRequest({
        title: "Incomplete",
        steps: [{ action: "trigger" }],
      }),
    /requires a trigger and an action/,
  );

  assert.deepEqual(
    buildZapierWorkflowRequest({
      title: "Lead capture",
      steps: [
        { action: "app:trigger", authentication: "auth-1" },
        {
          action: "webhooks:post",
          alias: "northstar",
          inputs: { url: "https://example.com/intake" },
        },
      ],
    }).data,
    {
      enabled: true,
      title: "Lead capture",
      steps: [
        { action: "app:trigger", authentication: "auth-1", inputs: {} },
        {
          action: "webhooks:post",
          alias: "northstar",
          inputs: { url: "https://example.com/intake" },
        },
      ],
    },
  );
});

test("Zapier deployer returns the durable external workflow reference", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        data: {
          id: "zap-123",
          enabled: true,
          links: { html_editor: "https://zapier.com/editor/zap-123" },
        },
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const result = await deployZapierWorkflow({
    accessToken: "secret",
    title: "Lead capture",
    steps: [{ action: "trigger" }, { action: "write" }],
    fetcher,
  });

  assert.equal(calls[0]?.url, "https://api.zapier.com/v2/zaps");
  assert.equal(result.externalId, "zap-123");
  assert.equal(result.enabled, true);
});

test("n8n deployer creates and activates a workflow", async () => {
  const calls: string[] = [];
  const fetcher = (async (url: string | URL | Request) => {
    calls.push(String(url));

    if (String(url).endsWith("/activate")) {
      return new Response(JSON.stringify({ id: "42", active: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ id: "42" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const result = await deployN8nWorkflow({
    baseUrl: "https://n8n.example.com/",
    apiKey: "secret",
    workflow: {
      name: "Lead capture",
      nodes: [],
      connections: {},
    },
    fetcher,
  });

  assert.deepEqual(calls, [
    "https://n8n.example.com/api/v1/workflows",
    "https://n8n.example.com/api/v1/workflows/42/activate",
  ]);
  assert.equal(result.externalId, "42");
  assert.equal(result.enabled, true);
});
