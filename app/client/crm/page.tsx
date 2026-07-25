import { NorthstarCrmWorkspace } from "@/components/crm/northstar-crm-workspace";
import { NorthstarDesktopShell } from "@/components/crm/northstar-desktop-shell";
import { loadClientPortal } from "@/lib/clients/portal";
import { loadNorthstarCrm } from "@/lib/crm/operating-suite";
import { parseCrmView } from "@/lib/crm/views";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const metadata = { title: "Northstar CRM" };
export const dynamic = "force-dynamic";

export default async function ClientCrmPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; search?: string; new?: string }>;
}) {
  const portal = await loadClientPortal();
  if (portal.kind !== "ok" || !portal.access.clientId) return null;
  if (portal.client.client_experience_mode !== "northstar_crm") {
    redirect("/client");
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const params = await searchParams;
  const view = parseCrmView(params.view);
  const data = await loadNorthstarCrm(supabase, portal.access.clientId);

  return (
    <NorthstarDesktopShell
      clientName={portal.client.name}
      currentView={view}
      userEmail={portal.user.email ?? "Signed in"}
    >
      <NorthstarCrmWorkspace
        clientId={portal.access.clientId}
        clientName={portal.client.name}
        basePath="/client/crm"
        view={view}
        canEdit={portal.access.canEditCrmData}
        canOperate={portal.access.canOperateCustomerActions}
        approvalsPath="/client/approvals"
        assistantPath="/client/assistant"
        data={data}
        embedded
        initialSearch={params.search ?? ""}
        showNewLead={params.new === "1"}
      />
    </NorthstarDesktopShell>
  );
}
