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
  connectorRetryDelayMinutes,
  executeConnectorSyncJob,
} from "../lib/integrations/connectors/sync-executor.ts";

test("connector catalog has unique valid manifests", () => {
  assert.ok(CONNECTOR_CATALOG.length >= 20);
  assert.equal(new Set(CONNECTOR_CATALOG.map((item) => item.key)).size, CONNECTOR_CATALOG.length);

  for (const manifest of CONNECTOR_CATALOG) {
    assert.deepEqual(validateConnectorManifest(manifest), [], manifest.key);
  }
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
