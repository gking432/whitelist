"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import { syncRunToCrm } from "@/lib/crm/sync-from-run";
import {
  deliverApprovedCustomerMessage,
  type DeliveryOutcome,
} from "@/lib/delivery/customer-message";
import type { FormState } from "@/lib/forms/state";
import {
  isRetryableJobStatus,
  updateActionJobAfterRetry,
  type ActionJobRecord,
} from "@/lib/jobs/record";
import {
  isAccessError,
  requireClientWorkspaceAccess,
} from "@/lib/permissions/access";
import { PARTNER_OPERATOR_ROLES } from "@/lib/permissions/roles";
import { bookApprovedAppointment } from "@/lib/scheduling/book-approved";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Retry a durable action job. Re-executes the SAME already-approved payload
// through the same gated delivery path — a retry can never widen what was
// approved, and live-mode rules still apply on every attempt.

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export async function retryActionJob(
  clientId: string,
  jobId: string,
): Promise<FormState> {
  const authState = await getAuthState();

  if (!authState.user) {
    return { status: "error", message: "Sign in to retry actions." };
  }

  try {
    const access = await requireClientWorkspaceAccess(
      authState.user.id,
      clientId,
      PARTNER_OPERATOR_ROLES,
    );

    const supabase = await createSupabaseServerClient();
    const admin = createSupabaseAdminClient();

    if (!supabase || !admin || !access.partnerId) {
      return { status: "error", message: "The data service is unavailable." };
    }

    const { data } = await supabase
      .from("action_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("client_id", clientId)
      .eq("partner_id", access.partnerId)
      .maybeSingle();

    const job = data as ActionJobRecord | null;

    if (!job) {
      return { status: "error", message: "The action was not found." };
    }

    if (!isRetryableJobStatus(job.status)) {
      return {
        status: "error",
        message: `This action is ${job.status.replaceAll("_", " ")} and cannot be retried.`,
      };
    }

    let outcome: DeliveryOutcome;

    if (job.kind === "sms.send" || job.kind === "email.send") {
      outcome = await deliverApprovedCustomerMessage({
        approvalId: job.approval_id ?? job.id,
        partnerId: job.partner_id,
        clientId: job.client_id,
        workflowRunId: job.workflow_run_id,
        channel: asString(job.payload.channel) ?? (job.kind === "email.send" ? "email" : "sms"),
        to: asString(job.payload.to),
        body: asString(job.payload.body) ?? "",
        subject: asString(job.payload.subject),
      });
    } else if (job.kind === "calendar.book") {
      const { data: clientRow } = await supabase
        .from("client_businesses")
        .select("name")
        .eq("id", clientId)
        .maybeSingle();

      outcome = await bookApprovedAppointment({
        approvalId: job.approval_id ?? job.id,
        partnerId: job.partner_id,
        clientId: job.client_id,
        workflowRunId: job.workflow_run_id,
        payload: job.payload,
        clientName: clientRow?.name ?? "the business",
      });
    } else {
      // crm.sync: re-run the additive contact+note sync for the stored run.
      const runId = asString(job.payload.run_id) ?? job.workflow_run_id;

      if (!runId) {
        return {
          status: "error",
          message: "This sync has no stored run to retry.",
        };
      }

      const { data: run } = await admin
        .from("workflow_runs")
        .select(
          "id, summary, input_snapshot, template:workflow_templates(template_key)",
        )
        .eq("id", runId)
        .eq("client_id", clientId)
        .maybeSingle();

      if (!run) {
        return { status: "error", message: "The original run was not found." };
      }

      const runRow = run as unknown as {
        id: string;
        summary: string | null;
        input_snapshot: {
          event_type?: string;
          data?: Record<string, unknown>;
        } | null;
        template: { template_key: string } | null;
      };

      const { data: clientRow } = await supabase
        .from("client_businesses")
        .select("name")
        .eq("id", clientId)
        .maybeSingle();

      const syncResult = await syncRunToCrm(admin, {
        partnerId: job.partner_id,
        clientId: job.client_id,
        runId: runRow.id,
        templateKey: runRow.template?.template_key ?? "new_lead_intake",
        clientName: clientRow?.name ?? "the business",
        eventType: runRow.input_snapshot?.event_type ?? "retry.manual",
        eventData: runRow.input_snapshot?.data ?? {},
        runSummary: runRow.summary ?? "Manual retry of CRM sync.",
      });

      const syncStatus = String(syncResult?.crm.status ?? "skipped");

      outcome = {
        attempted: syncStatus !== "skipped",
        delivered: syncStatus === "synced",
        status:
          syncStatus === "synced"
            ? "succeeded"
            : syncStatus === "dry_run"
              ? "dry_run"
              : syncStatus === "failed"
                ? "failed"
                : "skipped",
        detail:
          syncResult?.step.detail ??
          "No connected CRM was found — connect one in Setup first.",
      };
    }

    await updateActionJobAfterRetry(admin, job, outcome);

    await recordAuditEvent({
      actor: access,
      action: "job.retried",
      targetType: "action_job",
      targetId: job.id,
      summary: `Retried ${job.kind.replaceAll(".", " ")} (attempt ${job.attempt_count + 1}): ${outcome.status.replaceAll("_", " ")}.`,
      metadata: { kind: job.kind, status: outcome.status },
    });

    revalidatePath(`/partner/clients/${clientId}/runs`);

    return {
      status: outcome.status === "failed" ? "error" : "success",
      message: outcome.detail,
    };
  } catch (error) {
    if (isAccessError(error)) {
      return {
        status: "error",
        message:
          error.code === "ACCESS_DENIED"
            ? "You do not have permission to retry actions for this client."
            : "Retries are unavailable right now. Try again shortly.",
      };
    }

    throw error;
  }
}
