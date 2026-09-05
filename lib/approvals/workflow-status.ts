import type { SupabaseClient } from "@supabase/supabase-js";

/** A run may have a message, booking and external-app approval together. */
export async function settleWorkflowApprovals(
  db: SupabaseClient,
  partnerId: string,
  clientId: string,
  runId: string,
  summary?: string,
) {
  const [{ data: approvals }, { data: jobs }] = await Promise.all([
    db
      .from("approval_items")
      .select("status")
      .eq("partner_id", partnerId)
      .eq("client_id", clientId)
      .eq("workflow_run_id", runId)
      .throwOnError(),
    db
      .from("action_jobs")
      .select("status")
      .eq("partner_id", partnerId)
      .eq("client_id", clientId)
      .eq("workflow_run_id", runId)
      .neq("kind", "crm.sync")
      .throwOnError(),
  ]);
  if (!approvals?.length) return;
  const status = approvals.some((row) =>
    ["rejected", "cancelled", "expired"].includes(row.status),
  )
    ? "cancelled"
    : jobs?.some((row) => ["failed", "uncertain"].includes(row.status))
      ? "failed"
      : approvals.some((row) => row.status === "pending")
        ? "paused_for_approval"
        : jobs?.some((row) =>
              ["pending", "processing", "provider_pending"].includes(
                row.status,
              ),
            )
          ? "running"
          : "succeeded";
  await db
    .from("workflow_runs")
    .update({
      status,
      finished_at: ["cancelled", "failed", "succeeded"].includes(status)
        ? new Date().toISOString()
        : null,
      ...(summary ? { summary } : {}),
    })
    .eq("id", runId)
    .eq("partner_id", partnerId)
    .eq("client_id", clientId)
    .in("status", ["paused_for_approval", "running", "succeeded"])
    .throwOnError();
}
