import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAuditEvent } from "@/lib/audit/audit";
import {
  deliverApprovedCustomerMessage,
  type DeliveryOutcome,
} from "@/lib/delivery/customer-message";
import { bookApprovedAppointment } from "@/lib/scheduling/book-approved";
import type { FormState } from "@/lib/forms/state";
import type { AccessContext } from "@/lib/permissions/types";

export type ApprovalResolution = "approve" | "edit_and_approve" | "reject";

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

// Shared by partner and client portal actions. Callers must have already
// resolved an access context scoped to the approval's client; RLS enforces
// the same boundary underneath.
export async function resolveApprovalItem(
  input: ResolveApprovalInput,
): Promise<FormState> {
  const { supabase, access, approvalId, clientId, resolution } = input;

  if (!access.canResolveApprovals) {
    return {
      status: "error",
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

  if (error || !approval) {
    return { status: "error", message: "The approval item was not found." };
  }

  if (approval.status !== "pending") {
    return {
      status: "error",
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
      message: "This approval is not assigned to you.",
    };
  }

  const editedContent = input.editedContent?.trim();

  if (resolution === "edit_and_approve" && !editedContent) {
    return {
      status: "error",
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

  const { error: updateError } = await supabase
    .from("approval_items")
    .update({
      status: nextStatus,
      resolved_by: access.userId,
      resolved_at: resolvedAt,
      resolved_content: resolvedContent,
      resolution_note: input.note?.trim() || null,
    })
    .eq("id", approvalId)
    .eq("status", "pending");

  if (updateError) {
    return {
      status: "error",
      message: "The approval could not be resolved. Try again.",
    };
  }

  // Delivery/booking happens only here — strictly after a human approved.
  // Each path itself refuses to act unless its connection is in live mode.
  let delivery: DeliveryOutcome | null = null;

  if (
    resolution !== "reject" &&
    approval.type === "customer_message" &&
    resolvedContent
  ) {
    const payload = approval.proposed_payload ?? {};

    delivery = await deliverApprovedCustomerMessage({
      approvalId: approval.id,
      partnerId: approval.partner_id,
      clientId: approval.client_id,
      workflowRunId: approval.workflow_run_id,
      channel: typeof payload.channel === "string" ? payload.channel : null,
      to: typeof payload.to === "string" ? payload.to : null,
      body: resolvedContent,
      subject: typeof payload.subject === "string" ? payload.subject : null,
    });
  } else if (
    resolution !== "reject" &&
    approval.type === "appointment_booking"
  ) {
    const { data: clientRow } = await supabase
      .from("client_businesses")
      .select("name")
      .eq("id", approval.client_id)
      .maybeSingle();

    delivery = await bookApprovedAppointment({
      approvalId: approval.id,
      partnerId: approval.partner_id,
      clientId: approval.client_id,
      workflowRunId: approval.workflow_run_id,
      payload: approval.proposed_payload ?? {},
      clientName: clientRow?.name ?? "the business",
    });
  }

  // Transition the paused run, recording exactly what happened to the
  // approved content (sent, dry run, or recorded only).
  if (approval.workflow_run_id) {
    const approvedSummary =
      resolution === "reject"
        ? `Rejected: ${approval.title}`
        : delivery
          ? `Approved: ${approval.title}. ${delivery.detail}`
          : `Approved: ${approval.title}. The approved content is recorded on the approval item; no automatic delivery applies to this item type.`;

    await supabase
      .from("workflow_runs")
      .update({
        status: resolution === "reject" ? "cancelled" : "succeeded",
        finished_at: resolvedAt,
        summary: approvedSummary,
      })
      .eq("id", approval.workflow_run_id)
      .eq("status", "paused_for_approval");
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
    message:
      nextStatus === "rejected"
        ? "Approval rejected. The workflow run was cancelled."
        : delivery
          ? delivery.detail
          : "Approval recorded. The workflow run was completed.",
  };
}
