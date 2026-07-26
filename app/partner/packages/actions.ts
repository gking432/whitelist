"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import type { FormState } from "@/lib/forms/state";
import { enabledCapabilityKeys } from "@/lib/packages/capabilities";
import { readPackageFields } from "@/lib/packages/form";
import { PACKAGE_PRESETS, presetCapabilitiesMap } from "@/lib/packages/presets";
import {
  isAccessError,
  requirePrimaryPartnerAccess,
} from "@/lib/permissions/access";
import { PARTNER_OPERATOR_ROLES } from "@/lib/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Server actions for the partner package builder. Packages are plain
// capability toggle sets — no billing/pricing in this release.

function deniedState(error: unknown): FormState {
  if (isAccessError(error)) {
    return {
      status: "error",
      message:
        error.code === "ACCESS_DENIED"
          ? "You do not have permission to manage packages."
          : "Packages are unavailable right now. Try again shortly.",
    };
  }

  throw error;
}

async function requirePackageContext() {
  const authState = await getAuthState();

  if (!authState.user) {
    return { error: "Sign in to manage packages." } as const;
  }

  const access = await requirePrimaryPartnerAccess(
    authState.user.id,
    PARTNER_OPERATOR_ROLES,
  );

  const supabase = await createSupabaseServerClient();

  if (!supabase || !access.partnerId) {
    return { error: "The data service is unavailable." } as const;
  }

  return { access, supabase, partnerId: access.partnerId } as const;
}

export async function createPackage(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const { name, description, capabilities } = readPackageFields(formData);

  if (!name) {
    return {
      status: "error",
      message: "Give the package a name.",
      fieldErrors: { name: "A package name is required." },
    };
  }

  try {
    const context = await requirePackageContext();

    if ("error" in context) {
      return { status: "error", message: context.error };
    }

    const { access, supabase, partnerId } = context;

    const { data: created, error } = await supabase
      .from("partner_packages")
      .insert({
        partner_id: partnerId,
        name,
        description: description || null,
        capabilities,
        created_by: access.userId,
      })
      .select("id")
      .single();

    if (error || !created) {
      return {
        status: "error",
        message: "The package could not be created. Try again.",
      };
    }

    await recordAuditEvent({
      actor: access,
      action: "package.created",
      targetType: "partner_package",
      targetId: created.id,
      summary: `Created package "${name}".`,
      afterSnapshot: { name, capabilities },
    });

    revalidatePath("/partner/packages");

    return { status: "success", message: `Package "${name}" created.` };
  } catch (error) {
    return deniedState(error);
  }
}

export async function updatePackage(
  packageId: string,
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const { name, description, capabilities } = readPackageFields(formData);

  if (!name) {
    return {
      status: "error",
      message: "Give the package a name.",
      fieldErrors: { name: "A package name is required." },
    };
  }

  try {
    const context = await requirePackageContext();

    if ("error" in context) {
      return { status: "error", message: context.error };
    }

    const { access, supabase, partnerId } = context;

    const { data: existing } = await supabase
      .from("partner_packages")
      .select("id, name, capabilities")
      .eq("id", packageId)
      .eq("partner_id", partnerId)
      .maybeSingle();

    if (!existing) {
      return { status: "error", message: "The package was not found." };
    }

    const { error } = await supabase
      .from("partner_packages")
      .update({ name, description: description || null, capabilities })
      .eq("id", packageId)
      .eq("partner_id", partnerId);

    if (error) {
      return {
        status: "error",
        message: "The package could not be saved. Try again.",
      };
    }

    await recordAuditEvent({
      actor: access,
      action: "package.updated",
      targetType: "partner_package",
      targetId: packageId,
      summary: `Updated package "${name}". Changes apply to future setup checklists; already-enabled client workflows are not touched.`,
      beforeSnapshot: {
        name: existing.name,
        capabilities: enabledCapabilityKeys(
          existing.capabilities as Record<string, unknown>,
        ),
      },
      afterSnapshot: { name, capabilities: Object.keys(capabilities) },
    });

    revalidatePath("/partner/packages");

    return { status: "success", message: "Package saved." };
  } catch (error) {
    return deniedState(error);
  }
}

export async function archivePackage(packageId: string): Promise<FormState> {
  try {
    const context = await requirePackageContext();

    if ("error" in context) {
      return { status: "error", message: context.error };
    }

    const { access, supabase, partnerId } = context;

    const { data: existing } = await supabase
      .from("partner_packages")
      .select("id, name")
      .eq("id", packageId)
      .eq("partner_id", partnerId)
      .maybeSingle();

    if (!existing) {
      return { status: "error", message: "The package was not found." };
    }

    const { error } = await supabase
      .from("partner_packages")
      .update({ is_archived: true })
      .eq("id", packageId)
      .eq("partner_id", partnerId);

    if (error) {
      return { status: "error", message: "The package could not be archived." };
    }

    await recordAuditEvent({
      actor: access,
      action: "package.archived",
      targetType: "partner_package",
      targetId: packageId,
      summary: `Archived package "${existing.name}". Clients already on it keep their assignment.`,
    });

    revalidatePath("/partner/packages");

    return { status: "success", message: `Package "${existing.name}" archived.` };
  } catch (error) {
    return deniedState(error);
  }
}

// One-click creation of the three starter packages (Basic Automation,
// AI Assist, Full AI Operations). Skips any name that already exists.
export async function createStarterPackages(): Promise<FormState> {
  try {
    const context = await requirePackageContext();

    if ("error" in context) {
      return { status: "error", message: context.error };
    }

    const { access, supabase, partnerId } = context;

    const { data: existing } = await supabase
      .from("partner_packages")
      .select("name")
      .eq("partner_id", partnerId)
      .eq("is_archived", false);

    const existingNames = new Set((existing ?? []).map((row) => row.name));
    const toCreate = PACKAGE_PRESETS.filter(
      (preset) => !existingNames.has(preset.name),
    );

    if (toCreate.length === 0) {
      return {
        status: "success",
        message: "The starter packages already exist.",
      };
    }

    const { data: created, error } = await supabase
      .from("partner_packages")
      .insert(
        toCreate.map((preset) => ({
          partner_id: partnerId,
          name: preset.name,
          description: preset.description,
          capabilities: presetCapabilitiesMap(preset),
          created_by: access.userId,
        })),
      )
      .select("id, name");

    if (error || !created) {
      return {
        status: "error",
        message: "The starter packages could not be created. Try again.",
      };
    }

    for (const row of created) {
      await recordAuditEvent({
        actor: access,
        action: "package.created",
        targetType: "partner_package",
        targetId: row.id,
        summary: `Created starter package "${row.name}".`,
      });
    }

    revalidatePath("/partner/packages");
    revalidatePath("/partner/clients/new");

    return {
      status: "success",
      message: `Created ${created.length} starter package${created.length === 1 ? "" : "s"}.`,
    };
  } catch (error) {
    return deniedState(error);
  }
}

export async function deletePackageAndRedirect(packageId: string) {
  const result = await archivePackage(packageId);

  if (result.status === "success") {
    redirect("/partner/packages");
  }

  return result;
}
