import { notFound } from "next/navigation";
import { FlaskConical } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import {
  ScenarioLab,
  type ScenarioLabHistoryItem,
} from "@/components/partner/scenario-lab";
import { Badge } from "@/components/ui/badge";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import {
  isAccessError,
  requirePrimaryPartnerAccess,
} from "@/lib/permissions/access";
import type { AccessContext } from "@/lib/permissions/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { findScenarioLabClient } from "@/lib/testing/scenario-runner";

export const metadata = {
  title: "Scenario Lab",
};

export const dynamic = "force-dynamic";

function isLabEnabled() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_SCENARIO_LAB === "true"
  );
}

export default async function ScenarioLabPage() {
  if (!isLabEnabled()) {
    notFound();
  }

  const user = await requireAuthenticatedUser("/partner/lab");
  let access: AccessContext;

  try {
    access = await requirePrimaryPartnerAccess(user.id);
  } catch (error) {
    if (isAccessError(error) && error.code === "ACCESS_DENIED") {
      notFound();
    }

    throw error;
  }

  if (!access.partnerId) {
    notFound();
  }

  const admin = createSupabaseAdminClient();

  if (!admin) {
    throw new Error("Scenario Lab requires the Supabase service configuration.");
  }

  const [{ data: partner }, labClient] = await Promise.all([
    admin
      .from("partners")
      .select("name")
      .eq("id", access.partnerId)
      .maybeSingle(),
    findScenarioLabClient(admin, access.partnerId),
  ]);
  let history: ScenarioLabHistoryItem[] = [];

  if (labClient) {
    const { data: events } = await admin
      .from("integration_events")
      .select("id, event_type, status, request_payload, created_at")
      .eq("partner_id", access.partnerId)
      .eq("client_id", labClient.id)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(30);

    history = (events ?? [])
      .map((event) => {
        const payload = (event.request_payload ?? {}) as Record<
          string,
          unknown
        >;
        const eventData =
          typeof payload.data === "object" && payload.data !== null
            ? (payload.data as Record<string, unknown>)
            : {};
        const scenarioKey =
          typeof payload.scenario_key === "string"
            ? payload.scenario_key
            : typeof eventData.scenario_key === "string"
              ? eventData.scenario_key
              : "";

        if (payload.source !== "scenario_lab" && !scenarioKey) {
          return null;
        }

        return {
          id: event.id,
          eventType: event.event_type,
          scenarioKey,
          status: event.status,
          createdAt: event.created_at,
        };
      })
      .filter((item): item is ScenarioLabHistoryItem => Boolean(item));
  }

  return (
    <AppShell
      organizationName={partner?.name ?? "Partner workspace"}
      userEmail={user.email ?? "Authenticated user"}
      activeNav="lab"
    >
      <div className="space-y-6">
        <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Badge variant="gold">Internal tool</Badge>
              <Badge variant="outline">Sandbox only</Badge>
            </div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <FlaskConical className="size-5 text-primary" aria-hidden="true" />
              Scenario Lab
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Run editable business scenarios through Northstar’s real workflow
              engine and verify the resulting approvals, CRM records, bookings,
              assistant events, and failures.
            </p>
          </div>
        </header>

        <ScenarioLab
          labClient={labClient ? { id: labClient.id, name: labClient.name } : null}
          history={history}
        />
      </div>
    </AppShell>
  );
}
