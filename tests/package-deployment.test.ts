import assert from "node:assert/strict";
import test from "node:test";

import {
  integrationRequirementIsMet,
  missingIntegrationRequirements,
  type DeploymentReadinessConnection,
  type DeploymentReadinessRequirement,
} from "../lib/packages/deployment-readiness.ts";

const requirement = (
  values: Partial<DeploymentReadinessRequirement> = {},
): DeploymentReadinessRequirement => ({
  id: "crm",
  category: "crm",
  connectableToday: true,
  ...values,
});

const connection = (
  values: Partial<DeploymentReadinessConnection> & {
    category?: string;
    supportsInbound?: boolean;
  } = {},
): DeploymentReadinessConnection => ({
  id: values.id ?? "connection-1",
  status: values.status ?? "connected",
  provider:
    values.provider === null
      ? null
      : {
          provider_key: "test_provider",
          category: values.category ?? "crm",
          supports_inbound: values.supportsInbound ?? false,
          ...values.provider,
        },
});

test("a lead source requires a connected inbound-capable provider", () => {
  const leadSource = requirement({ id: "lead_source", category: null });

  assert.equal(
    integrationRequirementIsMet(leadSource, [
      connection({ category: "crm", supportsInbound: false }),
    ]),
    false,
  );
  assert.equal(
    integrationRequirementIsMet(leadSource, [
      connection({ category: "webhook", supportsInbound: true }),
    ]),
    true,
  );
});

test("needs-attention and disabled connections do not count as ready", () => {
  const crm = requirement();

  assert.equal(
    integrationRequirementIsMet(crm, [connection({ status: "needs_attention" })]),
    false,
  );
  assert.equal(
    integrationRequirementIsMet(crm, [connection({ status: "disabled" })]),
    false,
  );
});

test("provider categories satisfy their matching requirement", () => {
  const calendar = requirement({ id: "calendar", category: "calendar" });

  assert.equal(
    integrationRequirementIsMet(calendar, [connection({ category: "calendar" })]),
    true,
  );
  assert.equal(
    integrationRequirementIsMet(calendar, [connection({ category: "crm" })]),
    false,
  );
});

test("Twilio satisfies both phone and SMS requirements", () => {
  const twilio = connection({
    category: "sms",
    provider: {
      provider_key: "twilio",
      category: "sms",
      supports_inbound: true,
    },
  });

  assert.equal(
    integrationRequirementIsMet(
      requirement({ id: "phone", category: "phone" }),
      [twilio],
    ),
    true,
  );
  assert.equal(
    integrationRequirementIsMet(
      requirement({ id: "sms", category: "sms" }),
      [twilio],
    ),
    true,
  );
});

test("workspace suites satisfy both email and calendar requirements", () => {
  const workspace = connection({
    category: "productivity",
    provider: {
      provider_key: "google_workspace",
      category: "productivity",
      supports_inbound: false,
    },
  });

  assert.equal(
    integrationRequirementIsMet(
      requirement({ id: "email", category: "email" }),
      [workspace],
    ),
    true,
  );
  assert.equal(
    integrationRequirementIsMet(
      requirement({ id: "calendar", category: "calendar" }),
      [workspace],
    ),
    true,
  );
});

test("field-service systems satisfy the external CRM requirement", () => {
  assert.equal(
    integrationRequirementIsMet(requirement({ id: "crm", category: "crm" }), [
      connection({ category: "field_service", provider: { provider_key: "jobber", category: "field_service", supports_inbound: false } }),
    ]),
    true,
  );
});

test("readiness omits sold-ahead requirements that cannot connect yet", () => {
  const requirements = [
    requirement({ id: "crm", category: "crm" }),
    requirement({ id: "sms", category: "sms" }),
    requirement({
      id: "phone",
      category: "phone",
      connectableToday: false,
    }),
  ];

  assert.deepEqual(
    missingIntegrationRequirements(requirements, [connection({ category: "crm" })]),
    [requirements[1]],
  );
});
