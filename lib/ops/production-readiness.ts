export type ProductionReadinessIssue = {
  key: string;
  message: string;
};

export type ReadinessEnvironment = Record<string, string | undefined>;

function value(env: ReadinessEnvironment, key: string): string {
  return env[key]?.trim() ?? "";
}

function isPublicHttps(input: string): boolean {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      host !== "localhost" &&
      host !== "127.0.0.1" &&
      host !== "::1" &&
      !host.endsWith(".local")
    );
  } catch {
    return false;
  }
}

function isPublicWebSocket(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "wss:" && isPublicHttps(`https://${url.host}`);
  } catch {
    return false;
  }
}

function isBase64Key32Bytes(input: string): boolean {
  try {
    return Buffer.from(input, "base64").byteLength === 32;
  } catch {
    return false;
  }
}

export function productionReadiness(
  env: ReadinessEnvironment = process.env,
): {
  enforced: boolean;
  ready: boolean;
  issues: ProductionReadinessIssue[];
} {
  const issues: ProductionReadinessIssue[] = [];
  const requireValue = (key: string, minimumLength = 1) => {
    if (value(env, key).length < minimumLength) {
      issues.push({ key, message: `${key} is missing or too short.` });
    }
  };

  if (!isPublicHttps(value(env, "APP_URL"))) {
    issues.push({
      key: "APP_URL",
      message: "APP_URL must be the canonical public HTTPS application URL.",
    });
  }
  if (!isPublicHttps(value(env, "NEXT_PUBLIC_SUPABASE_URL"))) {
    issues.push({
      key: "NEXT_PUBLIC_SUPABASE_URL",
      message: "NEXT_PUBLIC_SUPABASE_URL must be a hosted HTTPS project URL.",
    });
  }

  requireValue("NEXT_PUBLIC_SUPABASE_ANON_KEY", 20);
  requireValue("SUPABASE_SERVICE_ROLE_KEY", 20);
  requireValue("CRON_SECRET", 24);
  requireValue("VOICE_STREAM_SHARED_SECRET", 24);
  requireValue("OPENAI_API_KEY", 20);
  requireValue("PLATFORM_ALERT_WEBHOOK_URL", 8);
  requireValue("PLATFORM_RESEND_API_KEY", 8);
  requireValue("PLATFORM_ALERT_FROM_EMAIL", 5);
  requireValue("RESEND_WEBHOOK_SECRET", 10);
  requireValue("RESEND_INBOUND_DOMAIN", 4);

  if (!isBase64Key32Bytes(value(env, "SECRETS_ENCRYPTION_KEY"))) {
    issues.push({
      key: "SECRETS_ENCRYPTION_KEY",
      message: "SECRETS_ENCRYPTION_KEY must decode to exactly 32 bytes.",
    });
  }
  if (value(env, "VOICE_PROVIDER") !== "openai_realtime") {
    issues.push({
      key: "VOICE_PROVIDER",
      message: "VOICE_PROVIDER must be openai_realtime for the shipped V1.",
    });
  }
  if (!isPublicWebSocket(value(env, "NORTHSTAR_VOICE_STREAM_URL"))) {
    issues.push({
      key: "NORTHSTAR_VOICE_STREAM_URL",
      message: "NORTHSTAR_VOICE_STREAM_URL must be the public WSS endpoint.",
    });
  }
  if (!isPublicHttps(value(env, "PLATFORM_ALERT_WEBHOOK_URL"))) {
    issues.push({
      key: "PLATFORM_ALERT_WEBHOOK_URL",
      message: "PLATFORM_ALERT_WEBHOOK_URL must be a public HTTPS endpoint.",
    });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value(env, "PLATFORM_ALERT_FROM_EMAIL"))) {
    issues.push({
      key: "PLATFORM_ALERT_FROM_EMAIL",
      message: "PLATFORM_ALERT_FROM_EMAIL must be a valid sender address.",
    });
  }
  if (value(env, "ENABLE_SCENARIO_LAB") === "true") {
    issues.push({
      key: "ENABLE_SCENARIO_LAB",
      message: "Scenario Lab must be disabled on the production web service.",
    });
  }
  if (value(env, "ENABLE_LOCAL_PREVIEW_LOGIN") === "true") {
    issues.push({
      key: "ENABLE_LOCAL_PREVIEW_LOGIN",
      message: "Local preview login must be disabled in production.",
    });
  }
  if (value(env, "ENABLE_CODEX_CONNECTOR_WORKER") === "true") {
    issues.push({
      key: "ENABLE_CODEX_CONNECTOR_WORKER",
      message: "The connector worker must not run on the public web service.",
    });
  }

  return {
    enforced: value(env, "REQUIRE_PRODUCTION_READINESS") === "true",
    ready: issues.length === 0,
    issues,
  };
}
