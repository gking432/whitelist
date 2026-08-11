export type SupabasePublicEnv = {
  url: string;
  anonKey: string;
};

export function getSupabasePublicEnv(): SupabasePublicEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return {
    url,
    anonKey,
  };
}

export function requireSupabasePublicEnv(): SupabasePublicEnv {
  const env = getSupabasePublicEnv();

  if (!env) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  return env;
}

export function isSupabaseConfigured() {
  return Boolean(getSupabasePublicEnv());
}

// Server-only. Never expose through NEXT_PUBLIC_* or browser responses.
export function getSupabaseServiceRoleKey(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
}

// Server-only 32-byte key (base64) used to encrypt integration secrets at rest.
export function getSecretsEncryptionKey(): string | null {
  return process.env.SECRETS_ENCRYPTION_KEY ?? null;
}

export function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export function getGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function getMicrosoftOAuthClient() {
  const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET;

  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function getJobberOAuthClient() {
  const clientId = process.env.JOBBER_OAUTH_CLIENT_ID;
  const clientSecret = process.env.JOBBER_OAUTH_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function getQuickBooksOAuthClient() {
  const clientId = process.env.QUICKBOOKS_OAUTH_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_OAUTH_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function getSquareOAuthClient() {
  const clientId = process.env.SQUARE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.SQUARE_OAUTH_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function getRingCentralOAuthClient() {
  const clientId = process.env.RINGCENTRAL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.RINGCENTRAL_OAUTH_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function getDialpadOAuthClient() {
  const clientId = process.env.DIALPAD_OAUTH_CLIENT_ID;
  const clientSecret = process.env.DIALPAD_OAUTH_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function getMetaOAuthClient() {
  const clientId = process.env.META_APP_ID;
  const clientSecret = process.env.META_APP_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function getGoogleAdsDeveloperToken() {
  return process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? null;
}

export function getMetaWebhookVerifyToken() {
  return process.env.META_WEBHOOK_VERIFY_TOKEN ?? null;
}

export function getResendInboundConfig() {
  const apiKey = process.env.PLATFORM_RESEND_API_KEY;
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  const domain = process.env.RESEND_INBOUND_DOMAIN;
  return apiKey && webhookSecret && domain ? { apiKey, webhookSecret, domain } : null;
}

export function getPodiumOAuthClient() {
  const clientId = process.env.PODIUM_OAUTH_CLIENT_ID;
  const clientSecret = process.env.PODIUM_OAUTH_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function isLocalDevAutoLoginEnabled() {
  const usesLocalSupabase =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http://127.0.0.1:") ??
    false;
  const previewLoginEnabled =
    process.env.ENABLE_LOCAL_PREVIEW_LOGIN === "true";

  return (
    usesLocalSupabase &&
    (process.env.NODE_ENV !== "production" || previewLoginEnabled)
  );
}

export function getLocalDevLoginEmail(nextPath = "/partner") {
  if (process.env.DEV_AUTO_LOGIN_EMAIL) {
    return process.env.DEV_AUTO_LOGIN_EMAIL;
  }

  if (nextPath.startsWith("/client")) {
    return "client@northstar.test";
  }

  if (nextPath.startsWith("/control")) {
    return "platform@northstar.test";
  }

  return "partner@northstar.test";
}

export function getLocalDevLoginPassword() {
  return process.env.DEV_AUTO_LOGIN_PASSWORD ?? "local-password-change-me";
}
