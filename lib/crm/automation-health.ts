export type AutomationWorkflow = {
  id: string;
  name: string;
  status: string;
  runtime_mode: string;
  health_status: string;
  last_run_at: string | null;
  template: {
    name?: string;
    description?: string | null;
    category?: string;
    risk_level?: string;
    required_provider_categories?: string[];
  } | null;
};

export type AutomationRun = {
  id: string;
  workflow_instance_id: string;
  status: string;
  summary: string | null;
  error_message: string | null;
  requires_approval: boolean;
  created_at: string;
  finished_at: string | null;
};

export type AutomationConnection = {
  id: string;
  display_name: string;
  status: string;
  runtime_mode: string;
  provider: {
    provider_key?: string;
    display_name?: string;
    category?: string;
  } | null;
};

export type AutomationHealthItem = {
  workflow: AutomationWorkflow;
  connections: AutomationConnection[];
  missingProviderCategories: string[];
  latestRun: AutomationRun | null;
  latestSuccess: AutomationRun | null;
  latestFailure: AutomationRun | null;
  recentRunCount: number;
  recentSuccessCount: number;
  recentFailureCount: number;
  state: "healthy" | "ready" | "needs_attention" | "inactive";
};

export type AutomationHealthSummary = {
  items: AutomationHealthItem[];
  installedCount: number;
  activeCount: number;
  healthyCount: number;
  needsAttentionCount: number;
  recentRunCount: number;
  recentSuccessCount: number;
  successRate: number | null;
};

const FAILURE_STATES = new Set(["failed", "cancelled"]);
const UNHEALTHY_STATES = new Set([
  "failing",
  "degraded",
  "needs_attention",
]);
const CONNECTED_STATES = new Set(["connected", "active", "healthy"]);

function newest(runs: AutomationRun[]): AutomationRun | null {
  return runs.reduce<AutomationRun | null>((latest, run) => {
    if (!latest) return run;
    return new Date(run.created_at).getTime() >
      new Date(latest.created_at).getTime()
      ? run
      : latest;
  }, null);
}

export function buildAutomationHealth(
  workflows: AutomationWorkflow[],
  runs: AutomationRun[],
  connections: AutomationConnection[],
  now = new Date(),
): AutomationHealthSummary {
  const recentCutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const runsByWorkflow = new Map<string, AutomationRun[]>();

  for (const run of runs) {
    const group = runsByWorkflow.get(run.workflow_instance_id) ?? [];
    group.push(run);
    runsByWorkflow.set(run.workflow_instance_id, group);
  }

  const items = workflows.map((workflow): AutomationHealthItem => {
    const workflowRuns = runsByWorkflow.get(workflow.id) ?? [];
    const recentRuns = workflowRuns.filter(
      (run) => new Date(run.created_at).getTime() >= recentCutoff,
    );
    const requiredCategories = [
      ...new Set(workflow.template?.required_provider_categories ?? []),
    ];
    const matchedConnections = connections.filter((connection) =>
      requiredCategories.includes(connection.provider?.category ?? ""),
    );
    const missingProviderCategories = requiredCategories.filter(
      (category) =>
        !matchedConnections.some(
          (connection) =>
            connection.provider?.category === category &&
            CONNECTED_STATES.has(connection.status),
        ),
    );
    const latestRun = newest(workflowRuns);
    const latestSuccess = newest(
      workflowRuns.filter((run) => run.status === "succeeded"),
    );
    const latestFailure = newest(
      workflowRuns.filter((run) => FAILURE_STATES.has(run.status)),
    );
    const latestFailureIsCurrent =
      latestFailure &&
      (!latestSuccess ||
        new Date(latestFailure.created_at).getTime() >
          new Date(latestSuccess.created_at).getTime());

    let state: AutomationHealthItem["state"] = "ready";
    if (workflow.status !== "active") {
      state = "inactive";
    } else if (
      missingProviderCategories.length > 0 ||
      UNHEALTHY_STATES.has(workflow.health_status) ||
      latestFailureIsCurrent
    ) {
      state = "needs_attention";
    } else if (
      workflow.health_status === "healthy" ||
      workflow.health_status === "ok" ||
      latestSuccess
    ) {
      state = "healthy";
    }

    return {
      workflow,
      connections: matchedConnections,
      missingProviderCategories,
      latestRun,
      latestSuccess,
      latestFailure,
      recentRunCount: recentRuns.length,
      recentSuccessCount: recentRuns.filter(
        (run) => run.status === "succeeded",
      ).length,
      recentFailureCount: recentRuns.filter((run) =>
        FAILURE_STATES.has(run.status),
      ).length,
      state,
    };
  });

  const recentRuns = runs.filter(
    (run) => new Date(run.created_at).getTime() >= recentCutoff,
  );
  const recentSuccessCount = recentRuns.filter(
    (run) => run.status === "succeeded",
  ).length;
  const recentFailureCount = recentRuns.filter((run) =>
    FAILURE_STATES.has(run.status),
  ).length;
  const completedCount = recentSuccessCount + recentFailureCount;

  return {
    items,
    installedCount: items.length,
    activeCount: items.filter((item) => item.workflow.status === "active")
      .length,
    healthyCount: items.filter((item) => item.state === "healthy").length,
    needsAttentionCount: items.filter(
      (item) => item.state === "needs_attention",
    ).length,
    recentRunCount: recentRuns.length,
    recentSuccessCount,
    successRate:
      completedCount > 0
        ? Math.round((recentSuccessCount / completedCount) * 100)
        : null,
  };
}
