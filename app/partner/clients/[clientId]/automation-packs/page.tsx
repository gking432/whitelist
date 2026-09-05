import { AutomationPackLibrary } from "@/components/automations/automation-pack-library";
import { AUTOMATION_PACKS } from "@/lib/automation-packs/catalog";
import type { AutomationPackInstallRecord } from "@/lib/automation-packs/install";
import { automationPacksForPackage } from "@/lib/automation-packs/package-selection";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { getAppUrl } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Automation Packs" };
export const dynamic = "force-dynamic";

export default async function AutomationPacksPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const workspace = await loadClientWorkspace(clientId);
  if (workspace.kind !== "ok") return null;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const [{ data: connections }, { data: installs }, { data: client }] = await Promise.all([
    supabase
      .from("integration_connections")
      .select(
        "id, status, provider:integration_providers!inner(provider_key)",
      )
      .eq("client_id", clientId)
      .in("status", ["connected", "needs_attention"])
      .eq("provider.provider_key", "generic_inbound_webhook"),
    supabase
      .from("client_automation_pack_installs")
      .select("*")
      .eq("client_id", clientId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("client_businesses")
      .select("package_id")
      .eq("id", clientId)
      .maybeSingle(),
  ]);

  const { data: packageData } = client?.package_id
    ? await supabase
        .from("partner_packages")
        .select("name, capabilities")
        .eq("id", client.package_id)
        .maybeSingle()
    : { data: null };
  const includedPackKeys = automationPacksForPackage(
    packageData?.capabilities as Record<string, unknown> | null,
  ).map((pack) => pack.key);

  const connection = connections?.[0] ?? null;
  const endpoint = connection
    ? `${getAppUrl()}/api/integrations/inbound/${connection.id}`
    : null;
  const base = `/partner/clients/${clientId}`;

  return (
    <AutomationPackLibrary
      packs={AUTOMATION_PACKS}
      installs={(installs ?? []) as AutomationPackInstallRecord[]}
      clientId={clientId}
      canManage={workspace.access.canManageIntegrations}
      inboundEndpoint={endpoint}
      integrationsPath={`${base}/connections`}
      packageName={packageData?.name ?? null}
      includedPackKeys={includedPackKeys}
    />
  );
}
