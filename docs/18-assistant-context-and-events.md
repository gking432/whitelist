# 18 — Assistant Context API & Live Event Contract

The programmatic surface future assistant runtimes (desktop tray app,
browser extension, CRM overlay) consume. The web consoles
(`/partner/clients/[clientId]/assistant` and `/client/assistant`) render
the same data.

## Authentication & tenancy

Both endpoints use the app session (Supabase auth cookies) — the same
sign-in as the web app. Tenancy and roles are enforced with the same
helpers as the web surfaces:

- **Partner members** pass `?client_id=<uuid>` for a client inside their
  partner org (any partner role reads; operator roles act).
- **Client members** omit `client_id` and get their own business (portal
  must be enabled). Owner/manager/staff can act; viewers read.
- Anything else: `404` without leaking whether the client exists.

Future non-browser runtimes authenticate the same way (session token);
dedicated API keys are a documented follow-up, not built.

## GET /api/assistant/context[?client_id=]

Returns `{ generated_at, context }` where `context` is the
JSON-serializable `AssistantContextData` (source of truth:
`lib/assistant/context.ts`). Shape summary:

```jsonc
{
  "mode": "live" | "preview",          // preview = labeled sample data
  "clientId": "…", "clientName": "…",
  "basePath": "/partner/clients/…" | "/client",
  "packageName": "AI Assist" | null,
  "interaction": { "channel", "channelLabel", "eventType", "receivedAt",
                   "contactName", "contactPhone", "contactEmail",
                   "contactAddress", "message" } | null,
  "routing":  { "category", "urgency", "confidence", "summary",
                "suggestedNextAction", "recommendedOwner",
                "requiresHandoff", "source": "ai"|"fallback"|"preview" } | null,
  "analysis": { "urgency", "quality", "missingFields", … } | null,
  "draft":    { "channel", "to", "subject", "body",
                "approvalId", "approvalStatus" } | null,
  "crm":      { "status", "contactId", "detail" },
  "booking":  { "approvalId", "status", "slotLabel", "alternatives" } | null,
  "slots":    [{ "label", "startIso" }], "slotsNote": "…",
  "actions":  [{ "key", "label", "state", "stateLabel", "detail",
                 "href", "enabled" }],
  "recentActivity": [{ "at", "kind", "title", "detail" }],
  "runtime":  { "requiredNow": […], "futureRuntimes": […] },
  "soldAhead": [{ "label", "note" }]
}
```

Action `state` values are the honest set: `works_now`, `dry_run`,
`requires_connection`, `preview_only`, `coming_soon`, `not_in_package`.

## Live assistant events

Table `assistant_events` (append-only, service-role writes, member
reads). Event types:

`active_call_started`, `transcript_turn_added`, `lead_detected`,
`appointment_intent_detected`, `draft_ready`, `approval_needed`,
`booking_proposed`, `crm_sync_completed`, `escalation_needed`,
`call_completed`.

Emitters today: the workflow engine (lead/routing/CRM/booking/draft
events), approval resolution (booking confirmation drafts), the assistant
console (escalations), and the voice foundation (call events). Rows carry
`payload` (redacted), plus optional `workflow_run_id`, `approval_id`,
`call_session_id` references.

## GET /api/assistant/events[?client_id=][&after=<iso8601>]

Polling flavor: returns `{ generated_at, events: [...] }`, newest first,
max 50, filtered to `created_at > after` when given. Poll every few
seconds and keep the last `generated_at` as the next `after` cursor.

SSE/WebSocket push is the documented next step; the table and the event
contract do not change for it — only the transport.

## What the web console shows today

The console merges the latest events into its "Recent assistant activity"
list (kind `assistant_event`). A dedicated live-event stream panel comes
with the push transport.
