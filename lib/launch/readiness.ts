import {
  integrationRequirementIsMet,
  type DeploymentReadinessRequirement,
} from "../packages/deployment-readiness.ts";

export type LaunchConnection = {
  id: string;
  displayName: string;
  status: string;
  runtimeMode: string;
  credentialStatus: string;
  provider: {
    provider_key: string;
    category: string;
    supports_inbound: boolean;
  } | null;
};

export type LaunchWorkflow = {
  id: string;
  name: string;
  status: string;
  runtimeMode: string;
  templateKey: string;
  approvalRequired: boolean;
};

export type LaunchDeployment = {
  id: string;
  packageId: string | null;
  status: string;
};

export type LaunchEvidence = {
  id: string;
  deploymentId: string | null;
  status: string;
  passed: boolean;
} | null;

export type LaunchGate = {
  key: "deployment" | "workflows" | "connections" | "tests";
  label: string;
  passed: boolean;
  detail: string;
};

export type LaunchReadiness = {
  gates: LaunchGate[];
  blockers: string[];
  canRunTests: boolean;
  canGoLive: boolean;
  targetWorkflowIds: string[];
  targetConnectionIds: string[];
  missingWorkflowKeys: string[];
  missingIntegrationIds: string[];
  hasLiveRuntime: boolean;
};

function readyConnections(connections: LaunchConnection[]) {
  return connections.filter(
    (connection) =>
      connection.status === "connected" &&
      connection.credentialStatus === "configured",
  );
}

function matchingConnection(
  requirement: DeploymentReadinessRequirement,
  connections: LaunchConnection[],
): LaunchConnection | undefined {
  return connections.find((connection) =>
    integrationRequirementIsMet(requirement, [
      {
        id: connection.id,
        status: connection.status,
        provider: connection.provider,
      },
    ]),
  );
}

export function computeLaunchReadiness(input: {
  packageId: string | null;
  deployment: LaunchDeployment | null;
  requiredTemplateKeys: string[];
  integrationRequirements: DeploymentReadinessRequirement[];
  workflows: LaunchWorkflow[];
  connections: LaunchConnection[];
  evidence: LaunchEvidence;
  uncoveredTemplateKeys?: string[];
}): LaunchReadiness {
  const deploymentReady = Boolean(
    input.packageId &&
    input.deployment &&
    input.deployment.packageId === input.packageId &&
    ["ready", "needs_setup"].includes(input.deployment.status),
  );
  const workflowByKey = new Map(
    input.workflows.map((workflow) => [workflow.templateKey, workflow]),
  );
  const missingWorkflowKeys = input.requiredTemplateKeys.filter((key) => {
    const workflow = workflowByKey.get(key);
    return !workflow || workflow.status !== "active";
  });
  const targetWorkflows = input.requiredTemplateKeys
    .map((key) => workflowByKey.get(key))
    .filter((workflow): workflow is LaunchWorkflow => Boolean(workflow));
  const eligibleConnections = readyConnections(input.connections);
  const requiredIntegrations = input.integrationRequirements.filter(
    (requirement) => requirement.connectableToday,
  );
  const matchedConnections = requiredIntegrations.map((requirement) => ({
    requirement,
    connection: matchingConnection(requirement, eligibleConnections),
  }));
  const missingIntegrationIds = matchedConnections
    .filter(({ connection }) => !connection)
    .map(({ requirement }) => requirement.id);
  const targetConnectionIds = [
    ...new Set(
      matchedConnections
        .map(({ connection }) => connection?.id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const uncoveredTemplateKeys = input.uncoveredTemplateKeys ?? [];
  const workflowsReady =
    missingWorkflowKeys.length === 0 && uncoveredTemplateKeys.length === 0;
  const connectionsReady = missingIntegrationIds.length === 0;
  const testsReady = Boolean(
    input.evidence &&
    input.deployment &&
    input.evidence.deploymentId === input.deployment.id &&
    input.evidence.passed &&
    ["ready", "live"].includes(input.evidence.status),
  );
  const hasLiveRuntime =
    input.workflows.some((workflow) => workflow.runtimeMode === "live") ||
    input.connections.some((connection) => connection.runtimeMode === "live");
  const blockers: string[] = [];

  if (!deploymentReady) blockers.push("Deploy the assigned package.");
  if (missingWorkflowKeys.length > 0) {
    blockers.push(`Restore workflows: ${missingWorkflowKeys.join(", ")}.`);
  }
  if (uncoveredTemplateKeys.length > 0) {
    blockers.push(`Add launch tests for: ${uncoveredTemplateKeys.join(", ")}.`);
  }
  if (missingIntegrationIds.length > 0) {
    blockers.push(`Connect: ${missingIntegrationIds.join(", ")}.`);
  }
  if (!testsReady) blockers.push("Run and pass the final safety check.");

  const gates: LaunchGate[] = [
    {
      key: "deployment",
      label: "Package deployed",
      passed: deploymentReady,
      detail: deploymentReady
        ? "The current package has a sandbox deployment receipt."
        : "Assign and deploy a package from Setup.",
    },
    {
      key: "workflows",
      label: "Workflows ready",
      passed: workflowsReady,
      detail: workflowsReady
        ? `${targetWorkflows.length} required workflow${targetWorkflows.length === 1 ? " is" : "s are"} active.`
        : "One or more required workflows are missing or untested.",
    },
    {
      key: "connections",
      label: "Connections ready",
      passed: connectionsReady,
      detail: connectionsReady
        ? `${targetConnectionIds.length} required connection${targetConnectionIds.length === 1 ? " is" : "s are"} connected.`
        : `Missing: ${missingIntegrationIds.join(", ")}.`,
    },
    {
      key: "tests",
      label: "Final safety check passed",
      passed: testsReady,
      detail: testsReady
        ? "The latest deployment passed its package-derived scenarios."
        : "Run the final package-derived scenarios after feature verification.",
    },
  ];

  return {
    gates,
    blockers,
    canRunTests: deploymentReady && workflowsReady && !hasLiveRuntime,
    canGoLive:
      deploymentReady && workflowsReady && connectionsReady && testsReady,
    targetWorkflowIds: targetWorkflows.map((workflow) => workflow.id),
    targetConnectionIds,
    missingWorkflowKeys,
    missingIntegrationIds,
    hasLiveRuntime,
  };
}
