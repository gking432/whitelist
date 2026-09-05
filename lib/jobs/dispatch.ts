import { legacyCrmSyncNeedsReconciliation } from "@/lib/crm/sync-outcome";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeliveryOutcome } from "@/lib/delivery/customer-message";
import { executeActionJob } from "@/lib/jobs/execute";
import { actionCanBeClaimed } from "./execution-state.ts";
import type { ActionJobRecord } from "@/lib/jobs/record";

export async function dispatchActionJob(
  admin: SupabaseClient,
  job: ActionJobRecord,
  manual = false,
): Promise<DeliveryOutcome | null> {
  if (!actionCanBeClaimed(job.status, manual)) return null;
  const claim = randomUUID();
  const { data, error } = await admin
    .from("action_jobs")
    .update({
      status: "processing",
      claim_token: claim,
      claimed_at: new Date().toISOString(),
      last_attempt_at: new Date().toISOString(),
      attempt_count: job.attempt_count + 1,
    })
    .eq("id", job.id)
    .eq("status", job.status)
    .eq("attempt_count", job.attempt_count)
    .select("*")
    .maybeSingle();
  if (error) throw new Error("Could not claim delivery; nothing was sent.");
  if (!data) return null;
  let outcome: DeliveryOutcome;
  try {
    outcome = legacyCrmSyncNeedsReconciliation(job) ? {
      attempted: false, delivered: false, status: "uncertain",
      detail: "This legacy CRM sync failed after a possible provider write. Reconcile the contact and notes before creating a new sync; automatic replay is disabled.",
    } : await executeActionJob(admin, data as ActionJobRecord);
  } catch {
    outcome = {
      attempted: true,
      delivered: false,
      status: "uncertain",
      detail:
        "Delivery was interrupted. Check the provider before creating a new action; automatic resend is disabled.",
    };
  }
  const { error: saveError } = await admin
    .from("action_jobs")
    .update({
      status: outcome.status,
      outcome_detail: outcome.detail,
      last_error: ["failed", "uncertain"].includes(outcome.status)
        ? outcome.detail
        : null,
      ...(outcome.externalRef ? { external_ref: outcome.externalRef } : {}),
    })
    .eq("id", job.id)
    .eq("claim_token", claim)
    .eq("status", "processing");
  if (saveError)
    throw new Error(
      "Delivery result could not be saved. Do not resend; reconcile with the provider.",
    );
  return outcome;
}
