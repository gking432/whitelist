import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeTwilioSignature,
  verifyTwilioSignature,
} from "../lib/integrations/twilio-signature.ts";

const AUTH_TOKEN = "12345678901234567890123456789012";
const URL = "https://app.example.com/api/integrations/inbound/twilio/abc";

test("accepts a correctly signed request", () => {
  const params = {
    From: "+15551230000",
    To: "+15559870000",
    Body: "Yes, tomorrow morning works",
    MessageSid: "SM123",
  };

  const signature = computeTwilioSignature(AUTH_TOKEN, URL, params);

  assert.ok(verifyTwilioSignature(AUTH_TOKEN, URL, params, signature));
});

test("rejects a tampered body", () => {
  const params = { From: "+15551230000", Body: "original" };
  const signature = computeTwilioSignature(AUTH_TOKEN, URL, params);

  assert.equal(
    verifyTwilioSignature(
      AUTH_TOKEN,
      URL,
      { ...params, Body: "tampered" },
      signature,
    ),
    false,
  );
});

test("rejects a signature made with a different token", () => {
  const params = { From: "+15551230000", Body: "hello" };
  const signature = computeTwilioSignature("wrong-token-wrong-token-wrong-t", URL, params);

  assert.equal(verifyTwilioSignature(AUTH_TOKEN, URL, params, signature), false);
});

test("rejects a signature for a different URL", () => {
  const params = { From: "+15551230000", Body: "hello" };
  const signature = computeTwilioSignature(
    AUTH_TOKEN,
    "https://evil.example.com/hook",
    params,
  );

  assert.equal(verifyTwilioSignature(AUTH_TOKEN, URL, params, signature), false);
});

test("parameter order does not matter (Twilio sorts keys)", () => {
  const a = computeTwilioSignature(AUTH_TOKEN, URL, { B: "2", A: "1" });
  const b = computeTwilioSignature(AUTH_TOKEN, URL, { A: "1", B: "2" });

  assert.equal(a, b);
});
