import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionJobRecord } from "../jobs/record";
import { prepareBookingFollowup, supabaseBookingLifecycleRepository } from "./lifecycle-service.ts";

/** Preparation runs only after the durable successful booking receipt commits. */
export async function queueCompletedBookingConfirmation(admin: SupabaseClient, job: ActionJobRecord) {
  if (job.kind !== "calendar.book" || !job.approval_id) return;
  // This initializer also runs during recovery: a crash after receipt commit
  // cannot lose the future reminder, and repeated recovery cannot renew a stop.
  const initialized = await admin.rpc("schedule_booking_lifecycle", {
    p_partner: job.partner_id, p_client: job.client_id,
    p_booking_approval: job.approval_id, p_action_job: job.id,
  });
  if (initialized.error) throw new Error("Booking is saved; its local follow-up schedule needs recovery.");
  const receipt = await admin.from("action_jobs").select("*")
    .eq("id", job.id).eq("partner_id", job.partner_id).eq("client_id", job.client_id)
    .eq("approval_id", job.approval_id).eq("kind", "calendar.book").eq("status", "succeeded").maybeSingle();
  if (receipt.error || !receipt.data) throw new Error("The durable successful booking receipt is unavailable.");
  const data = await prepareBookingFollowup(supabaseBookingLifecycleRepository(admin), receipt.data as ActionJobRecord, "confirmation", new Date().toISOString());
  if (!["queued", "existing"].includes(data.state))
    throw new Error(data.reason ?? "Booking is saved; current source evidence is required before confirmation preparation.");
  const saved = await admin.from("action_jobs").update({ confirmation_due_at: null })
    .eq("id", job.id).eq("partner_id", job.partner_id).eq("client_id", job.client_id).eq("status", "succeeded").not("confirmation_due_at", "is", null);
  if (saved.error) throw new Error("Confirmation result needs recovery; the booking must not be repeated.");
  return data;
}

export async function recoverBookingConfirmations(dependencies: {
  list: () => Promise<ActionJobRecord[]>;
  prepare: (job: ActionJobRecord) => Promise<unknown>;
  failed: (job: ActionJobRecord) => Promise<void>;
}) {
  let prepared = 0, failed = 0;
  for (const job of await dependencies.list()) {
    if (job.kind !== "calendar.book" || job.status !== "succeeded") continue;
    try { await dependencies.prepare(job); prepared++; }
    catch { await dependencies.failed(job); failed++; }
  }
  return { prepared, failed };
}

/** Recover the marked local follow-up on an existing receipt, never its provider write. */
export async function maintainBookingConfirmations(admin: SupabaseClient, limit = 3) {
  return recoverBookingConfirmations({
    list: async () => {
      const { data, error } = await admin.from("action_jobs").select("*").eq("kind", "calendar.book")
        .eq("status", "succeeded").lte("confirmation_due_at", new Date().toISOString()).order("confirmation_due_at").limit(Math.max(1, Math.min(limit, 10)));
      if (error) throw new Error("Saved booking follow-ups could not be recovered.");
      return (data ?? []) as ActionJobRecord[];
    },
    prepare: (job) => queueCompletedBookingConfirmation(admin, job),
    failed: async (job) => {
      const { error } = await admin.rpc("retry_booking_confirmation", { p_partner: job.partner_id, p_client: job.client_id, p_job: job.id });
      if (error) throw new Error("Saved booking follow-up retry could not be recorded.");
    },
  });
}
