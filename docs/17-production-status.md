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
| Audit + redaction | All new actions audited; every logged payload passes redactAuditValue |

## Preview / not built (still honest)

| Area | Status |
| --- | --- |
| Voice telephony | Foundation only — call sessions, transcripts, AI summaries, caller matching, disclosure modes, and the call.completed intake path are real code, but NO provider adapter exists: no calls happen until one ships with credentials + live mode (docs/20) |
| Live call / live scheduling popups | Not built — need the voice adapter's live transcript; the assistant_events feed they will consume is real |
| SSE/WebSocket event push | Not built — polling endpoint is real; push is transport-only on the same contract |
| Appointment reschedule/cancel | Not built — book-only today |
| Desktop tray app / browser extension / CRM overlay | Not built — context API + event feed are ready for them (docs/18) |
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
