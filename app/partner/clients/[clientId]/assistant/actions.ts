"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import { syncRunToCrm } from "@/lib/crm/sync-from-run";
import type { FormState } from "@/lib/forms/state";
import {
  isAccessError,
  requireClientWorkspaceAccess,
} from "@/lib/permissions/access";
import { PARTNER_OPERATOR_ROLES } from "@/lib/permissions/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Server actions behind the Staff Assistant Console's REAL buttons.
// Everything here follows the same rules as the rest of the app: explicit
// permission checks, tenant scoping, audit events, honest outcomes.

function deniedState(error: unknown): FormState {
  if (isAccessError(error)) {
    return {
      status: "error",
      message:
        error.code === "ACCESS_DENIED"
          ? "You do not have permission to use the assistant for this client."
          : "The assistant is unavailable right now. Try again shortly.",
    };
  }

  throw error;
}

async function requireAssistantContext(clientId: string) {
  const authState = await getAuthState();

  if (!authState.user) {
    return { error: "Sign in to use the assistant." } as const;
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

// Escalate: flags the current interaction for a manager. Real action — it
// lands in the audit trail (which the console itself displays).
export async function escalateInteraction(
  clientId: string,
  note: string,
): Promise<FormState> {
  const trimmed = note.trim();

  try {
    const context = await requireAssistantContext(clientId);

    if ("error" in context) {
      return { status: "error", message: context.error };
    }

    const { access } = context;

    await recordAuditEvent({
      actor: access,
      action: "assistant.escalated",
      targetType: "client_business",
      targetId: clientId,
      summary: trimmed
        ? `Escalated the active interaction from the assistant console: ${trimmed}`
        : "Escalated the active interaction from the assistant console.",
      metadata: { source: "staff_assistant_console" },
    });

    revalidatePath(`/partner/clients/${clientId}/assistant`);

    return {
      status: "success",
      message:
        "Escalated. The escalation is recorded in the audit trail; manager notifications ship with the notification pack.",
    };
  } catch (error) {
    return deniedState(error);
  }
}

// Sync to CRM: re-runs the additive contact + AI-note sync for the latest
// lead-bearing run. Same safe path the engine uses (dry run unless the CRM
// connection is live; never destructive).
export async function resyncLatestLeadToCrm(
  clientId: string,
): Promise<FormState> {
  try {
    const context = await requireAssistantContext(clientId);

    if ("error" in context) {
      return { status: "error", message: context.error };
    }

    const { access, supabase, partnerId } = context;

    const { data: runs } = await supabase
      .from("workflow_runs")
      .select(
        "id, summary, input_snapshot, template:workflow_templates!inner(template_key)",
      )
      .eq("client_id", clientId)
      .in("template.template_key", ["new_lead_intake", "ai_intake_router"])
      .order("started_at", { ascending: false })
      .limit(1);

    const run = (runs ?? [])[0] as unknown as
      | {
          id: string;
          summary: string | null;
          input_snapshot: {
            event_type?: string;
            data?: Record<string, unknown>;
          } | null;
          template: { template_key: string } | null;
        }
      | undefined;

    if (!run) {
      return {
        status: "error",
        message: "No lead has come through yet — there is nothing to sync.",
      };
    }

    const admin = createSupabaseAdminClient();

    if (!admin) {
      return {
        status: "error",
        message: "The server is not configured to reach the CRM.",
      };
    }

    const { data: client } = await supabase
      .from("client_businesses")
      .select("name")
      .eq("id", clientId)
      .maybeSingle();

    const outcome = await syncRunToCrm(admin, {
      partnerId,
      clientId,
      runId: run.id,
      templateKey: run.template?.template_key ?? "new_lead_intake",
      clientName: client?.name ?? "the business",
      eventType: run.input_snapshot?.event_type ?? "assistant.manual_sync",
      eventData: run.input_snapshot?.data ?? {},
      runSummary:
        run.summary ?? "Manual CRM sync from the assistant console.",
    });

    if (!outcome) {
      return {
        status: "error",
        message:
          "No connected CRM was found. Connect HubSpot in the Setup checklist first.",
      };
    }

    await recordAuditEvent({
      actor: access,
      action: "assistant.crm_sync_triggered",
      targetType: "workflow_run",
      targetId: run.id,
      summary: `Manually triggered CRM sync from the assistant console. Result: ${outcome.step.name}.`,
      metadata: { source: "staff_assistant_console" },
    });

    revalidatePath(`/partner/clients/${clientId}/assistant`);

    return {
      status:
        outcome.step.name === "CRM sync failed" ? "error" : "success",
      message: outcome.step.detail,
    };
  } catch (error) {
    return deniedState(error);
  }
}
