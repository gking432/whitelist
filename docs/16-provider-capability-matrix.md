# 16 — Provider Capability Matrix & Field Mapping

What each connectable provider can actually do in the current release.
"Approval-gated" means a human approves the exact content first; "live
mode only" means the connection's runtime mode must be `live` or the
action records an honest dry run instead.

## Capability matrix

| Provider | Category | Connect method | What works today | What does not |
| --- | --- | --- | --- | --- |
| HubSpot | CRM | Private app token (verified before storing) | Additive contact upsert + "AI Assistant" note on every lead-bearing run; manual re-sync; dry-run payload preview | No deal/stage writes, no deletes, no email via HubSpot |
| GoHighLevel | CRM | Private Integration token + Location ID (verified) | Same contract as HubSpot: contact upsert + AI note, dry-run preview, retry | No pipeline/opportunity writes, no messaging via GHL |
| Generic outbound webhook | CRM fallback | Generated signing secret + HTTPS destination | Signed `crm.contact_sync` JSON delivery (HMAC-SHA256 `X-Northstar-Signature`); private-network destinations blocked | Receiver must verify + map fields itself; no reads back |
| Twilio | SMS | Account SID + auth token + number (verified) | Approval-gated outbound SMS (live only); inbound SMS webhook with signature validation → AI intake routing | No voice/calls yet; no MMS |
| Resend | Email | API key + from address (verified, domain check) | Approval-gated outbound email (live only), plain-text | No inbound email parsing; no templates/HTML yet |
| Google Calendar | Calendar | Partner's OAuth client + Google consent | Real free/busy availability, slot proposals on scheduling requests, approval-gated event creation (live only) | No multi-calendar/worker routing, no reschedule flow yet |
| Northstar intake (webhook / web chat / forms) | Lead source | Generated endpoint + token | Token-authenticated intake, idempotency, rate limits, AI routing | Website chat widget UI not built (endpoint is real) |
| Phone / voice provider | Phone | — | Nothing — no adapter exists | Live call assistant, AI answering, transcripts |

Every outbound attempt (send/book/sync) also records a durable
`action_jobs` row with retry from Runs / Logs. Retries re-run the exact
approved payload through the same gate — approval and live-mode rules
apply on every attempt.

## Field mapping defaults

Northstar normalizes intake payloads to: `name` (split into first/last),
`email`, `phone`, `address`, `message`. Adapters map them as follows
(code of record: `lib/crm/contact-fields.ts`):

| Northstar field | HubSpot | GoHighLevel | Outbound webhook payload |
| --- | --- | --- | --- |
| first name | `firstname` | `firstName` | `data.contact.first_name` |
| last name | `lastname` | `lastName` | `data.contact.last_name` |
| email | `email` | `email` | `data.contact.email` |
| phone | `phone` | `phone` | `data.contact.phone` |
| address | `address` | `address1` | `data.contact.address` |
| AI summary note | Note object (association 202) | Contact note | `data.note` |

Mappings are additive-only: empty fields are omitted, never cleared.
Per-client custom field mapping is a future setting; these defaults are
what ships.

## Outbound webhook envelope

```json
{
  "event_type": "crm.contact_sync",
  "sent_at": "2026-07-05T18:00:00.000Z",
  "data": {
    "contact": { "first_name": "…", "last_name": "…", "email": "…", "phone": "…", "address": "…" },
    "note": "AI Assistant — Northstar …",
    "source_event_type": "lead.created",
    "client_name": "Pilot Plumbing Co"
  }
}
```

Header: `X-Northstar-Signature: base64(hmacSHA256(signing_secret, raw_body))`.
Destinations must be public HTTPS; localhost and private/link-local IP
ranges are rejected.
