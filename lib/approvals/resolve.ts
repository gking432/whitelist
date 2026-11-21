import { settleWorkflowApprovals } from "@/lib/approvals/workflow-status";
import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAuditEvent } from "@/lib/audit/audit";
import type { DeliveryOutcome } from "@/lib/delivery/customer-message";
import { dispatchActionJob } from "@/lib/jobs/dispatch";
import type { ActionJobRecord } from "@/lib/jobs/record";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { FormState } from "@/lib/forms/state";
import type { AccessContext } from "@/lib/permissions/types";

export type ApprovalResolution = "approve" | "edit_and_approve" | "reject";
export type ApprovalResolutionResult = FormState & {
  httpStatus: 200 | 403 | 404 | 409 | 422 | 503;
};

export type ResolveApprovalInput = {
  supabase: SupabaseClient;
  access: AccessContext;
  approvalId: string;
  clientId: string;
  resolution: ApprovalResolution;
  editedContent?: string;
  note?: string;
};

type ApprovalRow = {
  id: string;
  partner_id: string;
  client_id: string;
  workflow_run_id: string | null;
  type: string;
  status: string;
  title: string;
  editable_content: string | null;
  proposed_payload: Record<string, unknown> | null;
  assigned_to: string | null;
};

function databaseFailure(error: { code?: string }): ApprovalResolutionResult {
  if (error.code === "PT409") {
    return { status: "error", httpStatus: 409,
      message: "The approval or its source changed. Refresh and review before deciding again." };
  }
  if (error.code === "42501") {
    return { status: "error", httpStatus: 403, message: "Your current access cannot resolve this approval item." };
  }
  if (error.code === "22023") {
    return { status: "error", httpStatus: 422, message: "Review the approval and its current source before deciding again." };
  }
  return { status: "error", httpStatus: 503,
    message: "The approval could not be resolved. Refresh to check its current state before trying again." };
}

// Shared by partner and client portal actions. Callers must have already
// resolved an access context scoped to the approval's client; RLS enforces
// the same boundary underneath.
export async function resolveApprovalItem(
  input: ResolveApprovalInput,
): Promise<ApprovalResolutionResult> {
  const { supabase, access, approvalId, clientId, resolution } = input;

  if (!access.canResolveApprovals) {
    return {
      status: "error",
      httpStatus: 403,
      message: "Your role cannot resolve approval items.",
    };
  }

  const { data, error } = await supabase
    .from("approval_items")
    .select(
      "id, partner_id, client_id, workflow_run_id, type, status, title, editable_content, proposed_payload, assigned_to",
    )
    .eq("id", approvalId)
    .eq("client_id", clientId)
    .maybeSingle();

  const approval = data as ApprovalRow | null;

  if (error) {
    return databaseFailure(error);
  }
  if (!approval) {
    return { status: "error", httpStatus: 404, message: "The approval item was not found." };
  }
  const crmGateway = approval.type === "crm_change" || approval.proposed_payload?.crm_gateway_version === 1;

  if (approval.status !== "pending") {
    return {
      status: "error",
      httpStatus: 409,
      message: "This approval item was already resolved.",
    };
  }

  // Client staff may only resolve items assigned to them (RLS enforces this
  // too; check here for a clear message).
  if (
    access.role === "client_staff" &&
    approval.assigned_to !== access.userId
  ) {
    return {
      status: "error",
      httpStatus: 403,
      message: "This approval is not assigned to you.",
    };
  }

  if (approval.type === "appointment_change" && resolution === "edit_and_approve") {
    return { status: "error", httpStatus: 422, message: "Reject this appointment change and prepare a new exact proposal to change its time or source." };
  }
  if (crmGateway && resolution === "edit_and_approve") {
    return { status: "error", httpStatus: 422, message: "Reject this HubSpot proposal and prepare a fresh source review to change its exact target, customer fields or note." };
  }

  const editedContent = input.editedContent?.trim();

  if (resolution === "edit_and_approve" && !editedContent) {
    return {
      status: "error",
      httpStatus: 422,
      message: "Provide the edited content before approving.",
    };
  }

  const nextStatus =
    resolution === "approve"
      ? "approved"
      : resolution === "edit_and_approve"
        ? "edited_and_approved"
        : "rejected";

  const resolvedContent =
    resolution === "reject"
      ? null
      : resolution === "edit_and_approve"
        ? editedContent
        : approval.editable_content;

  const resolvedAt = new Date().toISOString();

  const { data: resolved, error: updateError } = await supabase
    .from("approval_items")
    .update({
      status: nextStatus,
      resolved_by: access.userId,
      resolved_at: resolvedAt,
      resolved_content: resolvedContent,
      resolution_note: input.note?.trim() || null,
    })
    .eq("id", approvalId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (updateError) {
    return databaseFailure(updateError);
  }
  if (!resolved) {
    return {
      status: "error",
      httpStatus: 409,
      message: "This approval item changed or was already resolved. Refresh and review its current state.",
    };
  }

  // The database committed delivery intent in the same transaction as the
  // winning resolution. A crashed request leaves a pending job for the worker.
  let delivery: DeliveryOutcome | null = null;
  if (resolution !== "reject") {
    const admin = createSupabaseAdminClient();
    if (admin) {
      const { data: job } = await admin.from("action_jobs").select("*")
        .eq("execution_key", `approval:${approval.id}`).maybeSingle();
      if (job) {
        try {
          delivery = await dispatchActionJob(admin, job as ActionJobRecord);
        } catch {
          delivery = { status: "uncertain", attempted: false, delivered: false,
            detail: "Approval saved. Delivery needs review in Action history; do not send it again." };
        }
      }
    }
  }

  // Transition the paused run, recording exactly what happened to the
  // approved content (sent, dry run, or recorded only).
  // A gateway proposal references the original run as source evidence. Its
  // resolution must not rewrite that run's summary/status; the new outcome
  // belongs to this approval and its durable action job.
  if (approval.workflow_run_id && !crmGateway) {
    const approvedSummary =
      resolution === "reject"
        ? `Rejected: ${approval.title}`
        : delivery
          ? `Approved: ${approval.title}. ${delivery.detail}`
          : `Approved: ${approval.title}. The approved content is recorded on the approval item; no automatic delivery applies to this item type.`;

    const statusDb = createSupabaseAdminClient();
    if (statusDb) await settleWorkflowApprovals(statusDb, approval.partner_id, clientId, approval.workflow_run_id, approvedSummary);
  }

  await recordAuditEvent({
    actor: { ...access, partnerId: approval.partner_id, clientId },
    action: "approval.resolved",
    targetType: "approval_item",
    targetId: approvalId,
    summary: `${
      nextStatus === "rejected"
        ? "Rejected"
        : nextStatus === "edited_and_approved"
          ? "Edited and approved"
          : "Approved"
    } "${approval.title}".`,
    beforeSnapshot: { status: "pending" },
    afterSnapshot: {
      status: nextStatus,
      resolution_note: input.note?.trim() || null,
    },
    metadata: {
      approval_type: approval.type,
      ...(delivery
        ? {
            delivery_attempted: delivery.attempted,
            delivery_delivered: delivery.delivered,
          }
        : {}),
    },
  });

  return {
    status: "success",
    httpStatus: 200,
    message:
      nextStatus === "rejected"
        ? crmGateway ? "HubSpot proposal rejected." : "Approval rejected. The workflow run was cancelled."
        : delivery
          ? delivery.detail
          : crmGateway ? "HubSpot approval recorded. Check Action history for a verified provider result." : "Approval recorded. The workflow run was completed.",
  };
}
