import { createHmac, timingSafeEqual } from "node:crypto";

import { getAppUrl, getSecretsEncryptionKey } from "../../env.ts";
import { persistRotatedCredentials } from "../credential-lifecycle.ts";
import { ConnectorAuthorizationError, connectorHttpError } from "../connectors/errors.ts";

export const WORKSPACE_PROVIDER_KEYS = [
  "google_workspace",
  "microsoft_365",
] as const;

export type WorkspaceProviderKey = (typeof WORKSPACE_PROVIDER_KEYS)[number];

export type WorkspaceOAuthState = {
  providerKey: WorkspaceProviderKey;
  connectionId: string;
  setupSessionId: string | null;
};

export type WorkspaceOAuthClient = {
  clientId: string;
  clientSecret: string;
};

export type WorkspaceCredentials = WorkspaceOAuthClient & {
  refreshToken: string;
  scope?: string;
  accountId?: string;
  accountName?: string;
};

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const MICROSOFT_AUTH_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MICROSOFT_TOKEN_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";

export const GOOGLE_WORKSPACE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/contacts",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

export const MICROSOFT_365_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Contacts.ReadWrite",
  "Calendars.ReadWrite",
  "Mail.Read",
  "Mail.Send",
] as const;

export function workspaceTokenRefreshRequiresReconnect(
  status: number,
  error: string | undefined,
): boolean {
  return status === 401 || [
    "invalid_grant",
    "invalid_client",
    "unauthorized_client",
    "interaction_required",
    "consent_required",
  ].includes(error ?? "");
}

export function workspaceApiRequiresReconnect(status: number): boolean {
  return status === 401;
}

export function workspaceRedirectUri(providerKey: WorkspaceProviderKey): string {
  return `${getAppUrl()}/api/oauth/${providerKey === "google_workspace" ? "google-workspace" : "microsoft"}/callback`;
}

export function buildWorkspaceOAuthState(
  providerKey: WorkspaceProviderKey,
  connectionId: string,
  setupSessionId?: string,
): string {
  const key = getSecretsEncryptionKey();
  if (!key) throw new Error("SECRETS_ENCRYPTION_KEY is required for OAuth state.");

  const body = Buffer.from(
    JSON.stringify({
      providerKey,
      connectionId,
      setupSessionId: setupSessionId ?? null,
      expiresAt: Date.now() + 15 * 60 * 1000,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", Buffer.from(key, "base64"))
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

export function verifyWorkspaceOAuthState(
  state: string,
): WorkspaceOAuthState | null {
  const key = getSecretsEncryptionKey();
  const [body, signature, extra] = state.split(".");
  if (!key || !body || !signature || extra) return null;

  const expected = createHmac("sha256", Buffer.from(key, "base64"))
    .update(body)
    .digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      providerKey?: string;
      connectionId?: string;
      setupSessionId?: string | null;
      expiresAt?: number;
    };
    if (
      !WORKSPACE_PROVIDER_KEYS.includes(parsed.providerKey as WorkspaceProviderKey) ||
      !parsed.connectionId ||
      !parsed.expiresAt ||
      parsed.expiresAt < Date.now()
    ) {
      return null;
    }
    return {
      providerKey: parsed.providerKey as WorkspaceProviderKey,
      connectionId: parsed.connectionId,
      setupSessionId: parsed.setupSessionId ?? null,
    };
  } catch {
    return null;
  }
}

export function buildWorkspaceAuthorizationUrl(
  providerKey: WorkspaceProviderKey,
  client: WorkspaceOAuthClient,
  connectionId: string,
  setupSessionId?: string,
): string {
  const common = {
    client_id: client.clientId,
    redirect_uri: workspaceRedirectUri(providerKey),
    response_type: "code",
    state: buildWorkspaceOAuthState(providerKey, connectionId, setupSessionId),
  };

  if (providerKey === "google_workspace") {
    return `${GOOGLE_AUTH_URL}?${new URLSearchParams({
      ...common,
      scope: GOOGLE_WORKSPACE_SCOPES.join(" "),
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
    })}`;
  }

  return `${MICROSOFT_AUTH_URL}?${new URLSearchParams({
    ...common,
    scope: MICROSOFT_365_SCOPES.join(" "),
    response_mode: "query",
    prompt: "select_account",
  })}`;
}

export async function exchangeWorkspaceCode(
  providerKey: WorkspaceProviderKey,
  client: WorkspaceOAuthClient,
  code: string,
): Promise<{ ok: true; credentials: WorkspaceCredentials } | { ok: false; error: string }> {
  const scope =
    providerKey === "google_workspace"
      ? GOOGLE_WORKSPACE_SCOPES.join(" ")
      : MICROSOFT_365_SCOPES.join(" ");
  const response = await fetch(
    providerKey === "google_workspace" ? GOOGLE_TOKEN_URL : MICROSOFT_TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code,
        redirect_uri: workspaceRedirectUri(providerKey),
        grant_type: "authorization_code",
        ...(providerKey === "microsoft_365" ? { scope } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    return { ok: false, error: `${providerKey === "google_workspace" ? "Google" : "Microsoft"} token exchange failed (${response.status}).` };
  }
  const body = (await response.json()) as { refresh_token?: string; scope?: string };
  if (!body.refresh_token) {
    return { ok: false, error: "The provider did not return offline access. Remove the prior app grant and authorize again." };
  }
  return {
    ok: true,
    credentials: {
      ...client,
      refreshToken: body.refresh_token,
      scope: body.scope ?? scope,
    },
  };
}

export async function mintWorkspaceAccessToken(
  providerKey: WorkspaceProviderKey,
  credentials: WorkspaceCredentials,
): Promise<string> {
  const response = await fetch(
    providerKey === "google_workspace" ? GOOGLE_TOKEN_URL : MICROSOFT_TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: "refresh_token",
        ...(providerKey === "microsoft_365"
          ? { scope: credentials.scope ?? MICROSOFT_365_SCOPES.join(" ") }
          : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
  };
  if (!response.ok) {
    if (workspaceTokenRefreshRequiresReconnect(response.status, body.error)) {
      throw new ConnectorAuthorizationError();
    }
    throw connectorHttpError("Workspace token refresh", response);
  }
  if (!body.access_token) throw new Error("Workspace token refresh returned no access token.");
  if (body.refresh_token && body.refresh_token !== credentials.refreshToken) {
    credentials.refreshToken = body.refresh_token;
    await persistRotatedCredentials(credentials);
  }
  return body.access_token;
}
