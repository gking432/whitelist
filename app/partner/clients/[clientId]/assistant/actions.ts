"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import { syncRunToCrm } from "@/lib/crm/sync-from-run";
import type { FormState } from "@/lib/forms/state";
import { resolveAssistantAccess } from "@/lib/assistant/access";
import { emitAssistantEvent } from "@/lib/assistant/events";
import { isAccessError } from "@/lib/permissions/access";
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

  // Partner operators AND the client's own owner/manager/staff may act.
  const access = await resolveAssistantAccess(authState.user.id, clientId, "write");

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

    await emitAssistantEvent({
      partnerId: context.partnerId,
      clientId,
      eventType: "escalation_needed",
      payload: { note: trimmed || null },
    });

    revalidatePath(`/partner/clients/${clientId}/assistant`);
    revalidatePath("/client/assistant");

    return {
      status: "success",
      message:
        "Escalated. The escalation is recorded in the audit trail; manager notifications ship with the notification pack.",
    };
  } catch (error) {
    return deniedState(error);
  }
}

// Create task: writes the AI-suggested follow-up task (from the latest
// lead analysis) into the built-in CRM task list. Internal-only — never
// customer-facing, so no approval gate; audited like everything else.
export async function createTaskFromAssistant(
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
        "id, output_snapshot, template:workflow_templates!inner(template_key)",
      )
      .eq("client_id", clientId)
      .eq("template.template_key", "new_lead_intake")
      .order("started_at", { ascending: false })
      .limit(1);

    const run = (runs ?? [])[0] as unknown as
      | {
          id: string;
          output_snapshot: {
            output?: {
              analysis?: { suggested_task?: Record<string, unknown> };
            };
          } | null;
        }
      | undefined;

    const suggested = run?.output_snapshot?.output?.analysis?.suggested_task;

    if (!run || !suggested?.title) {
      return {
        status: "error",
        message: "No AI-suggested task exists yet — it appears after a lead.",
      };
    }

    const admin = createSupabaseAdminClient();

    if (!admin) {
      return { status: "error", message: "The data service is unavailable." };
    }

    const dueAt =
      typeof suggested.due_in_minutes === "number"
        ? new Date(
            Date.now() + suggested.due_in_minutes * 60 * 1000,
          ).toISOString()
        : null;

    const { error } = await admin.from("crm_tasks").insert({
      partner_id: partnerId,
      client_id: clientId,
      title: String(suggested.title),
      description:
        typeof suggested.description === "string"
          ? suggested.description
          : null,
      priority: ["urgent", "high", "medium", "low"].includes(
        String(suggested.priority),
      )
        ? String(suggested.priority)
        : "medium",
      status: "open",
      due_at: dueAt,
      created_by: access.userId,
    });

    if (error) {
      return { status: "error", message: "The task could not be created." };
    }

    await recordAuditEvent({
      actor: access,
      action: "assistant.task_created",
      targetType: "workflow_run",
      targetId: run.id,
      summary: `Created the AI-suggested task "${suggested.title}" from the assistant console.`,
      metadata: { source: "staff_assistant_console" },
    });

    revalidatePath(`/partner/clients/${clientId}/crm`);
    revalidatePath(`/partner/clients/${clientId}/assistant`);
    revalidatePath("/client/assistant");

    return {
      status: "success",
      message: `Task created: "${suggested.title}". Find it on the CRM tab.`,
    };
  } catch (error) {
    return deniedState(error);
  }
}

// Mark spam / low-value: closes the latest built-in-CRM lead as lost and
// records the decision. Internal-only; audited.
export async function markLatestLeadLowValue(
  clientId: string,
): Promise<FormState> {
  try {
    const context = await requireAssistantContext(clientId);

    if ("error" in context) {
      return { status: "error", message: context.error };
    }

    const { access } = context;
    const admin = createSupabaseAdminClient();

    if (!admin) {
      return { status: "error", message: "The data service is unavailable." };
    }

    const { data: lead } = await admin
      .from("crm_leads")
      .select("id, status, contact_id")
      .eq("client_id", clientId)
      .neq("status", "lost")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lead) {
      await admin
        .from("crm_leads")
        .update({ status: "lost" })
        .eq("id", lead.id);

      if (lead.contact_id) {
        await admin.from("crm_timeline_entries").insert({
          partner_id: context.partnerId,
          client_id: clientId,
          contact_id: lead.contact_id,
          lead_id: lead.id,
          kind: "note",
          actor_type: "user",
          actor_user_id: access.userId,
          title: "Marked spam / low-value from the assistant console",
          body: null,
        });
      }
    }

    await recordAuditEvent({
      actor: access,
      action: "assistant.marked_low_value",
      targetType: lead ? "crm_lead" : "client_business",
      targetId: lead?.id ?? clientId,
      summary: lead
        ? "Marked the latest lead as spam/low-value from the assistant console."
        : "Marked the latest interaction as spam/low-value from the assistant console (no built-in CRM lead existed).",
      metadata: { source: "staff_assistant_console" },
    });

    revalidatePath(`/partner/clients/${clientId}/crm`);
    revalidatePath(`/partner/clients/${clientId}/assistant`);
    revalidatePath("/client/assistant");

    return {
      status: "success",
      message: lead
        ? "Marked as spam/low-value — the lead is closed."
        : "Recorded as spam/low-value.",
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
    revalidatePath("/client/assistant");

    return {
      status:
        outcome.step.name === "CRM sync failed" ? "error" : "success",
      message: outcome.step.detail,
    };
  } catch (error) {
    return deniedState(error);
  }
}
