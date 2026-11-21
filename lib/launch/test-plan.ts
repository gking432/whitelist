export type LaunchScenarioPlan = {
  scenarioKey: string;
  expectedTemplateKeys: string[];
};

const SCENARIO_COVERAGE = [
  {
    scenarioKey: "missed_call",
    templateKeys: ["new_lead_intake", "ai_intake_router", "missed_call_rescue"],
    requiredTemplateKey: "missed_call_rescue",
  },
  {
    scenarioKey: "website_lead",
    templateKeys: ["new_lead_intake", "ai_intake_router"],
    requiredTemplateKey: null,
  },
  {
    scenarioKey: "estimate_follow_up",
    templateKeys: ["estimate_follow_up"],
    requiredTemplateKey: null,
  },
  {
    scenarioKey: "appointment_reminder",
    templateKeys: ["appointment_reminder"],
    requiredTemplateKey: null,
  },
  {
    scenarioKey: "job_completed",
    templateKeys: ["review_request"],
    requiredTemplateKey: null,
  },
  {
    scenarioKey: "provider_failure",
    templateKeys: ["sync_failure_alert"],
    requiredTemplateKey: null,
  },
] as const;

export function buildLaunchTestPlan(requiredTemplateKeys: string[]): {
  scenarios: LaunchScenarioPlan[];
  uncoveredTemplateKeys: string[];
} {
  const remaining = new Set(requiredTemplateKeys);
  const scenarios: LaunchScenarioPlan[] = [];

  for (const scenario of SCENARIO_COVERAGE) {
    if (
      scenario.requiredTemplateKey &&
      !remaining.has(scenario.requiredTemplateKey)
    ) {
      continue;
    }

    const expectedTemplateKeys = scenario.templateKeys.filter((key) =>
      remaining.has(key),
    );

    if (expectedTemplateKeys.length === 0) {
      continue;
    }

    scenarios.push({
      scenarioKey: scenario.scenarioKey,
      expectedTemplateKeys,
    });
    expectedTemplateKeys.forEach((key) => remaining.delete(key));
  }

  return {
    scenarios,
    uncoveredTemplateKeys: [...remaining],
  };
}
