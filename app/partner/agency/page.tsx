import { NorthstarCrmWorkspace } from "@/components/crm/northstar-crm-workspace";
import { NorthstarDesktopShell } from "@/components/crm/northstar-desktop-shell";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { DEFAULT_BRAND_COLORS, normalizeBrandColor } from "@/lib/branding";
import { loadNorthstarCrm } from "@/lib/crm/operating-suite";
import { CRM_VIEWS, parseCrmView } from "@/lib/crm/views";
import { ensurePartnerAgencyBusiness } from "@/lib/partners/agency-business";
import {
  requireClientWorkspaceAccess,
  requirePrimaryPartnerAccess,
} from "@/lib/permissions/access";
import type { ClientSectionKey } from "@/lib/permissions/client-sections";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Sales CRM" };
export const dynamic = "force-dynamic";

export default async function PartnerAgencyPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; search?: string; new?: string }>;
}) {
  const user = await requireAuthenticatedUser("/partner/agency");
  const partnerAccess = await requirePrimaryPartnerAccess(user.id);
  const admin = createSupabaseAdminClient();
  const supabase = await createSupabaseServerClient();

  if (!admin || !supabase || !partnerAccess.partnerId) return null;

  const agency = await ensurePartnerAgencyBusiness(admin, {
    partnerId: partnerAccess.partnerId,
    userId: user.id,
  });
  const agencyAccess = await requireClientWorkspaceAccess(user.id, agency.id);
  const params = await searchParams;
  const view = parseCrmView(params.view);
  const visibleSections = [
    ...CRM_VIEWS,
    "assistant",
    "action-center",
  ] as ClientSectionKey[];

  const [data, partnerResult, brandingResult] = await Promise.all([
    loadNorthstarCrm(supabase, agency.id),
    supabase
      .from("partners")
      .select("name")
      .eq("id", partnerAccess.partnerId)
      .maybeSingle(),
    supabase
      .from("partner_branding")
      .select(
        "product_name, logo_url, primary_color, secondary_color, accent_color",
      )
      .eq("partner_id", partnerAccess.partnerId)
      .maybeSingle(),
  ]);

  const partnerName = partnerResult.data?.name ?? agency.name;
  const branding = brandingResult.data;
  const productName = branding?.product_name ?? `${partnerName} CRM`;
  const basePath = "/partner/agency";
  const approvalsPath = `/partner/clients/${agency.id}/approvals`;
  const assistantPath = `/partner/clients/${agency.id}/assistant`;

  return (
    <NorthstarDesktopShell
      clientName={agency.name}
      productName={productName}
      logoUrl={branding?.logo_url ?? null}
      currentView={view}
      userEmail={user.email ?? "Signed in"}
      visibleSections={visibleSections}
      canViewActionCenter={agencyAccess.canViewActionCenter}
      canEditCrmData={agencyAccess.canEditCrmData}
      unreadNotificationCount={0}
      basePath={basePath}
      assistantPath={assistantPath}
      notificationsPath={null}
      actionCenterPath={approvalsPath}
      actionCenterLabel="Agency approvals"
      homeLink={{ href: "/partner", label: "Partner dashboard" }}
      workspaceLabel="Agency workspace"
      brandColors={{
        primaryColor: normalizeBrandColor(
          branding?.primary_color,
          DEFAULT_BRAND_COLORS.primary,
        ),
        secondaryColor: normalizeBrandColor(
          branding?.secondary_color,
          DEFAULT_BRAND_COLORS.secondary,
        ),
        accentColor: normalizeBrandColor(
          branding?.accent_color,
          DEFAULT_BRAND_COLORS.accent,
        ),
      }}
    >
      <NorthstarCrmWorkspace
        clientId={agency.id}
        clientName={agency.name}
        productName={productName}
        basePath={basePath}
        view={view}
        canEdit={agencyAccess.canEditCrmData}
        canOperate={agencyAccess.canOperateCustomerActions}
        canManageTeam={false}
        visibleSections={visibleSections}
        approvalsPath={approvalsPath}
        assistantPath={assistantPath}
        actionCenterPath={approvalsPath}
        data={data}
        embedded
        initialSearch={params.search ?? ""}
        showNewLead={params.new === "1"}
      />
    </NorthstarDesktopShell>
  );
}
