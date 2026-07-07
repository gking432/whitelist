import type { SupabaseClient } from "@supabase/supabase-js";

import { redactAuditValue } from "@/lib/audit/redact";
import type { DeliveryOutcome } from "@/lib/delivery/customer-message";
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
    status: input.outcome.status,
    attempt_count: 1,
    last_error: input.outcome.status === "failed" ? input.outcome.detail : null,
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
      status: outcome.status,
      attempt_count: job.attempt_count + 1,
      last_error: outcome.status === "failed" ? outcome.detail : null,
      last_attempt_at: new Date().toISOString(),
    })
    .eq("id", job.id);
}

// A job can be retried when it did not succeed and is not cancelled.
// dry_run is retryable on purpose: flip the connection to live, retry, and
// the already-approved action goes out for real.
export function isRetryableJobStatus(status: string): boolean {
  return ["failed", "dry_run", "skipped"].includes(status);
}
