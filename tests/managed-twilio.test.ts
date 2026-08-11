import assert from "node:assert/strict";
import test from "node:test";

import {
  provisionManagedTwilioNumber,
  testTwilioParentAccount,
} from "../lib/integrations/providers/twilio.ts";

test("partner Twilio validation accepts an active parent account", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ friendly_name: "Sample Agency", status: "active" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  try {
    const result = await testTwilioParentAccount({
      accountSid: "ACparent",
      authToken: "parent-token",
    });

    assert.equal(result.ok, true);
    assert.match(result.detail, /Sample Agency/);
    assert.match(result.detail, /partner account/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("managed Twilio provisioning creates a subaccount and configured number", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { url: string; method: string }[] = [];
  const responses = [
    { sid: "ACchild", auth_token: "child-token" },
    { available_phone_numbers: [{ phone_number: "+13125550123" }] },
    { sid: "PNnumber" },
  ];

  globalThis.fetch = (async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
    });
    return new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await provisionManagedTwilioNumber({
      parentAccountSid: "ACparent",
      parentAuthToken: "parent-token",
      clientName: "Sample Plumbing",
      ownerLabel: "Sample Agency",
      areaCode: "312",
      smsUrl: "https://app.example.com/sms",
      voiceUrl: "https://app.example.com/voice",
      voiceStatusUrl: "https://app.example.com/status",
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.credentials.accountSid, "ACchild");
    assert.equal(result.credentials.fromNumber, "+13125550123");
    assert.equal(requests.length, 3);
    assert.match(requests[0].url, /Accounts\.json$/);
    assert.match(requests[1].url, /AreaCode=312/);
    assert.match(requests[2].url, /IncomingPhoneNumbers\.json$/);
    assert.deepEqual(
      requests.map((request) => request.method),
      ["POST", "GET", "POST"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("managed Twilio provisioning reports unavailable area codes", async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    { sid: "ACchild", auth_token: "child-token" },
    { available_phone_numbers: [] },
  ];

  globalThis.fetch = (async () =>
    new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  try {
    const result = await provisionManagedTwilioNumber({
      parentAccountSid: "ACparent",
      parentAuthToken: "parent-token",
      clientName: "Sample Plumbing",
      ownerLabel: "Sample Agency",
      areaCode: "312",
      smsUrl: "https://app.example.com/sms",
      voiceUrl: "https://app.example.com/voice",
      voiceStatusUrl: "https://app.example.com/status",
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.detail, /area code 312/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
