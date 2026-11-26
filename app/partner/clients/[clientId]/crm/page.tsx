import { NorthstarCrmWorkspace } from "@/components/crm/northstar-crm-workspace";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { loadNorthstarCrm } from "@/lib/crm/operating-suite";
import { parseCrmView } from "@/lib/crm/views";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Northstar CRM" };
export const dynamic = "force-dynamic";

export default async function PartnerClientCrmPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ view?: string; new?: string }>;
}) {
  const { clientId } = await params;
  const workspace = await loadClientWorkspace(clientId);
  if (workspace.kind !== "ok") return null;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const query = await searchParams;
  const data = await loadNorthstarCrm(supabase, clientId);
  const basePath = `/partner/clients/${clientId}/crm`;

  return (
    <NorthstarCrmWorkspace
      clientId={clientId}
      clientName={workspace.client.name}
      basePath={basePath}
      view={parseCrmView(query.view)}
      canEdit={workspace.access.canEditCrmData}
      canOperate={workspace.access.canOperateCustomerActions}
      canManageTeam={workspace.access.canManageClientTeam}
      approvalsPath={`/partner/clients/${clientId}/approvals`}
      assistantPath={`/partner/clients/${clientId}/assistant`}
      data={data}
      showNewLead={query.new === "1"}
    />
  );
}
