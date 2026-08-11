export type DeploymentReadinessConnection = {
  id: string;
  status: string;
  provider: {
    provider_key: string;
    category: string;
    supports_inbound: boolean;
  } | null;
};

export type DeploymentReadinessRequirement = {
  id: string;
  category: string | null;
  connectableToday: boolean;
};

function isConnected(connection: DeploymentReadinessConnection) {
  return connection.status === "connected";
}

export function integrationRequirementIsMet(
  requirement: DeploymentReadinessRequirement,
  connections: DeploymentReadinessConnection[],
): boolean {
  if (!requirement.connectableToday) {
    return true;
  }

  if (requirement.id === "lead_source") {
    return connections.some(
      (connection) =>
        isConnected(connection) && connection.provider?.supports_inbound,
    );
  }

  if (requirement.id === "phone") {
    return connections.some(
      (connection) =>
        isConnected(connection) &&
        (connection.provider?.category === "phone" ||
          connection.provider?.provider_key === "twilio"),
    );
  }

  if (requirement.id === "email" || requirement.id === "calendar") {
    return connections.some(
      (connection) =>
        isConnected(connection) &&
        (connection.provider?.category === requirement.category ||
          ["google_workspace", "microsoft_365"].includes(
            connection.provider?.provider_key ?? "",
          )),
    );
  }

  return connections.some(
    (connection) =>
      isConnected(connection) &&
      connection.provider?.category === requirement.category,
  );
}

export function missingIntegrationRequirements<
  Requirement extends DeploymentReadinessRequirement,
>(
  requirements: Requirement[],
  connections: DeploymentReadinessConnection[],
): Requirement[] {
  return requirements.filter(
    (requirement) =>
      requirement.connectableToday &&
      !integrationRequirementIsMet(requirement, connections),
  );
}
