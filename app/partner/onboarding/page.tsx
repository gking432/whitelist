import { redirect } from "next/navigation";

import { PartnerOnboardingWizard } from "@/components/partner/partner-onboarding-wizard";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { DEFAULT_BRAND_COLORS, normalizeBrandColor } from "@/lib/branding";
import {
  partnerOnboardingIsComplete,
  requestedOnboardingStep,
  type PartnerOnboardingRecord,
} from "@/lib/onboarding/partner";
import { ensurePartnerAgencyBusiness } from "@/lib/partners/agency-business";
import { requirePrimaryPartnerAccess } from "@/lib/permissions/access";
import { PARTNER_MANAGER_ROLES } from "@/lib/permissions/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Partner Onboarding" };
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ step?: string; edit?: string }>;
};

type TeamMembership = {
  id: string;
  user_id: string;
  role: string;
  status: string;
};

export default async function PartnerOnboardingPage({
  searchParams,
}: PageProps) {
  const user = await requireAuthenticatedUser("/partner/onboarding");
  const access = await requirePrimaryPartnerAccess(
    user.id,
    PARTNER_MANAGER_ROLES,
  );
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  if (!supabase || !admin || !access.partnerId) return null;

  const params = await searchParams;
  const [
    partnerResult,
    brandingResult,
    onboardingResult,
    membershipResult,
    twilioResult,
  ] = await Promise.all([
    supabase
      .from("partners")
      .select("name, website_url, support_email, support_phone")
      .eq("id", access.partnerId)
      .maybeSingle(),
    supabase
      .from("partner_branding")
      .select("*")
      .eq("partner_id", access.partnerId)
      .maybeSingle(),
    supabase
      .from("partner_onboarding")
      .select("*")
      .eq("partner_id", access.partnerId)
      .maybeSingle(),
    admin
      .from("memberships")
      .select("id, user_id, role, status")
      .eq("partner_id", access.partnerId)
      .is("client_id", null)
      .order("created_at", { ascending: true }),
    supabase
      .from("partner_provider_connections")
      .select("status, credential_status, health_summary, last_success_at, config")
      .eq("partner_id", access.partnerId)
      .eq("provider_key", "twilio")
      .maybeSingle(),
  ]);

  const partner = partnerResult.data;
  if (!partner) redirect("/partner");

  const onboarding =
    (onboardingResult.data as PartnerOnboardingRecord | null) ?? null;
  const complete = partnerOnboardingIsComplete(onboarding);

  if (complete && !params.edit && !params.step) {
    redirect("/partner");
  }

  const furthestStep = onboarding?.current_step ?? "agency";
  const step = requestedOnboardingStep(params.step, furthestStep, complete);
  const agency = await ensurePartnerAgencyBusiness(admin, {
    partnerId: access.partnerId,
    userId: user.id,
  });
  const memberships = (membershipResult.data ?? []) as TeamMembership[];
  const userIds = memberships.map((membership) => membership.user_id);
  const { data: profiles } =
    userIds.length > 0
      ? await admin
          .from("profiles")
          .select("id, email, full_name")
          .in("id", userIds)
      : { data: [] };
  const profileById = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile]),
  );
  const branding = brandingResult.data;
  const partnerName = partner.name;

  return (
    <PartnerOnboardingWizard
      step={step}
      furthestStep={furthestStep}
      partner={{
        name: partnerName,
        websiteUrl: partner.website_url ?? "",
        supportEmail: partner.support_email ?? user.email ?? "",
        supportPhone: partner.support_phone ?? "",
      }}
      branding={{
        productName: branding?.product_name ?? `${partnerName} CRM`,
        logoUrl: branding?.logo_url ?? null,
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
        supportLabel: branding?.support_label ?? `${partnerName} Support`,
        reportFooterText:
          branding?.report_footer_text ?? `Managed by ${partnerName}.`,
      }}
      team={memberships.map((membership) => {
        const profile = profileById.get(membership.user_id);
        return {
          id: membership.id,
          name: profile?.full_name || profile?.email || "Partner team member",
          email: profile?.email ?? "",
          role: membership.role,
          status: membership.status,
        };
      })}
      agencyId={agency.id}
      twilioConnection={
        twilioResult.data
          ? {
              status: twilioResult.data.status,
              credentialStatus: twilioResult.data.credential_status,
              healthSummary: twilioResult.data.health_summary,
              accountSid:
                typeof twilioResult.data.config?.account_sid === "string"
                  ? twilioResult.data.config.account_sid
                  : null,
              lastSuccessAt: twilioResult.data.last_success_at,
            }
          : null
      }
    />
  );
}
