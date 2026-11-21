import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAIConfigured } from "@/lib/ai/provider";
import type { ClientPortal } from "@/lib/clients/portal";
import { canReadBusinessWorkspace, canWriteBusinessWorkspace } from "./access";
import {
  EMPTY_PROFILE,
  type BusinessSnapshot,
  type BusinessRecord,
  type BusinessInstall,
  type BusinessEvent,
  type BusinessContact,
  type BusinessConnection,
} from "./types";

export async function readBusinessData(
  admin: SupabaseClient,
  partnerId: string,
  clientId: string,
) {
  const results = await Promise.all([
    admin
      .from("business_workspace_profiles")
      .select("profile")
      .eq("partner_id", partnerId)
      .eq("client_id", clientId)
      .maybeSingle(),
    admin
      .from("business_records")
      .select(
        "id,kind,title,body,data,status,revision,source_record_id,created_at,updated_at",
      )
      .eq("partner_id", partnerId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(1000),
    admin
      .from("business_capability_installs")
      .select("recipe_key,status,schedule_enabled,last_run_at,next_run_at")
      .eq("partner_id", partnerId)
      .eq("client_id", clientId),
    admin
      .from("business_workspace_events")
      .select("id,record_id,action,summary,created_at")
      .eq("partner_id", partnerId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(40),
    admin
      .from("crm_contacts")
      .select("id,first_name,last_name,email,phone,source")
      .eq("partner_id", partnerId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("integration_connections")
      .select(
        "id,display_name,status,runtime_mode,provider:integration_providers(provider_key,category,display_name)",
      )
      .eq("partner_id", partnerId)
      .eq("client_id", clientId),
    admin
      .from("approval_items")
      .select("id", { count: "exact", head: true })
      .eq("partner_id", partnerId)
      .eq("client_id", clientId)
      .eq("status", "pending"),
  ]);
  const [profile, records, installs, events, contacts, connections, approvals] =
    results;
  return {
    profile: { ...EMPTY_PROFILE, ...profile.data?.profile },
    records: (records.data ?? []) as BusinessRecord[],
    installs: (installs.data ?? []) as BusinessInstall[],
    events: (events.data ?? []) as BusinessEvent[],
    contacts: (contacts.data ?? []) as BusinessContact[],
    connections: (connections.data ?? []) as unknown as BusinessConnection[],
    pendingCustomerApprovals: approvals.count ?? 0,
    setupRequired: !profile.data,
    error: results.some((r) => r.error)
      ? "Business data could not be fully loaded. Check the database connection and apply the business workspace migration."
      : null,
  };
}
export async function loadBusinessSnapshot(
  portal: Extract<ClientPortal, { kind: "ok" }>,
): Promise<BusinessSnapshot> {
  if (!canReadBusinessWorkspace(portal.access))
    throw new Error(
      "Business workspace access requires an owner or a manager with full business permissions.",
    );
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("The data service is unavailable.");
  return {
    ...(await readBusinessData(
      admin,
      portal.client.partner_id,
      portal.client.id,
    )),
    clientName: portal.client.name,
    clientId: portal.client.id,
    aiConfigured: isAIConfigured(),
    canWrite: canWriteBusinessWorkspace(portal.access),
    isTestAccount: portal.client.is_test_account,
  };
}
