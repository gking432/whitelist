import type { SupabaseClient } from "@supabase/supabase-js";
import { completeCallSession } from "./sessions";

export async function enqueueVoiceFinalization(
  admin: SupabaseClient, callSessionId: string, delaySeconds = 90,
): Promise<void> {
  const { error } = await admin.rpc("enqueue_voice_finalization", {
    p_session_id: callSessionId, p_delay_seconds: delaySeconds,
  });
  if (error) throw new Error("Call completion could not be queued; retry delivery.");
}

export async function drainVoiceFinalizationJobs(admin: SupabaseClient, limit = 10) {
  const { data, error } = await admin.rpc("claim_voice_finalization_jobs", { p_limit: limit });
  if (error) throw new Error("Call completion queue is unavailable.");
  let processed = 0;
  let failed = 0;
  for (const job of data ?? []) {
    try {
      await completeCallSession(admin, job.call_session_id);
      const { error: saved } = await admin.from("voice_finalization_jobs")
        .update({ status: "succeeded", completed_at: new Date().toISOString(), lease_until: null })
        .eq("call_session_id", job.call_session_id).eq("lease_token", job.lease_token);
      if (saved) throw new Error("Completion receipt could not be stored.");
      processed += 1;
    } catch {
      failed += 1;
      await admin.from("voice_finalization_jobs").update({
        status: job.attempts >= 5 ? "failed" : "pending",
        available_at: new Date(Date.now() + Math.min(900, 30 * 2 ** job.attempts) * 1000).toISOString(),
        lease_until: null,
        last_error: "Call completion failed. Review provider and database health before retrying.",
      }).eq("call_session_id", job.call_session_id).eq("lease_token", job.lease_token);
    }
  }
  return { processed, failed };
}
