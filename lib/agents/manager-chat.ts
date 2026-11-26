import type { SupabaseClient } from "@supabase/supabase-js";
import { isAIConfigured } from "@/lib/ai/provider";
import type { AgentScope, WorkStatus } from "./types";

export type ManagerAssignment = {
  id: string;
  title: string;
  status: WorkStatus;
  summary: string;
};

export type ManagerMessage = {
  id: string;
  request: string;
  status: WorkStatus;
  summary: string;
  createdAt: string;
  assignments: ManagerAssignment[];
};

export type ManagerChatSnapshot = {
  messages: ManagerMessage[];
  active: boolean;
  aiConfigured: boolean;
  canWrite: boolean;
  hasMore: boolean;
};

// Business requests are the durable owner/manager conversation. Reuse their
// existing work IDs, approvals, and child assignments instead of creating a
// second agent queue that could disagree about what actually happened.
export async function readManagerChat(
  admin: SupabaseClient,
  scope: AgentScope,
  canWrite: boolean,
): Promise<ManagerChatSnapshot> {
  const [settings, requests, commands] = await Promise.all([
    admin
      .from("agent_team_settings")
      .select("status")
      .eq("partner_id", scope.partnerId)
      .eq("client_id", scope.clientId)
      .maybeSingle(),
    admin
      .from("agent_work_items")
      .select("id,title,input,status,summary,created_at")
      .eq("partner_id", scope.partnerId)
      .eq("client_id", scope.clientId)
      .eq("kind", "business_request")
      .is("parent_id", null)
      .order("created_at", { ascending: false })
      .limit(51),
    admin
      .from("business_owner_commands")
      .select("id,command,result,created_at")
      .eq("partner_id", scope.partnerId)
      .eq("client_id", scope.clientId)
      .order("created_at", { ascending: false })
      .limit(51),
  ]);
  if (settings.error || requests.error || commands.error)
    throw new Error("Business manager chat could not be loaded.");
  const recent = (requests.data ?? []).slice(0, 50);
  const ids = recent.map((row) => row.id);
  const children = ids.length
    ? await admin
        .from("agent_work_items")
        .select("id,parent_id,title,status,summary")
        .eq("partner_id", scope.partnerId)
        .eq("client_id", scope.clientId)
        .in("parent_id", ids)
        .order("created_at", { ascending: true })
        .limit(300)
    : { data: [], error: null };
  if (children.error)
    throw new Error("Manager assignments could not be loaded.");
  const byParent = new Map<string, ManagerAssignment[]>();
  for (const row of children.data ?? []) {
    const items = byParent.get(row.parent_id) ?? [];
    items.push({
      id: row.id,
      title: row.title,
      status: row.status as WorkStatus,
      summary: row.summary,
    });
    byParent.set(row.parent_id, items);
  }
  return {
    messages: [...recent
      .map((row) => ({
        id: row.id,
        request: String(row.input?.request ?? row.title),
        status: row.status as WorkStatus,
        summary: row.summary,
        createdAt: row.created_at,
        assignments: byParent.get(row.id) ?? [],
      })), ...(commands.data ?? []).slice(0, 50).map((row): ManagerMessage => ({
        id: row.id,
        request: row.command.action === "manager_control"
          ? String(row.command.command)
          : row.command.action === "review_context" ? "Review business context" : `Set ${String(row.command.channel)} authority to ${String(row.command.mode)}`,
        status: "completed",
        summary: String(row.result.message),
        createdAt: row.created_at,
        assignments: [],
      }))].sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).slice(-50),
    active: settings.data?.status === "active",
    aiConfigured: isAIConfigured(),
    canWrite,
    hasMore: (requests.data?.length ?? 0) + (commands.data?.length ?? 0) > 50,
  };
}
