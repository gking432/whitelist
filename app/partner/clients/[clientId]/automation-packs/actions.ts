"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import {
  installAutomationPackForClient,
  verifyAutomationPackForClient,
} from "@/lib/automation-packs/install";
import { V1_AUTOMATION_PACKS } from "@/lib/automation-packs/catalog";
import { getAuthState } from "@/lib/auth/session";
import type { FormState } from "@/lib/forms/state";
import {
  isAccessError,
  requireClientWorkspaceAccess,
} from "@/lib/permissions/access";
import { PARTNER_OPERATOR_ROLES } from "@/lib/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function deniedState(error: unknown): FormState {
  if (isAccessError(error)) {
    return {
      status: "error",
      message:
        error.code === "ACCESS_DENIED"
          ? "You do not have permission to install automations for this client."
          : "Automation installation is unavailable right now.",
    };
  }

  return {
    status: "error",
    message:
      error instanceof Error ? error.message : "The automation action failed.",
  };
}

async function loadContext(clientId: string) {
  const authState = await getAuthState();

  if (!authState.user) {
    return { error: "Sign in to manage automations." } as const;
  }

  const access = await requireClientWorkspaceAccess(
    authState.user.id,
    clientId,
    PARTNER_OPERATOR_ROLES,
  );
  const supabase = await createSupabaseServerClient();

  if (!supabase || !access.partnerId) {
    return { error: "The data service is unavailable." } as const;
  }

  return { access, supabase } as const;
}

export async function installAutomationPack(
  clientId: string,
  packKey: string,
  _previousState: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    const context = await loadContext(clientId);

    if ("error" in context) {
      return { status: "error", message: context.error };
    }

    const result = await installAutomationPackForClient(context.supabase, {
      partnerId: context.access.partnerId!,
      clientId,
      userId: context.access.userId,
      packKey,
    });

    await recordAuditEvent({
      actor: context.access,
      action: "automation_pack.installed",
      targetType: "client_automation_pack_install",
      targetId: result.install.id,
      summary: `Installed ${result.install.pack_name} v${result.install.pack_version}.`,
      afterSnapshot: {
        pack_key: packKey,
        status: result.install.status,
        missing_connections: result.install.missing_connection_keys,
      },
    });

    revalidatePath(`/partner/clients/${clientId}/automation-packs`);
    revalidatePath(`/partner/clients/${clientId}/workflows`);

    if (result.missingConnectionLabels.length > 0) {
      return {
        status: "success",
        message: `Northstar is installed. Connect ${result.missingConnectionLabels.join(", ")} before testing.`,
      };
    }

    return {
      status: "success",
      message: "Installed and ready for a real end-to-end test.",
    };
  } catch (error) {
    return deniedState(error);
  }
}

export async function verifyAutomationPack(
  clientId: string,
  packKey: string,
  _previousState: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    const context = await loadContext(clientId);

    if ("error" in context) {
      return { status: "error", message: context.error };
    }

    const result = await verifyAutomationPackForClient(context.supabase, {
      partnerId: context.access.partnerId!,
      clientId,
      packKey,
    });

    await recordAuditEvent({
      actor: context.access,
      action: "automation_pack.verified",
      targetType: "client_automation_pack_install",
      targetId: result.install.id,
      summary: `Verified ${result.install.pack_name} with a real ${result.eventType} event.`,
      afterSnapshot: result.install.verification_evidence,
    });

    revalidatePath(`/partner/clients/${clientId}/automation-packs`);

    return {
      status: "success",
      message: `Verified with a real ${result.eventType} event. This pack is active.`,
    };
  } catch (error) {
    return deniedState(error);
  }
}

export async function installLaunchAutomationStack(
  clientId: string,
  _previousState: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    const context = await loadContext(clientId);

    if ("error" in context) {
      return { status: "error", message: context.error };
    }

    const results = [];

    for (const pack of V1_AUTOMATION_PACKS) {
      results.push(
        await installAutomationPackForClient(context.supabase, {
          partnerId: context.access.partnerId!,
          clientId,
          userId: context.access.userId,
          packKey: pack.key,
        }),
      );
    }

    const needsSetup = results.filter(
      (result) => result.install.status === "needs_setup",
    );
    const missingAccounts = [
      ...new Set(
        needsSetup.flatMap((result) => result.missingConnectionLabels),
      ),
    ];

    await recordAuditEvent({
      actor: context.access,
      action: "automation_stack.installed",
      targetType: "client_business",
      targetId: clientId,
      summary: `Installed the ${V1_AUTOMATION_PACKS.length}-pack launch automation stack.`,
      afterSnapshot: {
        pack_keys: V1_AUTOMATION_PACKS.map((pack) => pack.key),
        missing_accounts: missingAccounts,
      },
    });

    revalidatePath(`/partner/clients/${clientId}/automation-packs`);
    revalidatePath(`/partner/clients/${clientId}/workflows`);

    return {
      status: "success",
      message:
        missingAccounts.length > 0
          ? `All six packs are provisioned. Connect ${missingAccounts.join(", ")} to finish setup.`
          : "All six launch packs are installed and ready for real tests.",
    };
  } catch (error) {
    return deniedState(error);
  }
}
