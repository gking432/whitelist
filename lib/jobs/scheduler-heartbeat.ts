import type { SupabaseClient } from "@supabase/supabase-js";

export function normalizeSchedulerRelease(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^[a-f0-9]{7,64}$/.test(normalized) ? normalized : null;
}

export async function recordSchedulerHeartbeat(
  admin: SupabaseClient,
  release: string | null,
) {
  if (!release) return;
  const { error } = await admin
    .from("platform_service_heartbeats")
    .upsert(
      {
        service_key: "jobs",
        release,
        last_success_at: new Date().toISOString(),
      },
      { onConflict: "service_key" },
    );
  if (error) {
    throw new Error(`Scheduler heartbeat could not be stored: ${error.message}`);
  }
}
