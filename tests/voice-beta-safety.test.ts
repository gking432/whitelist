import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { buildVoiceAgentInstructions } from "../lib/voice/providers/openai-realtime.ts";
import { mayEnrichVoiceContact, selectActiveCall, voiceCallExpired } from "../lib/voice/safety.ts";
import { computeOpenSlots } from "../lib/scheduling/slots.ts";

const require = createRequire(import.meta.url);
const { voiceLimits } = require("../services/voice-stream/limits.cjs");

test("caller-ID matches never expose stored customer PII in the spoken-agent prompt", () => {
  const prompt = buildVoiceAgentInstructions({
    clientName: "Example Service", knowledge: null, disclosureMode: "explicit", direction: "inbound",
    matchedContact: { name: "Private Customer", phone: "+13125550101", email: "private@example.test", address: "42 Private Street" },
  });
  for (const privateValue of ["Private Customer", "+13125550101", "private@example.test", "42 Private Street"]) {
    assert.equal(prompt.includes(privateValue), false);
  }
  assert.match(prompt, /identity has not been verified/);
  assert.match(prompt, /cannot transfer calls or promise a callback time/);
});

test("caller supplied details only enrich new provisional records, not matched existing customers", () => {
  assert.equal(mayEnrichVoiceContact({ caller_resolution: { status: "created" } }), true);
  for (const extracted of [{}, { caller_resolution: null }, { caller_resolution: { status: "matched" } }, { caller_resolution: { status: "unavailable" } }]) {
    assert.equal(mayEnrichVoiceContact(extracted), false);
  }
});

test("concurrent phone calls require selection and never silently switch a finished caller", () => {
  const first = { id: "first", assigned_user_id: "employee-one" };
  const second = { id: "second", assigned_user_id: null };
  assert.equal(selectActiveCall([first, second], null, "employee-one"), first);
  assert.equal(selectActiveCall([first, second], null, "employee-two"), null);
  assert.equal(selectActiveCall([first, second], "second", "employee-two"), second);
  assert.equal(selectActiveCall([first], "second", "employee-two"), null);
  assert.equal(selectActiveCall([first], null, "employee-two"), null);
  assert.equal(selectActiveCall([second]), second);
});

test("voice budgets stay bounded even with malformed or excessive operator configuration", () => {
  assert.deepEqual(voiceLimits({}), { maxCallSeconds: 900, maxCallTokens: 100000 });
  assert.deepEqual(voiceLimits({ VOICE_MAX_CALL_SECONDS: "Infinity", VOICE_MAX_CALL_TOKENS: "-1" }), { maxCallSeconds: 900, maxCallTokens: 100000 });
  assert.deepEqual(voiceLimits({ VOICE_MAX_CALL_SECONDS: "90000", VOICE_MAX_CALL_TOKENS: "100000000" }), { maxCallSeconds: 1200, maxCallTokens: 250000 });
  assert.deepEqual(voiceLimits({ VOICE_MAX_CALL_SECONDS: "1", VOICE_MAX_CALL_TOKENS: "1" }), { maxCallSeconds: 60, maxCallTokens: 1000 });
});

test("Gather fallback uses the original call age so stream reconnects cannot reset duration", () => {
  const started = "2026-09-04T12:00:00Z";
  assert.equal(voiceCallExpired(started, undefined, Date.parse("2026-09-04T12:14:59Z")), false);
  assert.equal(voiceCallExpired(started, undefined, Date.parse("2026-09-04T12:15:00Z")), true);
  assert.equal(voiceCallExpired(started, "90000", Date.parse("2026-09-04T12:20:00Z")), true);
  assert.equal(voiceCallExpired("invalid", undefined), true);
});

test("configured availability preserves weekend, split-window and appointment-duration rules", () => {
  const slots = computeOpenSlots([], {
    timezone: "America/Chicago", now: new Date("2026-09-04T12:00:00Z"),
    maxSlots: 20, maxPerDay: 20,
    availabilityWindows: [
      { weekday: 6, start_time: "09:30", end_time: "11:00", appointment_minutes: 90 },
      { weekday: 6, start_time: "14:00", end_time: "15:00", appointment_minutes: 60 },
    ],
  });
  assert.deepEqual(slots, [
    { startIso: "2026-09-05T14:30:00.000Z", endIso: "2026-09-05T16:00:00.000Z" },
    { startIso: "2026-09-05T19:00:00.000Z", endIso: "2026-09-05T20:00:00.000Z" },
  ]);
});
