import "server-only";
import type { ClientPortal } from "@/lib/clients/portal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canReadBusinessWorkspace, canWriteBusinessWorkspace } from "./access";
import { readConnectedData } from "@/lib/connections/data";
import { loadMobileConnectedSource } from "./mobile-summary";
import type {
  MobileBusinessData,
  MobileCustomerApproval,
} from "./mobile-types";
import type {
  BusinessConnection,
  BusinessEvent,
  BusinessRecord,
} from "./types";

const APPROVAL_FIELDS =
  "id,type,status,title,summary,editable_content,proposed_payload,created_at,resolved_at,action_jobs!action_jobs_approval_id_fkey(status,outcome_detail,created_at)";

export async function loadMobileBusinessData(
  portal: Extract<ClientPortal, { kind: "ok" }>,
): Promise<MobileBusinessData> {
  if (!canReadBusinessWorkspace(portal.access))
    throw new Error("Business access required.");
  const db = createSupabaseAdminClient();
  if (!db) throw new Error("The data service is unavailable.");
  // Never accept tenant IDs from the browser. The shared connected-data loader
  // returns the same bounded, allowlisted records used by Today and Money.
  const scoped = (table: string) => db.from(table);
  const partnerId = portal.client.partner_id;
  const clientId = portal.client.id;
  const canSeeApprovals =
    portal.access.visibleClientSections.includes("approvals");
  const emptyApprovals = { data: [], error: null, count: 0 };
  const [profile, records, connections, events, pending, recent, agents, connected] =
    await Promise.all([
      scoped("business_workspace_profiles")
        .select("profile")
        .eq("partner_id", partnerId)
        .eq("client_id", clientId)
        .maybeSingle(),
      scoped("business_records")
        .select(
          "id,kind,title,body,data,status,revision,source_record_id,created_at,updated_at",
          { count: "exact" },
        )
        .eq("partner_id", partnerId)
        .eq("client_id", clientId)
        .eq("status", "needs_approval")
        .order("created_at")
        .limit(50),
      scoped("integration_connections")
        .select(
          "id,display_name,status,runtime_mode,provider:integration_providers(provider_key,category,display_name)",
        )
        .eq("partner_id", partnerId)
        .eq("client_id", clientId)
        .order("display_name"),
      scoped("business_workspace_events")
        .select("id,record_id,action,summary,created_at")
        .eq("partner_id", partnerId)
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(30),
      canSeeApprovals
        ? scoped("approval_items")
            .select(APPROVAL_FIELDS, { count: "exact" })
            .eq("partner_id", partnerId)
            .eq("client_id", clientId)
            .eq("status", "pending")
            .order("created_at")
            .limit(50)
        : emptyApprovals,
      canSeeApprovals
        ? scoped("approval_items")
            .select(APPROVAL_FIELDS)
            .eq("partner_id", partnerId)
            .eq("client_id", clientId)
            .neq("status", "pending")
            .order("resolved_at", { ascending: false, nullsFirst: false })
            .limit(20)
        : emptyApprovals,
      scoped("agent_work_items")
        .select(
          "id,kind,title,status,summary,result_record_id,conversation_id",
          { count: "exact" },
        )
        .eq("partner_id", partnerId)
        .eq("client_id", clientId)
        .in("status", ["blocked", "waiting_external"])
        .order("updated_at", { ascending: false })
        .limit(20),
      loadMobileConnectedSource(() => readConnectedData(db, { partnerId, clientId })),
    ]);
  return {
    ...connected,
    agentAttention: agents.data ?? [],
    agentAttentionCount: agents.count ?? 0,
    currency: profile.data?.profile?.currency || "USD",
    pendingRecords: (records.data ?? []) as BusinessRecord[],
    pendingBusinessCount: records.count ?? 0,
    pendingCustomerCount: pending.count ?? 0,
    connections: (connections.data ?? []) as unknown as BusinessConnection[],
    events: (events.data ?? []) as BusinessEvent[],
    customerApprovals: (pending.data ??
      []) as unknown as MobileCustomerApproval[],
    recentCustomerApprovals: (recent.data ??
      []) as unknown as MobileCustomerApproval[],
    canDecideBusiness: canWriteBusinessWorkspace(portal.access),
    canDecideCustomer:
      canSeeApprovals &&
      portal.access.canResolveApprovals &&
      (!portal.access.isImpersonating ||
        portal.access.impersonationMode === "sandbox_full"),
    canManageConnections:
      !portal.access.isImpersonating &&
      portal.access.canOperateCustomerActions &&
      portal.access.visibleClientSections.includes("settings"),
    error: [
      profile,
      records,
      connections,
      events,
      pending,
      recent,
      agents,
    ].some((result) => result.error)
      ? "Some information could not be loaded. Refresh before making a decision."
      : null,
  };
}
