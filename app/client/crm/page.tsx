import { NorthstarCrmWorkspace } from "@/components/crm/northstar-crm-workspace";
import { loadClientPortal } from "@/lib/clients/portal";
import { loadNorthstarCrm } from "@/lib/crm/operating-suite";
import { parseCrmView } from "@/lib/crm/views";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Northstar CRM" };
export const dynamic = "force-dynamic";

export default async function ClientCrmPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const portal = await loadClientPortal();
  if (portal.kind !== "ok" || !portal.access.clientId) return null;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const params = await searchParams;
  const data = await loadNorthstarCrm(supabase, portal.access.clientId);

  return (
    <NorthstarCrmWorkspace
      clientId={portal.access.clientId}
      clientName={portal.client.name}
      basePath="/client/crm"
      view={parseCrmView(params.view)}
      canEdit={portal.access.canEditCrmData}
      canOperate={portal.access.canOperateCustomerActions}
      approvalsPath="/client/approvals"
      assistantPath="/client/assistant"
      data={data}
    />
  );
}
