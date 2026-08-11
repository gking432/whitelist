import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePhone,
  phoneSearchVariants,
} from "../lib/phone/normalize.ts";
import {
  signVoiceStreamPayload,
  signVoiceStreamSession,
  verifyVoiceStreamPayload,
} from "../lib/voice/stream-signature.ts";

test("normalizes common US caller ID formats", () => {
  assert.equal(normalizePhone("+1 (312) 555-0199"), "3125550199");
  assert.equal(normalizePhone("312.555.0199"), "3125550199");
  assert.equal(normalizePhone("123"), null);
});

test("builds useful CRM phone search variants without duplicates", () => {
  const variants = phoneSearchVariants("+1 (312) 555-0199");

  assert.ok(variants.includes("3125550199"));
  assert.ok(variants.includes("+13125550199"));
  assert.ok(variants.includes("(312) 555-0199"));
  assert.equal(new Set(variants).size, variants.length);
});

test("voice stream signatures accept fresh unchanged transcript events", () => {
  const secret = "test-stream-secret";
  const timestamp = "1785432000000";
  const body = JSON.stringify({
    call_session_id: "11111111-1111-4111-8111-111111111111",
    text: "Friday morning works.",
  });
  const signature = signVoiceStreamPayload(secret, timestamp, body);

  assert.equal(
    verifyVoiceStreamPayload({
      secret,
      timestamp,
      signature,
      body,
      now: Number(timestamp),
    }),
    true,
  );
});

test("voice stream signatures reject stale and modified events", () => {
  const secret = "test-stream-secret";
  const timestamp = "1785432000000";
  const body = "{}";
  const signature = signVoiceStreamPayload(secret, timestamp, body);

  assert.equal(
    verifyVoiceStreamPayload({
      secret,
      timestamp,
      signature,
      body: '{"changed":true}',
      now: Number(timestamp),
    }),
    false,
  );
  assert.equal(
    verifyVoiceStreamPayload({
      secret,
      timestamp,
      signature,
      body,
      now: Number(timestamp) + 5 * 60 * 1_000 + 1,
    }),
    false,
  );
});

test("call stream session tokens are stable and scoped to one call", () => {
  const first = signVoiceStreamSession("secret", "call-a");

  assert.equal(first, signVoiceStreamSession("secret", "call-a"));
  assert.notEqual(first, signVoiceStreamSession("secret", "call-b"));
});
