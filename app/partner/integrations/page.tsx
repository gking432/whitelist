import { Cable, CircleDot, Plus } from "lucide-react";

import { IntegrationRequestForm } from "@/components/integrations/integration-request-form";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { CONNECTOR_CATALOG } from "@/lib/integrations/connectors/catalog";
import { requirePrimaryPartnerAccess } from "@/lib/permissions/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

export default async function PartnerIntegrationsPage() {
  const user = await requireAuthenticatedUser("/partner/integrations");
  const access = await requirePrimaryPartnerAccess(user.id);
  const supabase = await createSupabaseServerClient();
  if (!supabase || !access.partnerId) return null;

  const [partnerResult, clientsResult, requestsResult, providersResult] = await Promise.all([
    supabase.from("partners").select("name").eq("id", access.partnerId).maybeSingle(),
    supabase.from("client_businesses").select("id, name").eq("partner_id", access.partnerId).eq("account_kind", "managed_client").neq("status", "archived").order("name"),
    supabase.from("integration_requests").select("id, application_name, status, priority, release_version, updated_at, client:client_businesses!integration_requests_client_id_fkey(name)").eq("partner_id", access.partnerId).order("updated_at", { ascending: false }),
    supabase.from("integration_providers").select("provider_key, connector_status"),
  ]);
  if (requestsResult.error) throw new Error(`Could not load integration requests: ${requestsResult.error.message}`);
  if (providersResult.error) throw new Error(`Could not load provider status: ${providersResult.error.message}`);
  const partner = partnerResult.data;
  const clients = clientsResult.data;
  const requests = requestsResult.data;
  const ready = CONNECTOR_CATALOG.filter((item) => item.verificationStatus === "contract_verified" || item.verificationStatus === "live_verified");
  const providerStatus = new Map(
    (providersResult.data ?? []).map((provider) => [
      provider.provider_key,
      provider.connector_status,
    ]),
  );

  return (
    <AppShell organizationName={partner?.name ?? "Partner workspace"} userEmail={user.email ?? ""} activeNav="integrations">
      <div className="space-y-6">
        <header className="border-b pb-5">
          <div className="flex items-center gap-2"><Cable className="size-5 text-primary" aria-hidden="true" /><h1 className="text-xl font-semibold">Integrations</h1></div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Connect supported systems during client setup. Request an application here when a client uses something that is not available yet.</p>
        </header>

        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="border-b px-5 py-4"><h2 className="font-semibold">Supported foundation</h2><p className="mt-1 text-xs text-muted-foreground">These connectors already have working application code. Real use still requires the client or partner account credentials.</p></div>
          <div className="grid sm:grid-cols-2">
            {ready.map((item) => {
              const status = providerStatus.get(item.key) ?? item.verificationStatus;
              return <div key={item.key} className="border-b px-5 py-4 sm:border-r"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold">{item.name}</p><Badge variant="outline">{status === "live_verified" ? "Live verified" : "Available"}</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p></div>;
            })}
          </div>
        </section>

        <section className="rounded-lg border bg-card p-5">
          <div className="mb-5 flex items-center gap-2"><Plus className="size-4 text-primary" aria-hidden="true" /><h2 className="font-semibold">Request another application</h2></div>
          <IntegrationRequestForm clients={(clients ?? []) as { id: string; name: string }[]} />
        </section>

        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="border-b px-5 py-4"><h2 className="font-semibold">Your requests</h2></div>
          {(requests ?? []).length === 0 ? <p className="px-5 py-8 text-sm text-muted-foreground">No integration requests yet.</p> : <div className="divide-y">{(requests ?? []).map((request) => {
            const client = request.client as unknown as { name?: string } | null;
            return <div key={request.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div><p className="text-sm font-semibold">{request.application_name}</p><p className="mt-1 text-xs text-muted-foreground">{client?.name ?? "Agency-wide"}{request.release_version ? ` · Version ${request.release_version}` : ""} · Updated {new Date(request.updated_at).toLocaleDateString()}</p></div><div className="flex items-center gap-2"><CircleDot className="size-3.5 text-primary" aria-hidden="true" /><Badge variant="outline">{request.status.replaceAll("_", " ")}</Badge></div></div>;
          })}</div>}
        </section>
      </div>
    </AppShell>
  );
}
