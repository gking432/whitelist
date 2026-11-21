import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import {
  isBlockedDestination,
  signWebhookBody,
} from "../lib/integrations/providers/outbound-webhook.ts";

test("allows public HTTPS destinations", () => {
  assert.equal(isBlockedDestination("https://hooks.example.com/crm"), false);
  assert.equal(isBlockedDestination("https://hooks.zapier.com/abc/123"), false);
});

test("blocks plain HTTP and garbage URLs", () => {
  assert.equal(isBlockedDestination("http://hooks.example.com/crm"), true);
  assert.equal(isBlockedDestination("not a url"), true);
});

test("blocks localhost and internal hostnames", () => {
  assert.equal(isBlockedDestination("https://localhost/hook"), true);
  assert.equal(isBlockedDestination("https://api.localhost/hook"), true);
  assert.equal(isBlockedDestination("https://service.internal/hook"), true);
  assert.equal(isBlockedDestination("https://printer.local/hook"), true);
});

test("blocks private, loopback, link-local, and metadata IPv4 ranges", () => {
  for (const host of [
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.10",
    "169.254.169.254",
    "0.0.0.0",
  ]) {
    assert.equal(isBlockedDestination(`https://${host}/hook`), true, host);
  }

  // Public IPv4 stays allowed.
  assert.equal(isBlockedDestination("https://8.8.8.8/hook"), false);
  assert.equal(isBlockedDestination("https://172.32.0.1/hook"), false);
});

test("signature matches HMAC-SHA256 base64 of the raw body", () => {
  const secret = "shh-signing-secret";
  const body = '{"event_type":"crm.contact_sync","data":{}}';

  assert.equal(
    signWebhookBody(secret, body),
    createHmac("sha256", secret).update(body).digest("base64"),
  );
});
