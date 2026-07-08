import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ChatWidgetSetup } from "@/components/partner/chat-widget-setup";
import { ConnectionControls } from "@/components/partner/connection-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { getAppUrl } from "@/lib/env";
import { formatDateTime, formatEnum } from "@/lib/format";
import {
  inboundWebhookPath,
  type IntegrationConnectionRecord,
  type IntegrationEventRecord,
} from "@/lib/integrations/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Connection Detail",
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ clientId: string; connectionId: string }>;
};

type ConnectionRow = IntegrationConnectionRecord & {
  provider: {
    provider_key: string;
    display_name: string;
    category: string;
    supports_inbound: boolean;
  } | null;
};

export default async function ConnectionDetailPage({ params }: PageProps) {
  const { clientId, connectionId } = await params;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind !== "ok") {
    return null;
  }

  const { access } = workspace;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const [connectionResult, secretResult, eventsResult] = await Promise.all([
    supabase
      .from("integration_connections")
      .select(
        "*, provider:integration_providers(provider_key, display_name, category, supports_inbound)",
      )
      .eq("id", connectionId)
      .eq("client_id", clientId)
      .maybeSingle(),
    // Safe columns only; encrypted_value is not selectable by session roles.
    supabase
      .from("integration_secrets")
      .select("id, secret_kind, last_four, updated_at")
      .eq("connection_id", connectionId)
      .maybeSingle(),
    supabase
      .from("integration_events")
      .select(
        "id, connection_id, workflow_run_id, direction, event_type, status, idempotency_key, error_code, error_message, created_at",
      )
      .eq("connection_id", connectionId)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  const connection = connectionResult.data as ConnectionRow | null;

  if (connectionResult.error || !connection) {
    return (
      <section className="rounded-lg border bg-card p-6">
        <h2 className="font-semibold">Connection not found</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This connection does not exist or is not accessible.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href={`/partner/clients/${clientId}/integrations`}>
            <ArrowLeft aria-hidden="true" />
            Back to integrations
          </Link>
        </Button>
      </section>
    );
  }

  const secret = secretResult.data;
  const events = (eventsResult.data ?? []) as IntegrationEventRecord[];
  const isInbound =
    Boolean(connection.provider?.supports_inbound);
  const endpointUrl = isInbound
    ? `${getAppUrl()}${inboundWebhookPath(connection.id)}`
    : null;

  return (
    <div className="space-y-5">
      <div>
        <Button asChild variant="ghost" className="px-0">
          <Link href={`/partner/clients/${clientId}/integrations`}>
            <ArrowLeft aria-hidden="true" />
            Integrations
          </Link>
        </Button>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{connection.display_name}</h2>
          <Badge variant="outline">{formatEnum(connection.status)}</Badge>
          <Badge variant="outline">
            {formatEnum(connection.runtime_mode)}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {connection.provider?.display_name} ·{" "}
          {formatEnum(connection.provider?.category ?? "")}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.8fr)]">
        <div className="space-y-5">
          {connection.provider?.provider_key === "northstar_web_chat" ? (
            <ChatWidgetSetup
              clientId={clientId}
              connectionId={connection.id}
              widgetKey={
                typeof (connection.config as Record<string, unknown>)
                  ?.widget_public_key === "string"
                  ? String(
                      (connection.config as Record<string, unknown>)
                        .widget_public_key,
                    )
                  : null
              }
              appUrl={getAppUrl()}
              canManage={access.canManageIntegrations}
            />
          ) : null}
          <section className="rounded-lg border bg-card p-5">
            <h3 className="text-sm font-semibold">Connection summary</h3>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Credential</dt>
                <dd className="mt-0.5">
                  {secret
                    ? `${formatEnum(connection.credential_status)} · ****${secret.last_four ?? ""}`
                    : formatEnum(connection.credential_status)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Last success</dt>
                <dd className="mt-0.5">
                  {formatDateTime(connection.last_success_at)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Last failure</dt>
                <dd className="mt-0.5">
                  {formatDateTime(connection.last_failure_at)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Error count</dt>
                <dd className="mt-0.5 tabular-nums">
                  {connection.error_count}
                </dd>
              </div>
            </dl>
            {connection.health_summary ? (
              <p className="mt-4 rounded-md border bg-secondary/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                {connection.health_summary}
              </p>
            ) : null}
          </section>

          {endpointUrl ? (
            <section className="rounded-lg border bg-card p-5">
              <h3 className="text-sm font-semibold">Inbound endpoint</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Configure the external system to send events here. The
                credential was shown once at creation; rotate it if it was not
                stored.
              </p>
              <code className="mt-3 block overflow-x-auto rounded bg-secondary/50 px-3 py-2 font-mono text-xs">
                POST {endpointUrl}
              </code>
              <div className="mt-3 space-y-1 text-xs leading-5 text-muted-foreground">
                <p>
                  Header:{" "}
                  <code className="font-mono">
                    x-webhook-token: &lt;credential&gt;
                  </code>
                </p>
                <p>
                  Body: JSON with required <code className="font-mono">event_type</code>,
                  optional <code className="font-mono">idempotency_key</code>,{" "}
                  <code className="font-mono">occurred_at</code>, and{" "}
                  <code className="font-mono">data</code> object.
                </p>
              </div>
            </section>
          ) : null}

          <section className="overflow-hidden rounded-lg border bg-card">
            <div className="border-b px-5 py-4">
              <h3 className="text-sm font-semibold">Recent events</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Payloads are stored redacted. Rejected requests are logged
                without credentials.
              </p>
            </div>
            {events.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                No events yet. Events appear when the external system sends a
                request to this connection.
              </div>
            ) : (
              <div className="divide-y">
                {events.map((event) => (
                  <div
                    key={event.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{event.event_type}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatEnum(event.direction)} ·{" "}
                        {formatDateTime(event.created_at)}
                        {event.error_message ? ` · ${event.error_message}` : ""}
                      </p>
                    </div>
                    <Badge variant="outline">{formatEnum(event.status)}</Badge>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="rounded-lg border bg-card p-5">
          {access.canManageIntegrations ? (
            <ConnectionControls
              clientId={clientId}
              connectionId={connection.id}
              status={connection.status}
              runtimeMode={connection.runtime_mode}
              hasCredential={Boolean(secret)}
            />
          ) : (
            <p className="text-sm leading-6 text-muted-foreground">
              Connection changes require a partner owner, admin, or
              implementer role.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
