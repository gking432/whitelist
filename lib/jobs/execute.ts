import { executeEmbeddedAction } from "@/lib/integrations/embedded/runtime";
import { crmSyncDeliveryStatus } from "@/lib/crm/sync-outcome";
import type { SupabaseClient } from "@supabase/supabase-js";

import { syncRunToCrm } from "@/lib/crm/sync-from-run";
import {
  deliverApprovedCustomerMessage,
  type DeliveryOutcome,
} from "@/lib/delivery/customer-message";
import type { ActionJobRecord } from "@/lib/jobs/record";
import { authorizedActionPayload, type ApprovalSnapshot } from "./execution-state.ts";
import { recordAppointmentBooking, recordTimelineMessage } from "@/lib/crm/internal";
import { queueBookingConfirmationDraft } from "@/lib/scheduling/confirmation";
import { bookApprovedAppointment } from "@/lib/scheduling/book-approved";

// Executes one durable action job — the shared dispatch used by manual
// retry (Runs / Logs) and the background runner. Every path re-runs the
// SAME already-approved payload through the same gated delivery code:
// approval and live-mode rules apply on every attempt, so a retry can
// never widen what was approved.

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export async function executeActionJob(
  admin: SupabaseClient,
  job: ActionJobRecord,
): Promise<DeliveryOutcome> {
  if (job.kind !== "crm.sync") {
    const { data: approval, error } = await admin.from("approval_items")
      .select("id, partner_id, client_id, status, type, resolved_content, proposed_payload")
      .eq("id", job.approval_id ?? "00000000-0000-0000-0000-000000000000")
      .eq("partner_id", job.partner_id).eq("client_id", job.client_id).maybeSingle();
    if (error) throw new Error("Approval could not be verified; delivery stopped.");
    const payload = authorizedActionPayload(job, approval as ApprovalSnapshot | null);
    if (!payload) return { status: "skipped", attempted: false, delivered: false, detail: "No matching human approval authorizes this action. Nothing was sent." };
    job = { ...job, payload };
  }
  if (job.kind === "external.action") return executeEmbeddedAction(admin, job);
  const { data: clientRow } = await admin
    .from("client_businesses")
    .select("name")
    .eq("id", job.client_id)
    .maybeSingle();

  const clientName = clientRow?.name ?? "the business";

  if (job.kind === "sms.send" || job.kind === "email.send") {
    const outcome = await deliverApprovedCustomerMessage({
      approvalId: job.approval_id ?? job.id,
      partnerId: job.partner_id,
      clientId: job.client_id,
      workflowRunId: job.workflow_run_id,
      channel:
        asString(job.payload.channel) ??
        (job.kind === "email.send" ? "email" : "sms"),
      to: asString(job.payload.to),
      body: asString(job.payload.body) ?? "",
      subject: asString(job.payload.subject),
    });
    await recordTimelineMessage({ partnerId: job.partner_id, clientId: job.client_id,
      approvalId: job.approval_id!, workflowRunId: job.workflow_run_id,
      channel: asString(job.payload.channel) ?? "sms", to: asString(job.payload.to),
      body: asString(job.payload.body) ?? "", outcomeStatus: outcome.status });
    const { error: inboxError } = await admin.from("crm_communications").update({
      status: outcome.status === "succeeded" ? "sent" : ["failed", "uncertain"].includes(outcome.status) ? "failed" : "approved",
      human_approved: true, provider_ref: outcome.externalRef ?? null,
    }).eq("approval_id", job.approval_id).eq("client_id", job.client_id);
    if (inboxError) throw new Error("Delivery requires inbox reconciliation.");
    return outcome;
  }

  if (job.kind === "calendar.book") {
    const outcome = await bookApprovedAppointment({
      approvalId: job.approval_id ?? job.id,
      partnerId: job.partner_id,
      clientId: job.client_id,
      workflowRunId: job.workflow_run_id,
      payload: job.payload,
      clientName,
    });
    if (outcome.status === "succeeded" || outcome.status === "dry_run") {
      await recordAppointmentBooking({ partnerId: job.partner_id, clientId: job.client_id,
        approvalId: job.approval_id!, workflowRunId: job.workflow_run_id,
        payload: job.payload, outcomeStatus: outcome.status, externalRef: outcome.externalRef ?? null });
      // A dry-run booking must never produce a sendable real confirmation.
      if (outcome.status === "succeeded") await queueBookingConfirmationDraft({
        partnerId: job.partner_id, clientId: job.client_id, clientName,
        workflowRunId: job.workflow_run_id, payload: job.payload, bookedLive: true });
    }
    return outcome;
  }

  // crm.sync: re-run the additive contact + note sync for the stored run.
  const runId = asString(job.payload.run_id) ?? job.workflow_run_id;

  if (!runId) {
    return {
      attempted: false,
      delivered: false,
      status: "skipped",
      detail: "This sync has no stored run to retry.",
    };
  }

  const { data: run } = await admin
    .from("workflow_runs")
    .select(
      "id, summary, input_snapshot, template:workflow_templates(template_key)",
    )
    .eq("id", runId)
    .eq("client_id", job.client_id)
    .maybeSingle();

  if (!run) {
    return {
      attempted: false,
      delivered: false,
      status: "skipped",
      detail: "The original run was not found.",
    };
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

  const syncResult = await syncRunToCrm(admin, {
    partnerId: job.partner_id,
    clientId: job.client_id,
    runId: runRow.id,
    templateKey: runRow.template?.template_key ?? "new_lead_intake",
    clientName,
    eventType: runRow.input_snapshot?.event_type ?? "retry.manual",
    eventData: runRow.input_snapshot?.data ?? {},
    runSummary: runRow.summary ?? "Retry of CRM sync.",
  });

  const syncStatus = String(syncResult?.crm.status ?? "skipped");

  return {
    attempted: syncStatus !== "skipped",
    delivered: syncStatus === "synced",
    status: crmSyncDeliveryStatus(syncStatus),
    detail:
      syncResult?.step.detail ??
      "No connected CRM was found — connect one in Setup first.",
  };
}
