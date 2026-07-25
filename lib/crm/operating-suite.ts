import type { SupabaseClient } from "@supabase/supabase-js";

export type NorthstarCrmData = {
  client: {
    name: string;
    industry: string | null;
    timezone: string;
    website_url: string | null;
    primary_contact_name: string | null;
    primary_contact_email: string | null;
    primary_contact_phone: string | null;
    crm_operating_mode: string;
    default_runtime_mode: string;
  } | null;
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
  workflows: Record<string, unknown>[];
  workflowRuns: Record<string, unknown>[];
  integrationEvents: Record<string, unknown>[];
  teamMembers: Record<string, unknown>[];
  escalationRules: string | null;
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
    workflows,
    workflowRuns,
    integrationEvents,
    teamMembers,
    knowledgeResult,
    clientResult,
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
    rows(
      supabase
        .from("client_workflow_instances")
        .select(
          "id, name, status, runtime_mode, health_status, last_run_at, template:workflow_templates(name, description, category, risk_level, required_provider_categories)",
        )
        .eq("client_id", clientId)
        .order("name", { ascending: true }),
    ),
    rows(
      supabase
        .from("workflow_runs")
        .select(
          "id, workflow_instance_id, status, summary, error_message, requires_approval, created_at, finished_at",
        )
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(500),
    ),
    rows(
      supabase
        .from("integration_events")
        .select(
          "id, connection_id, direction, event_type, status, external_object_type, external_object_id, error_message, created_at",
        )
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(100),
    ),
    rows(
      supabase
        .from("memberships")
        .select(
          "id, user_id, role, status, client_job_role, client_permissions, profile:profiles!memberships_user_id_fkey(email, full_name)",
        )
        .eq("client_id", clientId)
        .order("created_at", { ascending: true }),
    ),
    supabase
      .from("client_knowledge_profiles")
      .select("escalation_rules")
      .eq("client_id", clientId)
      .maybeSingle(),
    supabase
      .from("client_businesses")
      .select(
        "name, industry, timezone, website_url, primary_contact_name, primary_contact_email, primary_contact_phone, crm_operating_mode, default_runtime_mode",
      )
      .eq("id", clientId)
      .maybeSingle(),
  ]);

  return {
    client:
      clientResult.error || !clientResult.data
        ? null
        : (clientResult.data as NorthstarCrmData["client"]),
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
    workflows,
    workflowRuns,
    integrationEvents,
    teamMembers,
    escalationRules:
      knowledgeResult.error || !knowledgeResult.data
        ? null
        : knowledgeResult.data.escalation_rules,
  };
}
