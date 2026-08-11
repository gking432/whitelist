import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  parseForwardedLeadEmail,
  verifyResendWebhookSignature,
} from "../lib/integrations/providers/resend-inbound.ts";

const key = Buffer.from("resend-acceptance-secret");
const secret = `whsec_${key.toString("base64")}`;
const rawBody = JSON.stringify({ type: "email.received" });
const messageId = "msg_acceptance";
const timestamp = "1786492800";
const signature = createHmac("sha256", key)
  .update(`${messageId}.${timestamp}.${rawBody}`)
  .digest("base64");

test("Resend webhook verification accepts an authentic fresh payload", () => {
  assert.equal(
    verifyResendWebhookSignature({
      rawBody,
      messageId,
      timestamp,
      signatures: `v1,${signature}`,
      secret,
      nowSeconds: Number(timestamp),
    }),
    true,
  );
});

test("Resend webhook verification rejects tampered and stale payloads", () => {
  assert.equal(
    verifyResendWebhookSignature({
      rawBody: `${rawBody} `,
      messageId,
      timestamp,
      signatures: `v1,${signature}`,
      secret,
      nowSeconds: Number(timestamp),
    }),
    false,
  );
  assert.equal(
    verifyResendWebhookSignature({
      rawBody,
      messageId,
      timestamp,
      signatures: `v1,${signature}`,
      secret,
      nowSeconds: Number(timestamp) + 301,
    }),
    false,
  );
});

test("forwarded lead email parsing extracts customer contact details", () => {
  assert.deepEqual(
    parseForwardedLeadEmail({
      email: {
        subject: "New HVAC request",
        html: "<p>Name: Jamie Rivera</p><p>jamie@example.com</p><p>(312) 555-0198</p>",
      },
      fallbackFrom: "Marketplace <lead@marketplace.test>",
    }),
    {
      name: "Jamie Rivera",
      email: "jamie@example.com",
      phone: "(312) 555-0198",
      message: "Name: Jamie Rivera\njamie@example.com\n(312) 555-0198",
      title: "New HVAC request",
      source: "forwarded_lead_email",
      medium: "email",
    },
  );
});
