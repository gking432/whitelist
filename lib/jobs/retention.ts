import type { SupabaseClient } from "@supabase/supabase-js";

export function operationalRetentionPolicy(
  configuredValue = process.env.OPERATIONAL_RETENTION_DAYS,
  now = Date.now(),
) {
  const configured = Number(configuredValue ?? 90);
  const retentionDays = Number.isFinite(configured)
    ? Math.max(30, Math.min(Math.round(configured), 365))
    : 90;

  return {
    retentionDays,
    operationalCutoff: new Date(
      now - retentionDays * 24 * 60 * 60 * 1000,
    ).toISOString(),
    setupCutoff: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
    rateCutoff: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export async function runOperationalRetention(admin: SupabaseClient) {
  const policy = operationalRetentionPolicy();

  const [rateLimits, setupSessions, syncJobs] = await Promise.all([
    admin
      .from("api_rate_limit_windows")
      .delete({ count: "exact" })
      .lt("window_started_at", policy.rateCutoff),
    admin
      .from("client_connection_setup_sessions")
      .delete({ count: "exact" })
      .lt("expires_at", policy.setupCutoff),
    admin
      .from("integration_sync_jobs")
      .delete({ count: "exact" })
      .in("status", ["succeeded", "cancelled"])
      .lt("completed_at", policy.operationalCutoff),
  ]);

  const error = rateLimits.error ?? setupSessions.error ?? syncJobs.error;

  return {
    ok: !error,
    retentionDays: policy.retentionDays,
    removed: {
      rateLimitWindows: rateLimits.count ?? 0,
      expiredSetupSessions: setupSessions.count ?? 0,
      completedSyncJobs: syncJobs.count ?? 0,
    },
    error: error?.message ?? null,
  };
}
