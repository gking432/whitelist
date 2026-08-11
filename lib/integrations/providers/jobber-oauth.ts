import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { getAppUrl, getSecretsEncryptionKey } from "@/lib/env";

const AUTH_URL = "https://api.getjobber.com/api/oauth/authorize";
const TOKEN_URL = "https://api.getjobber.com/api/oauth/token";

export type JobberOAuthClient = { clientId: string; clientSecret: string };
export type JobberCredentials = JobberOAuthClient & { accessToken: string; refreshToken: string; expiresAt: string };
export type JobberOAuthState = { connectionId: string; setupSessionId: string | null; codeVerifier: string };

export function jobberRedirectUri() { return `${getAppUrl()}/api/oauth/jobber/callback`; }

function signState(payload: Record<string, unknown>) {
  const key = getSecretsEncryptionKey();
  if (!key) throw new Error("SECRETS_ENCRYPTION_KEY is required for OAuth state.");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", Buffer.from(key, "base64")).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyJobberState(state: string): JobberOAuthState | null {
  const key = getSecretsEncryptionKey();
  const [body, signature, extra] = state.split(".");
  if (!key || !body || !signature || extra) return null;
  const expected = createHmac("sha256", Buffer.from(key, "base64")).update(body).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as JobberOAuthState & { expiresAt: number };
    return parsed.connectionId && parsed.codeVerifier && parsed.expiresAt > Date.now()
      ? { connectionId: parsed.connectionId, setupSessionId: parsed.setupSessionId ?? null, codeVerifier: parsed.codeVerifier }
      : null;
  } catch { return null; }
}

export function buildJobberAuthorizationUrl(client: JobberOAuthClient, connectionId: string, setupSessionId?: string) {
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const state = signState({ connectionId, setupSessionId: setupSessionId ?? null, codeVerifier, expiresAt: Date.now() + 15 * 60 * 1000 });
  return `${AUTH_URL}?${new URLSearchParams({ response_type: "code", client_id: client.clientId, redirect_uri: jobberRedirectUri(), state, code_challenge: codeChallenge, code_challenge_method: "S256" })}`;
}

async function tokenRequest(client: JobberOAuthClient, params: Record<string, string>) {
  const response = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, ...params }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Jobber authorization failed (${response.status}).`);
  const body = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!body.access_token || !body.refresh_token) throw new Error("Jobber returned incomplete OAuth credentials.");
  return { ...client, accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString() } satisfies JobberCredentials;
}

export function exchangeJobberCode(client: JobberOAuthClient, code: string, codeVerifier: string) {
  return tokenRequest(client, { grant_type: "authorization_code", code, redirect_uri: jobberRedirectUri(), code_verifier: codeVerifier });
}

export function refreshJobberCredentials(credentials: JobberCredentials) {
  return tokenRequest(credentials, { grant_type: "refresh_token", refresh_token: credentials.refreshToken });
}
