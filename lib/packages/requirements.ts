import {
  CAPABILITIES,
  enabledCapabilityKeys,
  type CapabilityKey,
  type CapabilityMeta,
  type IntegrationRequirement,
  type StaffRuntime,
} from "./capabilities.ts";

// Turns a package's capability toggles into the concrete setup checklist:
// which integrations to connect, which workflow templates to enable, what
// (if anything) client staff must install, and which sold capabilities are
// not fully real yet. Pure functions — callers supply connection/instance
// state from the database.

export type PartnerPackageRecord = {
  id: string;
  partner_id: string;
  client_id: string | null;
  name: string;
  description: string | null;
  capabilities: Record<string, unknown>;
  is_archived: boolean;
};

export type PackageRequirements = {
  capabilities: CapabilityMeta[];
  integrations: IntegrationRequirement[];
  workflowTemplateKeys: string[];
  staffRuntimes: StaffRuntime[];
  // Enabled capabilities that are preview/coming_soon, with honest notes.
  limitations: { capability: CapabilityMeta; note: string }[];
};

export function computePackageRequirements(
  capabilityKeys: CapabilityKey[],
): PackageRequirements {
  const capabilities = capabilityKeys.map((key) => CAPABILITIES[key]);

  const integrationsById = new Map<string, IntegrationRequirement>();
  const templateKeys = new Set<string>();
  const runtimes = new Set<StaffRuntime>();
  const limitations: PackageRequirements["limitations"] = [];

  for (const capability of capabilities) {
    for (const requirement of capability.requirements) {
      integrationsById.set(requirement.id, requirement);
    }

    for (const templateKey of capability.workflowTemplateKeys) {
      templateKeys.add(templateKey);
    }

    if (capability.staffRuntime !== "none") {
      runtimes.add(capability.staffRuntime);
    }

    if (capability.status !== "available" && capability.statusNote) {
      limitations.push({ capability, note: capability.statusNote });
    } else if (capability.status === "available" && capability.statusNote) {
      // Available capabilities can still carry an honest caveat.
      limitations.push({ capability, note: capability.statusNote });
    }
  }

  return {
    capabilities,
    integrations: [...integrationsById.values()],
    workflowTemplateKeys: [...templateKeys],
    staffRuntimes: [...runtimes],
    limitations,
  };
}

export function requirementsForPackage(
  record: Pick<PartnerPackageRecord, "capabilities">,
  options: { crmOperatingMode?: string } = {},
): PackageRequirements {
  const requirements = computePackageRequirements(
    enabledCapabilityKeys(record.capabilities),
  );

  if (options.crmOperatingMode !== "primary_crm") {
    return requirements;
  }

  return {
    ...requirements,
    integrations: requirements.integrations.filter(
      (requirement) => requirement.id !== "crm",
    ),
  };
}
