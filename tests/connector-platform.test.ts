import assert from "node:assert/strict";
import test from "node:test";

import { CONNECTOR_CATALOG } from "../lib/integrations/connectors/catalog.ts";
import {
  validateCanonicalRecord,
  validateConnectorAdapter,
  validateConnectorManifest,
} from "../lib/integrations/connectors/contract.ts";
import {
  clearConnectorRegistryForTests,
  getConnector,
  registerConnector,
} from "../lib/integrations/connectors/registry.ts";
import type { ConnectorAdapter } from "../lib/integrations/connectors/types.ts";
import {
  listConnectorAdapters,
  NATIVE_CONNECTOR_CAPABILITIES,
} from "../lib/integrations/connectors/adapters.ts";
import {
  connectorRetryDelayMinutes,
  executeConnectorSyncJob,
} from "../lib/integrations/connectors/sync-executor.ts";
import { planLeadConnectorWriteback } from "../lib/integrations/connectors/writeback.ts";
import { quickBooksOnlineAdapter, mapQuickBooksCustomer } from "../lib/integrations/providers/quickbooks-online.ts";
import { stripeAdapter } from "../lib/integrations/providers/stripe.ts";
import { squareAdapter } from "../lib/integrations/providers/square.ts";
import { callRailAdapter } from "../lib/integrations/providers/callrail.ts";
import { ringCentralAdapter } from "../lib/integrations/providers/ringcentral.ts";
import { dialpadAdapter } from "../lib/integrations/providers/dialpad.ts";
import { openPhoneAdapter } from "../lib/integrations/providers/openphone.ts";
import { metaAdapter } from "../lib/integrations/providers/meta.ts";
import { googleAdsAdapter } from "../lib/integrations/providers/google-ads.ts";
import { googleBusinessProfileAdapter } from "../lib/integrations/providers/google-business-profile.ts";
import { podiumAdapter } from "../lib/integrations/providers/podium.ts";
import { birdeyeAdapter } from "../lib/integrations/providers/birdeye.ts";

test("connector catalog has unique valid manifests", () => {
  assert.ok(CONNECTOR_CATALOG.length >= 20);
  assert.equal(new Set(CONNECTOR_CATALOG.map((item) => item.key)).size, CONNECTOR_CATALOG.length);

  for (const manifest of CONNECTOR_CATALOG) {
    assert.deepEqual(validateConnectorManifest(manifest), [], manifest.key);
  }
});

test("every verified catalog capability has an executable implementation", () => {
  const adapters = new Map(
    listConnectorAdapters().map((adapter) => [adapter.manifest.key, adapter]),
  );

  for (const manifest of CONNECTOR_CATALOG) {
    if (manifest.verificationStatus !== "contract_verified") continue;

    const adapter = adapters.get(manifest.key);

    if (adapter) {
      assert.deepEqual(validateConnectorAdapter(adapter), [], manifest.key);
      assert.deepEqual(
        [...adapter.manifest.capabilities].sort(),
        [...manifest.capabilities].sort(),
        `${manifest.key} catalog and adapter capabilities differ`,
      );
      continue;
    }

    const nativeCapabilities =
      NATIVE_CONNECTOR_CAPABILITIES[
        manifest.key as keyof typeof NATIVE_CONNECTOR_CAPABILITIES
      ];

    assert.ok(nativeCapabilities, `${manifest.key} has no executable implementation`);
    assert.deepEqual(
      [...nativeCapabilities].sort(),
      [...manifest.capabilities].sort(),
      `${manifest.key} catalog and native capabilities differ`,
    );
  }
});

test("workspace connectors expose contacts, calendar, and mail capabilities", () => {
  for (const key of ["google_workspace", "microsoft_365"]) {
    const connector = CONNECTOR_CATALOG.find((item) => item.key === key);
    assert.ok(connector, `${key} is in the catalog`);
    assert.equal(connector.authStrategy, "oauth2");
    assert.equal(connector.verificationStatus, "contract_verified");
    assert.ok(connector.capabilities.includes("customer.read"));
    assert.ok(connector.capabilities.includes("appointment.create"));
    assert.ok(connector.capabilities.includes("message.create"));
  }
});

test("field-service launch connectors have executable contracts", () => {
  for (const key of ["jobber", "housecall_pro", "servicetitan", "workiz"]) {
    const connector = CONNECTOR_CATALOG.find((item) => item.key === key);
    assert.ok(connector, `${key} is in the catalog`);
    assert.equal(connector.verificationStatus, "contract_verified");
    assert.ok(connector.capabilities.some((capability) => capability.endsWith(".read")));
  }
});

test("finance and attribution connectors have executable contracts", () => {
  for (const key of ["quickbooks_online", "stripe", "square", "callrail"]) {
    const connector = CONNECTOR_CATALOG.find((item) => item.key === key);
    assert.ok(connector, `${key} is in the catalog`);
    assert.equal(connector.verificationStatus, "contract_verified");
    assert.ok(connector.capabilities.some((capability) => capability.endsWith(".read")));
  }
  for (const adapter of [quickBooksOnlineAdapter, stripeAdapter, squareAdapter, callRailAdapter]) {
    assert.deepEqual(validateConnectorAdapter(adapter), [], adapter.manifest.key);
  }
});

test("retained phone connectors expose real call and message contracts", () => {
  for (const adapter of [ringCentralAdapter, dialpadAdapter, openPhoneAdapter]) {
    const connector = CONNECTOR_CATALOG.find((item) => item.key === adapter.manifest.key);
    assert.ok(connector, `${adapter.manifest.key} is in the catalog`);
    assert.equal(connector.verificationStatus, "contract_verified");
    assert.ok(connector.capabilities.includes("lead.webhook"));
    assert.ok(connector.capabilities.includes("message.webhook"));
    assert.deepEqual(validateConnectorAdapter(adapter), [], adapter.manifest.key);
  }
});

test("marketing and reputation connectors expose executable contracts", () => {
  for (const adapter of [metaAdapter, googleAdsAdapter, googleBusinessProfileAdapter, podiumAdapter, birdeyeAdapter]) {
    const connector = CONNECTOR_CATALOG.find((item) => item.key === adapter.manifest.key);
    assert.ok(connector, `${adapter.manifest.key} is in the catalog`);
    assert.equal(connector.verificationStatus, "contract_verified");
    assert.deepEqual(validateConnectorAdapter(adapter), [], adapter.manifest.key);
  }
  assert.equal(CONNECTOR_CATALOG.find((item) => item.key === "universal_lead_email")?.verificationStatus, "contract_verified");
  for (const key of ["angi", "thumbtack", "yelp"]) assert.equal(CONNECTOR_CATALOG.find((item) => item.key === key)?.verificationStatus, "restricted");
});

test("QuickBooks customers map into the shared CRM contact shape", () => {
  const mapped = mapQuickBooksCustomer({
    Id: "42",
    DisplayName: "Acme Plumbing",
    PrimaryEmailAddr: { Address: "office@acme.test" },
    PrimaryPhone: { FreeFormNumber: "+13125550100" },
    MetaData: { LastUpdatedTime: "2026-08-11T12:00:00Z" },
  });
  assert.equal(mapped.objectType, "customer");
  assert.equal(mapped.externalId, "42");
  assert.equal(mapped.data.email, "office@acme.test");
  assert.equal(mapped.data.phone, "+13125550100");
});

test("available adapters must implement the operations they advertise", () => {
  const adapter = {
    manifest: {
      key: "broken_crm",
      name: "Broken CRM",
      category: "crm",
      description: "Contract fixture.",
      authStrategy: "api_key",
      capabilities: ["customer.read", "customer.create"],
      verificationStatus: "contract_verified",
      requestable: false,
    },
    async testConnection() {
      return { ok: true, detail: "ok" };
    },
  } satisfies ConnectorAdapter;

  const fields = validateConnectorAdapter(adapter).map((issue) => issue.field);
  assert.deepEqual(fields, ["pullPage", "pushRecord"]);
});

test("canonical records reject missing ids and invalid timestamps", () => {
  const issues = validateCanonicalRecord({
    objectType: "customer",
    externalId: " ",
    updatedAt: "not-a-date",
    data: {},
    source: {},
  });

  assert.deepEqual(
    issues.map((issue) => issue.field),
    ["externalId", "updatedAt"],
  );
});

test("registry rejects invalid adapters and duplicate keys", () => {
  clearConnectorRegistryForTests();
  const adapter = {
    manifest: {
      key: "fixture",
      name: "Fixture",
      category: "crm",
      description: "Valid registry fixture.",
      authStrategy: "api_key",
      capabilities: [],
      verificationStatus: "planned",
      requestable: true,
    },
    async testConnection() {
      return { ok: true, detail: "ok" };
    },
  } satisfies ConnectorAdapter;

  registerConnector(adapter);
  assert.equal(getConnector("fixture"), adapter);
  assert.throws(() => registerConnector(adapter), /already registered/);
  clearConnectorRegistryForTests();
});

test("sync executor validates and stores pulled canonical records", async () => {
  const saved: string[] = [];
  let cursor: Record<string, unknown> | null = null;
  const adapter = {
    manifest: {
      key: "pull_fixture",
      name: "Pull fixture",
      category: "crm",
      description: "Pull contract fixture.",
      authStrategy: "api_key",
      capabilities: ["customer.read"],
      verificationStatus: "contract_verified",
      requestable: false,
    },
    async testConnection() {
      return { ok: true, detail: "ok" };
    },
    async pullPage() {
      return {
        records: [
          {
            objectType: "customer",
            externalId: "external-1",
            data: { name: "Jamie" },
            source: { id: "external-1", name: "Jamie" },
          },
        ],
        nextCursor: { after: "external-1" },
      };
    },
  } satisfies ConnectorAdapter;

  const outcome = await executeConnectorSyncJob({
    adapter,
    context: {
      connectionId: "connection",
      partnerId: "partner",
      clientId: "client",
      credentials: {},
      config: {},
    },
    job: {
      id: "job",
      direction: "pull",
      objectType: "customer",
      operation: "sync",
      attempts: 0,
      maxAttempts: 5,
      payload: {},
    },
    repository: {
      async saveCanonicalRecord(record) {
        saved.push(record.externalId);
      },
      async saveCursor(next) {
        cursor = next;
      },
      async saveObjectLink() {},
    },
  });

  assert.equal(outcome.ok, true);
  assert.deepEqual(saved, ["external-1"]);
  assert.deepEqual(cursor, { after: "external-1" });
});

test("sync executor rejects malformed push jobs without calling provider", async () => {
  let pushed = false;
  const adapter = {
    manifest: {
      key: "push_fixture",
      name: "Push fixture",
      category: "crm",
      description: "Push contract fixture.",
      authStrategy: "api_key",
      capabilities: ["customer.create"],
      verificationStatus: "contract_verified",
      requestable: false,
    },
    async testConnection() {
      return { ok: true, detail: "ok" };
    },
    async pushRecord() {
      pushed = true;
      return { externalObjectId: "created" };
    },
  } satisfies ConnectorAdapter;

  const outcome = await executeConnectorSyncJob({
    adapter,
    context: {
      connectionId: "connection",
      partnerId: "partner",
      clientId: "client",
      credentials: {},
      config: {},
    },
    job: {
      id: "job",
      direction: "push",
      objectType: "customer",
      operation: "create",
      attempts: 0,
      maxAttempts: 5,
      payload: {},
    },
    repository: {
      async saveCanonicalRecord() {},
      async saveCursor() {},
      async saveObjectLink() {},
    },
  });

  assert.equal(outcome.ok, false);
  assert.equal(pushed, false);
  assert.equal(connectorRetryDelayMinutes(0), 1);
  assert.equal(connectorRetryDelayMinutes(20), 60);
});

test("sync executor refuses push operations outside the provider contract", async () => {
  let pushed = false;
  const adapter = {
    manifest: {
      key: "customer_only_fixture",
      name: "Customer-only fixture",
      category: "crm",
      description: "Push contract fixture.",
      authStrategy: "api_key",
      capabilities: ["customer.create"],
      verificationStatus: "contract_verified",
      requestable: false,
    },
    async testConnection() {
      return { ok: true, detail: "ok" };
    },
    async pushRecord() {
      pushed = true;
      return { externalObjectId: "created" };
    },
  } satisfies ConnectorAdapter;

  const outcome = await executeConnectorSyncJob({
    adapter,
    context: {
      connectionId: "connection",
      partnerId: "partner",
      clientId: "client",
      credentials: {},
      config: {},
    },
    job: {
      id: "job",
      direction: "push",
      objectType: "lead",
      operation: "create",
      attempts: 0,
      maxAttempts: 5,
      payload: {
        nativeObjectId: "lead",
        idempotencyKey: "lead-create",
        data: { phone: "+13125550100" },
      },
    },
    repository: {
      async saveCanonicalRecord() {},
      async saveCursor() {},
      async saveObjectLink() {},
    },
  });

  assert.equal(outcome.ok, false);
  assert.equal(pushed, false);
  if (!outcome.ok) assert.match(outcome.error, /lead\.create/);
});

test("lead write-back chooses the operation supported by the connected system", () => {
  const lead = planLeadConnectorWriteback({
    providerKey: "servicetitan",
    capabilities: ["customer.read", "lead.create"],
    workflowRunId: "run-1",
    leadId: "lead-1",
    eventType: "call.completed",
    eventData: { name: "Jamie Rivera", phone: "+13125550100" },
    runSummary: "Needs an HVAC estimate.",
  });
  assert.equal(lead?.objectType, "lead");
  assert.equal(lead?.nativeObjectId, "lead-1");
  assert.equal(lead?.data.first_name, "Jamie");

  const customer = planLeadConnectorWriteback({
    providerKey: "jobber",
    capabilities: ["customer.create", "job.read"],
    workflowRunId: "run-2",
    contactId: "contact-1",
    eventType: "form.submitted",
    eventData: { email: "jamie@example.test" },
    runSummary: "Requested service.",
  });
  assert.equal(customer?.objectType, "customer");
  assert.equal(customer?.nativeObjectId, "contact-1");
  assert.equal(customer?.idempotencyKey, "workflow-run-2-customer-create");
});

test("lead write-back refuses records without a stable customer identifier", () => {
  assert.equal(
    planLeadConnectorWriteback({
      providerKey: "workiz",
      capabilities: ["lead.create"],
      workflowRunId: "run-3",
      eventType: "chat.received",
      eventData: { name: "Anonymous" },
      runSummary: "No reply path.",
    }),
    null,
  );
});
