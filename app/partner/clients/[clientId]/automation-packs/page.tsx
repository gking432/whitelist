import { AutomationPackLibrary } from "@/components/automations/automation-pack-library";
import { AUTOMATION_PACKS } from "@/lib/automation-packs/catalog";
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

  const [{ data: instances }, { data: connections }] = await Promise.all([
    supabase
      .from("client_workflow_instances")
      .select(
        "status, template:workflow_templates!inner(template_key)",
      )
      .eq("client_id", clientId)
      .eq("status", "active"),
    supabase
      .from("integration_connections")
      .select(
        "id, status, provider:integration_providers!inner(provider_key)",
      )
      .eq("client_id", clientId)
      .in("status", ["connected", "needs_attention"])
      .eq("provider.provider_key", "generic_inbound_webhook"),
  ]);

  const activeTemplateKeys = (instances ?? [])
    .map((instance) => {
      const template = instance.template as unknown as {
        template_key?: string;
      } | null;
      return template?.template_key ?? null;
    })
    .filter((key): key is string => Boolean(key));
  const connection = connections?.[0] ?? null;
  const endpoint = connection
    ? `${getAppUrl()}/api/integrations/inbound/${connection.id}`
    : null;
  const base = `/partner/clients/${clientId}`;

  return (
    <AutomationPackLibrary
      packs={AUTOMATION_PACKS}
      activeTemplateKeys={activeTemplateKeys}
      inboundEndpoint={endpoint}
      integrationsPath={`${base}/integrations`}
      testCenterPath={`${base}/test-center`}
    />
  );
}

