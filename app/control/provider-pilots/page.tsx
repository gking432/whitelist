import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  FlaskConical,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";

import {
  promoteProviderPilot,
  revokeProviderPilot,
  saveProviderPilot,
} from "@/app/control/provider-pilots/actions";
import { NorthstarMark } from "@/components/brand/northstar-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { providerPilotReadiness } from "@/lib/control/provider-pilot";
import { requirePlatformRole } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Provider Pilots" };
export const dynamic = "force-dynamic";

type ConnectionRow = {
  id: string;
  provider_id: string;
  status: string;
  credential_status: string;
  runtime_mode: string;
  external_account_name: string | null;
  last_success_at: string | null;
  provider: {
    provider_key: string;
    display_name: string;
    supports_inbound: boolean;
    supports_outbound: boolean;
    connector_status: string;
  } | null;
  partner: { name: string } | null;
  client: { name: string } | null;
};

type PilotRow = {
  id: string;
  connection_id: string;
  status: string;
  inbound_event_id: string | null;
  outbound_event_id: string | null;
  read_evidence: string;
  retry_evidence: string;
  revocation_evidence: string;
  notes: string;
  passed_at: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
};

function statusClass(complete: boolean) {
  return complete
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-border bg-background text-muted-foreground";
}

export default async function ProviderPilotsPage() {
  const user = await requireAuthenticatedUser("/control/provider-pilots");
  await requirePlatformRole(user.id, ["platform_owner", "platform_admin"]);
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const [{ data: connectionData }, { data: pilotData }] = await Promise.all([
    admin
      .from("integration_connections")
      .select(
        "id, provider_id, status, credential_status, runtime_mode, external_account_name, last_success_at, provider:integration_providers(provider_key, display_name, supports_inbound, supports_outbound, connector_status), partner:partners(name), client:client_businesses(name)",
      )
      .order("updated_at", { ascending: false }),
    admin.from("provider_live_pilots").select("*").order("updated_at", {
      ascending: false,
    }),
  ]);
  const connections = (connectionData ?? []) as unknown as ConnectionRow[];
  const pilots = (pilotData ?? []) as PilotRow[];
  const pilotByConnection = new Map<string, PilotRow>();
  for (const pilot of pilots) {
    if (!pilotByConnection.has(pilot.connection_id)) {
      pilotByConnection.set(pilot.connection_id, pilot);
    }
  }
  const liveProviderIds = new Set(
    connections
      .filter(
        (connection) =>
          connection.provider?.connector_status === "live_verified",
      )
      .map((connection) => connection.provider_id),
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <NorthstarMark surface="light" subtitle="Provider Pilots" />
          <Button asChild variant="ghost" size="sm">
            <Link href="/control">
              <ArrowLeft aria-hidden="true" />
              Control room
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <section className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <FlaskConical className="size-5 text-primary" aria-hidden="true" />
              <h1 className="text-xl font-semibold">Real-account provider pilots</h1>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              A connector remains contract verified until one real client account proves credentials, reads, required inbound and outbound activity, retries, and disconnect behavior.
            </p>
          </div>
          <div className="flex gap-4 text-sm">
            <div>
              <p className="text-2xl font-semibold tabular-nums">{liveProviderIds.size}</p>
              <p className="text-xs text-muted-foreground">Live providers</p>
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums">{connections.length}</p>
              <p className="text-xs text-muted-foreground">Account connections</p>
            </div>
          </div>
        </section>

        {connections.length === 0 ? (
          <section className="rounded-lg border bg-card p-8 text-sm text-muted-foreground">
            No real provider connections exist yet. Connect the first pilot client from its Setup workspace, then return here.
          </section>
        ) : (
          <div className="space-y-4">
            {connections.map((connection) => {
              const provider = connection.provider;
              if (!provider) return null;
              const pilot = pilotByConnection.get(connection.id);
              const readiness = providerPilotReadiness({
                connectionStatus: connection.status,
                credentialStatus: connection.credential_status,
                runtimeMode: connection.runtime_mode,
                supportsInbound: provider.supports_inbound,
                supportsOutbound: provider.supports_outbound,
                inboundEventId: pilot?.inbound_event_id,
                outboundEventId: pilot?.outbound_event_id,
                readEvidence: pilot?.read_evidence,
                retryEvidence: pilot?.retry_evidence,
                revocationEvidence: pilot?.revocation_evidence,
              });
              const passed = pilot?.status === "passed";

              return (
                <section key={connection.id} className="overflow-hidden rounded-lg border bg-card">
                  <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold">{provider.display_name}</h2>
                        <Badge variant="outline">
                          {provider.connector_status.replaceAll("_", " ")}
                        </Badge>
                        {passed ? (
                          <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800" variant="outline">
                            <ShieldCheck aria-hidden="true" />
                            Pilot passed
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {connection.partner?.name ?? "Partner"} · {connection.client?.name ?? "Client"} · {connection.external_account_name ?? "Connected account"}
                      </p>
                    </div>
                    <Badge variant="outline">
                      {connection.status.replaceAll("_", " ")} · {connection.runtime_mode}
                    </Badge>
                  </div>

                  <div className="grid gap-2 border-b px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
                    {readiness.proofs.map((proof) => {
                      const Icon = proof.complete ? CheckCircle2 : CircleDashed;
                      return (
                        <div key={proof.key} className={`flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-xs ${statusClass(proof.complete)}`}>
                          <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                          <span>{proof.label}</span>
                        </div>
                      );
                    })}
                  </div>

                  {passed ? (
                    <div className="space-y-4 px-5 py-4">
                      <p className="text-sm leading-6 text-muted-foreground">
                        Passed {pilot.passed_at ? new Date(pilot.passed_at).toLocaleString() : "with recorded evidence"}. The provider is available as live verified across the platform.
                      </p>
                      <form action={revokeProviderPilot} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                        <input type="hidden" name="pilot_id" value={pilot.id} />
                        <label className="space-y-1.5 text-sm font-medium">
                          Rollback reason
                          <input name="reason" required minLength={12} maxLength={2000} className="h-9 w-full rounded-md border bg-background px-3 text-sm" placeholder="What failed or changed in the live provider contract?" />
                        </label>
                        <Button type="submit" variant="outline" size="sm">
                          <RotateCcw aria-hidden="true" />
                          Revoke live status
                        </Button>
                      </form>
                    </div>
                  ) : (
                    <form action={saveProviderPilot} className="space-y-4 px-5 py-4">
                      <input type="hidden" name="connection_id" value={connection.id} />
                      <div className="grid gap-4 lg:grid-cols-3">
                        <label className="space-y-1.5 text-sm font-medium">
                          Account read proof
                          <textarea name="read_evidence" required minLength={12} maxLength={4000} defaultValue={pilot?.read_evidence ?? ""} className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm font-normal" placeholder="What real record was read, and where was it confirmed?" />
                        </label>
                        <label className="space-y-1.5 text-sm font-medium">
                          Retry and idempotency proof
                          <textarea name="retry_evidence" required minLength={12} maxLength={4000} defaultValue={pilot?.retry_evidence ?? ""} className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm font-normal" placeholder="What was retried, and how was duplicate delivery prevented?" />
                        </label>
                        <label className="space-y-1.5 text-sm font-medium">
                          Disconnect proof
                          <textarea name="revocation_evidence" required minLength={12} maxLength={4000} defaultValue={pilot?.revocation_evidence ?? ""} className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm font-normal" placeholder="How did revoked credentials fail safely and recover?" />
                        </label>
                      </div>
                      <label className="block space-y-1.5 text-sm font-medium">
                        Notes
                        <textarea name="notes" maxLength={8000} defaultValue={pilot?.notes ?? ""} className="min-h-16 w-full rounded-md border bg-background px-3 py-2 text-sm font-normal" placeholder="Vendor account, test date, external record links, and any limitations." />
                      </label>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button type="submit" variant="outline" size="sm">Save and capture latest events</Button>
                      </div>
                    </form>
                  )}
                  {pilot?.status === "draft" && readiness.ready ? (
                    <form action={promoteProviderPilot} className="flex justify-end border-t px-5 py-4">
                      <input type="hidden" name="pilot_id" value={pilot.id} />
                      <Button type="submit" size="sm">
                        <ShieldCheck aria-hidden="true" />
                        Promote to live verified
                      </Button>
                    </form>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
