import { cache } from "react";
import type { User } from "@supabase/supabase-js";

import { requireAuthenticatedUser } from "@/lib/auth/session";
import {
  DEFAULT_BRAND_COLORS,
  normalizeBrandColor,
} from "@/lib/branding";
import type { ClientBusinessRecord } from "@/lib/clients/constants";
import {
  isAccessError,
  requirePrimaryClientAccess,
} from "@/lib/permissions/access";
import type { AccessContext } from "@/lib/permissions/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PortalBranding = {
  partnerName: string;
  productName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  supportLabel: string;
  supportEmail: string | null;
  supportPhone: string | null;
  reportFooterText: string | null;
};

export type ClientPortal =
  | {
      kind: "ok";
      user: User;
      access: AccessContext;
      client: ClientBusinessRecord;
      branding: PortalBranding;
    }
  | { kind: "denied" }
  | { kind: "unavailable" };

// Memoized per request; the portal layout and pages share one access check.
// The client scope always comes from the signed-in user's membership.
export const loadClientPortal = cache(async (): Promise<ClientPortal> => {
  const user = await requireAuthenticatedUser("/client");

  let access: AccessContext;

  try {
    access = await requirePrimaryClientAccess(user.id);
  } catch (error) {
    if (isAccessError(error)) {
      return error.code === "ACCESS_DENIED"
        ? { kind: "denied" }
        : { kind: "unavailable" };
    }

    throw error;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase || !access.clientId || !access.partnerId) {
    return { kind: "unavailable" };
  }

  const [clientResult, partnerResult, brandingResult] = await Promise.all([
    supabase
      .from("client_businesses")
      .select("*")
      .eq("id", access.clientId)
      .maybeSingle(),
    supabase
      .from("partners")
      .select("name, support_email, support_phone")
      .eq("id", access.partnerId)
      .maybeSingle(),
    supabase
      .from("partner_branding")
      .select(
        "product_name, logo_url, primary_color, secondary_color, accent_color, support_label, report_footer_text",
      )
      .eq("partner_id", access.partnerId)
      .maybeSingle(),
  ]);

  if (clientResult.error || !clientResult.data) {
    return { kind: "unavailable" };
  }

  const partner = partnerResult.data;
  const branding = brandingResult.data;

  return {
    kind: "ok",
    user,
    access,
    client: clientResult.data as ClientBusinessRecord,
    branding: {
      partnerName: partner?.name ?? "Your service partner",
      productName:
        branding?.product_name ??
        `${partner?.name ?? "Your service partner"} CRM`,
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
      supportLabel: branding?.support_label ?? partner?.name ?? "Support",
      supportEmail: partner?.support_email ?? null,
      supportPhone: partner?.support_phone ?? null,
      reportFooterText: branding?.report_footer_text ?? null,
    },
  };
});
