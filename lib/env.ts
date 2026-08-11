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
