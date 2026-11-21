import { getAppUrl } from "../../env.ts";
import { HUBSPOT_ACTIONS, type HubSpotOwnerPermission } from "../../crm/provider-contract.ts";

// Deliberately pin the supported dated API. No token is ever put in a URL.
// https://developers.hubspot.com/changelog/v1-oauth-api-deprecation
const TOKEN_URL = "https://api.hubapi.com/oauth/2026-03/token";
const INSPECT_URL = "https://api.hubapi.com/oauth/2026-03/token/introspect";
export const HUBSPOT_READ_SCOPES = ["oauth", "crm.objects.contacts.read", "crm.objects.deals.read"] as const;
export type HubSpotOAuthClient = { clientId: string; clientSecret: string; redirectUri: string };
export type HubSpotOAuthCredentials = {
  authType: "oauth"; clientId: string; accessToken: string; refreshToken: string;
  accountId: string; userId: string; appId: string; accountName: string; scopes: string[];
  expiresAt: string; permissions: HubSpotOwnerPermission[]; accessMode: "read_only" | "owner_selected";
  grantRevision: string;
};
export type HubSpotReadSession = { accessToken: string; accountId: string; scopes: string[]; authType: "oauth" };
type HttpOptions = { fetch?: typeof fetch; now?: () => string };
type Metadata = { accountId: string; userId: string; appId: string; accountName: string; scopes: string[]; expiresIn: number | null };
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const token = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 16000 && !/[\r\n\s]/.test(v);
const providerId = (v: unknown): string | null => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v)
  : typeof v === "string" && /^[1-9]\d{0,17}$/.test(v) && Number.isSafeInteger(Number(v)) ? v : null;
const validClock = (v: string) => Number.isFinite(Date.parse(v));
const scopes = (v: unknown): string[] | null => Array.isArray(v) && v.length > 0 && v.length <= 200 && v.every((s) => typeof s === "string" && /^[a-zA-Z0-9_.:-]{1,200}$/.test(s)) ? [...new Set(v as string[])].sort() : null;
const sameScopes = (a: string[], b: string[]) => a.join(" ") === b.join(" ");

export class HubSpotOAuthError extends Error {
  readonly reauth: boolean;
  readonly retryable: boolean;
  constructor(message: string, reauth: boolean, retryable = false) {
    super(message); this.reauth = reauth; this.retryable = retryable;
  }
}

export function getHubSpotOAuthClient(): HubSpotOAuthClient | null {
  const clientId = process.env.HUBSPOT_CLIENT_ID, clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  let redirect: URL;
  try { redirect = new URL("/api/oauth/hubspot/callback", getAppUrl()); } catch { return null; }
  // HubSpot requires a domain; localhost HTTP is its documented dev exception.
  if (redirect.username || redirect.password || !(redirect.protocol === "https:" || redirect.protocol === "http:" && redirect.hostname === "localhost") ||
      /^\d+(?:\.\d+){3}$/.test(redirect.hostname) || redirect.hostname.startsWith("[")) return null;
  return { clientId, clientSecret, redirectUri: redirect.href };
}

export function parseHubSpotPermissions(value: unknown): HubSpotOwnerPermission[] {
  if (!Array.isArray(value) || value.some((p) => !(HUBSPOT_ACTIONS as readonly unknown[]).includes(p))) throw new Error("Choose supported HubSpot permissions.");
  return HUBSPOT_ACTIONS.filter((p) => value.includes(p));
}
export function hubspotOAuthScopes(permissions: readonly HubSpotOwnerPermission[]): string[] {
  return [...HUBSPOT_READ_SCOPES, ...(permissions.length ? ["crm.objects.contacts.write"] : [])].sort();
}
export function buildHubSpotAuthorizationUrl(client: HubSpotOAuthClient, state: string, permissions: HubSpotOwnerPermission[] = [], expectedAccountId?: string | null) {
  if (!state || state.length > 3000 || expectedAccountId && !providerId(expectedAccountId)) throw new Error("Invalid HubSpot authorization binding.");
  const url = new URL(expectedAccountId ? `https://app.hubspot.com/oauth/${expectedAccountId}/authorize` : "https://app.hubspot.com/oauth/authorize");
  url.search = new URLSearchParams({ client_id: client.clientId, redirect_uri: client.redirectUri, scope: hubspotOAuthScopes(parseHubSpotPermissions(permissions)).join(" "), state }).toString();
  // Ordinary confidential app OAuth does not document PKCE. MCP is separate.
  return url.href;
}

async function post(url: string, fields: Record<string, string>, options: HttpOptions): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, { method: "POST", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields), signal: AbortSignal.timeout(15_000) });
  } catch { throw new HubSpotOAuthError(url === INSPECT_URL ? "HubSpot token inspection is temporarily unavailable." : "HubSpot token request has an unknown outcome. Reconnect before using this grant.", url !== INSPECT_URL, url === INSPECT_URL); }
  const body = object(await response.json().catch(() => null));
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    const reauth = !retryable && (response.status === 401 || response.status === 403 || ["invalid_grant", "invalid_client", "unauthorized_client", "invalid_token"].includes(String(body.error)));
    throw new HubSpotOAuthError(retryable ? "HubSpot authorization is temporarily unavailable. Retry later." : "HubSpot authorization must be renewed.", reauth || !retryable, retryable);
  }
  return body;
}
function metadata(body: Record<string, unknown>, client: HubSpotOAuthClient, expectedUse: "access_token" | "refresh_token"): Metadata {
  const accountId = providerId(body.hub_id), userId = providerId(body.user_id), appId = providerId(body.app_id), granted = scopes(body.scopes);
  if (body.active !== true || String(body.token_type).toLowerCase() !== "bearer" || body.token_use !== expectedUse || body.client_id !== client.clientId || !accountId || !userId || !appId || !granted)
    throw new HubSpotOAuthError("HubSpot did not verify the exact active app, account, user and scopes.", true);
  const expires = body.expires_in;
  if (expectedUse === "access_token" && (typeof expires !== "number" || !Number.isSafeInteger(expires) || expires <= 0))
    throw new HubSpotOAuthError("The HubSpot access grant is expired or incomplete.", true);
  return { accountId, userId, appId, scopes: granted, accountName: typeof body.hub_domain === "string" && body.hub_domain.length <= 500 ? body.hub_domain : `HubSpot account ${accountId}`,
    expiresIn: typeof expires === "number" ? expires : null };
}
async function inspect(client: HubSpotOAuthClient, value: string, use: "access_token" | "refresh_token", options: HttpOptions) {
  const body = await post(INSPECT_URL, { client_id: client.clientId, client_secret: client.clientSecret, token_type_hint: use, [use]: value }, options);
  if (body.token !== value) throw new HubSpotOAuthError("HubSpot did not inspect the exact supplied token.", true);
  return metadata(body, client, use);
}
function validateGrants(granted: string[], permissions: HubSpotOwnerPermission[]) {
  if (!hubspotOAuthScopes(permissions).every((scope) => granted.includes(scope))) throw new HubSpotOAuthError("HubSpot did not grant every selected permission.", true);
  const allowed = new Set(hubspotOAuthScopes(permissions));
  if (granted.some((scope) => !allowed.has(scope))) throw new HubSpotOAuthError("HubSpot returned permissions outside this reviewed connection request.", true);
}
async function verifiedPair(client: HubSpotOAuthClient, body: Record<string, unknown>, permissions: HubSpotOwnerPermission[], expectedAccountId: string | null, previous: HubSpotOAuthCredentials | null, options: HttpOptions, requestStartedAt: string): Promise<HubSpotOAuthCredentials> {
  const refreshToken = body.refresh_token ?? previous?.refreshToken;
  const responseScopes = scopes(body.scopes), accountId = providerId(body.hub_id), expiresIn = body.expires_in;
  if (String(body.token_type).toLowerCase() !== "bearer" || !token(body.access_token) || !token(refreshToken) || !responseScopes || !accountId ||
      typeof expiresIn !== "number" || !Number.isSafeInteger(expiresIn) || expiresIn <= 0)
    throw new HubSpotOAuthError("HubSpot returned incomplete tokens, actual scopes or account identity.", true);
  const access = await inspect(client, body.access_token, "access_token", options);
  const refresh = await inspect(client, refreshToken, "refresh_token", options);
  validateGrants(access.scopes, permissions);
  if (access.accountId !== accountId || expectedAccountId && access.accountId !== expectedAccountId || access.accountId !== refresh.accountId ||
      access.userId !== refresh.userId || access.appId !== refresh.appId || !sameScopes(access.scopes, responseScopes) || !sameScopes(access.scopes, refresh.scopes) ||
      previous && (access.userId !== previous.userId || access.appId !== previous.appId))
    throw new HubSpotOAuthError("The HubSpot tokens do not belong to the same reviewed account, app and user.", true);
  const now = requestStartedAt;
  if (!validClock(now)) throw new HubSpotOAuthError("The token observation clock is invalid.", true);
  const expiresAt = new Date(Date.parse(now) + Math.min(expiresIn, access.expiresIn!) * 1000);
  if (!Number.isFinite(expiresAt.getTime())) throw new HubSpotOAuthError("The HubSpot token expiry is invalid.", true);
  return { authType: "oauth", clientId: client.clientId, accessToken: body.access_token, refreshToken,
    accountId, userId: access.userId, appId: access.appId, accountName: access.accountName, scopes: access.scopes,
    expiresAt: expiresAt.toISOString(), permissions, accessMode: permissions.length ? "owner_selected" : "read_only", grantRevision: previous?.grantRevision ?? "" };
}
export async function exchangeHubSpotOAuthCode(client: HubSpotOAuthClient, code: string, permissions: HubSpotOwnerPermission[], expectedAccountId: string | null, options: HttpOptions = {}) {
  if (!token(code)) throw new HubSpotOAuthError("The HubSpot authorization code is unavailable.", true);
  const selected = parseHubSpotPermissions(permissions);
  const started = options.now?.() ?? new Date().toISOString();
  const body = await post(TOKEN_URL, { grant_type: "authorization_code", client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: client.redirectUri, code }, options);
  return verifiedPair(client, body, selected, expectedAccountId, null, options, started);
}
export async function refreshHubSpotOAuthCredentials(client: HubSpotOAuthClient, credentials: HubSpotOAuthCredentials, options: HttpOptions = {}) {
  if (credentials.authType !== "oauth" || credentials.clientId !== client.clientId || !token(credentials.refreshToken)) throw new HubSpotOAuthError("Reconnect this HubSpot app before refreshing its grant.", true);
  const started = options.now?.() ?? new Date().toISOString();
  const body = await post(TOKEN_URL, { grant_type: "refresh_token", client_id: client.clientId, client_secret: client.clientSecret, refresh_token: credentials.refreshToken }, options);
  return verifiedPair(client, body, parseHubSpotPermissions(credentials.permissions), credentials.accountId, credentials, options, started);
}
export async function verifyHubSpotToken(credentials: HubSpotOAuthCredentials, options: HttpOptions & { expectedAccountId?: string; client?: HubSpotOAuthClient } = {}): Promise<HubSpotReadSession> {
  const client = options.client ?? getHubSpotOAuthClient();
  if (!client || credentials.authType !== "oauth" || credentials.clientId !== client.clientId || !token(credentials.accessToken)) throw new HubSpotOAuthError("The current HubSpot OAuth app is unavailable.", true);
  const actual = await inspect(client, credentials.accessToken, "access_token", options);
  validateGrants(actual.scopes, parseHubSpotPermissions(credentials.permissions));
  if (actual.accountId !== credentials.accountId || options.expectedAccountId && actual.accountId !== options.expectedAccountId ||
      actual.userId !== credentials.userId || actual.appId !== credentials.appId || !sameScopes(actual.scopes, [...credentials.scopes].sort()))
    throw new HubSpotOAuthError("The current HubSpot token no longer matches this account and reviewed grant.", true);
  return { accessToken: credentials.accessToken, accountId: actual.accountId, scopes: actual.scopes, authType: "oauth" };
}
