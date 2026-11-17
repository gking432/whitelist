import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionJobRecord } from "../jobs/record.ts";
import { inspectBookingFollowup } from "./lifecycle-guard.ts";
import type { BookingFollowupKind, BookingLifecyclePin } from "./lifecycle-rules.ts";

export type BookingFollowupResult = {
  state: "queued" | "existing" | "waiting" | "blocked" | "not_due";
  approvalId: string | null;
  reason?: string;
  nextDueAt?: string;
};
export type BookingLifecycleRepository = {
  inspect(job: ActionJobRecord, kind: BookingFollowupKind, now: string): Promise<
    { state: "ready"; pin: BookingLifecyclePin } | { state: "waiting" | "blocked" | "not_due"; reason: string; nextDueAt?: string }>;
  prepare(job: ActionJobRecord, kind: BookingFollowupKind, pin: BookingLifecyclePin): Promise<BookingFollowupResult>;
};

/** An injected deterministic coordinator; it can only prepare owner decisions. */
export async function prepareBookingFollowup(repository: BookingLifecycleRepository, job: ActionJobRecord, kind: BookingFollowupKind, now: string): Promise<BookingFollowupResult> {
  if (job.kind !== "calendar.book" || job.status !== "succeeded" || !job.approval_id)
    return { state: "blocked", approvalId: null, reason: "Only an existing successful booking can prepare a follow-up; no calendar write was retried." };
  const inspected = await repository.inspect(job, kind, now);
  if (inspected.state !== "ready") return { ...inspected, approvalId: null };
  const result = await repository.prepare(job, kind, inspected.pin);
  if (!["queued", "existing", "waiting", "blocked", "not_due"].includes(result.state) ||
      (["queued", "existing"].includes(result.state) && !result.approvalId))
    throw new Error("The follow-up proposal could not be confirmed. The successful booking is unchanged.");
  return result;
}

export function supabaseBookingLifecycleRepository(admin: SupabaseClient): BookingLifecycleRepository {
  return {
    inspect: (job, kind, now) => inspectBookingFollowup(admin, { partnerId: job.partner_id, clientId: job.client_id }, job.approval_id!, kind, now, job.id),
    prepare: async (job, kind, pin) => {
      const { data, error } = await admin.rpc("prepare_booking_lifecycle_followup", {
        p_partner: job.partner_id, p_client: job.client_id, p_booking_approval: job.approval_id,
        p_action_job: job.id, p_kind: kind, p_pin: pin,
      });
      if (error || !data || typeof data.state !== "string") throw new Error("The current booking follow-up could not be saved. Its booking receipt is unchanged.");
      return data as BookingFollowupResult;
    },
  };
}

export async function recoverBookingLifecycle(dependencies: {
  now: () => string;
  list: () => Promise<ActionJobRecord[]>;
  prepare: (job: ActionJobRecord, now: string) => Promise<BookingFollowupResult>;
  retry: (job: ActionJobRecord, reason: string, nextDueAt?: string) => Promise<void>;
}) {
  let prepared = 0, waiting = 0, blocked = 0, failed = 0;
  const now = dependencies.now();
  for (const job of await dependencies.list()) {
    if (job.kind !== "calendar.book" || job.status !== "succeeded") continue;
    try {
      const result = await dependencies.prepare(job, now);
      if (["queued", "existing"].includes(result.state)) prepared++;
      else {
        await dependencies.retry(job, result.reason ?? "The reminder needs current booking source evidence.", result.nextDueAt);
        if (result.state === "blocked") blocked++; else waiting++;
      }
    } catch {
      await dependencies.retry(job, "Reminder preparation could not complete. Review the saved booking source; do not repeat its calendar write.");
      failed++;
    }
  }
  return { prepared, waiting, blocked, failed };
}

/** Existing succeeded action receipts carry the local follow-up marker. */
export async function maintainBookingLifecycle(admin: SupabaseClient, limit = 3, now = () => new Date().toISOString()) {
  const repository = supabaseBookingLifecycleRepository(admin);
  return recoverBookingLifecycle({
    now,
    list: async () => {
      const { data, error } = await admin.from("action_jobs").select("*").eq("kind", "calendar.book").eq("status", "succeeded")
        .eq("booking_followup_phase", "reminder").lte("booking_followup_due_at", now()).order("booking_followup_due_at").limit(Math.max(1, Math.min(limit, 10)));
      if (error) throw new Error("Saved booking reminder work could not be loaded.");
      return (data ?? []) as ActionJobRecord[];
    },
    prepare: (job, at) => prepareBookingFollowup(repository, job, "reminder", at),
    retry: async (job, reason, nextDueAt) => {
      const { error } = await admin.rpc("record_booking_followup_retry", {
        p_partner: job.partner_id, p_client: job.client_id, p_job: job.id, p_reason: reason,
        p_next_due: nextDueAt ?? null,
      });
      if (error) throw new Error("The saved reminder's review state could not be recorded.");
    },
  });
}
