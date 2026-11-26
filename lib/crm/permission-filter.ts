import type { NorthstarCrmData } from "./operating-suite.ts";
import type { ClientSectionKey } from "../permissions/client-sections.ts";

// This is a serialization boundary, in addition to database RLS. In particular,
// an overview-only employee receives no customer records in hidden props.
export function filterClientCrmData(
  data: NorthstarCrmData,
  sections: readonly ClientSectionKey[],
  canManageTeam = false,
): NorthstarCrmData {
  const has = (...keys: ClientSectionKey[]) => keys.some((key) => sections.includes(key));
  return {
    ...data,
    client: data.client && !has("settings") ? {
      ...data.client, primary_contact_name: null, primary_contact_email: null,
      primary_contact_phone: null,
    } : data.client,
    contacts: has("contacts") ? data.contacts : [],
    leads: has("contacts", "pipeline") ? data.leads : [],
    tasks: has("tasks") ? data.tasks : [],
    timeline: has("contacts", "activity") ? data.timeline : [],
    communications: has("inbox") ? data.communications : [],
    appointments: has("schedule") ? data.appointments : [],
    availability: has("schedule") ? data.availability : [],
    calls: has("calls", "assistant") ? data.calls : [],
    transcriptTurns: has("calls", "assistant") ? data.transcriptTurns : [],
    quotes: has("quotes") ? data.quotes : [],
    feedback: has("marketing") ? data.feedback : [],
    campaigns: has("marketing", "reports") ? data.campaigns : [],
    pendingApprovals: has("approvals", "action-center") ? data.pendingApprovals : 0,
    connections: has("crm-sync", "settings", "automations") ? data.connections : [],
    workflows: has("automations") ? data.workflows : [],
    workflowRuns: has("automations", "activity") ? data.workflowRuns : [],
    integrationEvents: has("crm-sync", "activity") ? data.integrationEvents : [],
    teamMembers: canManageTeam ? data.teamMembers : [],
    escalationRules: has("settings") ? data.escalationRules : null,
  };
}
