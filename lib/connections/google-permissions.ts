import { GOOGLE_WORKSPACE_READ_SCOPES, workspaceRedirectUri, type WorkspaceCredentials, type WorkspaceOAuthClient } from "../integrations/providers/workspace-oauth.ts";

export const GOOGLE_ACTION_PERMISSIONS = ["calendar.write", "email.send"] as const;
export type GoogleActionPermission = (typeof GOOGLE_ACTION_PERMISSIONS)[number];
const CALENDAR = "https://www.googleapis.com/auth/calendar";
const EVENTS = "https://www.googleapis.com/auth/calendar.events";
const OWNED = "https://www.googleapis.com/auth/calendar.events.owned";
const LIST = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const SEND = "https://www.googleapis.com/auth/gmail.send";
const scopes = (scope: string) => new Set(scope.split(/\s+/).filter(Boolean));
export function parseGooglePermissions(value: unknown): GoogleActionPermission[] {
  if (!Array.isArray(value) || !value.length || value.length > 2 || new Set(value).size !== value.length ||
    value.some((permission) => !GOOGLE_ACTION_PERMISSIONS.includes(permission as GoogleActionPermission))) throw new Error("Select calendar changes, email sending, or both for this Google account.");
  return GOOGLE_ACTION_PERMISSIONS.filter((permission) => value.includes(permission));
}
export function googlePermissionScopes(permissions: GoogleActionPermission[]): string[] {
  const selected = parseGooglePermissions(permissions);
  return [...GOOGLE_WORKSPACE_READ_SCOPES, ...(selected.includes("calendar.write") ? [EVENTS, LIST] : []), ...(selected.includes("email.send") ? [SEND] : [])];
}
export function googleScopeAllows(scope: string, permission: GoogleActionPermission): boolean {
  const granted = scopes(scope);
  return permission === "email.send" ? granted.has(SEND) || granted.has("https://mail.google.com/") || granted.has("https://www.googleapis.com/auth/gmail.modify") || granted.has("https://www.googleapis.com/auth/gmail.compose")
    : (granted.has(CALENDAR) || granted.has(EVENTS) || granted.has(OWNED)) &&
      (granted.has(CALENDAR) || granted.has("https://www.googleapis.com/auth/calendar.readonly") || granted.has(LIST) || granted.has("https://www.googleapis.com/auth/calendar.calendarlist"));
}
function baselineRead(scope: string): boolean {
  const granted = scopes(scope);
  return (granted.has("https://www.googleapis.com/auth/gmail.readonly") || granted.has("https://www.googleapis.com/auth/gmail.modify") || granted.has("https://mail.google.com/")) &&
    (granted.has("https://www.googleapis.com/auth/calendar.events.readonly") || granted.has(EVENTS) || granted.has(CALENDAR) || granted.has("https://www.googleapis.com/auth/calendar.readonly"));
}
export function googleAccountCanAct(config: Record<string, unknown> | null | undefined, channel: "calendar" | "email"): boolean {
  const permissions = config?.google_action_permissions;
  const selected = permissions && typeof permissions === "object" && !Array.isArray(permissions) ? permissions as Record<string, unknown> : {};
  const verified = config?.google_verified_scopes;
  return selected[channel === "calendar" ? "calendar_write" : "email_send"] === true && Array.isArray(verified) && verified.every((item) => typeof item === "string") &&
    googleScopeAllows(verified.join(" "), channel === "calendar" ? "calendar.write" : "email.send");
}
/** Imported accounts keep their read-only ingestion flag. Execution requires
 * this independent explicit credential selection and its actual Google grant. */
export function googleCredentialsCanAct(credentials: Pick<WorkspaceCredentials, "accessMode" | "scope" | "googlePermissions">, permission: GoogleActionPermission): boolean {
  if (credentials.accessMode !== undefined && credentials.accessMode !== "owner_selected") return false;
  return (credentials.accessMode !== "owner_selected" || credentials.googlePermissions?.includes(permission) === true) && googleScopeAllows(credentials.scope ?? "", permission);
}
export function selectedGooglePermissions(config: Record<string, unknown> | null | undefined): GoogleActionPermission[] {
  return GOOGLE_ACTION_PERMISSIONS.filter((permission) => googleAccountCanAct(config, permission === "calendar.write" ? "calendar" : "email"));
}
export type GoogleUpgradeVerification = { credentials: WorkspaceCredentials; verifiedScopes: string[]; selectedPermissions: GoogleActionPermission[]; accountId: string; accountName: string };
export function assertGooglePermissionAttempt(attempt: Record<string, unknown>, expected: {
  attemptId: string; actorId: string; partnerId: string; clientId: string; connectionId: string; cookieHash: string; now: string;
}): void {
  if (attempt.id !== expected.attemptId || attempt.actor_id !== expected.actorId || attempt.partner_id !== expected.partnerId || attempt.client_id !== expected.clientId ||
    attempt.connection_id !== expected.connectionId || attempt.cookie_hash !== expected.cookieHash || attempt.provider_key !== "google_workspace" || attempt.purpose !== "permission_upgrade" ||
    !Number.isFinite(Date.parse(expected.now)) || typeof attempt.consumed_at !== "string" || !Number.isFinite(Date.parse(attempt.consumed_at)) ||
    typeof attempt.expires_at !== "string" || !Number.isFinite(Date.parse(attempt.expires_at)) || Date.parse(attempt.expires_at) <= Date.parse(expected.now) ||
    typeof attempt.expected_account_id !== "string" || !attempt.expected_account_id) throw new Error("The Google permission attempt expired or belongs to another owner, account or browser.");
  parseGooglePermissions(attempt.requested_permissions);
}
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const text = (value: unknown) => typeof value === "string" ? value : "";

/** No writes occur here. A granular or wrong-account consent cannot replace
 * the saved read credentials. Even refresh-token reuse is verified with a new
 * access token, actual scopes, OAuth audience and the same immutable account. */
export async function verifyGooglePermissionUpgrade(input: {
  client: WorkspaceOAuthClient; code: string; verifier: string; expectedAccountId: string;
  existing: WorkspaceCredentials; requested: GoogleActionPermission[]; previouslySelected: GoogleActionPermission[];
}, options: { fetch?: typeof fetch } = {}): Promise<GoogleUpgradeVerification> {
  const requested = parseGooglePermissions(input.requested), request = options.fetch ?? fetch;
  if (!input.expectedAccountId || input.existing.accountId !== input.expectedAccountId || input.existing.clientId !== input.client.clientId || !input.existing.refreshToken)
    throw new Error("Reconnect the same read account before requesting new permissions.");
  const call = async (url: string, init: RequestInit = {}): Promise<Json> => {
    const response = await request(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Google permission verification was incomplete. Existing account access is unchanged.");
    return object(await response.json());
  };
  const token = await call("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: input.client.clientId, client_secret: input.client.clientSecret, code: input.code, code_verifier: input.verifier,
      redirect_uri: workspaceRedirectUri("google_workspace"), grant_type: "authorization_code" }) });
  const access = text(token.access_token), granted = text(token.scope);
  // Never substitute requested permissions for absent actual grant evidence.
  if (!access || !baselineRead(granted) || requested.some((permission) => !googleScopeAllows(granted, permission))) throw new Error("Google did not grant every selected permission. Existing read access is unchanged.");
  const identity = await call("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${access}` } });
  if (identity.id !== input.expectedAccountId || !text(identity.email)) throw new Error("Use the same Google account. Existing read access is unchanged.");
  const refreshToken = text(token.refresh_token) || input.existing.refreshToken;
  const refreshed = await call("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: input.client.clientId, client_secret: input.client.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }) });
  const refreshedAccess = text(refreshed.access_token);
  if (!refreshedAccess) throw new Error("Google offline permission verification was incomplete. Existing read access is unchanged.");
  // Same POST/Authorization form as Google's official OAuth2Client.getTokenInfo.
  const info = await call("https://oauth2.googleapis.com/tokeninfo", { method: "POST", headers: { Authorization: `Bearer ${refreshedAccess}`, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" } });
  const verified = text(info.scope);
  if (info.aud !== input.client.clientId || ((info.sub ?? info.user_id) && (info.sub ?? info.user_id) !== input.expectedAccountId) || !baselineRead(verified) ||
    requested.some((permission) => !googleScopeAllows(verified, permission))) throw new Error("The refreshed Google account did not retain the selected permissions. Existing read access is unchanged.");
  const refreshedIdentity = await call("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${refreshedAccess}` } });
  if (refreshedIdentity.id !== input.expectedAccountId || !text(refreshedIdentity.email)) throw new Error("The refreshed Google authorization belongs to a different account.");
  const selectedPermissions = GOOGLE_ACTION_PERMISSIONS.filter((permission) => [...input.previouslySelected, ...requested].includes(permission) && googleScopeAllows(verified, permission));
  return { accountId: input.expectedAccountId, accountName: text(refreshedIdentity.email), verifiedScopes: [...scopes(verified)].sort(), selectedPermissions,
    credentials: { ...input.client, refreshToken: text(refreshed.refresh_token) || refreshToken, scope: [...scopes(verified)].sort().join(" "),
      accountId: input.expectedAccountId, accountName: text(refreshedIdentity.email), accessMode: "owner_selected", googlePermissions: selectedPermissions } };
}
