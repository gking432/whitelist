import { ConnectedApps } from "@/components/integrations/connected-apps";
import Link from "next/link";
import { Link2, PlugZap, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { formatDateTime, formatEnum } from "@/lib/format";
import type {
  IntegrationConnectionRecord,
  IntegrationStatus,
} from "@/lib/integrations/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Client Integrations",
};

export const dynamic = "force-dynamic";

const statusStyles: Record<IntegrationStatus, string> = {
  not_connected: "border-slate-200 bg-slate-50 text-slate-700",
  connected: "border-emerald-200 bg-emerald-50 text-emerald-800",
  needs_attention: "border-amber-200 bg-amber-50 text-amber-900",
  failing: "border-red-200 bg-red-50 text-red-900",
  paused: "border-slate-200 bg-slate-50 text-slate-700",
  disabled: "border-slate-200 bg-slate-50 text-slate-500",
};

type ConnectionRow = IntegrationConnectionRecord & {
  provider: {
    provider_key: string;
    display_name: string;
    category: string;
  } | null;
};

type PageProps = {
  params: Promise<{ clientId: string }>;
};

export default async function ClientIntegrationsPage({ params }: PageProps) {
  const { clientId } = await params;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind !== "ok") {
    return null;
  }

  const { access } = workspace;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("integration_connections")
    .select(
      "*, provider:integration_providers(provider_key, display_name, category)",
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <section className="rounded-lg border bg-card p-6">
        <h2 className="font-semibold">Integrations unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Integration connections could not be loaded. Refresh to try again.
        </p>
      </section>
    );
  }

  const connections = (data ?? []) as unknown as ConnectionRow[];
  const base = `/partner/clients/${clientId}/integrations`;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold">Integration connections</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Connections to the systems this client operates with.
          </p>
        </div>
        {access.canManageIntegrations ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/partner/clients/${clientId}/connections`}>
                <Link2 aria-hidden="true" />
                Connection wizard
              </Link>
            </Button>
            <Button asChild>
              <Link href={`${base}/new`}>
                <Plus aria-hidden="true" />
                Add manually
              </Link>
            </Button>
          </div>
        ) : null}
      </div>

      {access.canManageIntegrations ? <ConnectedApps clientId={clientId} /> : null}

      {connections.length === 0 ? (
        <section className="flex min-h-64 flex-col items-center justify-center rounded-lg border bg-card px-6 py-12 text-center">
          <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <PlugZap className="size-5" aria-hidden="true" />
          </div>
          <h3 className="mt-4 font-semibold">No connections yet</h3>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Add an inbound webhook connection to start receiving events from
            this client&apos;s systems.
          </p>
          {access.canManageIntegrations ? (
            <Button asChild className="mt-5">
              <Link href={`${base}/new`}>
                <Plus aria-hidden="true" />
                Add connection
              </Link>
            </Button>
          ) : null}
        </section>
      ) : (
        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="border-b text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Connection</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Runtime mode</th>
                  <th className="px-4 py-3 font-medium">Credential</th>
                  <th className="px-4 py-3 font-medium">Last success</th>
                  <th className="px-4 py-3 font-medium">Last failure</th>
                  <th className="px-4 py-3 font-medium">Errors</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {connections.map((connection) => (
                  <tr key={connection.id} className="hover:bg-secondary/30">
                    <td className="px-5 py-3.5">
                      <Link
                        href={`${base}/${connection.id}`}
                        className="font-medium hover:underline"
                      >
                        {connection.display_name}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {connection.provider?.display_name ?? "Provider"} ·{" "}
                        {formatEnum(connection.provider?.category ?? "")}
                      </p>
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge
                        variant="outline"
                        className={statusStyles[connection.status]}
                      >
                        {formatEnum(connection.status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {formatEnum(connection.runtime_mode)}
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {formatEnum(connection.credential_status)}
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {formatDateTime(connection.last_success_at)}
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {formatDateTime(connection.last_failure_at)}
                    </td>
                    <td className="px-4 py-3.5 tabular-nums">
                      {connection.error_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
