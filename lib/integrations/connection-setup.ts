import { createHash, randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptSecret, encryptSecret } from "@/lib/integrations/secrets";

export const CONNECTION_SETUP_PROVIDER_KEYS = [
  "hubspot",
  "gohighlevel",
  "twilio",
  "resend",
  "google_calendar",
  "google_workspace",
  "microsoft_365",
  "jobber",
  "housecall_pro",
  "servicetitan",
  "workiz",
  "quickbooks_online",
  "stripe",
  "square",
  "callrail",
  "ringcentral",
  "dialpad",
  "openphone",
  "meta",
  "google_ads",
  "google_business_profile",
  "universal_lead_email",
  "podium",
  "birdeye",
] as const;

export type ConnectionSetupProviderKey =
  (typeof CONNECTION_SETUP_PROVIDER_KEYS)[number];

export type ConnectionSetupSession = {
  id: string;
  partner_id: string;
  client_id: string;
  token_hash: string;
  encrypted_token: string;
  allowed_provider_keys: ConnectionSetupProviderKey[];
  status: "active" | "completed" | "revoked";
  expires_at: string;
  completed_at: string | null;
  revoked_at: string | null;
  created_by: string | null;
  created_at: string;
};

export function isConnectionSetupProviderKey(
  value: string,
): value is ConnectionSetupProviderKey {
  return CONNECTION_SETUP_PROVIDER_KEYS.includes(
    value as ConnectionSetupProviderKey,
  );
}

export function generateConnectionSetupToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashConnectionSetupToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function encryptConnectionSetupToken(token: string): string {
  return encryptSecret(token);
}

export function decryptConnectionSetupToken(encryptedToken: string): string {
  return decryptSecret(encryptedToken);
}

export function connectionSetupPath(token: string): string {
  return `/connect/${encodeURIComponent(token)}`;
}

export async function loadActiveConnectionSetupSession(
  admin: SupabaseClient,
  token: string,
): Promise<ConnectionSetupSession | null> {
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) {
    return null;
  }

  const { data } = await admin
    .from("client_connection_setup_sessions")
    .select("*")
    .eq("token_hash", hashConnectionSetupToken(token))
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  return (data as ConnectionSetupSession | null) ?? null;
}

export async function loadActiveConnectionSetupSessionById(
  admin: SupabaseClient,
  sessionId: string,
): Promise<ConnectionSetupSession | null> {
  const { data } = await admin
    .from("client_connection_setup_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  return (data as ConnectionSetupSession | null) ?? null;
}
