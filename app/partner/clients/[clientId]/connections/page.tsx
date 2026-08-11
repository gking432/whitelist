import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Link2,
  LockKeyhole,
  PhoneCall,
  Workflow,
} from "lucide-react";

import { createConnectionSetupLink } from "@/app/partner/clients/[clientId]/connections/actions";
import { ConnectionLinkForm } from "@/components/partner/connection-link-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import {
  PILOT_PROVIDERS,
  type PilotProviderKey,
} from "@/lib/integrations/pilot";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Connection Setup" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ clientId: string }> };

export default async function ConnectionSetupPage({ params }: PageProps) {
  const { clientId } = await params;
  const workspace = await loadClientWorkspace(clientId);
  if (workspace.kind !== "ok") return null;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const [{ data: connections }, { data: activeSession }] = await Promise.all([
    supabase
      .from("integration_connections")
      .select("id, status, provider:integration_providers(provider_key)")
      .eq("client_id", clientId),
    supabase
      .from("client_connection_setup_sessions")
      .select("id, expires_at, allowed_provider_keys")
      .eq("client_id", clientId)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const connectedKeys = new Set(
    (connections ?? [])
      .filter((connection) => connection.status === "connected")
      .map((connection) => {
        const provider = connection.provider as unknown as
          | { provider_key: string }
          | null;
        return provider?.provider_key;
      })
      .filter(Boolean),
  );
  const sessionProviderKeys =
    (activeSession?.allowed_provider_keys as string[] | undefined) ??
    Object.keys(PILOT_PROVIDERS);
  const requestedProviderKeys = sessionProviderKeys.filter(
    (key): key is PilotProviderKey => key in PILOT_PROVIDERS,
  );
  const connectedCount = requestedProviderKeys.filter((key) =>
    connectedKeys.has(key),
  ).length;
  const boundCreate = createConnectionSetupLink.bind(null, clientId);

  return (
    <div className="space-y-7">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">Client setup</p>
          <h1 className="mt-1 text-2xl font-semibold">Connect {workspace.client.name}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Choose the systems, let the client authorize them securely, then install and verify the automation stack.
          </p>
        </div>
        <Badge variant="outline" className="w-fit">
          {connectedCount}/{requestedProviderKeys.length} accounts connected
        </Badge>
      </header>

      <ol className="grid gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-3">
        {[
          ["1", "Send connection link", "The client enters credentials; the partner never sees them."],
          ["2", "Install the stack", "The platform provisions the selected workflows automatically."],
          ["3", "Run real tests", "Nothing becomes active until its real event is verified."],
        ].map(([number, title, detail]) => (
          <li key={number} className="bg-card p-5">
            <span className="text-xs font-semibold text-primary">STEP {number}</span>
            <p className="mt-2 font-medium">{title}</p>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{detail}</p>
          </li>
        ))}
      </ol>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="rounded-lg border bg-card p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <LockKeyhole className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-semibold">Secure client authorization</h2>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                Select what this client uses. The link works for seven days and is replaced whenever you create a new one.
              </p>
            </div>
          </div>
          <div className="mt-5">
            <ConnectionLinkForm action={boundCreate} hasActiveLink={Boolean(activeSession)} />
          </div>
        </div>

        <aside className="space-y-3">
          <div className="rounded-lg border bg-card p-5">
            <div className="flex items-center gap-2">
              <PhoneCall className="size-4 text-primary" aria-hidden="true" />
              <h2 className="font-semibold">Phone setup</h2>
            </div>
            <p className="mt-2 text-sm leading-5 text-muted-foreground">
              Your agency provisions each client under your Twilio account. The client can forward their existing line to the new number or port it later.
            </p>
          </div>
          <Button asChild variant="outline" className="w-full justify-between">
            <Link href={`/partner/clients/${clientId}/setup`}>
              Connect accounts here
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </aside>
      </section>

      <section>
        <div className="flex items-center gap-2">
          <Link2 className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="font-semibold">Connection status</h2>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {requestedProviderKeys.map((key) => {
            const provider = PILOT_PROVIDERS[key];
            const connected = connectedKeys.has(provider.key);
            return (
              <div key={provider.key} className="rounded-lg border bg-card p-4">
                {connected ? (
                  <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
                ) : (
                  <CircleDashed className="size-4 text-muted-foreground" aria-hidden="true" />
                )}
                <p className="mt-3 text-sm font-medium">{provider.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {connected ? "Connected and verified" : "Waiting for client"}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <div className="flex justify-end">
        <Button asChild>
          <Link href={`/partner/clients/${clientId}/automation-packs`}>
            <Workflow aria-hidden="true" />
            Open automation installer
          </Link>
        </Button>
      </div>
    </div>
  );
}
