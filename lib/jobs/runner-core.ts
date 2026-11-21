import type { ActionJobRecord } from "./record.ts";
import type { DeliveryOutcome } from "../delivery/customer-message.ts";
import { actionCanBeClaimed } from "./execution-state.ts";

export const MAX_ACTION_ATTEMPTS = 5;
export type RunnerResult = {
  scanned: number;
  attempted: number;
  succeeded: number;
  failed: number;
  waiting: number;
  skipped: number;
  dryRun: number;
  uncertain: number;
};

export function isJobDueForRetry(
  job: Pick<ActionJobRecord, "status" | "attempt_count" | "last_attempt_at">,
  now: Date = new Date(),
): boolean {
  if (job.status !== "failed" || job.attempt_count >= MAX_ACTION_ATTEMPTS)
    return false;
  if (!job.last_attempt_at) return true;
  const elapsed = now.getTime() - Date.parse(job.last_attempt_at);
  return elapsed >= Math.min(2 ** job.attempt_count, 60) * 60_000;
}

/** Gather a due batch before dispatch changes the paginated candidate set. */
export async function drainActionJobs(dependencies: {
  now: () => Date;
  page: (offset: number, size: number) => Promise<ActionJobRecord[]>;
  dispatch: (job: ActionJobRecord) => Promise<DeliveryOutcome | null>;
}, limit = 20): Promise<RunnerResult> {
  const result: RunnerResult = {
    scanned: 0, attempted: 0, succeeded: 0, failed: 0, waiting: 0,
    skipped: 0, dryRun: 0, uncertain: 0,
  };
  const batchSize = Math.max(1, Math.min(200, Math.floor(limit)));
  const now = dependencies.now();
  const due: ActionJobRecord[] = [];
  for (let offset = 0; due.length < batchSize; offset += batchSize) {
    const page = await dependencies.page(offset, batchSize);
    result.scanned += page.length;
    for (const job of page) {
      if (job.attempt_count >= MAX_ACTION_ATTEMPTS) continue;
      if (job.status === "pending" || isJobDueForRetry(job, now)) due.push(job);
      else if (job.status === "failed") result.waiting++;
      if (due.length === batchSize) break;
    }
    if (page.length < batchSize) break;
  }
  for (const job of due) {
    const outcome = await dependencies.dispatch(job);
    if (!outcome) continue; // Another worker won the compare-and-swap.
    result.attempted++;
    if (outcome.status === "succeeded") result.succeeded++;
    else if (outcome.status === "failed") result.failed++;
    else if (outcome.status === "uncertain") result.uncertain++;
    else if (outcome.status === "provider_pending") result.waiting++;
    else if (outcome.status === "skipped") result.skipped++;
    else if (outcome.status === "dry_run") result.dryRun++;
  }
  return result;
}

export async function dispatchClaimedAction(
  job: ActionJobRecord,
  dependencies: {
    token: () => string;
    now: () => Date;
    claim: (job: ActionJobRecord, claim: string, now: Date) => Promise<ActionJobRecord | null>;
    execute: (job: ActionJobRecord) => Promise<DeliveryOutcome>;
    complete: (id: string, claim: string, outcome: DeliveryOutcome) => Promise<boolean>;
    afterComplete?: (job: ActionJobRecord, outcome: DeliveryOutcome) => Promise<void>;
  },
  manual = false,
): Promise<DeliveryOutcome | null> {
  if (!actionCanBeClaimed(job.status, manual)) return null;
  const claim = dependencies.token();
  const claimed = await dependencies.claim(job, claim, dependencies.now());
  if (!claimed) return null;
  let outcome: DeliveryOutcome;
  try {
    outcome = await dependencies.execute(claimed);
  } catch {
    outcome = {
      attempted: true, delivered: false, status: "uncertain",
      detail: "Delivery was interrupted. Check the provider before creating a new action; automatic resend is disabled.",
    };
  }
  if (!(await dependencies.complete(job.id, claim, outcome)))
    throw new Error("Delivery completion claim was lost. Do not resend; reconcile with the provider.");
  // Follow-up preparation cannot change or replay an already committed effect.
  try { await dependencies.afterComplete?.(claimed, outcome); } catch { /* Receipt remains authoritative. */ }
  return outcome;
}
