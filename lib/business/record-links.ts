import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecordData, RecordKind } from "./types";

// Admin-backed writes must validate links inside the authenticated business scope.
export async function validateGoalLink(
  admin: SupabaseClient,
  scope: { partnerId: string; clientId: string },
  record: { kind: RecordKind; data: RecordData },
) {
  if (record.kind !== "job" || !record.data.goal_id) return;
  const linked = await admin
    .from("business_records")
    .select("id")
    .eq("id", record.data.goal_id)
    .eq("partner_id", scope.partnerId)
    .eq("client_id", scope.clientId)
    .eq("kind", "goal")
    .neq("status", "archived")
    .maybeSingle();
  if (linked.error || !linked.data)
    throw new Error("Choose an active goal from this business.");
}
