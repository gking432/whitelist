import { legacyCrmSyncNeedsReconciliation } from "@/lib/crm/sync-outcome";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeliveryOutcome } from "@/lib/delivery/customer-message";
import { executeActionJob } from "@/lib/jobs/execute";
import { dispatchClaimedAction } from "./runner-core.ts";
import type { ActionJobRecord } from "@/lib/jobs/record";
import { completeCalendarMutation } from "@/lib/scheduling/calendar-mutation-completion";
import { queueCompletedBookingConfirmation } from "@/lib/scheduling/confirmation-completion";

export async function dispatchActionJob(
  admin: SupabaseClient,
  job: ActionJobRecord,
  manual = false,
): Promise<DeliveryOutcome | null> {
  return dispatchClaimedAction(job, {
    token: randomUUID,
    now: () => new Date(),
    claim: async (candidate, claim, now) => {
      const { data, error } = await admin
        .from("action_jobs")
        .update({
          status: "processing", claim_token: claim,
          claimed_at: now.toISOString(), last_attempt_at: now.toISOString(),
          attempt_count: candidate.attempt_count + 1,
        })
        .eq("id", candidate.id)
        .eq("status", candidate.status)
        .eq("attempt_count", candidate.attempt_count)
        .select("*")
        .maybeSingle();
      if (error) throw new Error("Could not claim delivery; nothing was sent.");
      return data as ActionJobRecord | null;
    },
    execute: async (claimed) => legacyCrmSyncNeedsReconciliation(job) ? {
      attempted: false, delivered: false, status: "uncertain",
      detail: "This legacy CRM sync failed after a possible provider write. Reconcile the contact and notes before creating a new sync; automatic replay is disabled.",
    } : executeActionJob(admin, claimed),
    complete: async (id, claim, outcome) => {
      const { data, error } = await admin
        .from("action_jobs")
        .update({
          status: outcome.status,
          outcome_detail: outcome.detail,
          last_error: ["failed", "uncertain"].includes(outcome.status) ? outcome.detail : null,
          ...(outcome.externalRef ? { external_ref: outcome.externalRef } : {}),
          ...(outcome.status === "succeeded" ? { receipt_recorded_at: new Date().toISOString() } : {}),
          ...(job.kind === "calendar.book" && outcome.status === "succeeded" ? { confirmation_due_at: new Date().toISOString() } : {}),
          ...(["calendar.cancel", "calendar.reschedule"].includes(job.kind) && outcome.status === "succeeded" ? { provider_receipt: outcome.calendarMutationReceipt ?? null, calendar_reconcile_due_at: new Date().toISOString() } : {}),
        })
        .eq("id", id)
        .eq("claim_token", claim)
        .eq("status", "processing")
        .select("id")
        .maybeSingle();
      if (error) throw new Error("Delivery result could not be saved. Do not resend; reconcile with the provider.");
      return !!data;
    },
    afterComplete: async (completed, outcome) => {
      if (["calendar.cancel", "calendar.reschedule"].includes(completed.kind) && outcome.status === "succeeded") {
        // Only mirror the durable verified result. Recovery never invokes the provider.
        try { await completeCalendarMutation(admin, { ...completed, status: "succeeded" }); }
        catch { /* The due marker remains for bounded local recovery. */ }
      }
      if (completed.kind === "calendar.book" && outcome.status === "succeeded") {
        try {
          const preparation = await queueCompletedBookingConfirmation(admin, completed);
          if (preparation?.state === "blocked") throw new Error("Confirmation requires owner review.");
        }
        catch {
          // The booking is already durably succeeded. A proposal failure must
          // never turn it into a retryable calendar write.
          await admin.from("action_jobs").update({ outcome_detail: `${outcome.detail} Booking saved; confirmation preparation needs review.` })
            .eq("id", completed.id).eq("partner_id", completed.partner_id).eq("client_id", completed.client_id).eq("status", "succeeded");
        }
      }
    },
  }, manual);
}
