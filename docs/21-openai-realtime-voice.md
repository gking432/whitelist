# 21 — OpenAI Realtime Voice Assistant

The AI phone assistant, built on the OpenAI Realtime API on top of the
voice foundation (docs/20). Architecture adapted from the Northstar CRM
demo's realtime implementation — session minting with GA/beta fallback,
short natural instructions, server-VAD turn taking — with every
demo-only assumption removed: no hardcoded businesses, personas,
scenarios, or scripts; everything is multi-tenant and driven by the
per-client Knowledge tab.

## What is real now

- **Provider adapter** — `openai_realtime` is registered in
  `lib/voice/provider.ts` (the registry is no longer empty). Capabilities:
  AI answering, native speech-to-speech, live audio + transcript, mid-call
  tool calling, post-call summary, and outbound-callback conversations
  once a bridge dials. `testConnection()` validates the key and model
  against OpenAI before anything is stored. Configure with
  `VOICE_PROVIDER=openai_realtime` + `OPENAI_API_KEY`.
- **Session contract** (`lib/voice/providers/openai-realtime.ts`):
  - `buildVoiceAgentInstructions` — per-client prompt built ONLY from the
    approved Knowledge profile (business description, services, areas,
    hours, emergency/booking/escalation rules, pricing disclaimer, FAQ)
    plus the standard never-invent guardrails, the client's AI disclosure
    mode, matched-caller known facts, and phone turn-taking rules. Short
    on purpose — realtime models sound robotic when over-scripted.
  - `mintRealtimeClientSecret` — server-side mint of a short-lived client
    secret (GA `/v1/realtime/client_secrets`, beta `/v1/realtime/sessions`
    fallback). The API key never leaves the server. Server VAD is set so
    the agent waits for the caller to finish.
  - `runSimulatedAgentTurn` — the same instructions + tools over chat
    completions (text transport) for the simulated harness.
- **Tools** (`lib/voice/tools.ts`) — the agent acts ONLY through these,
  and they hit the same rails as every other Northstar surface:

  | Tool | What it really does |
  | --- | --- |
  | `lookup_contact` | Finds an existing built-in CRM contact by phone/email (tenant-scoped) and pins it to the call session |
  | `save_contact_details` | Stores collected details on the call session + additive contact create/update (never overwrites filled fields) |
  | `add_note` | AI-attributed timeline note on the matched contact + call-session note |
  | `propose_slots` | REAL Google Calendar availability through the knowledge booking window + parsed caller constraints; honest `no_calendar` / `no_slots` answers |
  | `request_booking` | Creates a PENDING `appointment_booking` approval — only for a slot `propose_slots` actually returned; booking still happens only on human approval + live mode |
  | `request_confirmation_message` | Creates a PENDING `customer_message` approval (SMS/email draft) — delivery only on approval + live mode |
  | `escalate` | `escalation_needed` assistant event + timeline note |
  | `end_call` | Signals the transport to hang up and run the post-call pipeline |

  Every tool execution is appended (redacted) to the call session's tool
  log, and booking/draft requests emit `booking_proposed` /
  `draft_ready` / `approval_needed` assistant events tied to the call.
- **Ephemeral session endpoint** — `POST /api/voice/realtime/session`
  (`{client_id}`): session-authenticated (partner operator or client
  member, write access), rate-limited, creates a `call_sessions` row, and
  returns `{call_session_id, client_secret, webrtc_url, realtime_api,
  model}` for a browser WebRTC test call. Never the API key.
- **Simulated call harness** — `POST /api/voice/simulate` (below).

## Guardrails (unchanged from the platform rules)

- The agent **requests**; humans **approve**. It cannot send SMS/email,
  book calendar events, or touch anything customer-facing directly — it
  creates pending approval items, and the existing resolution paths still
  enforce live mode at delivery time (dry_run/sandbox record honestly).
- Business facts come only from the approved Knowledge profile with the
  never-invent guardrails; unknown answers become "the team will
  confirm".
- Scheduling: the agent may only offer slots `propose_slots` returned
  from real calendar availability, and `request_booking` rejects any
  start time that was not proposed on this call.
- AI disclosure follows the per-client mode (explicit default; legal
  review before "minimal" — docs/12).
- Tenancy: every write carries the call session's partner_id/client_id;
  RLS + service-role separation as everywhere else.

## Testing the voice workflow (before any phone bridge)

`POST /api/voice/simulate` runs the whole pipeline with text standing in
for audio (requires `OPENAI_API_KEY`; sim model defaults to gpt-4o-mini):

```jsonc
// 1. Start — creates the call session (caller matching, disclosure,
//    active_call_started event) and returns the AI greeting.
{ "action": "start", "client_id": "<uuid>", "from_number": "+15551234567" }

// 2. Converse — each turn is stored as a transcript turn; the agent may
//    call tools (they execute for real: contact saves, slot proposals,
//    approval-gated booking/draft requests, escalation).
{ "action": "caller_turn", "call_session_id": "<id>",
  "text": "Hi, my water heater is leaking. Can someone come out tomorrow morning?" }

// 3. Complete — runs completeCallSession: AI summary + clean CRM note,
//    call.completed intake event → router → workflows → approvals → CRM
//    sync, timeline note, call_completed event. Returns a verification
//    report: transcript turn count, summary/crm_note, intake event +
//    workflow run id, approvals created by the call, assistant events.
{ "action": "complete", "call_session_id": "<id>" }
```

Then check the surfaces: the Assistant console shows the call events and
waiting approvals; Approvals holds the booking/draft requests; the CRM
tab shows the contact, note, and (after approving) the appointment.

Simulated sessions are stamped `provider: "openai_realtime_simulated"` so
nothing ever presents them as real telephony.

## Phone bridge plan: what remains for real inbound calls

Everything above the audio transport is done. A bridge has one job:
connect a carrier call's audio to an OpenAI Realtime session minted by
`/api/voice/realtime/session`-style code and relay transcript/tool events
into `lib/voice/sessions.ts` + `lib/voice/tools.ts`. Options, in
recommended order:

1. **OpenAI SIP connector (recommended first bridge).** Point a Twilio
   SIP trunk (or any SIP provider) at OpenAI's SIP endpoint; OpenAI sends
   an incoming-call webhook, the server accepts it with the same
   per-client instructions + tools, then receives transcript/tool events
   over a websocket. No media handling on our side at all — the least
   code and the least latency. Needs: a phone number + SIP trunk per
   client, the incoming-call webhook route (verify with
   `OPENAI_REALTIME_WEBHOOK_SECRET`), number→client mapping, and the
   event relay into sessions/tools.
2. **Twilio Voice + Media Streams.** Twilio answers, streams μ-law audio
   over a websocket to our server, which re-encodes and proxies to the
   Realtime API. Full control (recording, transfer to a human, IVR
   fallback) but we own a stateful audio proxy — needs a long-lived
   websocket host (not serverless), buffering, and barge-in handling.
3. **Retell / Vapi.** Managed voice-agent platforms that own telephony +
   the realtime loop and call our webhooks for tools/transcripts. Fastest
   to ship and multi-model, but a per-minute vendor margin, less prompt
   control, and their adapter would replace `openai_realtime` rather than
   reuse it. Keep as the fallback if SIP setup stalls.

In all three cases the adapter surface is the one docs/20 defined:
`createCallSession` on ring, `addTranscriptTurn` per utterance,
`executeVoiceTool` per tool call, `completeCallSession` on hangup.
Summaries, workflows, approvals, CRM sync, and assistant events already
happen from there. Hard rule stays: no real calls until a bridge exists,
credentials are configured, and the connection runs in live mode.

## Env vars

```bash
VOICE_PROVIDER=openai_realtime
OPENAI_API_KEY=            # server-only; never sent to browsers
OPENAI_REALTIME_MODEL=     # default gpt-realtime (mini: gpt-realtime-mini)
OPENAI_REALTIME_VOICE=     # default marin (GA voices: cedar, marin)
OPENAI_SIM_MODEL=          # default gpt-4o-mini (simulated harness)
OPENAI_REALTIME_WEBHOOK_SECRET=  # reserved for the SIP bridge webhook
```
