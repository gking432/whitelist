import type { SupabaseClient } from "@supabase/supabase-js";

import {
  decryptSecret,
  encryptSecret,
} from "@/lib/integrations/secrets";

export const PARTNER_PROVIDER_CREDENTIALS_KIND = "provider_credentials";

export type PartnerTwilioCredentials = {
  accountSid: string;
  authToken: string;
};

export type PartnerProviderConnection = {
  id: string;
  partner_id: string;
  provider_key: "twilio";
  display_name: string;
  status: "not_connected" | "connected" | "needs_attention" | "disabled";
  credential_status: "missing" | "configured" | "invalid" | "rotating";
  config: Record<string, unknown>;
  health_summary: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
};

export async function readPartnerTwilioCredentials(
  admin: SupabaseClient,
  partnerId: string,
): Promise<{
  connection: PartnerProviderConnection;
  credentials: PartnerTwilioCredentials;
} | null> {
  const { data: connection } = await admin
    .from("partner_provider_connections")
    .select("*")
    .eq("partner_id", partnerId)
    .eq("provider_key", "twilio")
    .eq("status", "connected")
    .maybeSingle();

  if (!connection) return null;

  const { data: secret } = await admin
    .from("partner_provider_secrets")
    .select("encrypted_value")
    .eq("connection_id", connection.id)
    .eq("secret_kind", PARTNER_PROVIDER_CREDENTIALS_KIND)
    .maybeSingle();

  if (!secret?.encrypted_value) return null;

  try {
    const credentials = JSON.parse(
      decryptSecret(secret.encrypted_value),
    ) as PartnerTwilioCredentials;
    if (!credentials.accountSid || !credentials.authToken) return null;
    return {
      connection: connection as PartnerProviderConnection,
      credentials,
    };
  } catch {
    return null;
  }
}

export function encryptPartnerTwilioCredentials(
  credentials: PartnerTwilioCredentials,
) {
  return {
    encryptedValue: encryptSecret(JSON.stringify(credentials)),
    lastFour: credentials.authToken.slice(-4),
  };
}
