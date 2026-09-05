import { NorthstarCrmWorkspace } from "@/components/crm/northstar-crm-workspace";
import { NorthstarDesktopShell } from "@/components/crm/northstar-desktop-shell";
import { loadClientPortal } from "@/lib/clients/portal";
import { filterClientCrmData } from "@/lib/crm/permission-filter";
import { loadNorthstarCrm } from "@/lib/crm/operating-suite";
import { CRM_VIEWS, parseCrmView } from "@/lib/crm/views";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadUnreadNotificationCount } from "@/lib/notifications/client";
import { clientHomePath } from "@/lib/permissions/client-sections";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const portal = await loadClientPortal();
  return {
    title: {
      absolute: portal.kind === "ok" ? portal.branding.productName : "CRM",
    },
  };
}

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
  const allowedViews = CRM_VIEWS.filter((candidate) =>
    portal.access.visibleClientSections.includes(candidate),
  );

  if (!allowedViews.includes(view)) {
    redirect(
      allowedViews.length > 0
        ? `/client/crm?view=${allowedViews[0]}`
        : clientHomePath(
            portal.access.visibleClientSections,
            portal.client.client_experience_mode,
          ),
    );
  }

  const [data, unreadNotificationCount] = await Promise.all([
    loadNorthstarCrm(supabase, portal.access.clientId),
    portal.access.visibleClientSections.includes("notifications")
      ? loadUnreadNotificationCount(
          supabase,
          portal.access.clientId,
          portal.user.id,
        )
      : Promise.resolve(0),
  ]);

  return (
    <NorthstarDesktopShell
      clientName={portal.client.name}
      productName={portal.branding.productName}
      logoUrl={portal.branding.logoUrl}
      currentView={view}
      userEmail={portal.user.email ?? "Signed in"}
      visibleSections={portal.access.visibleClientSections}
      canViewActionCenter={portal.access.canViewActionCenter}
      canEditCrmData={portal.access.canEditCrmData}
      unreadNotificationCount={unreadNotificationCount}
    >
      <NorthstarCrmWorkspace
        clientId={portal.access.clientId}
        clientName={portal.client.name}
        productName={portal.branding.productName}
        basePath="/client/crm"
        view={view}
        canEdit={portal.access.canEditCrmData}
        canOperate={portal.access.canOperateCustomerActions}
        canManageTeam={portal.access.canManageClientTeam}
        visibleSections={portal.access.visibleClientSections}
        approvalsPath="/client/approvals"
        assistantPath="/client/assistant"
        actionCenterPath="/client/action-center"
        data={filterClientCrmData(data, portal.access.visibleClientSections, portal.access.canManageClientTeam)}
        embedded
        initialSearch={params.search ?? ""}
        showNewLead={params.new === "1"}
      />
    </NorthstarDesktopShell>
  );
}
