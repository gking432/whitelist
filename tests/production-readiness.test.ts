import assert from "node:assert/strict";
import test from "node:test";

import {
  productionReadiness,
  type ReadinessEnvironment,
} from "../lib/ops/production-readiness.ts";
import { normalizeVoiceStreamUrl } from "../lib/voice/stream-url.ts";

function completeEnvironment(): ReadinessEnvironment {
  return {
    REQUIRE_PRODUCTION_READINESS: "true",
    APP_URL: "https://app.example.com",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "publishable-key-at-least-twenty",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key-at-least-twenty",
    SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    CRON_SECRET: "cron-secret-at-least-twenty-four",
    VOICE_STREAM_SHARED_SECRET: "voice-secret-at-least-twenty-four",
    OPENAI_API_KEY: "openai-key-at-least-twenty",
    ANTHROPIC_API_KEY: "anthropic-key-at-least-twenty",
    VOICE_PROVIDER: "openai_realtime",
    NORTHSTAR_VOICE_STREAM_URL: "wss://voice.example.com",
    PLATFORM_ALERT_WEBHOOK_URL: "https://alerts.example.com/northstar",
    PLATFORM_RESEND_API_KEY: "resend-key",
    PLATFORM_ALERT_FROM_EMAIL: "alerts@example.com",
    RESEND_WEBHOOK_SECRET: "webhook-secret",
    RESEND_INBOUND_DOMAIN: "inbound.example.com",
    ENABLE_SCENARIO_LAB: "false",
    ENABLE_LOCAL_PREVIEW_LOGIN: "false",
    ENABLE_CODEX_CONNECTOR_WORKER: "false",
  };
}

test("complete production infrastructure passes readiness", () => {
  const result = productionReadiness(completeEnvironment());
  assert.equal(result.enforced, true);
  assert.equal(result.ready, true);
  assert.deepEqual(result.issues, []);
});

test("Render HTTPS voice URL becomes Twilio's WebSocket endpoint", () => {
  assert.equal(
    normalizeVoiceStreamUrl("https://northstar-voice.onrender.com"),
    "wss://northstar-voice.onrender.com/twilio",
  );
  assert.equal(
    normalizeVoiceStreamUrl("wss://voice.example.com/twilio"),
    "wss://voice.example.com/twilio",
  );

  const env = completeEnvironment();
  env.NORTHSTAR_VOICE_STREAM_URL = "https://northstar-voice.onrender.com";
  assert.equal(productionReadiness(env).ready, true);
});

test("local URLs, unsafe flags, and malformed encryption fail readiness", () => {
  const env = completeEnvironment();
  env.APP_URL = "http://localhost:3000";
  env.SECRETS_ENCRYPTION_KEY = "not-a-32-byte-key";
  env.ENABLE_LOCAL_PREVIEW_LOGIN = "true";
  env.ENABLE_CODEX_CONNECTOR_WORKER = "true";

  const keys = productionReadiness(env).issues.map((issue) => issue.key);
  assert.ok(keys.includes("APP_URL"));
  assert.ok(keys.includes("SECRETS_ENCRYPTION_KEY"));
  assert.ok(keys.includes("ENABLE_LOCAL_PREVIEW_LOGIN"));
  assert.ok(keys.includes("ENABLE_CODEX_CONNECTOR_WORKER"));
});

test("readiness can report issues without enforcing local health", () => {
  const result = productionReadiness({});
  assert.equal(result.enforced, false);
  assert.equal(result.ready, false);
  assert.ok(result.issues.length > 0);
});
