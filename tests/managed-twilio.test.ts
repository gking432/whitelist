import assert from "node:assert/strict";
import test from "node:test";

import {
  completeTwilioCall,
  createOutboundCall,
  provisionManagedTwilioNumber,
  testTwilioParentAccount,
} from "../lib/integrations/providers/twilio.ts";

test("Twilio outbound calls use the client number and signed app callbacks", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedBody = "";
  globalThis.fetch = (async (input, init) => {
    capturedUrl = String(input);
    capturedBody = String(init?.body ?? "");
    return new Response(
      JSON.stringify({ sid: "CAoutbound", status: "queued" }),
      {
        status: 201,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as typeof fetch;

  try {
    const result = await createOutboundCall(
      {
        accountSid: "ACclient",
        authToken: "client-token",
        fromNumber: "+13125550100",
      },
      {
        to: "+13125550199",
        twiml: "<Response><Say>Hello</Say></Response>",
        statusCallbackUrl: "https://app.example.test/status",
      },
    );

    assert.deepEqual(result, { callSid: "CAoutbound", status: "queued" });
    assert.match(capturedUrl, /Accounts\/ACclient\/Calls\.json$/);
    const body = new URLSearchParams(capturedBody);
    assert.equal(body.get("From"), "+13125550100");
    assert.equal(body.get("To"), "+13125550199");
    assert.equal(body.get("StatusCallback"), "https://app.example.test/status");
    assert.equal(body.has("StatusCallbackEvent"), false);
    assert.match(body.get("Twiml") ?? "", /<Say>Hello<\/Say>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Twilio hangup completes only the requested carrier call", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedBody = "";
  globalThis.fetch = (async (input, init) => {
    capturedUrl = String(input);
    capturedBody = String(init?.body ?? "");
    return new Response(
      JSON.stringify({ sid: "CAtarget", status: "completed" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as typeof fetch;

  try {
    await completeTwilioCall(
      { accountSid: "ACclient", authToken: "client-token" },
      "CAtarget",
    );
    assert.match(capturedUrl, /Accounts\/ACclient\/Calls\/CAtarget\.json$/);
    assert.equal(new URLSearchParams(capturedBody).get("Status"), "completed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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
