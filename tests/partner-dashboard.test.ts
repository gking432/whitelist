import assert from "node:assert/strict";
import test from "node:test";

import { operationalClients } from "../lib/dashboard/client-visibility.ts";
import {
  deliveryStageHref,
  resolvePartnerDeliveryStage,
} from "../lib/dashboard/partner-delivery.ts";

const baseClient = {
  packageId: "package-1",
  runtimeMode: "sandbox",
  clientStatus: "onboarding" as const,
  launchStatus: null,
  deploymentStatus: "ready",
};

test("partner delivery starts with package selection", () => {
  assert.equal(
    resolvePartnerDeliveryStage({ ...baseClient, packageId: null }),
    "package",
  );
});

test("a packaged client without a ready deployment remains in setup", () => {
  assert.equal(
    resolvePartnerDeliveryStage({
      ...baseClient,
      deploymentStatus: null,
    }),
    "setup",
  );
});

test("a ready package deployment moves a client into testing", () => {
  assert.equal(resolvePartnerDeliveryStage(baseClient), "test");
});

test("successful test evidence moves a client to launch", () => {
  assert.equal(
    resolvePartnerDeliveryStage({ ...baseClient, launchStatus: "ready" }),
    "launch",
  );
});

test("a live launch or live client runtime is shown as live", () => {
  assert.equal(
    resolvePartnerDeliveryStage({ ...baseClient, launchStatus: "live" }),
    "live",
  );
  assert.equal(
    resolvePartnerDeliveryStage({
      ...baseClient,
      clientStatus: "active",
      runtimeMode: "live",
    }),
    "live",
  );
});

test("each delivery stage opens the workspace that owns the next action", () => {
  const clientId = "client-1";

  assert.equal(
    deliveryStageHref(clientId, "package"),
    `/partner/clients/${clientId}/setup`,
  );
  assert.equal(
    deliveryStageHref(clientId, "setup"),
    `/partner/clients/${clientId}/setup`,
  );
  assert.equal(
    deliveryStageHref(clientId, "test"),
    `/partner/clients/${clientId}/test-center`,
  );
  assert.equal(
    deliveryStageHref(clientId, "launch"),
    `/partner/clients/${clientId}/launch`,
  );
  assert.equal(
    deliveryStageHref(clientId, "live"),
    `/partner/clients/${clientId}/runs`,
  );
});

test("partner operations exclude isolated test accounts", () => {
  const clients = [
    {
      id: "client-live",
      partner_id: "partner-1",
      name: "Real Client",
      status: "active" as const,
      industry: "Plumbing",
      crm_operating_mode: "primary_crm",
      default_runtime_mode: "live",
      client_portal_enabled: true,
      is_test_account: false,
      package_id: "package-1",
      updated_at: "2026-08-12T00:00:00.000Z",
    },
    {
      id: "client-lab",
      partner_id: "partner-1",
      name: "Scenario Lab",
      status: "onboarding" as const,
      industry: "Testing",
      crm_operating_mode: "primary_crm",
      default_runtime_mode: "sandbox",
      client_portal_enabled: false,
      is_test_account: true,
      package_id: null,
      updated_at: "2026-08-12T00:00:00.000Z",
    },
  ];

  assert.deepEqual(
    operationalClients(clients).map((client) => client.id),
    ["client-live"],
  );
});
