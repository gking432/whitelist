import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptSecret, encryptSecret } from "@/lib/integrations/secrets";

// Provider credentials are stored as one encrypted JSON document per
// connection (secret_kind "provider_credentials"). Reading the encrypted
// value requires the service-role client — the column is not selectable by
// browser-session roles — so reads only happen on trusted server paths after
// an explicit permission check.

export const PROVIDER_CREDENTIALS_KIND = "provider_credentials";

export async function readProviderCredentials<T>(
  admin: SupabaseClient,
  connectionId: string,
): Promise<T | null> {
  const { data } = await admin
    .from("integration_secrets")
    .select("encrypted_value")
    .eq("connection_id", connectionId)
    .eq("secret_kind", PROVIDER_CREDENTIALS_KIND)
    .maybeSingle();

  if (!data?.encrypted_value) {
    return null;
  }

  try {
    return JSON.parse(decryptSecret(data.encrypted_value)) as T;
  } catch {
    return null;
  }
}

export function encryptProviderCredentials(
  credentials: Record<string, string>,
): { encrypted_value: string; last_four: string } {
  const serialized = JSON.stringify(credentials);
  const anchor =
    credentials.privateAppToken ??
    credentials.privateToken ??
    credentials.authToken ??
    credentials.apiKey ??
    credentials.clientSecret ??
    serialized;

  return {
    encrypted_value: encryptSecret(serialized),
    last_four: anchor.slice(-4),
  };
}
