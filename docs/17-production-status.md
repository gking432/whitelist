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
| Staff Assistant Console (web) | Real data + real actions (approve-jumps, sync, escalate, copy); labeled Preview state before first lead |
| Audit + redaction | All new actions audited; every logged payload passes redactAuditValue |

## Preview / not built (still honest)

| Area | Status |
| --- | --- |
| Voice: AI answering, live call assistant, live scheduling popup | Not built — needs a phone provider adapter with live audio/transcript. Design contracts in docs/11. |
| Website AI chat widget UI | Not built — the chat intake endpoint + routing are real |
| Background worker / queue | Not built — actions are durable + retryable, execution is synchronous, retries are manual |
| Appointment reschedule/cancel | Not built — book-only today |
| Desktop tray app / browser extension / CRM overlay | Not built — the Assistant context contract is ready for them (docs/15) |
| Client-staff console login | Not built — console lives in the partner workspace |
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

## Verification commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
```
