import { connectorHttpError } from "../connectors/errors.ts";
import { createHmac, timingSafeEqual } from "node:crypto";

import { getAppUrl, getSecretsEncryptionKey } from "@/lib/env";

export const MARKETING_OAUTH_PROVIDER_KEYS = ["meta", "google_ads", "google_business_profile", "podium"] as const;
export type MarketingOAuthProviderKey = (typeof MARKETING_OAUTH_PROVIDER_KEYS)[number];
export type MarketingOAuthClient = { clientId: string; clientSecret: string };
export type MarketingOAuthState = { providerKey: MarketingOAuthProviderKey; connectionId: string; setupSessionId: string | null };

export type MetaCredentials = MarketingOAuthClient & { accessToken: string; expiresAt: string; pageId: string; pageName: string; pageAccessToken: string; adAccountId?: string };
export type GoogleAdsCredentials = MarketingOAuthClient & { accessToken: string; refreshToken: string; expiresAt: string; developerToken: string; customerId: string; managerCustomerId?: string };
export type GoogleBusinessProfileCredentials = MarketingOAuthClient & { accessToken: string; refreshToken: string; expiresAt: string; accountName: string; locationName: string; locationTitle: string };
export type PodiumCredentials = MarketingOAuthClient & { accessToken: string; refreshToken: string; expiresAt: string };

function redirectUri(providerKey: MarketingOAuthProviderKey) { return `${getAppUrl()}/api/oauth/${providerKey}/callback`; }
function signState(payload: Record<string, unknown>) { const key = getSecretsEncryptionKey(); if (!key) throw new Error("SECRETS_ENCRYPTION_KEY is required for OAuth state."); const body = Buffer.from(JSON.stringify(payload)).toString("base64url"); return `${body}.${createHmac("sha256", Buffer.from(key, "base64")).update(body).digest("base64url")}`; }

export function verifyMarketingOAuthState(state: string): MarketingOAuthState | null {
  const key = getSecretsEncryptionKey(); const [body, signature, extra] = state.split(".");
  if (!key || !body || !signature || extra) return null;
  const expected = createHmac("sha256", Buffer.from(key, "base64")).update(body).digest("base64url");
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try { const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as MarketingOAuthState & { expiresAt?: number }; return MARKETING_OAUTH_PROVIDER_KEYS.includes(parsed.providerKey) && parsed.connectionId && parsed.expiresAt && parsed.expiresAt > Date.now() ? { providerKey: parsed.providerKey, connectionId: parsed.connectionId, setupSessionId: parsed.setupSessionId ?? null } : null; } catch { return null; }
}

export function buildMarketingAuthorizationUrl(providerKey: MarketingOAuthProviderKey, client: MarketingOAuthClient, connectionId: string, setupSessionId?: string) {
  const state = signState({ providerKey, connectionId, setupSessionId: setupSessionId ?? null, expiresAt: Date.now() + 15 * 60_000 });
  if (providerKey === "meta") return `https://www.facebook.com/${process.env.META_GRAPH_VERSION ?? "v24.0"}/dialog/oauth?${new URLSearchParams({ client_id: client.clientId, redirect_uri: redirectUri(providerKey), response_type: "code", scope: "leads_retrieval,pages_show_list,pages_read_engagement,pages_manage_metadata,ads_read", state })}`;
  if (providerKey === "podium") return `https://api.podium.com/oauth/authorize?${new URLSearchParams({ client_id: client.clientId, redirect_uri: redirectUri(providerKey), scope: "read_reviews write_reviews", state })}`;
  const scope = providerKey === "google_ads" ? "https://www.googleapis.com/auth/adwords" : "https://www.googleapis.com/auth/business.manage";
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: client.clientId, redirect_uri: redirectUri(providerKey), response_type: "code", scope, access_type: "offline", prompt: "consent", state })}`;
}

async function googleToken(client: MarketingOAuthClient, params: Record<string, string>) { const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, ...params }), signal: AbortSignal.timeout(15_000) }); if (!response.ok) throw connectorHttpError("marketing-oauth", response); return response.json() as Promise<{ access_token?: string; refresh_token?: string; expires_in?: number }>; }

export async function exchangeGoogleMarketingCode(providerKey: "google_ads" | "google_business_profile", client: MarketingOAuthClient, code: string, developerToken?: string): Promise<GoogleAdsCredentials | GoogleBusinessProfileCredentials> {
  const token = await googleToken(client, { grant_type: "authorization_code", code, redirect_uri: redirectUri(providerKey) });
  if (!token.access_token || !token.refresh_token) throw new Error("Google returned incomplete authorization details.");
  const common = { ...client, accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString() };
  if (providerKey === "google_ads") {
    if (!developerToken) throw new Error("The platform Google Ads developer token is not configured.");
    const response = await fetch("https://googleads.googleapis.com/v25/customers:listAccessibleCustomers", { headers: { Authorization: `Bearer ${token.access_token}`, "developer-token": developerToken }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw connectorHttpError("marketing-oauth", response);
    const body = await response.json() as { resourceNames?: string[] }; const customerId = body.resourceNames?.[0]?.split("/").pop();
    if (!customerId) throw new Error("No accessible Google Ads account was found.");
    return { ...common, developerToken, customerId };
  }
  const accountsResponse = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15_000) });
  if (!accountsResponse.ok) throw connectorHttpError("marketing-oauth", accountsResponse);
  const accounts = await accountsResponse.json() as { accounts?: { name?: string }[] }; const accountName = accounts.accounts?.[0]?.name;
  if (!accountName) throw new Error("No Google Business Profile account was found.");
  const locationsResponse = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title,storeCode&pageSize=100`, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15_000) });
  if (!locationsResponse.ok) throw connectorHttpError("marketing-oauth", locationsResponse);
  const locations = await locationsResponse.json() as { locations?: { name?: string; title?: string }[] }; const location = locations.locations?.[0];
  if (!location?.name) throw new Error("No Google Business Profile location was found.");
  return { ...common, accountName, locationName: location.name, locationTitle: location.title ?? "Business location" };
}

export async function exchangeMetaCode(client: MarketingOAuthClient, code: string): Promise<MetaCredentials> {
  const version = process.env.META_GRAPH_VERSION ?? "v24.0";
  const tokenResponse = await fetch(`https://graph.facebook.com/${version}/oauth/access_token?${new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: redirectUri("meta"), code })}`, { signal: AbortSignal.timeout(15_000) });
  if (!tokenResponse.ok) throw connectorHttpError("marketing-oauth", tokenResponse);
  const shortToken = await tokenResponse.json() as { access_token?: string; expires_in?: number }; if (!shortToken.access_token) throw new Error("Meta returned no access token.");
  const longResponse = await fetch(`https://graph.facebook.com/${version}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: client.clientId, client_secret: client.clientSecret, fb_exchange_token: shortToken.access_token })}`, { signal: AbortSignal.timeout(15_000) });
  const longToken = longResponse.ok ? await longResponse.json() as { access_token?: string; expires_in?: number } : shortToken;
  const accessToken = longToken.access_token ?? shortToken.access_token;
  const pagesResponse = await fetch(`https://graph.facebook.com/${version}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(accessToken)}`, { signal: AbortSignal.timeout(15_000) });
  if (!pagesResponse.ok) throw connectorHttpError("marketing-oauth", pagesResponse);
  const pages = await pagesResponse.json() as { data?: { id?: string; name?: string; access_token?: string }[] }; const page = pages.data?.[0];
  if (!page?.id || !page.access_token) throw new Error("No managed Facebook Page with Lead Ads access was found.");
  const adAccountsResponse = await fetch(`https://graph.facebook.com/${version}/me/adaccounts?fields=id,name&limit=100&access_token=${encodeURIComponent(accessToken)}`, { signal: AbortSignal.timeout(15_000) });
  const adAccounts = adAccountsResponse.ok ? await adAccountsResponse.json() as { data?: { id?: string }[] } : null;
  return { ...client, accessToken, expiresAt: new Date(Date.now() + (longToken.expires_in ?? 60 * 24 * 3600) * 1000).toISOString(), pageId: page.id, pageName: page.name ?? "Facebook Page", pageAccessToken: page.access_token, adAccountId: adAccounts?.data?.[0]?.id };
}

async function podiumToken(client: MarketingOAuthClient, body: Record<string, string>) { const response = await fetch("https://api.podium.com/oauth/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: client.clientId, client_secret: client.clientSecret, ...body }), signal: AbortSignal.timeout(15_000) }); if (!response.ok) throw connectorHttpError("marketing-oauth", response); return response.json() as Promise<{ access_token?: string; refresh_token?: string; expires_in?: number }>; }
export async function exchangePodiumCode(client: MarketingOAuthClient, code: string): Promise<PodiumCredentials> { const token = await podiumToken(client, { grant_type: "authorization_code", code, redirect_uri: redirectUri("podium") }); if (!token.access_token || !token.refresh_token) throw new Error("Podium returned incomplete authorization details."); return { ...client, accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: new Date(Date.now() + (token.expires_in ?? 10 * 3600) * 1000).toISOString() }; }
export async function refreshPodiumCredentials(credentials: PodiumCredentials): Promise<PodiumCredentials> { const token = await podiumToken(credentials, { grant_type: "refresh_token", refresh_token: credentials.refreshToken }); if (!token.access_token) throw new Error("Podium did not return a refreshed access token."); return { ...credentials, accessToken: token.access_token, refreshToken: token.refresh_token ?? credentials.refreshToken, expiresAt: new Date(Date.now() + (token.expires_in ?? 10 * 3600) * 1000).toISOString() }; }

export async function refreshGoogleMarketingCredentials<T extends GoogleAdsCredentials | GoogleBusinessProfileCredentials>(credentials: T): Promise<T> {
  const token = await googleToken(credentials, { grant_type: "refresh_token", refresh_token: credentials.refreshToken });
  if (!token.access_token) throw new Error("Google did not return a refreshed access token.");
  return { ...credentials, accessToken: token.access_token, expiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString() };
}
