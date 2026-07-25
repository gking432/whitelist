"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import type { FormState } from "@/lib/forms/state";
import { loadClientLaunchContext } from "@/lib/launch/context";
import {
  isAccessError,
  requireClientWorkspaceAccess,
} from "@/lib/permissions/access";
import { PARTNER_OPERATOR_ROLES } from "@/lib/permissions/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getLabScenario } from "@/lib/testing/scenarios";
import { runClientLaunchScenario } from "@/lib/testing/scenario-runner";

function errorState(error: unknown): FormState {
  if (isAccessError(error)) {
    return {
      status: "error",
      message:
        error.code === "ACCESS_DENIED"
          ? "You do not have permission to manage this launch."
          : "Launch Control is unavailable right now.",
    };
  }

  return {
    status: "error",
    message: error instanceof Error ? error.message : "The launch action failed.",
  };
}

async function requireLaunchAccess(clientId: string) {
  const authState = await getAuthState();

  if (!authState.user) {
    throw new Error("Sign in to use Launch Control.");
  }

  const access = await requireClientWorkspaceAccess(
    authState.user.id,
    clientId,
    PARTNER_OPERATOR_ROLES,
  );
  const admin = createSupabaseAdminClient();

  if (!admin || !access.partnerId) {
    throw new Error("The data service is unavailable.");
  }

  return { user: authState.user, access, admin };
}

function readinessSnapshot(
  readiness: Awaited<
    ReturnType<typeof loadClientLaunchContext>
  >["readiness"],
) {
  return {
    gates: readiness.gates,
    blockers: readiness.blockers,
    target_workflow_ids: readiness.targetWorkflowIds,
    target_connection_ids: readiness.targetConnectionIds,
    checked_at: new Date().toISOString(),
  };
}

function refreshLaunchPaths(clientId: string) {
  revalidatePath(`/partner/clients/${clientId}`, "layout");
  revalidatePath(`/partner/clients/${clientId}/launch`);
}

export async function runPackageTests(
  clientId: string,
  _previousState: FormState,
  _formData: FormData,
): Promise<FormState> {
  let launchId: string | null = null;

  try {
    const { user, access, admin } = await requireLaunchAccess(clientId);
    const context = await loadClientLaunchContext(admin, {
      partnerId: access.partnerId!,
      clientId,
    });

    if (!context.package || !context.deployment) {
      return {
        status: "error",
        message: "Deploy an assigned package before running launch tests.",
      };
    }

    if (!context.readiness.canRunTests) {
      return {
        status: "error",
        message:
          context.readiness.blockers.find(
            (blocker) => !blocker.startsWith("Connect:") && !blocker.startsWith("Run and pass"),
          ) ?? "Resolve the launch blockers before running tests.",
      };
    }

    const { data: launch, error: launchError } = await admin
      .from("client_launches")
      .insert({
        partner_id: access.partnerId,
        client_id: clientId,
        package_id: context.package.id,
        deployment_id: context.deployment.id,
        status: "testing",
        readiness_snapshot: readinessSnapshot(context.readiness),
        test_summary: {
          passed: false,
          completed: 0,
          total: context.testPlan.scenarios.length,
        },
        target_workflow_ids: context.readiness.targetWorkflowIds,
        target_connection_ids: context.readiness.targetConnectionIds,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (launchError || !launch) {
      throw new Error("The package test run could not be started.");
    }

    launchId = launch.id;
    const scenarioResults: { key: string; passed: boolean }[] = [];

    for (const planned of context.testPlan.scenarios) {
      const scenario = getLabScenario(planned.scenarioKey);

      if (!scenario) {
        throw new Error(`Launch scenario ${planned.scenarioKey} is unavailable.`);
      }

      const { data: testRun, error: testRunError } = await admin
        .from("client_launch_test_runs")
        .insert({
          launch_id: launch.id,
          partner_id: access.partnerId,
          client_id: clientId,
          scenario_key: scenario.key,
          scenario_title: scenario.title,
          status: "running",
        })
        .select("id")
        .single();

      if (testRunError || !testRun) {
        throw new Error(`${scenario.title} could not be started.`);
      }

      const expectedWorkflows = context.workflows.filter((workflow) =>
        planned.expectedTemplateKeys.includes(workflow.templateKey),
      );
      const result = await runClientLaunchScenario(admin, {
        partnerId: access.partnerId!,
        clientId,
        scenarioKey: scenario.key,
        values: scenario.defaults,
        expectedTemplateKeys: planned.expectedTemplateKeys,
        minimumApprovals: expectedWorkflows.some(
          (workflow) => workflow.approvalRequired,
        )
          ? 1
          : 0,
        recordsContact:
          context.client.crmOperatingMode === "primary_crm" &&
          planned.expectedTemplateKeys.includes("new_lead_intake"),
      });
      const passed = result.status === "success" && result.passed === true;
      const completedAt = new Date().toISOString();
      const { error: resultError } = await admin
        .from("client_launch_test_runs")
        .update({
          status: passed ? "passed" : "failed",
          result: JSON.parse(JSON.stringify(result)),
          event_id: result.eventId ?? null,
          error_message: passed ? null : result.message,
          completed_at: completedAt,
        })
        .eq("id", testRun.id)
        .eq("launch_id", launch.id);

      if (resultError) {
        throw new Error(`${scenario.title} results could not be recorded.`);
      }

      scenarioResults.push({ key: scenario.key, passed });
    }

    const passed = scenarioResults.every((result) => result.passed);
    const passedCount = scenarioResults.filter((result) => result.passed).length;
    const completedAt = new Date().toISOString();
    const { error: finishError } = await admin
      .from("client_launches")
      .update({
        status: passed ? "ready" : "blocked",
        test_summary: {
          passed,
          passed_count: passedCount,
          total: scenarioResults.length,
          scenarios: scenarioResults,
        },
        tests_completed_at: completedAt,
        error_message: passed ? null : "One or more package tests failed.",
      })
      .eq("id", launch.id);

    if (finishError) {
      throw new Error("The package test summary could not be recorded.");
    }

    await recordAuditEvent({
      actor: access,
      action: "client.launch_tests_completed",
      targetType: "client_launch",
      targetId: launch.id,
      summary: `Ran ${scenarioResults.length} package launch test${scenarioResults.length === 1 ? "" : "s"} for "${context.client.name}".`,
      afterSnapshot: {
        passed,
        passed_count: passedCount,
        total: scenarioResults.length,
        deployment_id: context.deployment.id,
      },
    });

    refreshLaunchPaths(clientId);

    return {
      status: passed ? "success" : "error",
      message: passed
        ? scenarioResults.length > 0
          ? `All ${scenarioResults.length} package tests passed.`
          : "This package has no workflow scenarios to run. Test gate passed."
        : `${scenarioResults.length - passedCount} package test${scenarioResults.length - passedCount === 1 ? "" : "s"} failed.`,
    };
  } catch (error) {
    if (launchId) {
      const admin = createSupabaseAdminClient();
      await admin
        ?.from("client_launches")
        .update({
          status: "failed",
          error_message:
            error instanceof Error ? error.message : "The test run failed.",
        })
        .eq("id", launchId);
    }

    refreshLaunchPaths(clientId);
    return errorState(error);
  }
}

export async function goLive(
  clientId: string,
  launchId: string,
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  if (formData.get("confirm_live") !== "yes") {
    return {
      status: "error",
      message: "Confirm that approved actions may use real providers.",
    };
  }

  try {
    const { user, access, admin } = await requireLaunchAccess(clientId);
    const context = await loadClientLaunchContext(admin, {
      partnerId: access.partnerId!,
      clientId,
    });

    if (!context.latestLaunch || context.latestLaunch.id !== launchId) {
      return { status: "error", message: "Run the current package tests again." };
    }

    if (!context.readiness.canGoLive) {
      return {
        status: "error",
        message: context.readiness.blockers[0] ?? "This package is not ready.",
      };
    }

    const { error: targetError } = await admin
      .from("client_launches")
      .update({
        readiness_snapshot: readinessSnapshot(context.readiness),
        target_workflow_ids: context.readiness.targetWorkflowIds,
        target_connection_ids: context.readiness.targetConnectionIds,
      })
      .eq("id", launchId)
      .eq("client_id", clientId)
      .eq("partner_id", access.partnerId)
      .eq("status", "ready");

    if (targetError) {
      throw new Error("The final launch target list could not be locked.");
    }

    const { error: activateError } = await admin.rpc("activate_client_launch", {
      p_launch_id: launchId,
      p_actor_id: user.id,
    });

    if (activateError) {
      throw new Error(`Go-live was stopped: ${activateError.message}`);
    }

    await recordAuditEvent({
      actor: access,
      action: "client.launch_activated",
      targetType: "client_launch",
      targetId: launchId,
      summary: `Launched "${context.package?.name ?? "package"}" for "${context.client.name}".`,
      afterSnapshot: {
        workflow_ids: context.readiness.targetWorkflowIds,
        connection_ids: context.readiness.targetConnectionIds,
        default_runtime_mode: "live",
      },
    });

    refreshLaunchPaths(clientId);
    return {
      status: "success",
      message: "Client is live. The pre-launch runtime snapshot is ready for rollback.",
    };
  } catch (error) {
    refreshLaunchPaths(clientId);
    return errorState(error);
  }
}

export async function rollbackLaunch(
  clientId: string,
  launchId: string,
  _previousState: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    const { user, access, admin } = await requireLaunchAccess(clientId);
    const context = await loadClientLaunchContext(admin, {
      partnerId: access.partnerId!,
      clientId,
    });

    if (
      !context.latestLaunch ||
      context.latestLaunch.id !== launchId ||
      context.latestLaunch.status !== "live"
    ) {
      return { status: "error", message: "There is no active launch to roll back." };
    }

    const { error } = await admin.rpc("rollback_client_launch", {
      p_launch_id: launchId,
      p_actor_id: user.id,
    });

    if (error) {
      throw new Error(`Rollback was stopped: ${error.message}`);
    }

    await recordAuditEvent({
      actor: access,
      action: "client.launch_rolled_back",
      targetType: "client_launch",
      targetId: launchId,
      summary: `Rolled back the active launch for "${context.client.name}".`,
      afterSnapshot: { restored_from_pre_launch_snapshot: true },
    });

    refreshLaunchPaths(clientId);
    return {
      status: "success",
      message: "Rollback complete. Workflows and connections are back in their pre-launch modes.",
    };
  } catch (error) {
    refreshLaunchPaths(clientId);
    return errorState(error);
  }
}
