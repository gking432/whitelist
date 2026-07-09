// Voice provider abstraction (docs/11 Phase 4, docs/20, docs/21). No real
// telephony exists until a phone bridge (Twilio Voice / SIP) connects a
// carrier call to an adapter — this module defines the contract and
// honestly reports "not configured" until credentials exist.
//
// Env placeholders (see .env.example):
//   VOICE_PROVIDER          "openai_realtime" (shipped), later "twilio_voice", "retell", "vapi"
//   VOICE_PROVIDER_API_KEY  the provider's server-side API key (adapters
//                           may read their own env instead — OpenAI
//                           Realtime uses OPENAI_API_KEY)

import {
  isOpenAIRealtimeConfigured,
  testOpenAIRealtimeConnection,
} from "@/lib/voice/providers/openai-realtime";

export type VoiceProviderCapabilities = {
  // The AI answers and holds the conversation itself (vs. assisting staff).
  aiAnswering: boolean;
  // Native speech-to-speech model (no STT→LLM→TTS chain).
  speechToSpeech: boolean;
  liveAudio: boolean;
  liveTranscript: boolean;
  // Mid-call tool calls into Northstar actions (lib/voice/tools.ts).
  toolCalling: boolean;
  postCallSummary: boolean;
  postCallRecording: boolean;
  // Can drive an outbound callback conversation once a phone bridge dials
  // (docs/21) — the adapter itself never places calls.
  outboundCalls: boolean;
};

// The contract every voice adapter implements. Adapters translate provider
// webhooks/streams into Northstar's call session + transcript models
// (lib/voice/sessions.ts) — they never talk to workflows directly.
export type VoiceProviderAdapter = {
  key: string;
  displayName: string;
  capabilities: VoiceProviderCapabilities;
  // True when the adapter's own credentials are present (env or stored).
  isConfigured(): boolean;
  // Validates credentials against the provider before anything is stored.
  testConnection(): Promise<{ ok: boolean; detail: string }>;
};

export function getConfiguredVoiceProviderKey(): string | null {
  return process.env.VOICE_PROVIDER?.trim() || null;
}

// Adapter registry. OpenAI Realtime is the first real adapter: session
// minting, per-client instructions, tool calling, and the simulated
// harness are live code (docs/21). Everything downstream — call sessions,
// transcripts, summaries, workflows — already works; a phone bridge is
// the remaining piece for real carrier calls.
const ADAPTERS: Record<string, VoiceProviderAdapter> = {
  openai_realtime: {
    key: "openai_realtime",
    displayName: "OpenAI Realtime",
    capabilities: {
      aiAnswering: true,
      speechToSpeech: true,
      liveAudio: true,
      liveTranscript: true,
      toolCalling: true,
      postCallSummary: true,
      postCallRecording: false,
      outboundCalls: true,
    },
    isConfigured: isOpenAIRealtimeConfigured,
    testConnection: testOpenAIRealtimeConnection,
  },
};

export function isVoiceProviderConfigured(): boolean {
  const key = getConfiguredVoiceProviderKey();

  if (!key) {
    return false;
  }

  const adapter = ADAPTERS[key];

  if (adapter) {
    return adapter.isConfigured();
  }

  // Unknown keys fall back to the generic env pair so a future adapter can
  // be staged before its code ships — getVoiceProvider still returns null.
  return Boolean(process.env.VOICE_PROVIDER_API_KEY);
}

export function getVoiceProvider(): VoiceProviderAdapter | null {
  const key = getConfiguredVoiceProviderKey();

  if (!key || !isVoiceProviderConfigured()) {
    return null;
  }

  return ADAPTERS[key] ?? null;
}
