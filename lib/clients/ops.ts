import type { SupabaseClient } from "@supabase/supabase-js";

import { emptyOpsCounts, type ClientOpsCounts } from "@/lib/health/client-health";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Aggregates the operational signals used for health rollups. Queries run
// through the caller's RLS-scoped client, so results are already tenant-bound;
// the explicit partner filter keeps intent obvious and queries indexed.
export async function getPartnerOpsCounts(
  supabase: SupabaseClient,
  partnerId: string,
): Promise<Map<string, ClientOpsCounts>> {
  const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();

  const [connections, instances, runs, approvals, events] = await Promise.all([
    supabase
      .from("integration_connections")
      .select("client_id, status")
      .eq("partner_id", partnerId),
    supabase
      .from("client_workflow_instances")
      .select("client_id, status, runtime_mode")
      .eq("partner_id", partnerId),
    supabase
      .from("workflow_runs")
      .select("client_id, status, created_at")
      .eq("partner_id", partnerId)
      .gte("created_at", since),
    supabase
      .from("approval_items")
      .select("client_id, status")
      .eq("partner_id", partnerId)
      .eq("status", "pending"),
    supabase
      .from("integration_events")
      .select("client_id, created_at")
      .eq("partner_id", partnerId)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const firstError =
    connections.error ??
    instances.error ??
    runs.error ??
    approvals.error ??
    events.error;

  if (firstError) {
    throw new Error(`Failed to load operational counts: ${firstError.message}`);
  }

  const counts = new Map<string, ClientOpsCounts>();

  const forClient = (clientId: string): ClientOpsCounts => {
    let entry = counts.get(clientId);

    if (!entry) {
      entry = { ...emptyOpsCounts };
      counts.set(clientId, entry);
    }

    return entry;
  };

  for (const row of connections.data ?? []) {
    const entry = forClient(row.client_id);
    entry.connectionsTotal += 1;

    if (row.status === "failing") {
      entry.connectionsFailing += 1;
    } else if (row.status === "needs_attention") {
      entry.connectionsNeedsAttention += 1;
    }
  }

  for (const row of instances.data ?? []) {
    const entry = forClient(row.client_id);

    if (row.status === "active") {
      entry.activeWorkflows += 1;
    }

    if (row.status === "paused" && row.runtime_mode === "live") {
      entry.pausedLiveWorkflows += 1;
    }
  }

  for (const row of runs.data ?? []) {
    const entry = forClient(row.client_id);
    entry.runs7d += 1;

    if (row.status === "failed") {
      entry.failedRuns7d += 1;
    }
  }

  for (const row of approvals.data ?? []) {
    forClient(row.client_id).pendingApprovals += 1;
  }

  for (const row of events.data ?? []) {
    const entry = forClient(row.client_id);

    if (!entry.lastEventAt) {
      entry.lastEventAt = row.created_at;
    }
  }

  return counts;
}

export async function getClientOpsCounts(
  supabase: SupabaseClient,
  partnerId: string,
  clientId: string,
): Promise<ClientOpsCounts> {
  const counts = await getPartnerOpsCounts(supabase, partnerId);

  return counts.get(clientId) ?? { ...emptyOpsCounts };
}
