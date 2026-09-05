import assert from "node:assert/strict";
import test from "node:test";

import { platformActivation } from "../lib/ops/platform-activation.ts";
import type { ReadinessEnvironment } from "../lib/ops/production-readiness.ts";

function coreEnvironment(): ReadinessEnvironment {
  return {
    APP_URL: "https://app.example.com",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "publishable-key-at-least-twenty",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key-at-least-twenty",
    SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
    CRON_SECRET: "cron-secret-at-least-twenty-four",
    PLATFORM_ALERT_WEBHOOK_URL: "https://alerts.example.com/platform",
    ANTHROPIC_API_KEY: "anthropic-key-at-least-twenty",
    OPENAI_API_KEY: "openai-key-at-least-twenty",
    VOICE_PROVIDER: "openai_realtime",
    NORTHSTAR_VOICE_STREAM_URL: "https://voice.example.com",
    VOICE_STREAM_SHARED_SECRET: "voice-secret-at-least-twenty-four",
    PLATFORM_RESEND_API_KEY: "resend-key",
    PLATFORM_ALERT_FROM_EMAIL: "alerts@example.com",
    RESEND_WEBHOOK_SECRET: "resend-webhook-secret",
    RESEND_INBOUND_DOMAIN: "inbound.example.com",
    ENABLE_SCENARIO_LAB: "false",
    ENABLE_LOCAL_PREVIEW_LOGIN: "false",
    ENABLE_CODEX_CONNECTOR_WORKER: "false",
  };
}

test("activation separates required launch systems from optional provider apps", () => {
  const result = platformActivation(coreEnvironment());
  assert.equal(result.coreReady, true);
  assert.equal(result.coreComplete, result.coreTotal);

  const providers = result.groups.find((group) => group.key === "provider_apps");
  assert.ok(providers);
  assert.ok(providers.items.every((item) => !item.required));
  assert.ok(providers.items.every((item) => !item.configured));
});

test("activation reports AI and unsafe production flags as launch blockers", () => {
  const env = coreEnvironment();
  env.ANTHROPIC_API_KEY = "";
  env.ENABLE_SCENARIO_LAB = "true";
  const result = platformActivation(env);
  const items = result.groups.flatMap((group) => group.items);

  assert.equal(result.coreReady, false);
  assert.equal(items.find((item) => item.key === "workflow_ai")?.configured, false);
  assert.equal(items.find((item) => item.key === "safety_flags")?.configured, false);
  assert.equal(result.coreComplete, result.coreTotal - 2);
});

test("activation generates callback paths without exposing credential values", () => {
  const env = coreEnvironment();
  env.GOOGLE_OAUTH_CLIENT_ID = "secret-google-client-id";
  env.GOOGLE_OAUTH_CLIENT_SECRET = "secret-google-client-secret";
  const result = platformActivation(env);
  const google = result.groups
    .find((group) => group.key === "provider_apps")
    ?.items.find((item) => item.key === "google");

  assert.equal(google?.configured, true);
  assert.ok(google?.callbackPaths?.includes("/api/oauth/google/callback"));
  assert.ok(google?.environmentKeys?.includes("GOOGLE_OAUTH_CLIENT_SECRET"));
  assert.equal(JSON.stringify(result).includes("secret-google-client-secret"), false);
});
