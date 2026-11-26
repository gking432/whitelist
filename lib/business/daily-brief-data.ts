import "server-only";
import { readConnectedData } from "@/lib/connections/data";
import type { ClientPortal } from "@/lib/clients/portal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadBusinessSnapshot } from "./data";
import { canReadBusinessWorkspace, canWriteBusinessWorkspace } from "./access";
import { readBusinessContext } from "./context-data";
import { loadWorkspacePersonalization } from "./workspace-preferences-data";
import {
  addDays,
  localDate,
  validTimeZone,
  type DailyBriefData,
} from "./daily-brief";

export async function loadDailyBrief(
  portal: Extract<ClientPortal, { kind: "ok" }>,
): Promise<DailyBriefData> {
  if (!canReadBusinessWorkspace(portal.access))
    throw new Error("Business workspace access is required.");
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("The data service is unavailable.");
  const { id: clientId, partner_id: partnerId } = portal.client;
  const timeZone = validTimeZone(portal.client.timezone);
  const generatedAt = new Date().toISOString();
  const today = localDate(generatedAt, timeZone);
  // Wide timestamp bounds cover all offsets; local calendar-day filtering happens below.
  const start = `${addDays(today, -1)}T00:00:00Z`;
  const end = `${addDays(today, 8)}T00:00:00Z`;
  const scoped = <Columns extends string>(
    table: string,
    columns: Columns,
    count = false,
  ) =>
    admin
      .from(table)
      .select(columns, count ? { count: "exact" } : {})
      .eq("partner_id", partnerId)
      .eq("client_id", clientId);
  const [
    workspace,
    connectedData,
    person,
    tasks,
    appointments,
    approvals,
    conversations,
    work,
    blocked,
    team,
    sharedContext,
    personalization,
  ] = await Promise.all([
    loadBusinessSnapshot(portal),
    readConnectedData(admin, { partnerId, clientId }),
    admin
      .from("profiles")
      .select("full_name")
      .eq("id", portal.user.id)
      .maybeSingle(),
    scoped("crm_tasks", "id,title,description,priority,status,due_at,updated_at", true)
      .eq("status", "open")
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(200),
    scoped("crm_appointments", "id,title,start_at,end_at,status")
      .in("status", ["booked", "proposed"])
      .gte("start_at", start)
      .lt("start_at", end)
      .order("start_at")
      .limit(200),
    portal.access.visibleClientSections.includes("approvals")
      ? scoped("approval_items", "id,title,summary,created_at,type,editable_content,proposed_payload", true)
          .eq("status", "pending")
          .order("created_at")
          .limit(50)
      : Promise.resolve({ data: [], error: null, count: 0 }),
    scoped(
      "business_conversations",
      "id,channel,next_action,summary,updated_at",
      true,
    )
      .eq("state", "needs_attention")
      .order("updated_at", { ascending: false })
      .limit(50),
    scoped("agent_work_items", "id,title,status,summary,updated_at")
      .order("updated_at", { ascending: false })
      .limit(30),
    scoped("agent_work_items", "id,title,status,summary,updated_at", true)
      .eq("status", "blocked")
      .order("updated_at", { ascending: false })
      .limit(30),
    scoped("agent_team_settings", "status").maybeSingle(),
    readBusinessContext(admin, { partnerId, clientId }, canWriteBusinessWorkspace(portal.access))
      .then((data) => ({ data, error: null }))
      .catch(() => ({ data: null, error: "Shared business context could not be loaded. Setup and observation coverage may be incomplete." })),
    loadWorkspacePersonalization(portal),
  ]);
  const errors = [
    workspace.error,
    sharedContext.error,
    sharedContext.data?.coverage.some((item) => item.connectionId && item.status !== "fresh") &&
      "Some connected data streams are incomplete, paused or delayed. Review source coverage in business setup.",
    ...connectedData.errors,
    tasks.error && "Tasks could not be loaded.",
    appointments.error && "Calendar could not be loaded.",
    approvals.error && "Approvals could not be loaded.",
    conversations.error && "Customer inquiries could not be loaded.",
    (work.error || blocked.error || team.error) &&
      "Agent activity could not be fully loaded.",
  ].filter((e): e is string => typeof e === "string" && !!e);
  const name = person.data?.full_name?.trim();
  return {
    personalization,
    workspace: sharedContext.data ? { ...workspace, profile: sharedContext.data.profile } : workspace,
    businessContext: sharedContext.data ?? undefined,
    connectedData,
    displayName:
      personalization.preferences.displayName || (name &&
      !["Client Owner", "Partner Owner", "Platform Owner", portal.client.name].includes(name)
        ? name.split(/\s+/)[0]
        : null),
    timeZone,
    generatedAt,
    tasks: (tasks.data as unknown as DailyBriefData["tasks"]) || [],
    appointments: [
      ...((appointments.data as unknown as DailyBriefData["appointments"]) || []).filter(a=>
        !connectedData.appointments.some(e=>e.nativeId===a.id) &&
        !sharedContext.data?.records.some(r=>r.table==="integration_canonical_records" && r.kind==="appointment" && ["deleted","cancelled","canceled"].includes(r.status) && r.sources.some(s=>s.table==="crm_appointments" && s.id===a.id))),
      ...connectedData.appointments.map(a=>({ id:`imported:${a.id}`, title:a.title, start_at:a.startAt, end_at:a.endAt,
        status:a.status ?? "unknown", sourceHref:a.href || "/client/calendar", sourceAccount:a.account, allDay:a.allDay })),
    ],
    canResolveApprovals:
      portal.access.canResolveApprovals &&
      (!portal.access.isImpersonating || portal.access.impersonationMode === "sandbox_full"),
    approvals: (approvals.data as unknown as DailyBriefData["approvals"]) || [],
    conversations:
      (conversations.data as unknown as DailyBriefData["conversations"]) || [],
    work: [
      ...new Map(
        [...(blocked.data || []), ...(work.data || [])].map((row) => [
          row.id,
          row,
        ]),
      ).values(),
    ] as DailyBriefData["work"],
    teamStatus:
      team.data?.status === "active"
        ? "active"
        : team.data
          ? "paused"
          : "not_set_up",
    counts: {
      tasks: tasks.count || 0,
      approvals: approvals.count || 0,
      conversations: conversations.count || 0,
      blockedWork: blocked.count || 0,
    },
    errors,
    limited:
      connectedData.limited ||
      !!sharedContext.error ||
      !!sharedContext.data?.coverage.some((item) => item.hasMore) ||
      workspace.records.length === 1000 ||
      (tasks.count || 0) > 200 ||
      appointments.data?.length === 200 ||
      (approvals.count || 0) > 50 ||
      (conversations.count || 0) > 50 ||
      (blocked.count || 0) > 30,
  };
}
