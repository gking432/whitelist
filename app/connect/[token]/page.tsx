import { notFound } from "next/navigation";
import { CheckCircle2, LockKeyhole } from "lucide-react";

import { ClientConnectionCard } from "@/components/integrations/client-connection-card";
import { getGoogleOAuthClient } from "@/lib/env";
import { loadActiveConnectionSetupSession } from "@/lib/integrations/connection-setup";
import { PILOT_PROVIDERS, type PilotProviderKey } from "@/lib/integrations/pilot";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const metadata = {
  title: { absolute: "Connect Business Accounts" },
};
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ google?: string }>;
};

export default async function ClientConnectionPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { google } = await searchParams;
  const admin = createSupabaseAdminClient();
  if (!admin) notFound();
  const session = await loadActiveConnectionSetupSession(admin, token);
  if (!session) notFound();

  const [
    { data: client },
    { data: partner },
    { data: branding },
    { data: connections },
    { data: partnerTwilio },
  ] =
    await Promise.all([
      admin.from("client_businesses").select("name, crm_operating_mode").eq("id", session.client_id).single(),
      admin.from("partners").select("name, support_email").eq("id", session.partner_id).single(),
      admin.from("partner_branding").select("product_name, logo_url, primary_color").eq("partner_id", session.partner_id).maybeSingle(),
      admin
        .from("integration_connections")
        .select("status, provider:integration_providers(provider_key)")
        .eq("client_id", session.client_id),
      admin
        .from("partner_provider_connections")
        .select("status")
        .eq("partner_id", session.partner_id)
        .eq("provider_key", "twilio")
        .maybeSingle(),
    ]);

  if (!client || !partner) notFound();
  const connectedKeys = new Set(
    (connections ?? [])
      .filter((connection) => connection.status === "connected")
      .map((connection) => (connection.provider as unknown as { provider_key: string } | null)?.provider_key)
      .filter(Boolean),
  );
  const requestedProviders = session.allowed_provider_keys.filter(
    (key): key is PilotProviderKey => key in PILOT_PROVIDERS,
  );
  const completeCount = requestedProviders.filter((key) => connectedKeys.has(key)).length;
  const productName = branding?.product_name || partner.name;

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            {branding?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={branding.logo_url} alt="" className="size-9 object-contain" />
            ) : (
              <div
                className="flex size-9 items-center justify-center rounded-md text-sm font-semibold text-white"
                style={{ backgroundColor: branding?.primary_color || "#174735" }}
              >
                {productName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div>
              <p className="font-semibold">{productName}</p>
              <p className="text-xs text-muted-foreground">Secure account connection</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <LockKeyhole className="size-3.5" aria-hidden="true" /> Encrypted
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-primary">{client.name}</p>
          <h1 className="mt-2 text-3xl font-semibold">Connect your business accounts</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Sign in or enter access directly here. Credentials are verified, encrypted, and never shown to your service partner.
          </p>
        </div>

        <div className="mt-6 flex items-center gap-3 border-y py-4">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-emerald-600 transition-all"
              style={{ width: `${requestedProviders.length ? (completeCount / requestedProviders.length) * 100 : 100}%` }}
            />
          </div>
          <span className="text-sm font-medium tabular-nums">{completeCount}/{requestedProviders.length}</span>
        </div>

        {google ? (
          <div className="mt-5 rounded-md border bg-card px-4 py-3 text-sm">
            {google === "connected"
              ? "Google Calendar connected and verified."
              : "Google Calendar needs attention. Open its card and try again."}
          </div>
        ) : null}

        {completeCount === requestedProviders.length ? (
          <section className="mt-7 rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-emerald-950">
            <CheckCircle2 className="size-6 text-emerald-700" aria-hidden="true" />
            <h2 className="mt-3 font-semibold">Account connection is complete</h2>
            <p className="mt-1 text-sm leading-5">Your service partner can now install and test the automation package.</p>
          </section>
        ) : (
          <div className="mt-7 space-y-4">
            {requestedProviders.map((key) => (
              <ClientConnectionCard
                key={key}
                token={token}
                provider={PILOT_PROVIDERS[key]}
                connected={connectedKeys.has(key)}
                productName={productName}
                supportName={partner.name}
                googleReady={Boolean(getGoogleOAuthClient())}
                managedTwilioReady={partnerTwilio?.status === "connected"}
              />
            ))}
          </div>
        )}

        <p className="mt-8 text-xs leading-5 text-muted-foreground">
          This link expires {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.expires_at))}. Contact {partner.support_email || partner.name} for help.
        </p>
      </div>
    </main>
  );
}
