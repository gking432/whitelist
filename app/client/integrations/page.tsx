import { PlugZap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { loadClientPortal } from "@/lib/clients/portal";
import { formatDateTime, formatEnum } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const statusStyles: Record<string, string> = {
  connected: "border-emerald-200 bg-emerald-50 text-emerald-800",
  needs_attention: "border-amber-200 bg-amber-50 text-amber-900",
  failing: "border-red-200 bg-red-50 text-red-900",
};

export default async function ClientPortalIntegrationsPage() {
  const portal = await loadClientPortal();

  if (portal.kind !== "ok") {
    return null;
  }

  const { access } = portal;
  const supabase = await createSupabaseServerClient();

  if (!supabase || !access.clientId) {
    return null;
  }

  // Health only. Config, credentials, and endpoints are partner-side concerns
  // and are never shown in the portal.
  const { data, error } = await supabase
    .from("integration_connections")
    .select(
      "id, display_name, status, last_success_at, provider:integration_providers(display_name, category)",
    )
    .eq("client_id", access.clientId)
    .order("display_name", { ascending: true });

  const connections = (data ?? []) as unknown as {
    id: string;
    display_name: string;
    status: string;
    last_success_at: string | null;
    provider: { display_name: string; category: string } | null;
  }[];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Connected systems</h1>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          The systems connected to your automations and their current health.
        </p>
      </header>

      {error ? (
        <section className="rounded-lg border bg-card p-6">
          <p className="text-sm leading-6 text-muted-foreground">
            Connection health could not be loaded. Refresh to try again.
          </p>
        </section>
      ) : connections.length === 0 ? (
        <section className="flex min-h-48 flex-col items-center justify-center rounded-lg border bg-card px-6 py-10 text-center">
          <PlugZap className="size-6 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold">No connections yet</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Your partner will connect your systems as part of setup.
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="divide-y">
            {connections.map((connection) => (
              <div
                key={connection.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
              >
                <div>
                  <p className="text-sm font-medium">
                    {connection.display_name}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {connection.provider?.display_name ?? "System"} · Last
                    successful event: {formatDateTime(connection.last_success_at)}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={statusStyles[connection.status] ?? ""}
                >
                  {formatEnum(connection.status)}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
