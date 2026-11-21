import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionJobRecord } from "../jobs/record.ts";

export type CalendarMutationCompletionResult =
  | { state: "completed"; jobId: string; bookingApprovalId: string; appointmentId: string; replayed?: boolean }
  | { state: "review"; jobId: string; bookingApprovalId: string; taskId: string; reason: string; replayed?: boolean };
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const savedResultMessage = "The successful calendar change remains recorded. Its local completion could not be confirmed; recover this saved action without repeating the calendar write.";

function eligible(job: unknown): job is ActionJobRecord {
  if (!job || typeof job !== "object" || Array.isArray(job)) return false;
  const row = job as Partial<ActionJobRecord>;
  return row.status === "succeeded" && (row.kind === "calendar.cancel" || row.kind === "calendar.reschedule") &&
    [row.id, row.partner_id, row.client_id, row.approval_id].every((id) => typeof id === "string" && uuid.test(id));
}
const validId = (value: unknown): value is string => typeof value === "string" && uuid.test(value);
function completionResult(value: unknown, job: ActionJobRecord): CalendarMutationCompletionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(savedResultMessage);
  const result = value as Record<string, unknown>;
  if (result.state !== "completed" && result.state !== "review") throw new Error(savedResultMessage);
  if (result.jobId !== job.id || !validId(result.bookingApprovalId) ||
    (typeof job.payload?.booking_approval_id === "string" && result.bookingApprovalId !== job.payload.booking_approval_id) ||
    (result.replayed !== undefined && typeof result.replayed !== "boolean")) throw new Error(savedResultMessage);
  const base = { jobId: job.id, bookingApprovalId: result.bookingApprovalId, ...(typeof result.replayed === "boolean" ? { replayed: result.replayed } : {}) };
  if (result.state === "completed" && validId(result.appointmentId)) return { ...base, state: "completed", appointmentId: result.appointmentId };
  if (result.state === "review" && validId(result.taskId) && typeof result.reason === "string" && result.reason.trim())
    return { ...base, state: "review", taskId: result.taskId, reason: result.reason };
  throw new Error(savedResultMessage);
}

/** Finalize local state from a durable successful receipt. This path has no
 * provider adapter and cannot repeat cancellation or rescheduling. */
export async function completeCalendarMutation(admin: SupabaseClient, job: ActionJobRecord): Promise<CalendarMutationCompletionResult | null> {
  if (!eligible(job)) return null;
  try {
    const { data, error } = await admin.rpc("complete_calendar_mutation", {
      p_partner: job.partner_id, p_client: job.client_id, p_job: job.id,
    });
    if (error) throw new Error(savedResultMessage);
    return completionResult(data, job);
  } catch { throw new Error(savedResultMessage); }
}

/** An injectable restart coordinator over saved successes only. Failures in
 * one local projection do not prevent recovery of later saved results. */
export async function recoverCalendarMutationCompletions(dependencies: {
  list: () => Promise<unknown[]>;
  complete: (job: ActionJobRecord) => Promise<CalendarMutationCompletionResult | null>;
}) {
  let completed = 0, review = 0, failed = 0, skipped = 0;
  for (const job of await dependencies.list()) {
    if (!eligible(job)) { skipped++; continue; }
    try {
      const result = completionResult(await dependencies.complete(job), job);
      if (result.state === "completed") completed++; else review++;
    } catch { failed++; }
  }
  return { completed, review, failed, skipped };
}

/** Bounded due-receipt maintenance. The RPC owns reconciliation markers and
 * validates actual stored proof; no job status or receipt is rewritten here. */
export async function maintainCalendarMutations(admin: SupabaseClient, limit = 3, now = () => new Date().toISOString()) {
  const clock = now();
  if (!Number.isFinite(Date.parse(clock))) throw new Error("The local calendar completion clock could not be verified. Successful provider results remain recorded.");
  const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 10)) : 3;
  return recoverCalendarMutationCompletions({
    list: async () => {
      const { data, error } = await admin.from("action_jobs").select("*")
        .in("kind", ["calendar.cancel", "calendar.reschedule"]).eq("status", "succeeded")
        .not("calendar_reconcile_due_at", "is", null).lte("calendar_reconcile_due_at", clock)
        .order("calendar_reconcile_due_at").limit(bounded);
      if (error || !Array.isArray(data)) throw new Error("Saved calendar completion work could not be loaded. Successful provider results remain recorded.");
      return data.slice(0, bounded);
    },
    complete: (job) => completeCalendarMutation(admin, job),
  });
}
