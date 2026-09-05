import { dispatchActionJob } from "@/lib/jobs/dispatch";
import { type ActionJobRecord } from "@/lib/jobs/record";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

const MAX_ATTEMPTS = 5;
const BACKOFF_CAP_MINUTES = 60;

export type RunnerResult = {
  scanned: number;
  attempted: number;
  succeeded: number;
  failed: number;
  waiting: number;
};

function backoffMinutes(attemptCount: number): number {
  return Math.min(2 ** attemptCount, BACKOFF_CAP_MINUTES);
}

export function isJobDueForRetry(
  job: Pick<ActionJobRecord, "status" | "attempt_count" | "last_attempt_at">,
  now: Date = new Date(),
): boolean {
  if (job.status !== "failed" || job.attempt_count >= MAX_ATTEMPTS) {
    return false;
  }

  if (!job.last_attempt_at) {
    return true;
  }

  const waitMs = backoffMinutes(job.attempt_count) * 60 * 1000;

  return now.getTime() - Date.parse(job.last_attempt_at) >= waitMs;
}

export async function processPendingActionJobs(
  limit = 20,
): Promise<RunnerResult> {
  const admin = createSupabaseAdminClient();
  const result: RunnerResult = {
    scanned: 0,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    waiting: 0,
  };

  if (!admin) {
    return result;
  }

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

  const { data, error } = await admin
    .from("action_jobs")
    .select("*")
    .in("status", ["failed", "pending"])
    .lt("attempt_count", MAX_ATTEMPTS)
    .order("last_attempt_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) throw new Error("Delivery queue is unavailable.");

  const jobs = (data ?? []) as ActionJobRecord[];
  result.scanned = jobs.length;

  for (const job of jobs) {
    if (job.status === "failed" && !isJobDueForRetry(job)) {
      result.waiting += 1;
      continue;
    }

    const outcome = await dispatchActionJob(admin, job);
    if (!outcome) continue;
    result.attempted += 1;

    if (outcome.status === "failed" || outcome.status === "uncertain") {
      result.failed += 1;
    } else {
      result.succeeded += 1;
    }
  }

  return result;
}
