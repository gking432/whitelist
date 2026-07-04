// Google Calendar REST adapter (pilot stack). Server-side only. Uses the
// OAuth 2.0 authorization-code flow: the partner supplies their own Google
// Cloud OAuth client (ID + secret), authorizes with the client business's
// Google account, and Northstar stores the refresh token encrypted. Access
// tokens are minted on demand and never persisted.

import { createHmac, timingSafeEqual } from "node:crypto";

import { getAppUrl, getSecretsEncryptionKey } from "@/lib/env";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
const SCOPE = "https://www.googleapis.com/auth/calendar";

export type GoogleOAuthClient = {
  clientId: string;
  clientSecret: string;
};

export type GoogleCalendarCredentials = GoogleOAuthClient & {
  refreshToken: string;
};

export function googleRedirectUri(): string {
  return `${getAppUrl()}/api/oauth/google/callback`;
}

// State parameter: HMAC-signed connection id + expiry so the callback can
// trust which connection initiated the flow.
export function buildOAuthState(connectionId: string): string {
  const key = getSecretsEncryptionKey();

  if (!key) {
    throw new Error("SECRETS_ENCRYPTION_KEY is required for OAuth state.");
  }

  const expires = Date.now() + 15 * 60 * 1000;
  const payload = `${connectionId}.${expires}`;
  const signature = createHmac("sha256", Buffer.from(key, "base64"))
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

export function verifyOAuthState(state: string): string | null {
  const key = getSecretsEncryptionKey();

  if (!key) {
    return null;
  }

  const parts = state.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const [connectionId, expires, signature] = parts;
  const payload = `${connectionId}.${expires}`;
  const expected = createHmac("sha256", Buffer.from(key, "base64"))
    .update(payload)
    .digest("base64url");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  if (Number(expires) < Date.now()) {
    return null;
  }

  return connectionId;
}

export function buildAuthorizationUrl(
  oauthClient: GoogleOAuthClient,
  connectionId: string,
): string {
  const params = new URLSearchParams({
    client_id: oauthClient.clientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: buildOAuthState(connectionId),
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  oauthClient: GoogleOAuthClient,
  code: string,
): Promise<{ refreshToken: string } | { error: string }> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: oauthClient.clientId,
      client_secret: oauthClient.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: googleRedirectUri(),
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    return { error: `Google token exchange failed (${response.status}).` };
  }

  const tokens = (await response.json()) as { refresh_token?: string };

  if (!tokens.refresh_token) {
    return {
      error:
        "Google did not return a refresh token. Remove the app's prior access at myaccount.google.com/permissions and connect again.",
    };
  }

  return { refreshToken: tokens.refresh_token };
}

async function mintAccessToken(
  credentials: GoogleCalendarCredentials,
): Promise<string> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Google token refresh failed (${response.status}).`);
  }

  const tokens = (await response.json()) as { access_token: string };

  return tokens.access_token;
}

// Availability check: busy blocks on the primary calendar for the next week.
export async function testCalendarAccess(
  credentials: GoogleCalendarCredentials,
): Promise<{ ok: true; detail: string } | { ok: false; detail: string }> {
  try {
    const accessToken = await mintAccessToken(credentials);
    const now = new Date();
    const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const response = await fetch(`${CALENDAR_BASE}/freeBusy`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: now.toISOString(),
        timeMax: weekOut.toISOString(),
        items: [{ id: "primary" }],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        ok: false,
        detail: `Google Calendar returned an error (${response.status}).`,
      };
    }

    const busy = (await response.json()) as {
      calendars?: { primary?: { busy?: unknown[] } };
    };
    const busyCount = busy.calendars?.primary?.busy?.length ?? 0;

    return {
      ok: true,
      detail: `Connected. The primary calendar has ${busyCount} busy block${busyCount === 1 ? "" : "s"} in the next 7 days — Northstar can read availability and create events.`,
    };
  } catch (error) {
    return {
      ok: false,
      detail:
        error instanceof Error ? error.message : "Could not reach Google.",
    };
  }
}

export async function createCalendarEvent(
  credentials: GoogleCalendarCredentials,
  event: {
    summary: string;
    description: string;
    startIso: string;
    endIso: string;
  },
): Promise<{ eventId: string; htmlLink: string | null }> {
  const accessToken = await mintAccessToken(credentials);

  const response = await fetch(
    `${CALENDAR_BASE}/calendars/primary/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: event.summary,
        description: event.description,
        start: { dateTime: event.startIso },
        end: { dateTime: event.endIso },
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!response.ok) {
    throw new Error(`Google Calendar event creation failed (${response.status}).`);
  }

  const created = (await response.json()) as {
    id: string;
    htmlLink?: string;
  };

  return { eventId: created.id, htmlLink: created.htmlLink ?? null };
}
