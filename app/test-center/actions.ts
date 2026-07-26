"use server";

import { revalidatePath } from "next/cache";

import { getAuthState } from "@/lib/auth/session";
import type { FormState } from "@/lib/forms/state";
import { loadClientLaunchContext } from "@/lib/launch/context";
import {
  enabledCapabilityKeys,
  type CapabilityKey,
} from "@/lib/packages/capabilities";
import {
  isAccessError,
  requireClientWorkspaceAccess,
  requirePrimaryClientAccess,
} from "@/lib/permissions/access";
import {
  CLIENT_APPROVER_ROLES,
  PARTNER_OPERATOR_ROLES,
  isClientRole,
  isPlatformRole,
} from "@/lib/permissions/roles";
import type { AccessContext } from "@/lib/permissions/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getLabScenario } from "@/lib/testing/scenarios";
import { runClientLaunchScenario } from "@/lib/testing/scenario-runner";
import { FEATURE_TEST_DEFINITIONS } from "@/lib/testing/test-center";

export type FeatureTestActionState = FormState & {
  passedAssertions?: number;
  totalAssertions?: number;
  scenarioResults?: {
    title: string;
    passed: boolean;
    detail: string;
  }[];
};

function audienceFor(access: AccessContext): "platform" | "partner" | "client" {
  if (isPlatformRole(access.role)) return "platform";
  if (isClientRole(access.role)) return "client";
  return "partner";
}

export async function runFeatureTest(
  requestedAudience: "partner" | "client",
  requestedClientId: string | null,
  capabilityKey: CapabilityKey,
  _previousState: FeatureTestActionState,
  _formData: FormData,
): Promise<FeatureTestActionState> {
  const authState = await getAuthState();

  if (!authState.user) {
    return { status: "error", message: "Sign in to run this test." };
  }

  let testRunId: string | null = null;

  try {
    const access =
      requestedAudience === "partner" && requestedClientId
        ? await requireClientWorkspaceAccess(
            authState.user.id,
            requestedClientId,
            PARTNER_OPERATOR_ROLES,
          )
        : await requirePrimaryClientAccess(
            authState.user.id,
            CLIENT_APPROVER_ROLES,
          );
    const clientId =
      requestedAudience === "partner" ? requestedClientId : access.clientId;

    if (!clientId || !access.partnerId) {
      return { status: "error", message: "The test business is unavailable." };
    }

    const definition = FEATURE_TEST_DEFINITIONS[capabilityKey];
    if (!definition || definition.testMode !== "automated") {
      return { status: "error", message: "This feature uses a guided test." };
    }

    const admin = createSupabaseAdminClient();
    if (!admin) throw new Error("The data service is unavailable.");

    const context = await loadClientLaunchContext(admin, {
      partnerId: access.partnerId,
      clientId,
    });

    if (!context.package) {
      return {
        status: "error",
        message: "Assign a package before testing features.",
      };
    }

    const setupBlocker = context.readiness.gates.find(
      (gate) => gate.key !== "tests" && !gate.passed,
    );
    if (setupBlocker) {
      return {
        status: "error",
        message: `${setupBlocker.label} is incomplete. Finish client Setup before testing.`,
      };
    }

    const enabled = enabledCapabilityKeys(context.package.capabilities);
    if (!enabled.includes(capabilityKey)) {
      return {
        status: "error",
        message: "This feature is not in the assigned package.",
      };
    }

    if (context.readiness.hasLiveRuntime) {
      return {
        status: "error",
        message:
          "Automated synthetic tests are disabled while this business is live. Follow the guided steps or test the package in a sandbox business.",
      };
    }

    const expectedTemplateKeys = definition.expectedTemplateKeys.filter((key) =>
      context.requirements?.workflowTemplateKeys.includes(key),
    );
    const missingExpected = expectedTemplateKeys.filter(
      (key) =>
        !context.workflows.some(
          (workflow) =>
            workflow.templateKey === key && workflow.status === "active",
        ),
    );

    if (missingExpected.length > 0) {
      return {
        status: "error",
        message: `Enable the required workflow${missingExpected.length === 1 ? "" : "s"}: ${missingExpected.join(", ")}.`,
      };
    }

    const { data: testRun, error: startError } = await admin
      .from("client_feature_test_runs")
      .insert({
        partner_id: access.partnerId,
        client_id: clientId,
        package_id: context.package.id,
        capability_key: capabilityKey,
        audience: audienceFor(access),
        status: "running",
        actor_user_id: authState.user.id,
      })
      .select("id")
      .single();

    if (startError || !testRun) {
      throw new Error("The feature test could not be started.");
    }

    testRunId = testRun.id;
    const results = [];

    for (const scenarioKey of definition.scenarioKeys) {
      const scenario = getLabScenario(scenarioKey);
      if (!scenario)
        throw new Error(`Test scenario ${scenarioKey} is unavailable.`);

      const scenarioExpectedKeys = expectedTemplateKeys.filter((key) =>
        scenario.expectation.templates.includes(key),
      );
      const expectedWorkflows = context.workflows.filter((workflow) =>
        scenarioExpectedKeys.includes(workflow.templateKey),
      );
      const result = await runClientLaunchScenario(admin, {
        partnerId: access.partnerId,
        clientId,
        scenarioKey,
        values: scenario.defaults,
        expectedTemplateKeys: scenarioExpectedKeys,
        minimumApprovals: expectedWorkflows.some(
          (workflow) => workflow.approvalRequired,
        )
          ? 1
          : 0,
        recordsContact:
          context.client.crmOperatingMode === "primary_crm" &&
          scenarioExpectedKeys.includes("new_lead_intake"),
      });

      results.push(result);
    }

    const passed = results.every(
      (result) => result.status === "success" && result.passed === true,
    );
    const passedAssertions = results.reduce(
      (total, result) => total + (result.passedAssertions ?? 0),
      0,
    );
    const totalAssertions = results.reduce(
      (total, result) => total + (result.totalAssertions ?? 0),
      0,
    );
    const scenarioResults = results.map((result) => ({
      title: result.scenarioTitle ?? "Feature scenario",
      passed: result.status === "success" && result.passed === true,
      detail: result.message,
    }));

    const { error: finishError } = await admin
      .from("client_feature_test_runs")
      .update({
        status: passed ? "passed" : "failed",
        result: {
          passed,
          passed_assertions: passedAssertions,
          total_assertions: totalAssertions,
          scenarios: results,
        },
        completed_at: new Date().toISOString(),
      })
      .eq("id", testRun.id);

    if (finishError)
      throw new Error("The feature test result could not be saved.");

    revalidatePath(`/partner/clients/${clientId}/test-center`);
    revalidatePath("/client/test-center");

    return {
      status: passed ? "success" : "error",
      message: passed
        ? `${definition.scenarioKeys.length} scenario${definition.scenarioKeys.length === 1 ? "" : "s"} passed.`
        : "One or more scenarios failed. Review the result below.",
      passedAssertions,
      totalAssertions,
      scenarioResults,
    };
  } catch (error) {
    if (testRunId) {
      await createSupabaseAdminClient()
        ?.from("client_feature_test_runs")
        .update({
          status: "failed",
          result: {
            error: error instanceof Error ? error.message : "Test failed.",
          },
          completed_at: new Date().toISOString(),
        })
        .eq("id", testRunId);
    }

    if (isAccessError(error)) {
      return {
        status: "error",
        message:
          error.code === "ACCESS_DENIED"
            ? "This account cannot run feature tests."
            : "The Test Center is unavailable right now.",
      };
    }

    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "The feature test failed.",
    };
  }
}
