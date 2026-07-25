import { Palette } from "lucide-react";

import { updatePartnerBranding } from "@/app/partner/branding/actions";
import { AppShell } from "@/components/layout/app-shell";
import {
  BrandingForm,
  type BrandingFormValue,
} from "@/components/partner/branding-form";
import { Badge } from "@/components/ui/badge";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import {
  DEFAULT_BRAND_COLORS,
  normalizeBrandColor,
} from "@/lib/branding";
import {
  isAccessError,
  requirePrimaryPartnerAccess,
} from "@/lib/permissions/access";
import { PARTNER_MANAGER_ROLES } from "@/lib/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Branding" };
export const dynamic = "force-dynamic";

export default async function PartnerBrandingPage() {
  const user = await requireAuthenticatedUser("/partner/branding");
  let access = null;

  try {
    access = await requirePrimaryPartnerAccess(
      user.id,
      PARTNER_MANAGER_ROLES,
    );
  } catch (error) {
    if (!isAccessError(error)) throw error;
  }

  if (!access) {
    return (
      <AppShell
        organizationName="Partner workspace"
        userEmail={user.email ?? ""}
        activeNav="branding"
      >
        <section className="rounded-lg border bg-card p-6">
          <h1 className="text-lg font-semibold">Branding access required</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Partner owners and admins can change the client-facing product
            name, logo, colors, and support identity.
          </p>
        </section>
      </AppShell>
    );
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase || !access.partnerId) return null;

  const [partnerResult, brandingResult] = await Promise.all([
    supabase
      .from("partners")
      .select("name")
      .eq("id", access.partnerId)
      .maybeSingle(),
    supabase
      .from("partner_branding")
      .select("*")
      .eq("partner_id", access.partnerId)
      .maybeSingle(),
  ]);
  const partnerName = partnerResult.data?.name ?? "Partner workspace";
  const branding = brandingResult.data;
  const initial: BrandingFormValue = {
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
  };

  return (
    <AppShell
      organizationName={partnerName}
      userEmail={user.email ?? ""}
      activeNav="branding"
    >
      <div className="space-y-6">
        <header className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Palette className="size-5 text-primary" aria-hidden="true" />
              <h1 className="text-xl font-semibold">Client branding</h1>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Set the product identity clients see across the CRM, portal,
              support areas, and reports.
            </p>
          </div>
          <Badge variant="outline">Owner and admin only</Badge>
        </header>

        <BrandingForm action={updatePartnerBranding} initial={initial} />
      </div>
    </AppShell>
  );
}
