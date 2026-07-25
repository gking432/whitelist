import type { SupabaseClient } from "@supabase/supabase-js";

import {
  computeLaunchReadiness,
  type LaunchConnection,
  type LaunchDeployment,
  type LaunchWorkflow,
} from "@/lib/launch/readiness";
import { buildLaunchTestPlan } from "@/lib/launch/test-plan";
import {
  requirementsForPackage,
  type PackageRequirements,
  type PartnerPackageRecord,
} from "@/lib/packages/requirements";

export type ClientLaunchRow = {
  id: string;
  package_id: string | null;
  deployment_id: string | null;
  status: "testing" | "blocked" | "ready" | "live" | "rolled_back" | "failed";
  readiness_snapshot: Record<string, unknown>;
  test_summary: Record<string, unknown>;
  error_message: string | null;
  tests_completed_at: string | null;
  launched_at: string | null;
  rolled_back_at: string | null;
  created_at: string;
};

export type LaunchTestRunRow = {
  id: string;
  scenario_key: string;
  scenario_title: string;
  status: "running" | "passed" | "failed";
  result: Record<string, unknown>;
  error_message: string | null;
  completed_at: string | null;
};

export type ClientLaunchContext = {
  client: {
    id: string;
    name: string;
    packageId: string | null;
    defaultRuntimeMode: string;
    crmOperatingMode: string;
  };
  package: PartnerPackageRecord | null;
  requirements: PackageRequirements | null;
  deployment: LaunchDeployment | null;
  workflows: LaunchWorkflow[];
  connections: LaunchConnection[];
  latestLaunch: ClientLaunchRow | null;
  latestTestRuns: LaunchTestRunRow[];
  testPlan: ReturnType<typeof buildLaunchTestPlan>;
  readiness: ReturnType<typeof computeLaunchReadiness>;
};

export async function loadClientLaunchContext(
  supabase: SupabaseClient,
  input: { partnerId: string; clientId: string },
): Promise<ClientLaunchContext> {
  const { data: client, error: clientError } = await supabase
    .from("client_businesses")
    .select("id, name, package_id, default_runtime_mode, crm_operating_mode")
    .eq("id", input.clientId)
    .eq("partner_id", input.partnerId)
    .maybeSingle();

  if (clientError || !client) {
    throw new Error("The client launch context could not be loaded.");
  }

  const [packageResult, deploymentResult, workflowResult, connectionResult, launchResult] =
    await Promise.all([
      client.package_id
        ? supabase
            .from("partner_packages")
            .select("*")
            .eq("id", client.package_id)
            .eq("partner_id", input.partnerId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      client.package_id
        ? supabase
            .from("client_package_deployments")
            .select("id, package_id, status")
            .eq("client_id", input.clientId)
            .eq("package_id", client.package_id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("client_workflow_instances")
        .select(
          "id, name, status, runtime_mode, approval_policy, template:workflow_templates(template_key)",
        )
        .eq("client_id", input.clientId)
        .eq("partner_id", input.partnerId),
      supabase
        .from("integration_connections")
        .select(
          "id, display_name, status, runtime_mode, credential_status, provider:integration_providers(provider_key, category, supports_inbound)",
        )
        .eq("client_id", input.clientId)
        .eq("partner_id", input.partnerId)
        .neq("status", "disabled"),
      supabase
        .from("client_launches")
        .select(
          "id, package_id, deployment_id, status, readiness_snapshot, test_summary, error_message, tests_completed_at, launched_at, rolled_back_at, created_at",
        )
        .eq("client_id", input.clientId)
        .eq("partner_id", input.partnerId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (
    packageResult.error ||
    deploymentResult.error ||
    workflowResult.error ||
    connectionResult.error ||
    launchResult.error
  ) {
    throw new Error("One or more launch checks could not be loaded.");
  }

  const pkg = (packageResult.data as PartnerPackageRecord | null) ?? null;
  const requirements = pkg ? requirementsForPackage(pkg) : null;
  const rawWorkflows = (workflowResult.data ?? []) as unknown as {
    id: string;
    name: string;
    status: string;
    runtime_mode: string;
    approval_policy: Record<string, unknown> | null;
    template: { template_key: string } | null;
  }[];
  const workflows: LaunchWorkflow[] = rawWorkflows
    .filter((workflow) => workflow.template)
    .map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      status: workflow.status,
      runtimeMode: workflow.runtime_mode,
      templateKey: workflow.template!.template_key,
      approvalRequired: workflow.approval_policy?.requires_approval === true,
    }));
  const connections: LaunchConnection[] = (
    (connectionResult.data ?? []) as unknown as {
      id: string;
      display_name: string;
      status: string;
      runtime_mode: string;
      credential_status: string;
      provider: LaunchConnection["provider"];
    }[]
  ).map((connection) => ({
    id: connection.id,
    displayName: connection.display_name,
    status: connection.status,
    runtimeMode: connection.runtime_mode,
    credentialStatus: connection.credential_status,
    provider: connection.provider,
  }));
  const deploymentData = deploymentResult.data as {
    id: string;
    package_id: string | null;
    status: string;
  } | null;
  const deployment: LaunchDeployment | null = deploymentData
    ? {
        id: deploymentData.id,
        packageId: deploymentData.package_id,
        status: deploymentData.status,
      }
    : null;
  const latestLaunch =
    (launchResult.data as ClientLaunchRow | null) ?? null;
  const testPlan = buildLaunchTestPlan(
    requirements?.workflowTemplateKeys ?? [],
  );
  const evidence = latestLaunch
    ? {
        id: latestLaunch.id,
        deploymentId: latestLaunch.deployment_id,
        status: latestLaunch.status,
        passed: latestLaunch.test_summary.passed === true,
      }
    : null;
  const readiness = computeLaunchReadiness({
    packageId: client.package_id,
    deployment,
    requiredTemplateKeys: requirements?.workflowTemplateKeys ?? [],
    integrationRequirements: requirements?.integrations ?? [],
    workflows,
    connections,
    evidence,
    uncoveredTemplateKeys: testPlan.uncoveredTemplateKeys,
  });
  const { data: testRuns, error: testRunsError } = latestLaunch
    ? await supabase
        .from("client_launch_test_runs")
        .select(
          "id, scenario_key, scenario_title, status, result, error_message, completed_at",
        )
        .eq("launch_id", latestLaunch.id)
        .order("started_at", { ascending: true })
    : { data: [], error: null };

  if (testRunsError) {
    throw new Error("The latest package test details could not be loaded.");
  }

  return {
    client: {
      id: client.id,
      name: client.name,
      packageId: client.package_id,
      defaultRuntimeMode: client.default_runtime_mode,
      crmOperatingMode: client.crm_operating_mode,
    },
    package: pkg,
    requirements,
    deployment,
    workflows,
    connections,
    latestLaunch,
    latestTestRuns: (testRuns ?? []) as LaunchTestRunRow[],
    testPlan,
    readiness,
  };
}
