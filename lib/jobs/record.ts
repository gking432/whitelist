import type { SupabaseClient } from "@supabase/supabase-js";

import { redactAuditValue } from "@/lib/audit/redact";
import type { DeliveryOutcome } from "@/lib/delivery/customer-message";
import { actionJobOutcomeFields } from "@/lib/jobs/outcome";
export { isRetryableJobStatus } from "@/lib/jobs/outcome";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Durable action jobs: every provider-facing action records an attempt row
// so failures are visible and retryable. Written only via the service role;
// browser roles read. Recording is best-effort — a job-log failure must
// never break the action it describes.

export type ActionJobKind =
  | "sms.send"
  | "email.send"
  | "calendar.book"
  | "crm.sync";

export type ActionJobRecord = {
  id: string;
  partner_id: string;
  client_id: string;
  connection_id: string | null;
  approval_id: string | null;
  workflow_run_id: string | null;
  kind: ActionJobKind;
  payload: Record<string, unknown>;
  status: string;
  attempt_count: number;
  outcome_detail?: string | null;
  last_error: string | null;
  last_attempt_at: string | null;
  created_at: string;
};

export async function recordActionJob(input: {
  partnerId: string;
  clientId: string;
  kind: ActionJobKind;
  payload: Record<string, unknown>;
  outcome: DeliveryOutcome;
  approvalId?: string | null;
  workflowRunId?: string | null;
  connectionId?: string | null;
}): Promise<void> {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return;
  }

  await admin.from("action_jobs").insert({
    partner_id: input.partnerId,
    client_id: input.clientId,
    connection_id: input.connectionId ?? null,
    approval_id: input.approvalId ?? null,
    workflow_run_id: input.workflowRunId ?? null,
    kind: input.kind,
    payload: redactAuditValue(input.payload),
    ...actionJobOutcomeFields(input.outcome),
    attempt_count: 1,
    last_attempt_at: new Date().toISOString(),
  });
}

export async function updateActionJobAfterRetry(
  admin: SupabaseClient,
  job: Pick<ActionJobRecord, "id" | "attempt_count">,
  outcome: DeliveryOutcome,
): Promise<void> {
  await admin
    .from("action_jobs")
    .update({
      ...actionJobOutcomeFields(outcome),
      attempt_count: job.attempt_count + 1,
      last_attempt_at: new Date().toISOString(),
    })
    .eq("id", job.id);
}
