import type { SupabaseClient } from "@supabase/supabase-js";

import { getAppUrl } from "@/lib/env";
import {
  encryptProviderCredentials,
  PROVIDER_CREDENTIALS_KIND,
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

type ConnectionScope = {
  partnerId: string;
  clientId: string;
  createdBy: string;
};

type CredentialProviderKey = Exclude<
  PilotProviderKey,
  "google_calendar" | "google_workspace" | "microsoft_365"
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

  const { data: existing } = await supabase
    .from("integration_connections")
    .select("id")
    .eq("partner_id", scope.partnerId)
    .eq("client_id", scope.clientId)
    .eq("provider_id", provider.id)
    .limit(1)
    .maybeSingle();

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
    })
    .eq("id", connectionId);

  await refreshPackageDeploymentReadiness(supabase, {
    partnerId: scope.partnerId,
    clientId: scope.clientId,
  });

  return { connectionId, detail: healthDetail };
}
