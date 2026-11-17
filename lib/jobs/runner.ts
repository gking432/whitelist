import { dispatchActionJob } from "@/lib/jobs/dispatch";
import { type ActionJobRecord } from "@/lib/jobs/record";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { maintainBookingConfirmations } from "@/lib/scheduling/confirmation-completion";
import { maintainBookingLifecycle } from "@/lib/scheduling/lifecycle-service";

// Background job runner for durable action jobs. Retries FAILED jobs with
// exponential backoff (2^attempt minutes, capped) up to MAX_ATTEMPTS.
// dry_run/skipped jobs are NOT auto-retried — those are honest outcomes a
// human changes (flip a connection to live, connect a provider) and then
// retries manually from Runs / Logs.
//
// Invocation: POST /api/jobs/run with Authorization: Bearer $CRON_SECRET
// (Vercel Cron, GitHub Actions schedule, or any external scheduler —
// every minute to every 5 minutes is sensible). The function is safe to
// call concurrently: a compare-and-swap claim precedes each external effect.
// Interrupted claims require reconciliation rather than automatic replay.

import { drainActionJobs, MAX_ACTION_ATTEMPTS } from "./runner-core.ts";
import type { RunnerResult } from "./runner-core.ts";
export { isJobDueForRetry } from "./runner-core.ts";
export type { RunnerResult } from "./runner-core.ts";

export async function processPendingActionJobs(
  limit = 20,
): Promise<RunnerResult> {
  const admin = createSupabaseAdminClient();
  if (!admin) return {
    scanned: 0, attempted: 0, succeeded: 0, failed: 0, waiting: 0,
    skipped: 0, dryRun: 0, uncertain: 0,
  };

  // An expired lease may already have caused an external effect. Never resend it.
  const { error: recoveryError } = await admin
    .from("action_jobs")
    .update({
      status: "uncertain",
      last_error:
        "Interrupted delivery; reconcile provider result before any resend.",
    })
    .eq("status", "processing")
    .lt("claimed_at", new Date(Date.now() - 10 * 60_000).toISOString());
  if (recoveryError)
    throw new Error("Interrupted deliveries could not be checked.");

  const result = await drainActionJobs({
    now: () => new Date(),
    page: async (offset, size) => {
      const { data, error } = await admin
        .from("action_jobs")
        .select("*")
        .in("status", ["failed", "pending"])
        .lt("attempt_count", MAX_ACTION_ATTEMPTS)
        .order("last_attempt_at", { ascending: true, nullsFirst: true })
        .order("id", { ascending: true })
        .range(offset, offset + size - 1);
      if (error) throw new Error("Delivery queue is unavailable.");
      return (data ?? []) as ActionJobRecord[];
    },
    dispatch: (job) => dispatchActionJob(admin, job),
  }, limit);
  await maintainBookingConfirmations(admin);
  await maintainBookingLifecycle(admin);
  return result;
}
