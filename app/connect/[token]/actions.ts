"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  getAppUrl,
  getGoogleOAuthClient,
  getMicrosoftOAuthClient,
  getJobberOAuthClient,
  getQuickBooksOAuthClient,
  getSquareOAuthClient,
} from "@/lib/env";
import type { FormState } from "@/lib/forms/state";
import {
  credentialsFromForm,
  ensureProviderConnection,
  saveProviderCredentials,
} from "@/lib/integrations/connect-provider";
import {
  connectionSetupPath,
  isConnectionSetupProviderKey,
  loadActiveConnectionSetupSession,
} from "@/lib/integrations/connection-setup";
import {
  encryptProviderCredentials,
  PROVIDER_CREDENTIALS_KIND,
} from "@/lib/integrations/credentials";
import { isPilotProviderKey } from "@/lib/integrations/pilot";
import { readPartnerTwilioCredentials } from "@/lib/integrations/partner-provider";
import { buildAuthorizationUrl } from "@/lib/integrations/providers/google-calendar";
import {
  buildWorkspaceAuthorizationUrl,
  type WorkspaceProviderKey,
} from "@/lib/integrations/providers/workspace-oauth";
import { provisionManagedTwilioNumber } from "@/lib/integrations/providers/twilio";
import { buildJobberAuthorizationUrl } from "@/lib/integrations/providers/jobber-oauth";
import { buildCommerceAuthorizationUrl, type CommerceOAuthProviderKey } from "@/lib/integrations/providers/commerce-oauth";
import { isSecretsEncryptionConfigured } from "@/lib/integrations/secrets";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

async function loadAuthorizedSetup(token: string, providerKey: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const session = await loadActiveConnectionSetupSession(admin, token);
  if (
    !session ||
    !isConnectionSetupProviderKey(providerKey) ||
    !session.allowed_provider_keys.includes(providerKey)
  ) {
    return null;
  }
  if (!session.created_by) return null;
  return { admin, session };
}

export async function connectClientAccount(
  token: string,
  providerKey: string,
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isSecretsEncryptionConfigured()) {
    return { status: "error", message: "Secure credential storage is unavailable." };
  }
  if (
    !isPilotProviderKey(providerKey) ||
    providerKey === "google_calendar" ||
    providerKey === "google_workspace" ||
    providerKey === "microsoft_365" ||
    providerKey === "jobber"
    || providerKey === "quickbooks_online"
    || providerKey === "square"
  ) {
    return { status: "error", message: "That account cannot be connected here." };
  }

  const context = await loadAuthorizedSetup(token, providerKey);
  if (!context) return { status: "error", message: "This setup link is invalid or expired." };
  const parsed = credentialsFromForm(providerKey, formData);
  if (!parsed.ok) {
    return {
      status: "error",
      message: "Fill in the highlighted fields and try again.",
      fieldErrors: parsed.fieldErrors,
    };
  }

  try {
    const result = await saveProviderCredentials(
      context.admin,
      {
        partnerId: context.session.partner_id,
        clientId: context.session.client_id,
        createdBy: context.session.created_by!,
      },
      providerKey,
      parsed.credentials,
    );
    revalidatePath(connectionSetupPath(token));
    return { status: "success", message: result.detail };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "The account could not be connected.",
    };
  }
}

export async function startClientCommerceConnect(
  token: string,
  providerKey: CommerceOAuthProviderKey,
  _previousState: FormState,
  _formData: FormData,
): Promise<FormState> {
  if (!isSecretsEncryptionConfigured()) return { status: "error", message: "Secure credential storage is unavailable." };
  const oauthClient = providerKey === "quickbooks_online" ? getQuickBooksOAuthClient() : getSquareOAuthClient();
  if (!oauthClient) return { status: "error", message: `${providerKey === "quickbooks_online" ? "QuickBooks" : "Square"} access is still being prepared. No action is required from you yet.` };
  const context = await loadAuthorizedSetup(token, providerKey);
  if (!context) return { status: "error", message: "This setup link is invalid or expired." };
  const connectionId = await ensureProviderConnection(context.admin, {
    partnerId: context.session.partner_id,
    clientId: context.session.client_id,
    createdBy: context.session.created_by!,
  }, providerKey);
  await context.admin.from("integration_connections").update({
    credential_status: "rotating",
    health_summary: `Waiting for ${providerKey === "quickbooks_online" ? "QuickBooks" : "Square"} authorization to finish.`,
  }).eq("id", connectionId);
  redirect(buildCommerceAuthorizationUrl(providerKey, oauthClient, connectionId, context.session.id));
}

export async function startClientJobberConnect(
  token: string,
  _previousState: FormState,
  _formData: FormData,
): Promise<FormState> {
  if (!isSecretsEncryptionConfigured()) return { status: "error", message: "Secure credential storage is unavailable." };
  const oauthClient = getJobberOAuthClient();
  if (!oauthClient) return { status: "error", message: "Jobber access is still being prepared. No action is required from you yet." };
  const context = await loadAuthorizedSetup(token, "jobber");
  if (!context) return { status: "error", message: "This setup link is invalid or expired." };
  const connectionId = await ensureProviderConnection(context.admin, {
    partnerId: context.session.partner_id,
    clientId: context.session.client_id,
    createdBy: context.session.created_by!,
  }, "jobber");
  await context.admin.from("integration_connections").update({
    credential_status: "rotating",
    health_summary: "Waiting for Jobber authorization to finish.",
  }).eq("id", connectionId);
  redirect(buildJobberAuthorizationUrl(oauthClient, connectionId, context.session.id));
}

export async function startClientWorkspaceConnect(
  token: string,
  providerKey: WorkspaceProviderKey,
  _previousState: FormState,
  _formData: FormData,
): Promise<FormState> {
  if (!isSecretsEncryptionConfigured()) {
    return { status: "error", message: "Secure credential storage is unavailable." };
  }
  const oauthClient =
    providerKey === "google_workspace"
      ? getGoogleOAuthClient()
      : getMicrosoftOAuthClient();
  if (!oauthClient) {
    return {
      status: "error",
      message: `${providerKey === "google_workspace" ? "Google Workspace" : "Microsoft 365"} access is still being prepared. No action is required from you yet.`,
    };
  }
  const context = await loadAuthorizedSetup(token, providerKey);
  if (!context) return { status: "error", message: "This setup link is invalid or expired." };

  const connectionId = await ensureProviderConnection(
    context.admin,
    {
      partnerId: context.session.partner_id,
      clientId: context.session.client_id,
      createdBy: context.session.created_by!,
    },
    providerKey,
  );
  const { encrypted_value, last_four } = encryptProviderCredentials(oauthClient);
  const { error } = await context.admin.from("integration_secrets").upsert(
    {
      partner_id: context.session.partner_id,
      client_id: context.session.client_id,
      connection_id: connectionId,
      secret_kind: PROVIDER_CREDENTIALS_KIND,
      encrypted_value,
      last_four,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "connection_id,secret_kind" },
  );
  if (error) return { status: "error", message: "Authorization could not be started." };

  await context.admin.from("integration_connections").update({
    credential_status: "rotating",
    health_summary: `Waiting for ${providerKey === "google_workspace" ? "Google" : "Microsoft"} authorization to finish.`,
  }).eq("id", connectionId);

  redirect(
    buildWorkspaceAuthorizationUrl(
      providerKey,
      oauthClient,
      connectionId,
      context.session.id,
    ),
  );
}

export async function startClientGoogleConnect(
  token: string,
  _previousState: FormState,
  _formData: FormData,
): Promise<FormState> {
  if (!isSecretsEncryptionConfigured()) {
    return { status: "error", message: "Secure credential storage is unavailable." };
  }
  const oauthClient = getGoogleOAuthClient();
  if (!oauthClient) {
    return {
      status: "error",
      message: "Google Calendar access is still being prepared. No action is required from you yet.",
    };
  }
  const context = await loadAuthorizedSetup(token, "google_calendar");
  if (!context) return { status: "error", message: "This setup link is invalid or expired." };

  const connectionId = await ensureProviderConnection(
    context.admin,
    {
      partnerId: context.session.partner_id,
      clientId: context.session.client_id,
      createdBy: context.session.created_by!,
    },
    "google_calendar",
  );
  const { encrypted_value, last_four } = encryptProviderCredentials(oauthClient);
  const { error } = await context.admin.from("integration_secrets").upsert(
    {
      partner_id: context.session.partner_id,
      client_id: context.session.client_id,
      connection_id: connectionId,
      secret_kind: PROVIDER_CREDENTIALS_KIND,
      encrypted_value,
      last_four,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "connection_id,secret_kind" },
  );
  if (error) return { status: "error", message: "Google authorization could not be started." };

  await context.admin
    .from("integration_connections")
    .update({
      credential_status: "rotating",
      health_summary: "Waiting for Google authorization to finish.",
    })
    .eq("id", connectionId);

  redirect(buildAuthorizationUrl(oauthClient, connectionId, context.session.id));
}

export async function provisionClientPhoneNumber(
  token: string,
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const context = await loadAuthorizedSetup(token, "twilio");
  if (!context) return { status: "error", message: "This setup link is invalid or expired." };
  const parent = await readPartnerTwilioCredentials(
    context.admin,
    context.session.partner_id,
  );
  if (!parent) {
    return {
      status: "error",
      message: "Your service provider is still preparing phone setup. No action is required from you yet.",
    };
  }
  const appUrl = getAppUrl().replace(/\/$/, "");
  if (!appUrl.startsWith("https://")) {
    return { status: "error", message: "Phone provisioning is not available at this address yet." };
  }
  const areaCode = String(formData.get("areaCode") ?? "").trim();
  if (areaCode && !/^\d{3}$/.test(areaCode)) {
    return {
      status: "error",
      message: "Enter a three-digit US area code.",
      fieldErrors: { areaCode: "Use three digits." },
    };
  }
  if (formData.get("confirmPurchase") !== "yes") {
    return {
      status: "error",
      message: "Confirm that your service provider may purchase a Twilio number for this business.",
      fieldErrors: { confirmPurchase: "Confirmation is required." },
    };
  }

  const [{ data: client }, { data: partner }, { data: branding }] =
    await Promise.all([
      context.admin
        .from("client_businesses")
        .select("name")
        .eq("id", context.session.client_id)
        .single(),
      context.admin
        .from("partners")
        .select("name")
        .eq("id", context.session.partner_id)
        .single(),
      context.admin
        .from("partner_branding")
        .select("product_name")
        .eq("partner_id", context.session.partner_id)
        .maybeSingle(),
    ]);
  const connectionId = await ensureProviderConnection(
    context.admin,
    {
      partnerId: context.session.partner_id,
      clientId: context.session.client_id,
      createdBy: context.session.created_by!,
    },
    "twilio",
  );
  const provisioned = await provisionManagedTwilioNumber({
    parentAccountSid: parent.credentials.accountSid,
    parentAuthToken: parent.credentials.authToken,
    clientName: client?.name ?? "Client",
    ownerLabel: branding?.product_name || partner?.name || "Phone service",
    areaCode: areaCode || undefined,
    smsUrl: `${appUrl}/api/integrations/inbound/twilio/${connectionId}`,
    voiceUrl: `${appUrl}/api/integrations/inbound/twilio-voice/${connectionId}`,
    voiceStatusUrl: `${appUrl}/api/integrations/inbound/twilio-voice/${connectionId}/status`,
  });
  if (!provisioned.ok) return { status: "error", message: provisioned.detail };

  try {
    await saveProviderCredentials(
      context.admin,
      {
        partnerId: context.session.partner_id,
        clientId: context.session.client_id,
        createdBy: context.session.created_by!,
      },
      "twilio",
      provisioned.credentials as unknown as Record<string, string>,
      { skipVerification: true, healthDetail: provisioned.detail },
    );
    revalidatePath(connectionSetupPath(token));
    return { status: "success", message: provisioned.detail };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "The phone connection could not be saved.",
    };
  }
}
