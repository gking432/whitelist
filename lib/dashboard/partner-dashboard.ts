import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ClientStatus =
  | "onboarding"
  | "active"
  | "paused"
  | "at_risk"
  | "archived";

export type ClientHealth =
  | "healthy"
  | "onboarding"
  | "needs_attention";

export type AttentionSeverity = "critical" | "warning" | "setup";

type PartnerRecord = {
  id: string;
  name: string;
  status: "active" | "trial" | "paused" | "suspended";
};

type ClientRecord = {
  id: string;
  partner_id: string;
  name: string;
  status: ClientStatus;
  industry: string | null;
  crm_operating_mode: string;
  default_runtime_mode: string;
  client_portal_enabled: boolean;
  updated_at: string;
};

export type PartnerDashboardClient = {
  id: string;
  name: string;
  status: ClientStatus;
  health: ClientHealth;
  industry: string | null;
  crmOperatingMode: string;
  runtimeMode: string;
  clientPortalEnabled: boolean;
  updatedAt: string;
};

export type PartnerAttentionItem = {
  clientId: string;
  clientName: string;
  severity: AttentionSeverity;
  label: string;
  detail: string;
};

export type PartnerDashboardData = {
  partner: PartnerRecord;
  clients: PartnerDashboardClient[];
  attentionItems: PartnerAttentionItem[];
  metrics: {
    totalClients: number;
    activeClients: number;
    clientsNeedingAttention: number;
    onboardingClients: number;
  };
};

export class PartnerDashboardDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PartnerDashboardDataError";
  }
}

function toClientHealth(status: ClientStatus): ClientHealth {
  if (status === "active") {
    return "healthy";
  }

  if (status === "onboarding") {
    return "onboarding";
  }

  return "needs_attention";
}

function toAttentionItem(
  client: PartnerDashboardClient,
): PartnerAttentionItem | null {
  if (client.status === "at_risk") {
    return {
      clientId: client.id,
      clientName: client.name,
      severity: "critical",
      label: "At risk",
      detail: "Review client health and recent operating issues.",
    };
  }

  if (client.status === "paused") {
    return {
      clientId: client.id,
      clientName: client.name,
      severity: "warning",
      label: "Operations paused",
      detail: "Confirm whether this client should remain paused.",
    };
  }

  if (client.status === "onboarding") {
    return {
      clientId: client.id,
      clientName: client.name,
      severity: "setup",
      label: "Onboarding in progress",
      detail: "Complete the remaining client setup work.",
    };
  }

  return null;
}

const statusPriority: Record<ClientStatus, number> = {
  at_risk: 0,
  paused: 1,
  onboarding: 2,
  active: 3,
  archived: 4,
};

export function buildPartnerDashboardData(
  partner: PartnerRecord,
  records: ClientRecord[],
): PartnerDashboardData {
  const clients = records
    .filter((client) => client.status !== "archived")
    .map((client) => ({
      id: client.id,
      name: client.name,
      status: client.status,
      health: toClientHealth(client.status),
      industry: client.industry,
      crmOperatingMode: client.crm_operating_mode,
      runtimeMode: client.default_runtime_mode,
      clientPortalEnabled: client.client_portal_enabled,
      updatedAt: client.updated_at,
    }))
    .sort((left, right) => {
      const statusDifference =
        statusPriority[left.status] - statusPriority[right.status];

      return statusDifference || left.name.localeCompare(right.name);
    });

  const attentionItems = clients
    .map(toAttentionItem)
    .filter((item): item is PartnerAttentionItem => item !== null);

  return {
    partner,
    clients,
    attentionItems,
    metrics: {
      totalClients: clients.length,
      activeClients: clients.filter((client) => client.status === "active")
        .length,
      clientsNeedingAttention: attentionItems.length,
      onboardingClients: clients.filter(
        (client) => client.status === "onboarding",
      ).length,
    },
  };
}

export async function getPartnerDashboardData(
  partnerId: string,
): Promise<PartnerDashboardData> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    throw new PartnerDashboardDataError(
      "Supabase is not configured for this environment.",
    );
  }

  const [partnerResult, clientsResult] = await Promise.all([
    supabase
      .from("partners")
      .select("id, name, status")
      .eq("id", partnerId)
      .maybeSingle(),
    supabase
      .from("client_businesses")
      .select(
        "id, partner_id, name, status, industry, crm_operating_mode, default_runtime_mode, client_portal_enabled, updated_at",
      )
      .eq("partner_id", partnerId)
      .order("name", { ascending: true }),
  ]);

  if (partnerResult.error) {
    throw new PartnerDashboardDataError(partnerResult.error.message);
  }

  if (!partnerResult.data) {
    throw new PartnerDashboardDataError(
      "Partner organization was not found or is inaccessible.",
    );
  }

  if (clientsResult.error) {
    throw new PartnerDashboardDataError(clientsResult.error.message);
  }

  return buildPartnerDashboardData(
    partnerResult.data as PartnerRecord,
    (clientsResult.data ?? []) as ClientRecord[],
  );
}
