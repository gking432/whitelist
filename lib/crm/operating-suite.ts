import type { SupabaseClient } from "@supabase/supabase-js";

export type NorthstarCrmData = {
  contacts: Record<string, unknown>[];
  leads: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  timeline: Record<string, unknown>[];
  communications: Record<string, unknown>[];
  appointments: Record<string, unknown>[];
  availability: Record<string, unknown>[];
  calls: Record<string, unknown>[];
  transcriptTurns: Record<string, unknown>[];
  quotes: Record<string, unknown>[];
  feedback: Record<string, unknown>[];
  pendingApprovals: number;
  connections: Record<string, unknown>[];
};

async function rows(
  query: PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<Record<string, unknown>[]> {
  const result = await query;
  return result.error
    ? []
    : ((result.data ?? []) as Record<string, unknown>[]);
}

export async function loadNorthstarCrm(
  supabase: SupabaseClient,
  clientId: string,
): Promise<NorthstarCrmData> {
  const [
    contacts,
    leads,
    tasks,
    timeline,
    communications,
    appointments,
    availability,
    calls,
    transcriptTurns,
    quotes,
    feedback,
    approvalsResult,
    connections,
  ] = await Promise.all([
    rows(
      supabase
        .from("crm_contacts")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(250),
    ),
    rows(
      supabase
        .from("crm_leads")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(300),
    ),
    rows(
      supabase
        .from("crm_tasks")
        .select("*")
        .eq("client_id", clientId)
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(250),
    ),
    rows(
      supabase
        .from("crm_timeline_entries")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(300),
    ),
    rows(
      supabase
        .from("crm_communications")
        .select("*")
        .eq("client_id", clientId)
        .order("occurred_at", { ascending: false })
        .limit(300),
    ),
    rows(
      supabase
        .from("crm_appointments")
        .select("*")
        .eq("client_id", clientId)
        .order("start_at", { ascending: true })
        .limit(250),
    ),
    rows(
      supabase
        .from("crm_availability_windows")
        .select("*")
        .eq("client_id", clientId)
        .order("weekday", { ascending: true })
        .order("start_time", { ascending: true }),
    ),
    rows(
      supabase
        .from("call_sessions")
        .select("*")
        .eq("client_id", clientId)
        .order("started_at", { ascending: false })
        .limit(100),
    ),
    rows(
      supabase
        .from("call_transcript_turns")
        .select("*")
        .eq("client_id", clientId)
        .order("occurred_at", { ascending: false })
        .limit(500),
    ),
    rows(
      supabase
        .from("crm_quotes")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(100),
    ),
    rows(
      supabase
        .from("crm_feedback")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(100),
    ),
    supabase
      .from("approval_items")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("status", "pending"),
    rows(
      supabase
        .from("integration_connections")
        .select(
          "id, display_name, status, runtime_mode, provider:integration_providers(provider_key, display_name, category)",
        )
        .eq("client_id", clientId),
    ),
  ]);

  return {
    contacts,
    leads,
    tasks,
    timeline,
    communications,
    appointments,
    availability,
    calls,
    transcriptTurns,
    quotes,
    feedback,
    pendingApprovals: approvalsResult.count ?? 0,
    connections,
  };
}

