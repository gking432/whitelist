import type {
  AutomationConnectionRequirement,
  AutomationPack,
} from "./catalog.ts";

export type AutomationConnection = {
  id: string;
  status: string;
  provider: {
    provider_key: string;
    category: string;
    supports_inbound: boolean;
  } | null;
};

export function connectionMeetsAutomationRequirement(
  requirement: AutomationConnectionRequirement,
  connection: AutomationConnection,
): boolean {
  if (connection.status !== "connected" || !connection.provider) {
    return false;
  }

  if (requirement.supportsInbound && connection.provider.supports_inbound) {
    return true;
  }

  if (requirement.providerKeys?.includes(connection.provider.provider_key)) {
    return true;
  }

  return Boolean(
    requirement.categories?.includes(connection.provider.category),
  );
}

export function missingAutomationConnections(
  pack: AutomationPack,
  connections: AutomationConnection[],
  options: { crmOperatingMode?: string | null } = {},
): AutomationConnectionRequirement[] {
  return pack.connectionRequirements.filter((requirement) => {
    if (
      requirement.key === "crm" &&
      options.crmOperatingMode === "primary_crm"
    ) {
      return false;
    }

    return !connections.some((connection) =>
      connectionMeetsAutomationRequirement(requirement, connection),
    );
  });
}

export function automationPackReadiness(
  pack: AutomationPack,
  connections: AutomationConnection[],
  options: { crmOperatingMode?: string | null } = {},
) {
  const missing = missingAutomationConnections(pack, connections, options);

  return {
    ready: missing.length === 0,
    requiredKeys: pack.connectionRequirements.map(
      (requirement) => requirement.key,
    ),
    missingKeys: missing.map((requirement) => requirement.key),
    missingLabels: missing.map((requirement) => requirement.label),
  };
}
