import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { createIntegrationConnection } from "@/app/partner/clients/[clientId]/integrations/actions";
import { ConnectionForm } from "@/components/partner/connection-form";
import { Button } from "@/components/ui/button";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { getAppUrl } from "@/lib/env";
import type { IntegrationProviderRecord } from "@/lib/integrations/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Add Connection",
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ clientId: string }>;
};

export default async function NewConnectionPage({ params }: PageProps) {
  const { clientId } = await params;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind !== "ok") {
    return null;
  }

  const { access } = workspace;

  if (!access.canManageIntegrations) {
    return (
      <section className="rounded-lg border bg-card p-6">
        <h2 className="font-semibold">Integration access required</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Adding connections requires a partner owner, admin, or implementer
          role.
        </p>
      </section>
    );
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("integration_providers")
    .select("*")
    .eq("is_active", true)
    .order("display_name", { ascending: true });

  if (error || !data || data.length === 0) {
    return (
      <section className="rounded-lg border bg-card p-6">
        <h2 className="font-semibold">Providers unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          The provider catalog could not be loaded. Refresh to try again.
        </p>
      </section>
    );
  }

  const boundCreate = createIntegrationConnection.bind(null, clientId);

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <Button asChild variant="ghost" className="px-0">
          <Link href={`/partner/clients/${clientId}/integrations`}>
            <ArrowLeft aria-hidden="true" />
            Integrations
          </Link>
        </Button>
        <h2 className="mt-2 text-lg font-semibold">Add connection</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Website chat and generic webhooks work immediately. HubSpot,
          GoHighLevel, Twilio SMS, Resend, and Google Calendar connect when you
          add the provider credentials.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <ConnectionForm
          clientId={clientId}
          providers={data as IntegrationProviderRecord[]}
          appUrl={getAppUrl()}
          action={boundCreate}
        />
      </div>
    </div>
  );
}
