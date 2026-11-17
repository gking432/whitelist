import "server-only";
import type { ClientPortal } from "@/lib/clients/portal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canReadBusinessWorkspace } from "./access";
import { loadBusinessSnapshot } from "./data";
import { validTimeZone } from "./daily-brief";
import type { TodoSnapshot, SavedTask, TodoWork } from "./todo-types";

export async function loadTodoSnapshot(
  portal: Extract<ClientPortal, { kind: "ok" }>,
): Promise<TodoSnapshot> {
  if (!canReadBusinessWorkspace(portal.access))
    throw new Error("Business access required.");
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("The data service is unavailable.");
  const { id: clientId, partner_id: partnerId } = portal.client;
  const [workspace, tasks, work] = await Promise.all([
    loadBusinessSnapshot(portal),
    admin
      .from("crm_tasks")
      .select("id,title,description,status,priority,due_at,updated_at")
      .eq("partner_id", partnerId)
      .eq("client_id", clientId)
      .neq("status", "cancelled")
      .order("status", { ascending: false })
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(301),
    admin
      .from("agent_work_items")
      .select(
        "id,title,summary,status,agent_key,revision,updated_at,approval_id,conversation_id,result_record_id",
      )
      .eq("partner_id", partnerId)
      .eq("client_id", clientId)
      .neq("status", "cancelled")
      .order("updated_at", { ascending: false })
      .limit(201),
  ]);
  return {
    workspace: {
      records: workspace.records,
      profile: workspace.profile,
      canWrite: workspace.canWrite,
    },
    tasks: (tasks.data || []).slice(0, 300) as SavedTask[],
    work: (work.data || []).slice(0, 200) as TodoWork[],
    timeZone: validTimeZone(portal.client.timezone),
    generatedAt: new Date().toISOString(),
    limited:
      workspace.records.length === 1000 ||
      (tasks.data?.length || 0) > 300 ||
      (work.data?.length || 0) > 200,
    errors: [
      workspace.error,
      tasks.error && "Saved tasks could not be loaded.",
      work.error && "Agent assignments could not be loaded.",
    ].filter((error): error is string => typeof error === "string" && !!error),
  };
}
