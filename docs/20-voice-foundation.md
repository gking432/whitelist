# 20 — Voice / Call Assistant Foundation

Production-shaped call infrastructure with a Twilio telephony adapter.
Reference behavior adapted from the Northstar CRM
demo's call intelligence (summaries, caller matching, note-vs-transcript
separation) into the multi-tenant platform.

> Update: the first real adapter now exists — **OpenAI Realtime**
> (docs/21): per-client instructions from approved knowledge, ephemeral
> session minting, mid-call tool calling into real Northstar actions, and
> a simulated-call harness that exercises this whole pipeline. The Twilio
> bridge now carries full-duplex AI audio and staff-assisted transcription;
> production remains unverified until a real-account pilot is recorded.

## What exists (real code, ready for a provider)

- **Models**: `call_sessions` (direction, numbers, status, disclosure
  mode, matched contact, clean `crm_note` vs `summary`, extracted fields)
  and `call_transcript_turns` (ordered caller/staff/ai_assistant turns).
  Tenant-scoped RLS; service-role writes.
- **Lifecycle functions** (`lib/voice/sessions.ts`) — the adapter
  contract:
  1. `createCallSession` on ring/answer — resolves the client's
     disclosure mode from the Knowledge profile and matches the caller by
     phone against the built-in CRM; emits `active_call_started`.
  2. `addTranscriptTurn` per utterance — emits `transcript_turn_added`.
  3. `completeCallSession` on hangup — AI call summary (labeled fallback
     when AI is off): clean CRM note separate from the full transcript,
     extracted contact fields/urgency/service need/appointment
     preference; then a `call.completed` intake event through the SAME
     rails as every other source (router → workflows → approvals → CRM
     sync), a timeline note on the matched contact, and a
     `call_completed` assistant event.
- **Provider abstraction** (`lib/voice/provider.ts`): adapter interface
  with a capability matrix (AI answering, speech-to-speech, live
  audio/transcript, tool calling, post-call summary/recording, outbound).
  The registry holds `openai_realtime` (docs/21); `getVoiceProvider()`
  returns null until `VOICE_PROVIDER` names a registered adapter AND that
  adapter's credentials are configured (OpenAI Realtime reads
  `OPENAI_API_KEY`; future adapters use `VOICE_PROVIDER_API_KEY`).
- **Disclosure modes** per client (Knowledge tab): explicit (default),
  minimal, off. Stamped onto every call session.

## What a provider adapter must do

Provider webhooks/streams translate into the three lifecycle calls above.
OpenAI Realtime is the first registered provider (docs/21), and the Twilio
adapter supplies both a full-duplex AI carrier path and staff-assisted Media
Streams transcription. The remaining voice launch work is deployment, real
credentials, and a recorded provider pilot, not another transport layer.

## Hard rules

- No real calls, answering, or callbacks until a concrete adapter exists,
  credentials are configured, and the connection runs in live mode.
- The raw transcript never syncs to external CRMs — only the clean note.
- AI disclosure follows the per-client mode; legal review before using
  "minimal" (docs/12).
