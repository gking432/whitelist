# 17 — Production Status: Real vs Preview

Snapshot of what is genuinely wired end-to-end versus honest preview,
after the production push. Read with docs/16 (provider capability matrix)
and docs/08 (acceptance checklist). Northstar's primary posture is the AI
operations layer on top of a client's existing CRM/phone/SMS/email/
calendar/forms; the built-in CRM is the fallback for clients without a
stack.

## Real today (wired, gated, logged, retryable)

| Area | Status |
| --- | --- |
| Inbound intake (webhook/forms/web chat endpoint) | Real — token auth, idempotency, rate limits, redacted logs |
| Inbound SMS (Twilio webhook) | Real — X-Twilio-Signature validated (unit-tested), MessageSid idempotency, routes through AI intake |
| Universal AI intake routing | Real — AI with labeled rule-based fallback, fires on every inbound event type |
| Lead analysis + first-response draft | Real — every form/web lead gets an approval-gated SMS/email draft; missed calls use the rescue draft |
| Approval-gated SMS delivery (Twilio) | Real — live mode only; dry_run/skipped/failed recorded honestly |
| Approval-gated email delivery (Resend) | Real — same gate; key + sending-domain verified at connect |
| Appointment slot proposals | Real — Google Calendar free/busy → business-hours slots (unit-tested slot engine), one open proposal per client |
| Approval-gated booking | Real — approving creates the calendar event, live mode only, logged as calendar.event_created |
| CRM sync (HubSpot, GoHighLevel) | Real — additive contact + AI Assistant note, verified credentials, dry-run previews |
| CRM sync fallback (signed outbound webhook) | Real — HMAC-SHA256 signed envelope, HTTPS only, private-network destinations blocked (unit-tested) |
| Durable action jobs + retry | Real — every send/booking/sync records an attempt; failed/dry-run/skipped retryable from Runs / Logs with audit |
| Built-in CRM foundation | Real — contacts/leads/timeline/tasks/appointments, tenant-scoped RLS, AI writes attributed as ai_assistant; fills for primary/mirror/assist modes only |
| Packages → setup checklist | Real — capability toggles drive required integrations, workflows, staff-runtime honesty |
| Staff Assistant Console (web) | Real data + real actions (approve-jumps, sync, create task, mark spam, escalate, copy); labeled Preview state before first lead |
| Client-staff Assistant Console (/client/assistant) | Real — same contract and gates, scoped by the member's own client; portal must be enabled |
| Assistant Context API + live events | Real — GET /api/assistant/context and /api/assistant/events (polling), session-authenticated, tenancy-enforced (docs/18) |
| Approved AI knowledge base | Real — per-client Knowledge tab, audited saves, injected into intake/draft/chat/call prompts with never-invent guardrails |
| Website AI chat widget | Real — hosted page + iframe embed, public rotatable key, rate-limited, AI replies from approved knowledge with scripted fallback; completed chats become normal intake events (docs/19) |
| Scheduling constraints | Real — "after 5"/"mornings"/"not tomorrow"/weekday parsing (unit-tested) intersects the knowledge-base booking window in slot proposals; approval summaries say what was honored |
| Booking confirmation drafts | Real — approved bookings queue a NEW approval-gated confirmation message; booking approval never implies message approval |
| Background job runner | Real — POST /api/jobs/run (CRON_SECRET) retries failed jobs with exponential backoff; manual retry retained; needs an external scheduler |
| OpenAI Realtime voice agent | Real — registered provider adapter, per-client instructions from approved knowledge, ephemeral session minting (key stays server-side), tool calls into real actions (contact lookup/save, notes, real slot proposals, approval-gated booking + message requests, escalation), and simulated-call harness exercising the full pipeline (docs/21) |
| Twilio AI-answering calls | Real — signed inbound voice webhooks create a durable call session, Twilio Gather carries customer turns to the configured AI voice tools, responses return as TwiML, and call completion runs the normal CRM/post-call pipeline |
| Staff-assisted Twilio calls | Real foundation — Twilio forwards the call to staff while an always-on WebSocket service streams call audio for transcription, signs transcript events back to the app, and feeds the desktop assistant |
| Managed Twilio provisioning | Real — a partner-owned Twilio parent account can create a client subaccount, purchase a voice/SMS number, and configure messaging, voice, and status webhooks automatically |
| Desktop phone assistant | Real foundation — Electron tray app, hosted authenticated assistant route, active-call always-on-top behavior, launch-at-login, server configuration, and macOS/Windows/Linux packaging are present |
| Scoped client connection links | Real — partners can send expiring provider-specific links so the client can enter its own credentials without exposing them to the partner |
| Package-driven automation installation | Real — choosing the sold package provisions its native workflows and only its included launch automations in sandbox, records per-pack readiness, identifies the minimum missing client accounts, and feeds the test and launch gates |
| n8n/Zapier/Make expansion recipes | Real export/deployer contracts — 14 researched recipes can bridge unusual external apps; clients do not need these accounts for native connectors, and no shared platform automation account is configured |
| Field-service connectors | Real contracts — Jobber OAuth; Housecall Pro, ServiceTitan, and Workiz credential verification; customer/lead/job/appointment sync into canonical records and the built-in CRM |
| Finance and attribution connectors | Real contracts — QuickBooks and Square OAuth, Stripe key verification, CallRail credential verification, normalized customer/payment/call attribution sync |
| Retained phone connectors | Real contracts — RingCentral and Dialpad OAuth plus signed webhooks; Quo/OpenPhone credential setup; caller matching, screen-pop events, SMS intake, and post-call workflows |
| Marketing and reputation connectors | Real contracts — Meta Lead Ads/webhooks and campaign metrics; Google Ads lead forms/campaign metrics; GBP, Podium, and Birdeye reviews; approval-gated replies where supported |
| Forwarded lead inbox | Real — Resend Receiving signature validation, unique per-client address, message retrieval/parsing, idempotent intake, and normal AI workflow routing |
| Integration request and escalation center | Real — client-to-partner support, partner-to-owner escalation, durable triage/routing, guarded Codex handoff, review and release states |
| Audit + redaction | All new actions audited; every logged payload passes redactAuditValue |

## Preview / not built (still honest)

| Area | Status |
| --- | --- |
| Fully streaming AI-to-customer voice | Twilio's AI-answering path is turn-based Gather/TwiML. The WebSocket audio stream currently supports staff-assisted transcription; a full-duplex AI audio bridge remains a later quality upgrade |
| Staff-assist production proof | Code is present, but a real Twilio account, public app URL, always-on voice-stream URL, OpenAI key, and installed desktop build are still required for live verification |
| SSE/WebSocket event push | Not built — polling endpoint is real; push is transport-only on the same contract |
| Appointment reschedule/cancel | Not built — book-only today |
| Browser extension / third-party CRM overlay | Not built. The Electron desktop assistant is the supported V1 overlay; direct CRM write-back is preferred whenever a connector supports it |
| Provider live verification | Connector contracts are implemented and tested locally, but each vendor still needs production app approval and at least one real account pilot before being labeled live-verified |
| Marketplace native APIs | Angi, Thumbtack, Yelp, and similar broad lead APIs remain vendor-restricted; private forwarded email and signed webhook intake are the supported V1 paths |
| Per-client custom field mapping | Defaults only (docs/16) |
| Billing/usage pricing on packages | Not built by request |

## Hardening notes (docs/08 checklist)

- **RLS/grants**: every new table (partner_packages, action_jobs, crm_*)
  ships policies AND explicit grants (the partner_packages incident is the
  reference failure). action_jobs is select-only for browser roles —
  writes go through the service role.
- **Secrets**: provider credentials encrypted (AES-256-GCM), never
  selectable by browser roles, verified against the real provider before
  storage, never echoed back.
- **Live-mode guardrails**: nothing customer-facing leaves the system
  without (a) a human approval and (b) a live-mode connection; retries
  re-check both on every attempt.
- **Outbound webhooks**: HTTPS enforced at creation; localhost/private/
  link-local/metadata destinations rejected at delivery (unit-tested).
- **Tests**: `npm test` — node:test suites for the slot engine, Twilio
  signature validation, and outbound-webhook destination blocking/signing.
- **Known gaps before real customer data**: error monitoring, backups,
  rate limits exist only on inbound endpoints, no queue worker, legal
  review of AI disclosure (docs/12) still pending.

## UI modernization pass (2026-07)

The app chrome was modernized to match the product's positioning: the
large deep-green sidebar was replaced with a light, slim shell (neutral
white/off-white surfaces, hairline borders, near-invisible shadows), the
radius scale tightened to 8px cards / 6px controls, and deep green + gold
now appear only as accents — active nav, icons, primary buttons, and the
assistant window bar. Operational headings and tables were tightened for
density. A second pass made the app deliberately desktop-first: the
sidebar rail runs the full page height, every section shares one content
width, and the Assistant console is a full-width two-pane workbench
(context pane + action rail) instead of a floating narrow card. No
behavior, routes, or data changed; all honesty labels (live/dry-run/
preview, runtime modes, provider status) are untouched. Verified with
1440px screenshots.

Remaining visual debt: run-detail and audit pages could use the same
density treatment; dark mode does not exist; the client portal could
surface partner logo/colors once branding assets are stored; small-screen
layouts are explicitly not designed yet (desktop-first by decision).

## Verification commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
```
