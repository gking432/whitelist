import { EMPTY_PROFILE } from "./types.ts";
import type { DailyBriefData } from "./daily-brief.ts";
import type { ConnectedData } from "../connections/types.ts";

export function emptyDesignPreviewSources(generatedAt: string): ConnectedData {
  return {
    apps: [],
    messages: [],
    appointments: [],
    leads: [],
    invoices: [],
    payments: [],
    customers: [],
    crmDeals: [],
    errors: [],
    limited: false,
    generatedAt,
  };
}

// Presentation-only state. No tenant identifiers, customer records, credentials,
// or database calls belong in the public preview.
export function emptyDesignPreview(
  generatedAt = new Date().toISOString(),
): DailyBriefData {
  return {
    workspace: {
      clientName: "",
      clientId: "",
      workspaceScopeKey: "",
      profileRevision: null,
      profile: { ...EMPTY_PROFILE, goals: [] },
      records: [],
      installs: [],
      events: [],
      contacts: [],
      connections: [],
      pendingCustomerApprovals: 0,
      aiConfigured: false,
      canWrite: false,
      isTestAccount: false,
      setupRequired: false,
      error: null,
    },
    displayName: null,
    connectedData: emptyDesignPreviewSources(generatedAt),
    timeZone: "America/Chicago",
    generatedAt,
    tasks: [],
    appointments: [],
    approvals: [],
    conversations: [],
    work: [],
    teamStatus: "not_set_up",
    counts: { tasks: 0, approvals: 0, conversations: 0, blockedWork: 0 },
    errors: [],
    limited: false,
  };
}
