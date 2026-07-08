// Voice provider abstraction (docs/11 Phase 4). No real telephony exists
// until a concrete adapter is implemented AND a live-mode connection with
// credentials exists — this module defines the contract and honestly
// reports "not configured" until then.
//
// Env placeholders (see .env.example):
//   VOICE_PROVIDER          e.g. "twilio_voice", "retell", "vapi"
//   VOICE_PROVIDER_API_KEY  the provider's server-side API key

export type VoiceProviderCapabilities = {
  liveAudio: boolean;
  liveTranscript: boolean;
  postCallRecording: boolean;
  outboundCalls: boolean;
};

// The contract every voice adapter implements. Adapters translate provider
// webhooks/streams into Northstar's call session + transcript models
// (lib/voice/sessions.ts) — they never talk to workflows directly.
export type VoiceProviderAdapter = {
  key: string;
  displayName: string;
  capabilities: VoiceProviderCapabilities;
  // Validates credentials against the provider before anything is stored.
  testConnection(): Promise<{ ok: boolean; detail: string }>;
};

export function getConfiguredVoiceProviderKey(): string | null {
  return process.env.VOICE_PROVIDER?.trim() || null;
}

export function isVoiceProviderConfigured(): boolean {
  return Boolean(
    getConfiguredVoiceProviderKey() && process.env.VOICE_PROVIDER_API_KEY,
  );
}

// Adapter registry. Empty on purpose: the first real adapter (Twilio
// Voice, Retell, Vapi, …) registers here. Everything downstream — call
// sessions, transcripts, summaries, workflows — already works; the adapter
// only has to feed lib/voice/sessions.ts.
const ADAPTERS: Record<string, VoiceProviderAdapter> = {};

export function getVoiceProvider(): VoiceProviderAdapter | null {
  const key = getConfiguredVoiceProviderKey();

  if (!key || !isVoiceProviderConfigured()) {
    return null;
  }

  return ADAPTERS[key] ?? null;
}
