import type { SupabaseClient } from "@supabase/supabase-js";
import { isAIConfigured } from "@/lib/ai/provider";
import type { AgentScope, TeamSnapshot, VisibleWork } from "./types";

export async function readTeam(
  admin: SupabaseClient,
  scope: AgentScope,
  canWrite: boolean,
): Promise<TeamSnapshot> {
  const results = await Promise.all([
    admin
      .from("agent_team_settings")
      .select("*")
      .eq("partner_id", scope.partnerId)
      .eq("client_id", scope.clientId)
      .maybeSingle(),
    admin
      .from("agent_work_items")
      .select(
        "id,parent_id,conversation_id,kind,agent_key,title,status,summary,source_lead_id,source_record_id,result_record_id,approval_id,revision,created_at,updated_at",
      )
      .eq("partner_id", scope.partnerId)
      .eq("client_id", scope.clientId)
      .order("updated_at", { ascending: false })
      .limit(101),
    admin
      .from("agent_work_events")
      .select("id,work_id,status,summary,created_at")
      .eq("partner_id", scope.partnerId)
      .eq("client_id", scope.clientId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  if (results.some((r) => r.error))
    throw new Error(
      "Agent team data is unavailable. Check the database connection and agent team migration.",
    );
  return {
    settings: results[0].data,
    work: (results[1].data ?? []).slice(0, 100) as VisibleWork[],
    events: results[2].data ?? [],
    aiConfigured: isAIConfigured(),
    canWrite,
    hasMore: (results[1].data?.length ?? 0) > 100,
  };
}
