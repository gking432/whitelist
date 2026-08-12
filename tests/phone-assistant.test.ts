import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { findCanonicalCallerMatch } from "../lib/crm/canonical-caller.ts";
import { resolveAssistantOperatingSystem } from "../lib/assistant/operating-system.ts";
import {
  normalizePhone,
  phoneSearchVariants,
  toE164Phone,
} from "../lib/phone/normalize.ts";
import {
  signVoiceStreamPayload,
  signVoiceStreamSession,
  verifyVoiceStreamPayload,
} from "../lib/voice/stream-signature.ts";
import { buildAiStreamTwimlXml } from "../lib/voice/twiml-xml.ts";

const require = createRequire(import.meta.url);
const voiceProtocol = require("../services/voice-stream/protocol.cjs") as {
  functionCallOutput: (
    callId: string,
    output: Record<string, unknown>,
  ) => Record<string, unknown>;
  functionCallsFromResponse: (
    event: Record<string, unknown>,
  ) => { callId: string; name: string; arguments: string }[];
  realtimeSessionUpdate: (input: {
    instructions: string;
    model: string;
    voice: string;
    transcriptionModel: string;
    tools: Record<string, unknown>[];
  }) => Record<string, any>;
  truncateAssistantItem: (
    itemId: string,
    audioEndMs: number,
  ) => Record<string, unknown>;
  twilioClear: (streamSid: string) => Record<string, unknown>;
  twilioMedia: (streamSid: string, payload: string) => Record<string, unknown>;
};

test("matches formatted caller IDs against synced external customers", () => {
  const result = findCanonicalCallerMatch(
    [
      {
        object_type: "customer",
        external_object_id: "customer-42",
        native_object_id: null,
        canonical_data: {
          name: "Jamie Rivera",
          phone: "+1 (312) 555-0199",
          email: "jamie@example.test",
        },
      },
    ],
    "312.555.0199",
  );

  assert.equal(result?.objectType, "customer");
  assert.equal(result?.match.id, "customer-42");
  assert.equal(result?.match.firstname, "Jamie");
  assert.equal(result?.match.lastname, "Rivera");
});

test("assistant treats a connected field-service system as the CRM target", () => {
  const result = resolveAssistantOperatingSystem({
    crmOperatingMode: "external_crm_only",
    connections: [
      {
        status: "connected",
        runtime_mode: "live",
        provider: {
          provider_key: "jobber",
          category: "field_service",
          display_name: "Jobber",
        },
      },
    ],
  });

  assert.equal(result.providerLabel, "Jobber");
  assert.equal(result.connectionInfo.connected, true);
  assert.equal(result.connectionInfo.live, true);
  assert.equal(result.nativeCrmOnly, false);
  assert.equal(result.supportsNotes, false);
});

test("assistant uses the built-in CRM when it is the only operating system", () => {
  const result = resolveAssistantOperatingSystem({
    crmOperatingMode: "primary_crm",
    connections: [],
  });

  assert.equal(result.providerLabel, "Northstar CRM");
  assert.equal(result.connectionInfo.connected, true);
  assert.equal(result.nativeCrmOnly, true);
  assert.equal(result.supportsNotes, true);
});

test("normalizes common US caller ID formats", () => {
  assert.equal(normalizePhone("+1 (312) 555-0199"), "3125550199");
  assert.equal(normalizePhone("312.555.0199"), "3125550199");
  assert.equal(normalizePhone("123"), null);
});

test("converts ordinary CRM phone formats to Twilio E.164 destinations", () => {
  assert.equal(toE164Phone("(312) 555-0199"), "+13125550199");
  assert.equal(toE164Phone("+44 20 7946 0958"), "+442079460958");
  assert.equal(toE164Phone("555-0199"), null);
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

test("AI TwiML starts an authenticated bidirectional stream with speech fallback", () => {
  const xml = buildAiStreamTwimlXml({
    actionUrl:
      "https://app.example.test/api/integrations/inbound/twilio-voice/11111111-1111-4111-8111-111111111111/turn",
    callSessionId: "22222222-2222-4222-8222-222222222222",
    streamUrl: "wss://voice.example.test/twilio",
    streamToken: "signed-token",
    fallbackSpeech: "The live assistant was interrupted.",
  });

  assert.match(
    xml,
    /<Connect><Stream url="wss:\/\/voice\.example\.test\/twilio">/,
  );
  assert.match(xml, /name="mode" value="ai_answered"/);
  assert.match(xml, /name="streamToken" value="signed-token"/);
  assert.match(xml, /<\/Connect><Gather input="speech"/);
  assert.match(xml, /The live assistant was interrupted/);
});

test("realtime voice protocol preserves Twilio PCMU and function-call contracts", () => {
  const update = voiceProtocol.realtimeSessionUpdate({
    instructions: "Answer for Acme.",
    model: "gpt-realtime",
    voice: "marin",
    transcriptionModel: "gpt-4o-mini-transcribe",
    tools: [{ type: "function", name: "propose_slots" }],
  });

  assert.equal(update.session.audio.input.format.type, "audio/pcmu");
  assert.equal(update.session.audio.output.format.type, "audio/pcmu");
  assert.equal(update.session.audio.input.turn_detection.interrupt_response, true);
  assert.deepEqual(voiceProtocol.twilioMedia("MZ123", "bXVsdWxhdw=="), {
    event: "media",
    streamSid: "MZ123",
    media: { payload: "bXVsdWxhdw==" },
  });
  assert.deepEqual(voiceProtocol.twilioClear("MZ123"), {
    event: "clear",
    streamSid: "MZ123",
  });

  const calls = voiceProtocol.functionCallsFromResponse({
    type: "response.done",
    response: {
      output: [
        {
          type: "function_call",
          call_id: "call-1",
          name: "propose_slots",
          arguments: '{"preference_text":"Friday morning"}',
        },
      ],
    },
  });
  assert.deepEqual(calls, [
    {
      callId: "call-1",
      name: "propose_slots",
      arguments: '{"preference_text":"Friday morning"}',
    },
  ]);
  assert.deepEqual(
    voiceProtocol.functionCallOutput("call-1", { slots: [] }),
    {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: "call-1",
        output: '{"slots":[]}',
      },
    },
  );
  assert.deepEqual(voiceProtocol.truncateAssistantItem("item-1", 129.8), {
    type: "conversation.item.truncate",
    item_id: "item-1",
    content_index: 0,
    audio_end_ms: 129,
  });
});
