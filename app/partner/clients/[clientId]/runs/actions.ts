"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import type { FormState } from "@/lib/forms/state";
import { executeActionJob } from "@/lib/jobs/execute";
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
    const access = await requireClientWorkspaceAccess(
      authState.user.id,
      clientId,
      PARTNER_OPERATOR_ROLES,
    );

    if (!access.canOperateCustomerActions) {
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

    const outcome = await executeActionJob(admin, job);

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
