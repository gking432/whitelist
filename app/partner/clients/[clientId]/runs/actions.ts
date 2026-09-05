"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import type { FormState } from "@/lib/forms/state";
import { dispatchActionJob } from "@/lib/jobs/dispatch";
import { isRetryableJobStatus, type ActionJobRecord } from "@/lib/jobs/record";
import {
  isAccessError,
  requirePrimaryClientAccess,
} from "@/lib/permissions/access";
import { CLIENT_APPROVER_ROLES } from "@/lib/permissions/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Retry a durable action job. Re-executes the SAME already-approved payload
// through the same gated delivery path — a retry can never widen what was
// approved, and live-mode rules still apply on every attempt.

export async function retryActionJob(
  clientId: string,
  jobId: string,
): Promise<FormState> {
  const authState = await getAuthState();

  if (!authState.user) {
    return { status: "error", message: "Sign in to retry actions." };
  }

  try {
    const access = await requirePrimaryClientAccess(
      authState.user.id,
      CLIENT_APPROVER_ROLES,
    );

    if (
      !access.canOperateCustomerActions ||
      access.clientId !== clientId ||
      access.isImpersonating
    ) {
      return {
        status: "error",
        message: "Only authorized client staff can retry customer actions.",
      };
    }

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

    const outcome = await dispatchActionJob(admin, job, true);
    if (!outcome)
      return {
        status: "error",
        message: "This action is already being processed.",
      };

    await recordAuditEvent({
      actor: access,
      action: "job.retried",
      targetType: "action_job",
      targetId: job.id,
      summary: `Retried ${job.kind.replaceAll(".", " ")} (attempt ${job.attempt_count + 1}): ${outcome.status.replaceAll("_", " ")}.`,
      metadata: { kind: job.kind, status: outcome.status },
    });

    revalidatePath(`/partner/clients/${clientId}/runs`);
    revalidatePath("/client/approvals");

    return {
      status: ["failed", "uncertain"].includes(outcome.status)
        ? "error"
        : "success",
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

export async function reconcileActionJob(
  clientId: string,
  jobId: string,
  outcome: string,
  evidence: string,
): Promise<FormState> {
  const authState = await getAuthState();
  if (!authState.user)
    return { status: "error", message: "Sign in to review this delivery." };
  try {
    const access = await requirePrimaryClientAccess(authState.user.id, [
      "client_owner",
    ]);
    if (
      access.clientId !== clientId ||
      !access.partnerId ||
      access.isImpersonating
    ) {
      return {
        status: "error",
        message: "Only the business owner can confirm provider results.",
      };
    }
    if (
      !["succeeded", "cancelled"].includes(outcome) ||
      typeof evidence !== "string" ||
      evidence.trim().length < 20 ||
      evidence.length > 1000
    ) {
      return {
        status: "error",
        message:
          "Select the confirmed result and add 20–1,000 characters of provider evidence.",
      };
    }
    const admin = createSupabaseAdminClient();
    if (!admin)
      return { status: "error", message: "The data service is unavailable." };
    const { data, error } = await admin.rpc("reconcile_uncertain_action", {
      p_job_id: jobId,
      p_client_id: clientId,
      p_partner_id: access.partnerId,
      p_actor_id: access.userId,
      p_status: outcome,
      p_evidence: evidence.trim(),
    });
    if (error || !data)
      return {
        status: "error",
        message:
          "This result could not be saved. Refresh to check whether someone already resolved it.",
      };
    revalidatePath("/client/approvals");
    revalidatePath(`/partner/clients/${clientId}/runs`);
    return {
      status: "success",
      message: "Provider result recorded. Nothing was sent or booked again.",
    };
  } catch (error) {
    if (isAccessError(error))
      return {
        status: "error",
        message: "Only the business owner can confirm provider results.",
      };
    throw error;
  }
}
