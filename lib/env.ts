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

export function isLocalDevAutoLoginEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http://127.0.0.1:")
  );
}

export function getLocalDevLoginEmail(nextPath = "/partner") {
  if (process.env.DEV_AUTO_LOGIN_EMAIL) {
    return process.env.DEV_AUTO_LOGIN_EMAIL;
  }

  if (nextPath.startsWith("/client")) {
    return "client.owner@example.test";
  }

  return "partner.owner@example.test";
}

export function getLocalDevLoginPassword() {
  return process.env.DEV_AUTO_LOGIN_PASSWORD ?? "local-password-change-me";
}
