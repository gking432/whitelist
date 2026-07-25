"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import {
  isAccessError,
  requirePrimaryPartnerAccess,
} from "@/lib/permissions/access";
import { PARTNER_OPERATOR_ROLES } from "@/lib/permissions/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  ensureScenarioLabClient,
  runScenarioLab,
  type ScenarioLabRunResult,
} from "@/lib/testing/scenario-runner";
import type {
  LabScenarioKey,
  LabScenarioValues,
} from "@/lib/testing/scenarios";

export type ScenarioLabSetupResult = {
  status: "success" | "error";
  message: string;
  clientId?: string;
};

async function requireLabContext() {
  const authState = await getAuthState();

  if (!authState.user) {
    return { error: "Sign in to use the Scenario Lab." } as const;
  }

  try {
    const access = await requirePrimaryPartnerAccess(
      authState.user.id,
      PARTNER_OPERATOR_ROLES,
    );
    const admin = createSupabaseAdminClient();

    if (!access.partnerId || !admin) {
      return { error: "The Scenario Lab data service is unavailable." } as const;
    }

    return { access, admin, user: authState.user } as const;
  } catch (error) {
    if (isAccessError(error)) {
      return {
        error:
          error.code === "ACCESS_DENIED"
            ? "A partner operator role is required to run scenarios."
            : "Scenario Lab access checks are unavailable.",
      } as const;
    }

    throw error;
  }
}

export async function setupScenarioLabAction(): Promise<ScenarioLabSetupResult> {
  const context = await requireLabContext();

  if ("error" in context) {
    return {
      status: "error",
      message: context.error ?? "Scenario Lab access is unavailable.",
    };
  }

  try {
    const client = await ensureScenarioLabClient(context.admin, {
      partnerId: context.access.partnerId!,
      userId: context.user.id,
    });

    await recordAuditEvent({
      actor: context.access,
      action: "scenario_lab.prepared",
      targetType: "client_business",
      targetId: client.id,
      summary: "Prepared the isolated Northstar Scenario Lab business.",
      metadata: { client_slug: client.slug },
    });

    revalidatePath("/partner/lab");

    return {
      status: "success",
      message: "The isolated sandbox business is ready.",
      clientId: client.id,
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "The Scenario Lab could not be prepared.",
    };
  }
}

export async function runScenarioLabAction(input: {
  clientId: string;
  scenarioKey: LabScenarioKey;
  values: LabScenarioValues;
}): Promise<ScenarioLabRunResult> {
  const context = await requireLabContext();

  if ("error" in context) {
    return {
      status: "error",
      message: context.error ?? "Scenario Lab access is unavailable.",
    };
  }

  try {
    await ensureScenarioLabClient(context.admin, {
      partnerId: context.access.partnerId!,
      userId: context.user.id,
    });
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "The Scenario Lab setup could not be verified.",
    };
  }

  const result = await runScenarioLab(context.admin, {
    partnerId: context.access.partnerId!,
    clientId: input.clientId,
    scenarioKey: input.scenarioKey,
    values: input.values,
  });

  if (result.status === "success") {
    await recordAuditEvent({
      actor: context.access,
      action: "scenario_lab.run_completed",
      targetType: "integration_event",
      targetId: result.eventId ?? input.clientId,
      summary: `${result.scenarioTitle ?? input.scenarioKey}: ${result.passed ? "passed" : "failed assertions"}.`,
      metadata: {
        scenario_key: input.scenarioKey,
        passed: result.passed,
        passed_assertions: result.passedAssertions,
        total_assertions: result.totalAssertions,
        run_ids: result.runIds,
      },
    });
  }

  revalidatePath("/partner/lab");
  revalidatePath(`/partner/clients/${input.clientId}`, "layout");

  return result;
}
