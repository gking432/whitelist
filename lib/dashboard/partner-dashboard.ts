import { getPartnerOpsCounts } from "@/lib/clients/ops";
import type { ClientStatus } from "@/lib/clients/constants";
import {
  computeClientHealth,
  emptyOpsCounts,
  type ClientHealthStatus,
  type ClientOpsCounts,
} from "@/lib/health/client-health";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type { ClientStatus } from "@/lib/clients/constants";
export type { ClientHealthStatus } from "@/lib/health/client-health";

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
  health: ClientHealthStatus;
  healthReasons: string[];
  industry: string | null;
  crmOperatingMode: string;
  runtimeMode: string;
  clientPortalEnabled: boolean;
  pendingApprovals: number;
  failedRuns7d: number;
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
    openApprovals: number;
    failedRuns7d: number;
    totalRuns7d: number;
    failingConnections: number;
    activeWorkflows: number;
  };
};

export class PartnerDashboardDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PartnerDashboardDataError";
  }
}

const healthPriority: Record<ClientHealthStatus, number> = {
  failing: 0,
  attention: 1,
  paused: 2,
  onboarding: 3,
  healthy: 4,
};

const healthSeverity: Partial<Record<ClientHealthStatus, AttentionSeverity>> = {
  failing: "critical",
  attention: "warning",
  paused: "warning",
  onboarding: "setup",
};

const healthLabel: Partial<Record<ClientHealthStatus, string>> = {
  failing: "Failing",
  attention: "Needs attention",
  paused: "Operations paused",
  onboarding: "Onboarding in progress",
};

export function buildPartnerDashboardData(
  partner: PartnerRecord,
  records: ClientRecord[],
  opsCounts: Map<string, ClientOpsCounts>,
): PartnerDashboardData {
  const clients = records
    .filter((client) => client.status !== "archived")
    .map((client) => {
      const counts = opsCounts.get(client.id) ?? { ...emptyOpsCounts };
      const health = computeClientHealth(client.status, counts);

      return {
        id: client.id,
        name: client.name,
        status: client.status,
        health: health.status,
        healthReasons: health.reasons,
        industry: client.industry,
        crmOperatingMode: client.crm_operating_mode,
        runtimeMode: client.default_runtime_mode,
        clientPortalEnabled: client.client_portal_enabled,
        pendingApprovals: counts.pendingApprovals,
        failedRuns7d: counts.failedRuns7d,
        updatedAt: client.updated_at,
      };
    })
    .sort((left, right) => {
      const difference =
        healthPriority[left.health] - healthPriority[right.health];

      return difference || left.name.localeCompare(right.name);
    });

  const attentionItems = clients
    .filter((client) => client.health !== "healthy")
    .map((client) => ({
      clientId: client.id,
      clientName: client.name,
      severity: healthSeverity[client.health] ?? "warning",
      label: healthLabel[client.health] ?? "Needs review",
      detail:
        client.healthReasons[0] ??
        "Review this client's operational state.",
    }));

  let openApprovals = 0;
  let failedRuns7d = 0;
  let totalRuns7d = 0;
  let failingConnections = 0;
  let activeWorkflows = 0;

  for (const client of records) {
    const counts = opsCounts.get(client.id);

    if (!counts || client.status === "archived") {
      continue;
    }

    openApprovals += counts.pendingApprovals;
    failedRuns7d += counts.failedRuns7d;
    totalRuns7d += counts.runs7d;
    failingConnections += counts.connectionsFailing;
    activeWorkflows += counts.activeWorkflows;
  }

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
      openApprovals,
      failedRuns7d,
      totalRuns7d,
      failingConnections,
      activeWorkflows,
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

  const [partnerResult, clientsResult, opsCounts] = await Promise.all([
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
      .eq("account_kind", "managed_client")
      .order("name", { ascending: true }),
    getPartnerOpsCounts(supabase, partnerId).catch(() => null),
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
    opsCounts ?? new Map(),
  );
}
