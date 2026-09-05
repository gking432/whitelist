import { connectorHttpError } from "../connectors/errors.ts";
import { createHmac, timingSafeEqual } from "node:crypto";

import { getAppUrl, getSecretsEncryptionKey } from "@/lib/env";
import type { DialpadCredentials } from "./dialpad";
import type { RingCentralCredentials } from "./ringcentral";

export const TELEPHONY_OAUTH_PROVIDER_KEYS = ["ringcentral", "dialpad"] as const;
export type TelephonyOAuthProviderKey = (typeof TELEPHONY_OAUTH_PROVIDER_KEYS)[number];
export type TelephonyOAuthClient = { clientId: string; clientSecret: string };
export type TelephonyOAuthState = { providerKey: TelephonyOAuthProviderKey; connectionId: string; setupSessionId: string | null };

const PROVIDERS = {
  ringcentral: {
    authorize: "https://platform.ringcentral.com/restapi/oauth/authorize",
    token: "https://platform.ringcentral.com/restapi/oauth/token",
    scope: "ReadAccounts ReadCallLog ReadMessages WebhookSubscriptions offline_access",
  },
  dialpad: {
    authorize: "https://dialpad.com/oauth2/authorize",
    token: "https://dialpad.com/oauth2/token",
    scope: "offline_access calls:list recordings_export message_content_export message_content_export:all screen_pop",
  },
} as const;

export function telephonyRedirectUri(providerKey: TelephonyOAuthProviderKey) {
  return `${getAppUrl()}/api/oauth/${providerKey}/callback`;
}

function signState(payload: Record<string, unknown>) {
  const key = getSecretsEncryptionKey();
  if (!key) throw new Error("SECRETS_ENCRYPTION_KEY is required for OAuth state.");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", Buffer.from(key, "base64")).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyTelephonyOAuthState(state: string): TelephonyOAuthState | null {
  const key = getSecretsEncryptionKey();
  const [body, signature, extra] = state.split(".");
  if (!key || !body || !signature || extra) return null;
  const expected = createHmac("sha256", Buffer.from(key, "base64")).update(body).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as TelephonyOAuthState & { expiresAt?: number };
    if (!TELEPHONY_OAUTH_PROVIDER_KEYS.includes(parsed.providerKey) || !parsed.connectionId || !parsed.expiresAt || parsed.expiresAt < Date.now()) return null;
    return { providerKey: parsed.providerKey, connectionId: parsed.connectionId, setupSessionId: parsed.setupSessionId ?? null };
  } catch { return null; }
}

export function buildTelephonyAuthorizationUrl(providerKey: TelephonyOAuthProviderKey, client: TelephonyOAuthClient, connectionId: string, setupSessionId?: string) {
  const provider = PROVIDERS[providerKey];
  return `${provider.authorize}?${new URLSearchParams({ client_id: client.clientId, response_type: "code", redirect_uri: telephonyRedirectUri(providerKey), scope: provider.scope, state: signState({ providerKey, connectionId, setupSessionId: setupSessionId ?? null, expiresAt: Date.now() + 15 * 60 * 1000 }) })}`;
}

async function tokenRequest(providerKey: TelephonyOAuthProviderKey, client: TelephonyOAuthClient, params: Record<string, string>) {
  const response = await fetch(PROVIDERS[providerKey].token, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw connectorHttpError("telephony-oauth", response);
  return response.json() as Promise<{ access_token?: string; refresh_token?: string; expires_in?: number }>;
}

export async function exchangeTelephonyCode(providerKey: TelephonyOAuthProviderKey, client: TelephonyOAuthClient, code: string): Promise<RingCentralCredentials | DialpadCredentials> {
  const body = await tokenRequest(providerKey, client, { grant_type: "authorization_code", code, redirect_uri: telephonyRedirectUri(providerKey) });
  if (!body.access_token || !body.refresh_token) throw new Error("The phone provider returned incomplete authorization details.");
  return { ...client, accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString() };
}

export async function refreshTelephonyCredentials(providerKey: TelephonyOAuthProviderKey, credentials: RingCentralCredentials | DialpadCredentials) {
  const body = await tokenRequest(providerKey, credentials, { grant_type: "refresh_token", refresh_token: credentials.refreshToken });
  if (!body.access_token) throw new Error("The phone provider did not return a refreshed access token.");
  return { ...credentials, accessToken: body.access_token, refreshToken: body.refresh_token ?? credentials.refreshToken, expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString() };
}
