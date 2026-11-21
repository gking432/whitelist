import { testInstagramConnection, type InstagramMessagingCredentials } from "@/lib/integrations/providers/instagram-messaging";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAppUrl } from "@/lib/env";
import {
  encryptProviderCredentials,
  PROVIDER_CREDENTIALS_KIND,
  readProviderCredentials,
} from "@/lib/integrations/credentials";
import {
  isPilotProviderKey,
  PILOT_PROVIDERS,
  type PilotProviderKey,
} from "@/lib/integrations/pilot";
import {
  testEmailConnection,
  type EmailCredentials,
} from "@/lib/integrations/providers/email";
import {
  testGoHighLevelConnection,
  type GoHighLevelCredentials,
} from "@/lib/integrations/providers/gohighlevel";
import {
  testHubSpotConnection,
  type HubSpotCredentials,
} from "@/lib/integrations/providers/hubspot";
import {
  configureTwilioNumber,
  testTwilioConnection,
  type TwilioCredentials,
} from "@/lib/integrations/providers/twilio";
import { refreshPackageDeploymentReadiness } from "@/lib/packages/deployment";
import { housecallProAdapter, type HousecallProCredentials } from "@/lib/integrations/providers/housecall-pro";
import { serviceTitanAdapter, type ServiceTitanCredentials } from "@/lib/integrations/providers/servicetitan";
import { workizAdapter, type WorkizCredentials } from "@/lib/integrations/providers/workiz";
import { enqueueInitialConnectorSync } from "@/lib/integrations/connectors/sync-runner";
import { stripeAdapter, type StripeCredentials } from "@/lib/integrations/providers/stripe";
import { callRailAdapter, type CallRailCredentials } from "@/lib/integrations/providers/callrail";
import { openPhoneAdapter, type OpenPhoneCredentials } from "@/lib/integrations/providers/openphone";
import { registerConnectionWebhooks } from "@/lib/integrations/connectors/webhook-runner";
import { birdeyeAdapter, type BirdeyeCredentials } from "@/lib/integrations/providers/birdeye";

type ConnectionScope = {
  partnerId: string;
  clientId: string;
  createdBy: string;
};

type CredentialProviderKey = Exclude<
  PilotProviderKey,
  "google_calendar" | "google_workspace" | "microsoft_365" | "jobber" | "quickbooks_online" | "square" | "ringcentral" | "dialpad" | "meta" | "google_ads" | "google_business_profile" | "podium" | "universal_lead_email"
>;

export async function ensureProviderConnection(
  supabase: SupabaseClient,
  scope: ConnectionScope,
  providerKey: PilotProviderKey,
) {
  const { data: provider } = await supabase
    .from("integration_providers")
    .select("id")
    .eq("provider_key", providerKey)
    .eq("is_active", true)
    .maybeSingle();

  if (!provider) throw new Error("This provider is not available.");

  let existingQuery = supabase
    .from("integration_connections")
    .select("id")
    .eq("partner_id", scope.partnerId)
    .eq("client_id", scope.clientId)
    .eq("provider_id", provider.id);
  if (["google_workspace", "microsoft_365"].includes(providerKey))
    existingQuery = existingQuery.or("config->>workspace_view_only.is.null,config->>workspace_view_only.neq.true");
  const { data: existing } = await existingQuery.limit(1).maybeSingle();

  if (existing) return existing.id as string;

  const { data: created, error } = await supabase
    .from("integration_connections")
    .insert({
      partner_id: scope.partnerId,
      client_id: scope.clientId,
      provider_id: provider.id,
      display_name: PILOT_PROVIDERS[providerKey].title,
      status: "not_connected",
      runtime_mode: "dry_run",
      credential_status: "missing",
      config: {},
      health_summary: "Waiting for account authorization.",
      created_by: scope.createdBy,
    })
    .select("id")
    .single();

  if (error || !created) throw new Error("The connection could not be created.");
  return created.id as string;
}

async function verifyProviderCredentials(
  providerKey: CredentialProviderKey,
  credentials: Record<string, string>,
) {
  if (providerKey === "instagram_messaging") return testInstagramConnection(credentials as unknown as InstagramMessagingCredentials);
  if (providerKey === "hubspot") {
    return testHubSpotConnection(credentials as unknown as HubSpotCredentials);
  }
  if (providerKey === "gohighlevel") {
    return testGoHighLevelConnection(
      credentials as unknown as GoHighLevelCredentials,
    );
  }
  if (providerKey === "resend") {
    return testEmailConnection(credentials as unknown as EmailCredentials);
  }
  if (providerKey === "housecall_pro") {
    return housecallProAdapter.testConnection({ connectionId: "verify", partnerId: "verify", clientId: "verify", credentials: credentials as unknown as HousecallProCredentials, config: {} });
  }
  if (providerKey === "servicetitan") {
    return serviceTitanAdapter.testConnection({ connectionId: "verify", partnerId: "verify", clientId: "verify", credentials: credentials as unknown as ServiceTitanCredentials, config: {} });
  }
  if (providerKey === "workiz") {
    return workizAdapter.testConnection({ connectionId: "verify", partnerId: "verify", clientId: "verify", credentials: credentials as unknown as WorkizCredentials, config: {} });
  }
  if (providerKey === "stripe") {
    return stripeAdapter.testConnection({ connectionId: "verify", partnerId: "verify", clientId: "verify", credentials: credentials as unknown as StripeCredentials, config: {} });
  }
  if (providerKey === "callrail") {
    return callRailAdapter.testConnection({ connectionId: "verify", partnerId: "verify", clientId: "verify", credentials: credentials as unknown as CallRailCredentials, config: {} });
  }
  if (providerKey === "openphone") {
    return openPhoneAdapter.testConnection({ connectionId: "verify", partnerId: "verify", clientId: "verify", credentials: credentials as unknown as OpenPhoneCredentials, config: {} });
  }
  if (providerKey === "birdeye") {
    return birdeyeAdapter.testConnection({ connectionId: "verify", partnerId: "verify", clientId: "verify", credentials: credentials as unknown as BirdeyeCredentials, config: {} });
  }
  return testTwilioConnection(credentials as unknown as TwilioCredentials);
}

export function credentialsFromForm(
  providerKey: string,
  formData: FormData,
):
  | { ok: true; credentials: Record<string, string> }
  | { ok: false; fieldErrors: Record<string, string> } {
  if (!isPilotProviderKey(providerKey)) {
    return { ok: false, fieldErrors: { provider: "Unknown provider." } };
  }

  const credentials: Record<string, string> = {};
  const fieldErrors: Record<string, string> = {};

  for (const field of PILOT_PROVIDERS[providerKey].fields) {
    const value = String(formData.get(field.name) ?? "").trim();
    if (!value && !field.optional) {
      fieldErrors[field.name] = `${field.label} is required.`;
    } else if (value) {
      credentials[field.name] = value;
    }
  }

  if (
    providerKey === "twilio" &&
    credentials.phoneHandlingMode === "staff_assisted" &&
    !credentials.staffForwardNumber
  ) {
    fieldErrors.staffForwardNumber =
      "Add the staff number that Twilio should ring.";
  }

  return Object.keys(fieldErrors).length > 0
    ? { ok: false, fieldErrors }
    : { ok: true, credentials };
}

export async function saveProviderCredentials(
  supabase: SupabaseClient,
  scope: ConnectionScope,
  providerKey: CredentialProviderKey,
  credentials: Record<string, string>,
  options: { skipVerification?: boolean; healthDetail?: string } = {},
) {
  if (providerKey === "stripe") credentials = { ...credentials, accessMode: "read_only" };
  const test = options.skipVerification
    ? { ok: true as const, detail: options.healthDetail ?? "Connected." }
    : await verifyProviderCredentials(providerKey, credentials);

  if (!test.ok) throw new Error(`The credentials did not work: ${test.detail}`);

  const connectionId = await ensureProviderConnection(
    supabase,
    scope,
    providerKey,
  );
  let healthDetail = test.detail;
  let stripeConfig: Record<string, unknown> | undefined;
  if (providerKey === "stripe") {
    const current = await supabase.from("integration_connections").select("config,external_account_id")
      .eq("id", connectionId).eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).single().throwOnError();
    const verifiedId = "externalAccountId" in test ? test.externalAccountId : null;
    if (current.data.external_account_id && verifiedId && current.data.external_account_id !== verifiedId)
      throw new Error("Reconnect the same Stripe account. Add a separate connection for a different business account.");
    if (!credentials.webhookSecret) {
      const previous = await readProviderCredentials<Record<string, string>>(supabase, connectionId);
      if (previous?.webhookSecret) credentials = { ...credentials, webhookSecret: previous.webhookSecret };
    }
    stripeConfig = { ...current.data.config, workspace_view_only: true, owner_workspace_imports: true, conversation_intake_enabled: false };
    healthDetail += ` Read-only import. Signed-event endpoint: ${getAppUrl()}/api/integrations/inbound/stripe/${connectionId}. ${credentials.webhookSecret ? "Signing secret saved; real event delivery still needs verification." : "Polling only until an event signing secret is configured."}`;
  }
  if (providerKey === "instagram_messaging") healthDetail += ` Callback: ${getAppUrl()}/api/integrations/inbound/instagram/${connectionId}`;
  if (providerKey === "resend") healthDetail += ` Receiving callback (email.received): ${getAppUrl()}/api/integrations/inbound/email/resend/${connectionId}`;

  if (providerKey === "twilio" && !options.skipVerification) {
    const appUrl = getAppUrl().replace(/\/$/, "");
    if (appUrl.startsWith("https://")) {
      const configured = await configureTwilioNumber(
        credentials as unknown as TwilioCredentials,
        {
          smsUrl: `${appUrl}/api/integrations/inbound/twilio/${connectionId}`,
          voiceUrl: `${appUrl}/api/integrations/inbound/twilio-voice/${connectionId}`,
          voiceStatusUrl: `${appUrl}/api/integrations/inbound/twilio-voice/${connectionId}/status`,
        },
      );
      if (!configured.ok) throw new Error(configured.detail);
      healthDetail = configured.detail;
    }
  }

  const { encrypted_value, last_four } = encryptProviderCredentials(credentials);
  const { error: secretError } = await supabase
    .from("integration_secrets")
    .upsert(
      {
        partner_id: scope.partnerId,
        client_id: scope.clientId,
        connection_id: connectionId,
        secret_kind: PROVIDER_CREDENTIALS_KIND,
        encrypted_value,
        last_four,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "connection_id,secret_kind" },
    );

  if (secretError) throw new Error("The credentials could not be stored.");

  await supabase
    .from("integration_connections")
    .update({
      status: "connected",
      credential_status: "configured",
      health_summary: healthDetail,
      last_success_at: new Date().toISOString(),
      ...(stripeConfig ? { config: stripeConfig, runtime_mode: "dry_run", ...("externalAccountId" in test ? { external_account_id: test.externalAccountId } : {}), ...("externalAccountName" in test ? { external_account_name: test.externalAccountName } : {}) } : {}),
    })
    .eq("id", connectionId)
    .eq("partner_id", scope.partnerId)
    .eq("client_id", scope.clientId).throwOnError();

  await refreshPackageDeploymentReadiness(supabase, {
    partnerId: scope.partnerId,
    clientId: scope.clientId,
  });
  if (providerKey === "openphone") {
    const hooks = await registerConnectionWebhooks(supabase, {
      partnerId: scope.partnerId,
      clientId: scope.clientId,
      connectionId,
      providerKey,
    });
    healthDetail = `${healthDetail} ${hooks.detail}`;
    await supabase.from("integration_connections").update({ health_summary: healthDetail }).eq("id", connectionId);
  }
  if (["housecall_pro", "servicetitan", "workiz", "stripe", "callrail", "openphone", "birdeye"].includes(providerKey)) {
    await enqueueInitialConnectorSync(supabase, {
      partnerId: scope.partnerId,
      clientId: scope.clientId,
      connectionId,
      providerKey,
    });
  }

  return { connectionId, detail: healthDetail };
}
