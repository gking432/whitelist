import { connectorHttpError } from "../connectors/errors.ts";
import { createHmac, timingSafeEqual } from "node:crypto";

import { getAppUrl, getSecretsEncryptionKey } from "@/lib/env";

export const COMMERCE_OAUTH_PROVIDER_KEYS = ["quickbooks_online", "square"] as const;
export type CommerceOAuthProviderKey = (typeof COMMERCE_OAUTH_PROVIDER_KEYS)[number];
export type CommerceOAuthClient = { clientId: string; clientSecret: string };
export type CommerceOAuthState = {
  providerKey: CommerceOAuthProviderKey;
  connectionId: string;
  setupSessionId: string | null;
};

export type QuickBooksCredentials = CommerceOAuthClient & {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  realmId: string;
};

export type SquareCredentials = CommerceOAuthClient & {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  merchantId: string;
  locationId?: string;
};

const QBO_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SQUARE_AUTH_URL = "https://connect.squareup.com/oauth2/authorize";
const SQUARE_TOKEN_URL = "https://connect.squareup.com/oauth2/token";

export function commerceRedirectUri(providerKey: CommerceOAuthProviderKey) {
  return `${getAppUrl()}/api/oauth/${providerKey === "quickbooks_online" ? "quickbooks" : "square"}/callback`;
}

function signState(payload: Record<string, unknown>) {
  const key = getSecretsEncryptionKey();
  if (!key) throw new Error("SECRETS_ENCRYPTION_KEY is required for OAuth state.");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", Buffer.from(key, "base64"))
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

export function verifyCommerceOAuthState(state: string): CommerceOAuthState | null {
  const key = getSecretsEncryptionKey();
  const [body, signature, extra] = state.split(".");
  if (!key || !body || !signature || extra) return null;
  const expected = createHmac("sha256", Buffer.from(key, "base64"))
    .update(body)
    .digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as CommerceOAuthState & { expiresAt?: number };
    if (!COMMERCE_OAUTH_PROVIDER_KEYS.includes(parsed.providerKey) || !parsed.connectionId || !parsed.expiresAt || parsed.expiresAt < Date.now()) return null;
    return { providerKey: parsed.providerKey, connectionId: parsed.connectionId, setupSessionId: parsed.setupSessionId ?? null };
  } catch {
    return null;
  }
}

export function buildCommerceAuthorizationUrl(
  providerKey: CommerceOAuthProviderKey,
  client: CommerceOAuthClient,
  connectionId: string,
  setupSessionId?: string,
) {
  const state = signState({ providerKey, connectionId, setupSessionId: setupSessionId ?? null, expiresAt: Date.now() + 15 * 60 * 1000 });
  if (providerKey === "quickbooks_online") {
    return `${QBO_AUTH_URL}?${new URLSearchParams({
      client_id: client.clientId,
      response_type: "code",
      scope: "com.intuit.quickbooks.accounting",
      redirect_uri: commerceRedirectUri(providerKey),
      state,
    })}`;
  }
  return `${SQUARE_AUTH_URL}?${new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: commerceRedirectUri(providerKey),
    scope: ["MERCHANT_PROFILE_READ", "CUSTOMERS_READ", "CUSTOMERS_WRITE", "PAYMENTS_READ", "INVOICES_READ", "ORDERS_READ", "ORDERS_WRITE", "PAYMENTS_WRITE"].join(" "),
    session: "false",
    state,
  })}`;
}

async function qboTokenRequest(client: CommerceOAuthClient, params: Record<string, string>) {
  const response = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw connectorHttpError("commerce-oauth", response);
  return response.json() as Promise<{ access_token?: string; refresh_token?: string; expires_in?: number }>;
}

export async function exchangeQuickBooksCode(client: CommerceOAuthClient, code: string, realmId: string): Promise<QuickBooksCredentials> {
  const body = await qboTokenRequest(client, { grant_type: "authorization_code", code, redirect_uri: commerceRedirectUri("quickbooks_online") });
  if (!body.access_token || !body.refresh_token || !realmId) throw new Error("QuickBooks returned incomplete authorization details.");
  return { ...client, accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString(), realmId };
}

export async function refreshQuickBooksCredentials(credentials: QuickBooksCredentials): Promise<QuickBooksCredentials> {
  const body = await qboTokenRequest(credentials, { grant_type: "refresh_token", refresh_token: credentials.refreshToken });
  if (!body.access_token || !body.refresh_token) throw new Error("QuickBooks token refresh returned incomplete credentials.");
  return { ...credentials, accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString() };
}

async function squareTokenRequest(client: CommerceOAuthClient, body: Record<string, string>) {
  const response = await fetch(SQUARE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Square-Version": "2026-07-15" },
    body: JSON.stringify({ client_id: client.clientId, client_secret: client.clientSecret, ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw connectorHttpError("commerce-oauth", response);
  return response.json() as Promise<{ access_token?: string; refresh_token?: string; expires_at?: string; merchant_id?: string }>;
}

export async function exchangeSquareCode(client: CommerceOAuthClient, code: string): Promise<SquareCredentials> {
  const body = await squareTokenRequest(client, { grant_type: "authorization_code", code, redirect_uri: commerceRedirectUri("square") });
  if (!body.access_token || !body.refresh_token || !body.merchant_id) throw new Error("Square returned incomplete authorization details.");
  return { ...client, accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: body.expires_at ?? new Date(Date.now() + 29 * 24 * 60 * 60 * 1000).toISOString(), merchantId: body.merchant_id };
}

export async function refreshSquareCredentials(credentials: SquareCredentials): Promise<SquareCredentials> {
  const body = await squareTokenRequest(credentials, { grant_type: "refresh_token", refresh_token: credentials.refreshToken });
  if (!body.access_token || !body.refresh_token) throw new Error("Square token refresh returned incomplete credentials.");
  return { ...credentials, accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: body.expires_at ?? new Date(Date.now() + 29 * 24 * 60 * 60 * 1000).toISOString(), merchantId: body.merchant_id ?? credentials.merchantId };
}
