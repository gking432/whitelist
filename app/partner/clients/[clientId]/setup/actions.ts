"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import type { FormState } from "@/lib/forms/state";
import {
  LEAD_SOURCE_KEYS,
  WEBSITE_PLATFORM_KEYS,
  emptyIntakeAnswers,
  type IntakeAnswers,
  type LeadSourceKey,
  type WebsitePlatformKey,
  type YesNoUnsure,
} from "@/lib/lead-sources/catalog";
import { readPackageFields } from "@/lib/packages/form";
import { requirementsForPackage } from "@/lib/packages/requirements";
import {
  isAccessError,
  requireClientWorkspaceAccess,
} from "@/lib/permissions/access";
import { PARTNER_OPERATOR_ROLES } from "@/lib/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const YES_NO_UNSURE: YesNoUnsure[] = ["yes", "no", "unsure"];

// Never trust the browser-shaped answers object: rebuild it against the
// catalog so only known keys/values are stored.
function sanitizeAnswers(input: unknown): IntakeAnswers {
  const raw = (input ?? {}) as Partial<IntakeAnswers>;

  const leadSources = Array.isArray(raw.leadSources)
    ? [
        ...new Set(
          raw.leadSources.filter((source): source is LeadSourceKey =>
            LEAD_SOURCE_KEYS.includes(source as LeadSourceKey),
          ),
        ),
      ]
    : [];

  const yesNoUnsure = (value: unknown): YesNoUnsure =>
    YES_NO_UNSURE.includes(value as YesNoUnsure)
      ? (value as YesNoUnsure)
      : "unsure";

  return {
    leadSources,
    websitePlatform: WEBSITE_PLATFORM_KEYS.includes(
      raw.websitePlatform as WebsitePlatformKey,
    )
      ? (raw.websitePlatform as WebsitePlatformKey)
      : "unknown",
    canEditWebsite: yesNoUnsure(raw.canEditWebsite),
    hasCrm: yesNoUnsure(raw.hasCrm),
    hasPhoneProvider: yesNoUnsure(raw.hasPhoneProvider),
    hasMessagingProvider: yesNoUnsure(raw.hasMessagingProvider),
    hasCalendar: yesNoUnsure(raw.hasCalendar),
  };
}

export async function saveLeadSourceProfile(
  clientId: string,
  answersInput: IntakeAnswers,
): Promise<FormState> {
  const authState = await getAuthState();

  if (!authState.user) {
    return { status: "error", message: "Sign in to save the setup plan." };
  }

  const answers = sanitizeAnswers(answersInput);

  if (answers.leadSources.length === 0) {
    return {
      status: "error",
      message: "Choose at least one lead source before saving.",
    };
  }

  try {
    const access = await requireClientWorkspaceAccess(
      authState.user.id,
      clientId,
      PARTNER_OPERATOR_ROLES,
    );

    const supabase = await createSupabaseServerClient();

    if (!supabase || !access.partnerId) {
      return { status: "error", message: "The data service is unavailable." };
    }

    const { data: existing, error: existingError } = await supabase
      .from("client_businesses")
      .select("id, name, lead_source_profile")
      .eq("id", clientId)
      .maybeSingle();

    if (existingError || !existing) {
      return { status: "error", message: "The client could not be loaded." };
    }

    const previousProfile =
      (existing.lead_source_profile as { answers?: IntakeAnswers } | null) ??
      {};

    const profile = {
      answers,
      saved_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from("client_businesses")
      .update({ lead_source_profile: profile })
      .eq("id", clientId)
      .eq("partner_id", access.partnerId);

    if (updateError) {
      return {
        status: "error",
        message: "The setup plan could not be saved. Try again.",
      };
    }

    await recordAuditEvent({
      actor: access,
      action: "client.lead_source_profile_updated",
      targetType: "client_business",
      targetId: clientId,
      summary: `Updated the lead source setup plan for "${existing.name}".`,
      beforeSnapshot: {
        answers: previousProfile.answers ?? emptyIntakeAnswers,
      },
      afterSnapshot: { answers },
    });

    revalidatePath(`/partner/clients/${clientId}`, "layout");

    return { status: "success", message: "Setup plan saved." };
  } catch (error) {
    if (isAccessError(error)) {
      return {
        status: "error",
        message:
          error.code === "ACCESS_DENIED"
            ? "You do not have permission to manage setup for this client."
            : "Setup is unavailable right now. Try again shortly.",
      };
    }

    throw error;
  }
}

// ---------------------------------------------------------------------------
// Package-driven setup. The package choice is the onboarding decision
// ("what did you sell this client?"); the checklist — integrations,
// workflows, staff installs — derives from it.

function deniedState(error: unknown): FormState {
  if (isAccessError(error)) {
    return {
      status: "error",
      message:
        error.code === "ACCESS_DENIED"
          ? "You do not have permission to manage setup for this client."
          : "Setup is unavailable right now. Try again shortly.",
    };
  }

  throw error;
}

async function requireSetupContext(clientId: string) {
  const authState = await getAuthState();

  if (!authState.user) {
    return { error: "Sign in to manage client setup." } as const;
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

  return { access, supabase, partnerId: access.partnerId } as const;
}

export async function assignPackageToClient(
  clientId: string,
  packageId: string,
): Promise<FormState> {
  try {
    const context = await requireSetupContext(clientId);

    if ("error" in context) {
      return { status: "error", message: context.error };
    }

    const { access, supabase, partnerId } = context;

    const { data: pkg } = await supabase
      .from("partner_packages")
      .select("id, name, client_id, is_archived")
      .eq("id", packageId)
      .eq("partner_id", partnerId)
      .maybeSingle();

    if (!pkg || pkg.is_archived) {
      return { status: "error", message: "That package is not available." };
    }

    // Custom packages belong to exactly one client.
    if (pkg.client_id && pkg.client_id !== clientId) {
      return {
        status: "error",
        message: "That package is a custom package for a different client.",
      };
    }

    const { data: client } = await supabase
      .from("client_businesses")
      .select("id, name, package_id")
      .eq("id", clientId)
      .eq("partner_id", partnerId)
      .maybeSingle();

    if (!client) {
      return { status: "error", message: "The client was not found." };
    }

    const { error } = await supabase
      .from("client_businesses")
      .update({ package_id: packageId })
      .eq("id", clientId)
      .eq("partner_id", partnerId);

    if (error) {
      return { status: "error", message: "The package could not be assigned." };
    }

    await recordAuditEvent({
      actor: access,
      action: "client.package_assigned",
      targetType: "client_business",
      targetId: clientId,
      summary: `Assigned package "${pkg.name}" to "${client.name}".`,
      beforeSnapshot: { package_id: client.package_id },
      afterSnapshot: { package_id: packageId, package_name: pkg.name },
    });

    revalidatePath(`/partner/clients/${clientId}/setup`);
    revalidatePath(`/partner/clients/${clientId}`);

    return {
      status: "success",
      message: `Package "${pkg.name}" assigned. The checklist now shows exactly what this client needs.`,
    };
  } catch (error) {
    return deniedState(error);
  }
}

// "The sold deal doesn't match a saved package" path: create a one-off
// custom package owned by this client and assign it in the same step.
export async function createCustomPackageForClient(
  clientId: string,
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const { name, description, capabilities } = readPackageFields(formData);

  if (!name) {
    return {
      status: "error",
      message: "Give the custom package a name.",
      fieldErrors: { name: "A package name is required." },
    };
  }

  try {
    const context = await requireSetupContext(clientId);

    if ("error" in context) {
      return { status: "error", message: context.error };
    }

    const { access, supabase, partnerId } = context;

    const { data: created, error } = await supabase
      .from("partner_packages")
      .insert({
        partner_id: partnerId,
        client_id: clientId,
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
        message: "The custom package could not be created. Try again.",
      };
    }

    const { error: assignError } = await supabase
      .from("client_businesses")
      .update({ package_id: created.id })
      .eq("id", clientId)
      .eq("partner_id", partnerId);

    if (assignError) {
      return {
        status: "error",
        message:
          "The package was created but could not be assigned. Pick it from the package list.",
      };
    }

    await recordAuditEvent({
      actor: access,
      action: "package.custom_created",
      targetType: "partner_package",
      targetId: created.id,
      summary: `Created and assigned custom package "${name}" for this client.`,
      afterSnapshot: { name, capabilities: Object.keys(capabilities) },
    });

    revalidatePath(`/partner/clients/${clientId}/setup`);

    return {
      status: "success",
      message: `Custom package "${name}" created and assigned.`,
    };
  } catch (error) {
    return deniedState(error);
  }
}

// Enables every workflow template the assigned package includes, skipping
// ones already enabled. Instances start in the template's default runtime
// mode — nothing goes live here.
export async function enablePackageWorkflows(
  clientId: string,
): Promise<FormState> {
  try {
    const context = await requireSetupContext(clientId);

    if ("error" in context) {
      return { status: "error", message: context.error };
    }

    const { access, supabase, partnerId } = context;

    const { data: client } = await supabase
      .from("client_businesses")
      .select("id, package_id")
      .eq("id", clientId)
      .eq("partner_id", partnerId)
      .maybeSingle();

    if (!client?.package_id) {
      return {
        status: "error",
        message:
          "Choose a package first — it decides which workflows to enable.",
      };
    }

    const { data: pkg } = await supabase
      .from("partner_packages")
      .select("id, name, capabilities")
      .eq("id", client.package_id)
      .maybeSingle();

    if (!pkg) {
      return { status: "error", message: "The assigned package was not found." };
    }

    const requirements = requirementsForPackage({
      capabilities: (pkg.capabilities as Record<string, unknown>) ?? {},
    });

    if (requirements.workflowTemplateKeys.length === 0) {
      return {
        status: "success",
        message: "This package includes no automated workflows.",
      };
    }

    const { data: templates } = await supabase
      .from("workflow_templates")
      .select("id, template_key, name, default_runtime_mode")
      .in("template_key", requirements.workflowTemplateKeys)
      .eq("is_active", true);

    const { data: existing } = await supabase
      .from("client_workflow_instances")
      .select("template_id")
      .eq("client_id", clientId);

    const enabledTemplateIds = new Set(
      (existing ?? []).map((row) => row.template_id),
    );
    const toEnable = (templates ?? []).filter(
      (template) => !enabledTemplateIds.has(template.id),
    );

    if (toEnable.length === 0) {
      return {
        status: "success",
        message: "All workflows for this package are already enabled.",
      };
    }

    const { data: created, error } = await supabase
      .from("client_workflow_instances")
      .insert(
        toEnable.map((template) => ({
          partner_id: partnerId,
          client_id: clientId,
          template_id: template.id,
          name: template.name,
          status: "active",
          runtime_mode: template.default_runtime_mode,
          settings: {},
          approval_policy: {},
          health_status: "unknown",
          created_by: access.userId,
        })),
      )
      .select("id, name");

    if (error || !created) {
      return {
        status: "error",
        message: "The workflows could not be enabled. Try again.",
      };
    }

    for (const instance of created) {
      await recordAuditEvent({
        actor: access,
        action: "workflow.instance_enabled",
        targetType: "client_workflow_instance",
        targetId: instance.id,
        summary: `Enabled workflow "${instance.name}" from package "${pkg.name}".`,
      });
    }

    revalidatePath(`/partner/clients/${clientId}/setup`);
    revalidatePath(`/partner/clients/${clientId}/workflows`);

    return {
      status: "success",
      message: `Enabled ${created.length} workflow${created.length === 1 ? "" : "s"}: ${created
        .map((instance) => instance.name)
        .join(", ")}.`,
    };
  } catch (error) {
    return deniedState(error);
  }
}
