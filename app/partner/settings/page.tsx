import Link from "next/link";
import {
  ArrowRight,
  BriefcaseBusiness,
  ClipboardCheck,
  Package,
  Palette,
  PhoneCall,
} from "lucide-react";

import { updatePartnerBranding } from "@/app/partner/settings/actions";
import { AppShell } from "@/components/layout/app-shell";
import {
  BrandingForm,
  type BrandingFormValue,
} from "@/components/partner/branding-form";
import { Badge } from "@/components/ui/badge";
import { PartnerTwilioForm } from "@/components/partner/partner-twilio-form";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { DEFAULT_BRAND_COLORS, normalizeBrandColor } from "@/lib/branding";
import {
  isAccessError,
  requirePrimaryPartnerAccess,
} from "@/lib/permissions/access";
import { PARTNER_MANAGER_ROLES } from "@/lib/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Partner Settings" };
export const dynamic = "force-dynamic";

export default async function PartnerBrandingPage() {
  const user = await requireAuthenticatedUser("/partner/settings");
  let access = null;

  try {
    access = await requirePrimaryPartnerAccess(user.id, PARTNER_MANAGER_ROLES);
  } catch (error) {
    if (!isAccessError(error)) throw error;
  }

  if (!access) {
    return (
      <AppShell
        organizationName="Partner workspace"
        userEmail={user.email ?? ""}
        activeNav="settings"
      >
        <section className="rounded-lg border bg-card p-6">
          <h1 className="text-lg font-semibold">Branding access required</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Partner owners and admins can change the client-facing product name,
            logo, colors, and support identity.
          </p>
        </section>
      </AppShell>
    );
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase || !access.partnerId) return null;

  const [partnerResult, brandingResult, twilioResult] = await Promise.all([
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
    supabase
      .from("partner_provider_connections")
      .select("status, credential_status, health_summary, last_success_at, config")
      .eq("partner_id", access.partnerId)
      .eq("provider_key", "twilio")
      .maybeSingle(),
  ]);
  const partnerName = partnerResult.data?.name ?? "Partner workspace";
  const branding = brandingResult.data;
  const twilio = twilioResult.data;
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
      activeNav="settings"
    >
      <div className="space-y-6">
        <header className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Palette className="size-5 text-primary" aria-hidden="true" />
              <h1 className="text-xl font-semibold">Partner settings</h1>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Control the white-label product your agency sells and jump to the
              operating tools that belong to your own business.
            </p>
          </div>
          <Badge variant="outline">Owner and admin only</Badge>
        </header>

        <nav
          aria-label="Partner settings areas"
          className="grid overflow-hidden rounded-lg border bg-card md:grid-cols-4"
        >
          <div className="border-b p-4 md:border-b-0 md:border-r">
            <Palette className="size-4 text-primary" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold">White-label identity</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Product name, logo, colors, and support identity.
            </p>
            <Badge variant="secondary" className="mt-3">
              Current section
            </Badge>
          </div>
          <Link
            href="/partner/packages"
            className="group border-b p-4 transition-colors hover:bg-secondary/40 md:border-b-0 md:border-r"
          >
            <Package className="size-4 text-primary" aria-hidden="true" />
            <p className="mt-2 flex items-center justify-between gap-2 text-sm font-semibold">
              Package catalog
              <ArrowRight
                className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Define the reusable offers your agency sells.
            </p>
          </Link>
          <Link
            href="/partner/agency"
            className="group border-b p-4 transition-colors hover:bg-secondary/40 md:border-b-0 md:border-r"
          >
            <BriefcaseBusiness
              className="size-4 text-primary"
              aria-hidden="true"
            />
            <p className="mt-2 flex items-center justify-between gap-2 text-sm font-semibold">
              Agency home base
              <ArrowRight
                className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Use the CRM and AI tools inside your own business.
            </p>
          </Link>
          <Link
            href="/partner/onboarding?step=agency"
            className="group p-4 transition-colors hover:bg-secondary/40"
          >
            <ClipboardCheck className="size-4 text-primary" aria-hidden="true" />
            <p className="mt-2 flex items-center justify-between gap-2 text-sm font-semibold">
              Onboarding and plan
              <ArrowRight
                className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Review setup, team access, agency tools, and partner pricing.
            </p>
          </Link>
        </nav>

        <section aria-labelledby="branding-heading" className="space-y-5">
          <div>
            <h2 id="branding-heading" className="text-lg font-semibold">
              White-label identity
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Set this during partner onboarding before selling to clients.
              Changes made here update every CRM and client workspace under your
              agency.
            </p>
          </div>
          <BrandingForm action={updatePartnerBranding} initial={initial} />
        </section>

        <section aria-labelledby="phone-heading" className="space-y-5 border-t pt-6">
          <div>
            <div className="flex items-center gap-2">
              <PhoneCall className="size-4 text-primary" aria-hidden="true" />
              <h2 id="phone-heading" className="text-lg font-semibold">
                Phone infrastructure
              </h2>
            </div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Connect the Twilio account owned and billed by your agency. Client phone systems are provisioned underneath it.
            </p>
          </div>
          <PartnerTwilioForm
            connection={
              twilio
                ? {
                    status: twilio.status,
                    credentialStatus: twilio.credential_status,
                    healthSummary: twilio.health_summary,
                    accountSid:
                      typeof twilio.config?.account_sid === "string"
                        ? twilio.config.account_sid
                        : null,
                    lastSuccessAt: twilio.last_success_at,
                  }
                : null
            }
          />
        </section>
      </div>
    </AppShell>
  );
}
