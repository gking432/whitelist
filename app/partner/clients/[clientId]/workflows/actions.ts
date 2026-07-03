"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import { RUNTIME_MODES } from "@/lib/clients/constants";
import type { FormState } from "@/lib/forms/state";
import {
  isAccessError,
  requireClientWorkspaceAccess,
} from "@/lib/permissions/access";
import { PARTNER_OPERATOR_ROLES } from "@/lib/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const INSTANCE_STATUSES = ["active", "paused", "disabled"] as const;

function deniedState(error: unknown): FormState {
  if (isAccessError(error)) {
    return {
      status: "error",
      message:
        error.code === "ACCESS_DENIED"
          ? "You do not have permission to manage workflows for this client."
          : "Workflows are unavailable right now. Try again shortly.",
    };
  }

  throw error;
}

async function requireWorkflowContext(clientId: string) {
  const authState = await getAuthState();

  if (!authState.user) {
    return { error: "Sign in to manage workflows." } as const;
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

// Live mode requires the client to actually have the integrations the
// template depends on; block instead of silently failing later.
async function missingProviderCategories(
  supabase: NonNullable<
    Awaited<ReturnType<typeof createSupabaseServerClient>>
  >,
  clientId: string,
  requiredCategories: string[],
): Promise<string[]> {
  if (requiredCategories.length === 0) {
    return [];
  }

  const { data } = await supabase
    .from("integration_connections")
    .select("status, provider:integration_providers(category)")
    .eq("client_id", clientId)
    .in("status", ["connected", "needs_attention"]);

  const presentCategories = new Set(
    (data ?? [])
      .map(
        (row) =>
          (row as unknown as { provider: { category: string } | null })
            .provider?.category,
      )
      .filter(Boolean),
  );

  return requiredCategories.filter(
    (category) => !presentCategories.has(category),
  );
}

export async function enableWorkflowTemplate(
  clientId: string,
  templateId: string,
): Promise<FormState> {
  try {
    const context = await requireWorkflowContext(clientId);

    if ("error" in context) {
      return { status: "error", message: context.error };
    }

    const { access, supabase } = context;

    const { data: template, error: templateError } = await supabase
      .from("workflow_templates")
      .select(
        "id, template_key, name, default_runtime_mode, requires_approval_default",
      )
      .eq("id", templateId)
      .eq("is_active", true)
      .maybeSingle();

    if (templateError || !template) {
      return { status: "error", message: "The template is not available." };
    }

    const { data: existing } = await supabase
      .from("client_workflow_instances")
      .select("id")
      .eq("client_id", clientId)
      .eq("template_id", templateId)
      .maybeSingle();

    if (existing) {
      return {
        status: "error",
        message: "This workflow is already enabled for the client.",
      };
    }

    const { data: created, error: insertError } = await supabase
      .from("client_workflow_instances")
      .insert({
        partner_id: access.partnerId,
        client_id: clientId,
        template_id: templateId,
        name: template.name,
        status: "active",
        runtime_mode: template.default_runtime_mode,
        settings: {},
        approval_policy: {},
        health_status: "unknown",
        created_by: access.userId,
      })
      .select("id")
      .single();

    if (insertError || !created) {
      return {
        status: "error",
        message: "The workflow could not be enabled. Try again.",
      };
    }

    await recordAuditEvent({
      actor: access,
      action: "workflow.instance_enabled",
      targetType: "client_workflow_instance",
      targetId: created.id,
      summary: `Enabled workflow "${template.name}" for this client.`,
      afterSnapshot: {
        template_key: template.template_key,
        status: "active",
        runtime_mode: template.default_runtime_mode,
      },
    });

    revalidatePath(`/partner/clients/${clientId}/workflows`);

    return {
      status: "success",
      message: `Workflow "${template.name}" enabled in ${template.default_runtime_mode.replaceAll("_", " ")} mode.`,
    };
  } catch (error) {
    return deniedState(error);
  }
}

export async function setWorkflowInstanceStatus(
  clientId: string,
  instanceId: string,
  nextStatus: string,
): Promise<FormState> {
  if (!INSTANCE_STATUSES.includes(nextStatus as never)) {
    return { status: "error", message: "Choose a valid workflow status." };
  }

  try {
    const context = await requireWorkflowContext(clientId);

    if ("error" in context) {
      return { status: "error", message: context.error };
    }

    const { access, supabase } = context;

    const { data: instance, error: instanceError } = await supabase
      .from("client_workflow_instances")
      .select("id, name, status")
      .eq("id", instanceId)
      .eq("client_id", clientId)
      .maybeSingle();

    if (instanceError || !instance) {
      return { status: "error", message: "The workflow was not found." };
    }

    const { error: updateError } = await supabase
      .from("client_workflow_instances")
      .update({ status: nextStatus })
      .eq("id", instanceId);

    if (updateError) {
      return { status: "error", message: "The workflow could not be updated." };
    }

    await recordAuditEvent({
      actor: access,
      action:
        nextStatus === "active"
          ? "workflow.instance_resumed"
          : nextStatus === "paused"
            ? "workflow.instance_paused"
            : "workflow.instance_disabled",
      targetType: "client_workflow_instance",
      targetId: instanceId,
      summary: `Set workflow "${instance.name}" to ${nextStatus}.`,
      beforeSnapshot: { status: instance.status },
      afterSnapshot: { status: nextStatus },
    });

    revalidatePath(`/partner/clients/${clientId}/workflows`);

    return { status: "success", message: `Workflow set to ${nextStatus}.` };
  } catch (error) {
    return deniedState(error);
  }
}

export async function updateWorkflowInstance(
  clientId: string,
  instanceId: string,
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const runtimeMode = String(formData.get("runtime_mode") ?? "");
  const approvalPolicyChoice = String(
    formData.get("approval_policy") ?? "template_default",
  );

  if (!RUNTIME_MODES.includes(runtimeMode as never)) {
    return { status: "error", message: "Choose a valid runtime mode." };
  }

  if (!["template_default", "always", "never"].includes(approvalPolicyChoice)) {
    return { status: "error", message: "Choose a valid approval policy." };
  }

  try {
    const context = await requireWorkflowContext(clientId);

    if ("error" in context) {
      return { status: "error", message: context.error };
    }

    const { access, supabase } = context;

    const { data: instance, error: instanceError } = await supabase
      .from("client_workflow_instances")
      .select(
        "id, name, runtime_mode, settings, approval_policy, template:workflow_templates(template_key, required_provider_categories, settings_schema, risk_level)",
      )
      .eq("id", instanceId)
      .eq("client_id", clientId)
      .maybeSingle();

    if (instanceError || !instance) {
      return { status: "error", message: "The workflow was not found." };
    }

    const template = instance.template as unknown as {
      template_key: string;
      required_provider_categories: string[];
      settings_schema: { fields?: { key: string }[] };
      risk_level: string;
    } | null;

    if (runtimeMode === "live") {
      const missing = await missingProviderCategories(
        supabase,
        clientId,
        template?.required_provider_categories ?? [],
      );

      if (missing.length > 0) {
        return {
          status: "error",
          message: `Live mode requires an active connection for: ${missing
            .map((category) => category.replaceAll("_", " "))
            .join(", ")}.`,
        };
      }
    }

    const settings: Record<string, unknown> = {
      ...((instance.settings as Record<string, unknown>) ?? {}),
    };

    for (const field of template?.settings_schema?.fields ?? []) {
      const value = formData.get(`setting_${field.key}`);

      if (typeof value === "string") {
        const trimmed = value.trim();

        if (trimmed) {
          settings[field.key] = trimmed;
        } else {
          delete settings[field.key];
        }
      }
    }

    const approvalPolicy: Record<string, unknown> = {
      ...((instance.approval_policy as Record<string, unknown>) ?? {}),
    };

    if (approvalPolicyChoice === "template_default") {
      delete approvalPolicy.requires_approval;
    } else {
      approvalPolicy.requires_approval = approvalPolicyChoice === "always";
    }

    // Guardrail: high-risk customer-facing workflows cannot waive approval
    // while running live.
    if (
      runtimeMode === "live" &&
      template?.risk_level === "high" &&
      approvalPolicy.requires_approval === false
    ) {
      return {
        status: "error",
        message:
          "High-risk workflows require approval in live mode. Change the approval policy before going live.",
      };
    }

    const { error: updateError } = await supabase
      .from("client_workflow_instances")
      .update({
        runtime_mode: runtimeMode,
        settings,
        approval_policy: approvalPolicy,
      })
      .eq("id", instanceId);

    if (updateError) {
      return { status: "error", message: "The workflow could not be updated." };
    }

    await recordAuditEvent({
      actor: access,
      action: "workflow.instance_updated",
      targetType: "client_workflow_instance",
      targetId: instanceId,
      summary: `Updated configuration for workflow "${instance.name}".`,
      beforeSnapshot: {
        runtime_mode: instance.runtime_mode,
        approval_policy: instance.approval_policy,
      },
      afterSnapshot: {
        runtime_mode: runtimeMode,
        approval_policy: approvalPolicy,
      },
    });

    if (instance.runtime_mode !== runtimeMode) {
      await recordAuditEvent({
        actor: access,
        action: "workflow.runtime_mode_changed",
        targetType: "client_workflow_instance",
        targetId: instanceId,
        summary: `Changed runtime mode for "${instance.name}" from ${instance.runtime_mode} to ${runtimeMode}.`,
        beforeSnapshot: { runtime_mode: instance.runtime_mode },
        afterSnapshot: { runtime_mode: runtimeMode },
      });
    }

    revalidatePath(`/partner/clients/${clientId}/workflows`);
    revalidatePath(
      `/partner/clients/${clientId}/workflows/${instanceId}`,
    );

    return { status: "success", message: "Workflow configuration saved." };
  } catch (error) {
    return deniedState(error);
  }
}
