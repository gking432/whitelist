import { ConnectedApps } from "@/components/integrations/connected-apps";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { loadClientPortal } from "@/lib/clients/portal";
import { supportsImportedLeadAutomation } from "@/lib/integrations/connectors/catalog";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  setImportedLeadAutomation,
  setNativeLifecycleAutomation,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Apps and automations" };

export default async function ClientPortalIntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const portal = await loadClientPortal();
  if (portal.kind !== "ok") return null;
  if (
    portal.access.isImpersonating ||
    !["client_owner", "client_manager"].includes(portal.access.role) ||
    !portal.access.canOperateCustomerActions ||
    !portal.access.visibleClientSections.includes("settings")
  ) {
    return (
      <p>
        An owner or manager with settings and customer action access can manage
        imported lead automation.
      </p>
    );
  }
  const db = await createSupabaseServerClient();
  const { data: lifecycle } = db
    ? await db
        .from("client_businesses")
        .select("native_lifecycle_enabled_at")
        .eq("id", portal.client.id)
        .eq("partner_id", portal.client.partner_id)
        .maybeSingle()
    : { data: null };
  const lifecycleEnabled = Boolean(lifecycle?.native_lifecycle_enabled_at);
  const { data, error } = db
    ? await db
        .from("integration_connections")
        .select(
          "id,display_name,status,runtime_mode,config,provider:integration_providers(provider_key,display_name)",
        )
        .eq("partner_id", portal.client.partner_id)
        .eq("client_id", portal.client.id)
        .eq("status", "connected")
        .order("display_name")
    : { data: null, error: true };
  const connections = (data ?? []).filter((connection) => {
    const provider = connection.provider as unknown as { provider_key: string };
    return supportsImportedLeadAutomation(provider?.provider_key);
  });
  const { notice } = await searchParams;
  const messages: Record<string, string> = {
    saved: "Your imported lead automation setting is saved.",
    denied: "Your account cannot change this setting.",
    unavailable:
      "The connected source could not be loaded. Try again or contact your partner.",
    changed:
      "The source changed while you were saving. Review the current setting and try again.",
  };
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Apps and automations</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          Connect your existing tools and choose which activity starts your
          solutions. Test the setup here, and review proposed customer actions
          in Approvals.
        </p>
      </header>
      <ConnectedApps clientId={portal.client.id} />
      {messages[notice ?? ""] ? (
        <p role="status" className="rounded-lg border bg-secondary p-4 text-sm">
          {messages[notice ?? ""]}
        </p>
      ) : null}
      {error ? (
        <p role="alert">
          Connected sources could not be loaded. Please try again.
        </p>
      ) : connections.length === 0 ? (
        <div className="rounded-xl border p-6">
          <h2 className="font-medium">No connected lead import sources</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Ask your partner to connect a supported lead source. Web forms,
            forwarded email and phone intake already use their own workflow
            settings.
          </p>
        </div>
      ) : (
        connections.map((connection) => {
          const enabled =
            typeof connection.config?.lead_automation_enabled_at === "string";
          const provider = connection.provider as unknown as {
            display_name: string;
          };
          return (
            <section
              key={connection.id}
              className="rounded-xl border bg-card p-6"
            >
              <h2 className="font-medium">
                {connection.display_name || provider.display_name}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {enabled
                  ? "Future imported lead automation is enabled."
                  : "Imported leads are saved for reference."}{" "}
                {connection.runtime_mode === "live"
                  ? "This source is live."
                  : "This source is in preview; workflows from imports start only after it is live."}
              </p>
              <form action={setImportedLeadAutomation} className="mt-4">
                <input
                  type="hidden"
                  name="connection_id"
                  value={connection.id}
                />
                <input type="hidden" name="enabled" value={String(!enabled)} />
                <Button type="submit" variant={enabled ? "outline" : "default"}>
                  {enabled
                    ? "Pause lead automations"
                    : "Turn on lead automations"}
                </Button>
              </form>
            </section>
          );
        })
      )}
      {["primary_crm", "mirror", "assist"].includes(
        portal.client.crm_operating_mode,
      ) ? (
        <section className="rounded-xl border bg-card p-6">
          <h2 className="font-medium">
            CRM follow-ups, reminders and review requests
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Enable your installed workflows to respond to future estimate and
            appointment activity in this CRM. Your business and the relevant
            workflows must be live. Existing approval rules apply before
            customer messages are sent.
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {lifecycleEnabled
              ? "CRM automations are on."
              : "CRM automations are off."}{" "}
            Turning this off cancels activity that has not started processing.
            You can still review existing approvals.
          </p>
          <form action={setNativeLifecycleAutomation} className="mt-4">
            <input
              type="hidden"
              name="enabled"
              value={String(!lifecycleEnabled)}
            />
            <Button
              type="submit"
              variant={lifecycleEnabled ? "outline" : "default"}
            >
              {lifecycleEnabled
                ? "Pause CRM automations"
                : "Turn on CRM automations"}
            </Button>
          </form>
        </section>
      ) : null}
      <nav className="flex flex-wrap gap-5 text-sm">
        <Link href="/client/approvals" className="underline underline-offset-4">
          Review pending approvals
        </Link>
        <Link href="/client/launch" className="underline underline-offset-4">
          Beta launch checklist
        </Link>
      </nav>
    </div>
  );
}
