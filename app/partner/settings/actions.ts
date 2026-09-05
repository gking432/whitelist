"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import { isBrandColor } from "@/lib/branding";
import type { FormState } from "@/lib/forms/state";
import {
  encryptPartnerTwilioCredentials,
  PARTNER_PROVIDER_CREDENTIALS_KIND,
} from "@/lib/integrations/partner-provider";
import { testTwilioParentAccount } from "@/lib/integrations/providers/twilio";
import { isSecretsEncryptionConfigured } from "@/lib/integrations/secrets";
import {
  isAccessError,
  requirePrimaryPartnerAccess,
} from "@/lib/permissions/access";
import { PARTNER_MANAGER_ROLES } from "@/lib/permissions/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const BRANDING_BUCKET = "partner-branding";
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function accessErrorState(error: unknown): FormState {
  if (isAccessError(error)) {
    return {
      status: "error",
      message:
        error.code === "ACCESS_DENIED"
          ? "Partner owner or admin access is required."
          : "Partner settings are unavailable right now. Try again shortly.",
    };
  }

  throw error;
}

export async function connectPartnerTwilio(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const authState = await getAuthState();
  if (!authState.user) {
    return { status: "error", message: "Sign in to connect Twilio." };
  }
  if (!isSecretsEncryptionConfigured()) {
    return { status: "error", message: "Encrypted credential storage is unavailable." };
  }

  const accountSid = text(formData, "account_sid");
  const authToken = text(formData, "auth_token");
  const fieldErrors: Record<string, string> = {};
  if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) {
    fieldErrors.account_sid = "Enter the Account SID beginning with AC.";
  }
  if (authToken.length < 20) {
    fieldErrors.auth_token = "Enter the Twilio Auth Token.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Fix the highlighted Twilio credentials.",
      fieldErrors,
    };
  }

  try {
    const access = await requirePrimaryPartnerAccess(
      authState.user.id,
      PARTNER_MANAGER_ROLES,
    );
    const supabase = await createSupabaseServerClient();
    const admin = createSupabaseAdminClient();
    if (!supabase || !admin || !access.partnerId) {
      return { status: "error", message: "The data service is unavailable." };
    }

    const tested = await testTwilioParentAccount({ accountSid, authToken });
    if (!tested.ok) {
      return { status: "error", message: tested.detail };
    }

    const { data: connection, error: connectionError } = await supabase
      .from("partner_provider_connections")
      .upsert(
        {
          partner_id: access.partnerId,
          provider_key: "twilio",
          display_name: "Twilio phone infrastructure",
          status: "connected",
          credential_status: "configured",
          config: { account_sid: accountSid },
          health_summary: tested.detail,
          last_success_at: new Date().toISOString(),
          last_failure_at: null,
          created_by: access.userId,
        },
        { onConflict: "partner_id,provider_key" },
      )
      .select("id")
      .single();

    if (connectionError || !connection) {
      return { status: "error", message: "The Twilio connection could not be saved." };
    }

    const encrypted = encryptPartnerTwilioCredentials({ accountSid, authToken });
    const { error: secretError } = await admin
      .from("partner_provider_secrets")
      .upsert(
        {
          partner_id: access.partnerId,
          connection_id: connection.id,
          secret_kind: PARTNER_PROVIDER_CREDENTIALS_KIND,
          encrypted_value: encrypted.encryptedValue,
          last_four: encrypted.lastFour,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "connection_id,secret_kind" },
      );

    if (secretError) {
      await supabase
        .from("partner_provider_connections")
        .update({
          status: "needs_attention",
          credential_status: "missing",
          health_summary: "The account was verified, but its credential could not be stored.",
        })
        .eq("id", connection.id);
      return { status: "error", message: "The encrypted credential could not be stored." };
    }

    await recordAuditEvent({
      actor: access,
      action: "partner.provider_twilio_connected",
      targetType: "partner_provider_connection",
      targetId: connection.id,
      summary: "Connected the partner-owned Twilio account for client phone provisioning.",
      afterSnapshot: { provider_key: "twilio", account_sid: accountSid },
    });

    revalidatePath("/partner/settings");
    revalidatePath("/partner/onboarding");
    return { status: "success", message: tested.detail };
  } catch (error) {
    return accessErrorState(error);
  }
}

export async function updatePartnerBranding(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const authState = await getAuthState();

  if (!authState.user) {
    return { status: "error", message: "Sign in to manage branding." };
  }

  const productName = text(formData, "product_name");
  const primaryColor = text(formData, "primary_color").toLowerCase();
  const secondaryColor = text(formData, "secondary_color").toLowerCase();
  const accentColor = text(formData, "accent_color").toLowerCase();
  const supportLabel = text(formData, "support_label");
  const reportFooterText = text(formData, "report_footer_text");
  const removeLogo = formData.get("remove_logo") === "on";
  const logoValue = formData.get("logo");
  const logo =
    logoValue instanceof File && logoValue.size > 0 ? logoValue : null;
  const fieldErrors: Record<string, string> = {};

  if (!productName || productName.length > 50) {
    fieldErrors.product_name =
      "Enter a product name between 1 and 50 characters.";
  }

  for (const [key, value] of [
    ["primary_color", primaryColor],
    ["secondary_color", secondaryColor],
    ["accent_color", accentColor],
  ]) {
    if (!isBrandColor(value)) {
      fieldErrors[key] = "Use a six-digit hex color such as #1e4735.";
    }
  }

  if (supportLabel.length > 60) {
    fieldErrors.support_label = "Keep the support label under 60 characters.";
  }

  if (reportFooterText.length > 180) {
    fieldErrors.report_footer_text =
      "Keep the report footer under 180 characters.";
  }

  if (logo) {
    if (!LOGO_TYPES[logo.type]) {
      fieldErrors.logo = "Upload a PNG, JPG, or WebP image.";
    } else if (logo.size > MAX_LOGO_BYTES) {
      fieldErrors.logo = "Logo files must be 2 MB or smaller.";
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Fix the highlighted branding fields.",
      fieldErrors,
    };
  }

  try {
    const access = await requirePrimaryPartnerAccess(
      authState.user.id,
      PARTNER_MANAGER_ROLES,
    );

    if (!access.partnerId) {
      return { status: "error", message: "Partner access is required." };
    }

    const supabase = await createSupabaseServerClient();
    const admin = createSupabaseAdminClient();

    if (!supabase || !admin) {
      return {
        status: "error",
        message: "The data service is unavailable.",
      };
    }

    const { data: existing, error: existingError } = await supabase
      .from("partner_branding")
      .select("*")
      .eq("partner_id", access.partnerId)
      .maybeSingle();

    if (existingError) {
      return { status: "error", message: "Branding could not be loaded." };
    }

    let logoUrl = existing?.logo_url ?? null;
    const logoPaths = ["logo.png", "logo.jpg", "logo.webp"].map(
      (name) => `${access.partnerId}/${name}`,
    );

    if (removeLogo) {
      await admin.storage.from(BRANDING_BUCKET).remove(logoPaths);
      logoUrl = null;
    }

    if (logo && !removeLogo) {
      const extension = LOGO_TYPES[logo.type];
      const logoPath = `${access.partnerId}/logo.${extension}`;
      const { error: uploadError } = await admin.storage
        .from(BRANDING_BUCKET)
        .upload(logoPath, await logo.arrayBuffer(), {
          contentType: logo.type,
          upsert: true,
          cacheControl: "3600",
        });

      if (uploadError) {
        return {
          status: "error",
          message: `The logo could not be uploaded: ${uploadError.message}`,
        };
      }

      const { data: publicLogo } = admin.storage
        .from(BRANDING_BUCKET)
        .getPublicUrl(logoPath);
      logoUrl = `${publicLogo.publicUrl}?v=${Date.now()}`;
    }

    const values = {
      partner_id: access.partnerId,
      product_name: productName,
      logo_url: logoUrl,
      primary_color: primaryColor,
      secondary_color: secondaryColor,
      accent_color: accentColor,
      support_label: supportLabel || null,
      report_footer_text: reportFooterText || null,
    };
    const { data: saved, error: saveError } = await supabase
      .from("partner_branding")
      .upsert(values, { onConflict: "partner_id" })
      .select("id")
      .single();

    if (saveError || !saved) {
      return {
        status: "error",
        message: "Branding could not be saved. Try again.",
      };
    }

    await recordAuditEvent({
      actor: access,
      action: "partner.branding_updated",
      targetType: "partner_branding",
      targetId: saved.id,
      summary: `Updated client-facing branding to "${productName}".`,
      beforeSnapshot: existing
        ? {
            product_name: existing.product_name,
            logo_url: existing.logo_url,
            primary_color: existing.primary_color,
            secondary_color: existing.secondary_color,
            accent_color: existing.accent_color,
            support_label: existing.support_label,
            report_footer_text: existing.report_footer_text,
          }
        : null,
      afterSnapshot: values,
    });

    revalidatePath("/partner/settings");
    revalidatePath("/client", "layout");
    revalidatePath("/client/crm");

    return {
      status: "success",
      message: "Branding saved. Client workspaces now use these settings.",
    };
  } catch (error) {
    return accessErrorState(error);
  }
}
