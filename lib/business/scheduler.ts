import type { SupabaseClient } from "@supabase/supabase-js";
import { runBusinessRecipe } from "./engine";
// Daily runs create internal proposals only. A lease plus a stable due-time key
// makes interrupted runs replayable without duplicate work products.
export async function processBusinessSchedules(
  admin: SupabaseClient,
  limit = 3,
) {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("business_capability_installs")
    .select("id,partner_id,client_id,recipe_key,next_run_at,updated_at")
    .eq("status", "enabled")
    .eq("schedule_enabled", true)
    .lte("next_run_at", now)
    .order("next_run_at")
    .limit(limit);
  if (error) throw new Error("Business schedules could not be loaded.");
  let completed = 0,
    failed = 0;
  for (const install of data ?? []) {
    const { data: claim, error: claimError } = await admin
      .from("business_capability_installs")
      .update({
        next_run_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        updated_at: now,
      })
      .eq("id", install.id)
      .eq("updated_at", install.updated_at)
      .eq("status", "enabled")
      .eq("schedule_enabled", true)
      .select("id")
      .maybeSingle();
    if (claimError || !claim) continue;
    try {
      await runBusinessRecipe(
        admin,
        {
          partnerId: install.partner_id,
          clientId: install.client_id,
          actorId: null,
        },
        install.recipe_key,
        "",
        `scheduled:${install.id}:${now.slice(0, 10)}`,
      );
      const { error: saveError } = await admin
        .from("business_capability_installs")
        .update({
          next_run_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", install.id)
        .eq("updated_at", now)
        .eq("status", "enabled");
      if (saveError) throw new Error("Schedule completion could not be saved.");
      completed++;
    } catch {
      failed++;
    }
  }
  return { scanned: data?.length ?? 0, completed, failed };
}
