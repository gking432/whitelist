import assert from "node:assert/strict";
import test from "node:test";

import { requirementsForPackage } from "../lib/packages/requirements.ts";

const packageWithCrmSync = {
  capabilities: {
    northstar_crm: true,
    crm_sync: true,
    lead_intake: true,
    appointment_booking: true,
  },
};

test("external-system clients retain the package CRM connection requirement", () => {
  const requirements = requirementsForPackage(packageWithCrmSync, {
    crmOperatingMode: "external_crm_only",
  });

  assert.equal(
    requirements.integrations.some((requirement) => requirement.id === "crm"),
    true,
  );
});

test("Northstar CRM clients do not require an external CRM connection", () => {
  const requirements = requirementsForPackage(packageWithCrmSync, {
    crmOperatingMode: "primary_crm",
  });

  assert.equal(
    requirements.integrations.some((requirement) => requirement.id === "crm"),
    false,
  );
  assert.equal(
    requirements.integrations.some(
      (requirement) => requirement.id === "calendar",
    ),
    false,
  );
  assert.equal(
    requirements.integrations.some(
      (requirement) => requirement.id === "lead_source",
    ),
    true,
  );
});
