# Provider capability matrix

This is the launch-facing description of what the current release can do.
The code of record for external connector capabilities is
`lib/integrations/connectors/catalog.ts`; provider-specific adapters live in
`lib/integrations/providers`.

## Verification labels

- `contract_verified`: implemented against the provider's published API and
  covered by local fixtures/contract tests. It still requires a real vendor
  account pilot before production use.
- `live_verified`: a real credential, inbound event, and outbound action have
  passed in the deployed production environment. No provider is promoted to
  this label from code tests alone.
- `restricted`: implementation depends on commercial or product approval that
  an ordinary customer account cannot supply.

## Native operating paths

| Provider/path            | What works in this release                                                                                                                                                                                                                                | Important boundary                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Built-in CRM             | Contacts, leads, pipeline, inbox/drafts, calls, notes, tasks, appointments, quotes, marketing, reports, permissions, automation health                                                                                                                    | Native data replaces an outside CRM/calendar requirement only when the client selects the built-in operating mode                                   |
| Managed Twilio           | Partner parent-account validation; client subaccount/number provisioning; signed inbound SMS and voice; approval-gated SMS; full-duplex OpenAI Realtime answering with barge-in and Gather failover; authorized one-click CRM callbacks for lead follow-up, reschedule, and reminders; playback-aware AI hangup; staff forwarding; Media Streams transcription; caller matching; post-call CRM/workflow actions | AI answering, callbacks, and the live staff coach require the always-on voice-stream service; real callbacks require a live connection and an authorized non-spoofed client user; staff popups also require the desktop app |
| Northstar web chat       | Hosted page and iframe; approved-knowledge answers; contact/service capture; rate limits; completed-conversation intake; CRM/workflow/approval routing                                                                                                    | The public widget key starts chat sessions only; customer-facing actions remain approval-gated                                                      |
| Generic inbound webhook  | Generated token, idempotency, normalized event intake, AI routing, redacted event history                                                                                                                                                                 | The sender must map its payload to the documented event envelope                                                                                    |
| Generic outbound webhook | Public-HTTPS validation, private-network blocking, HMAC signing, additive contact/AI-note sync, retries                                                                                                                                                   | The receiver must verify the signature and map the payload; no remote reads                                                                         |
| Resend                   | Verified sending-domain connection, approval-gated email, private forwarded lead inbox, signed receiving webhook and parsing                                                                                                                              | HTML/template campaigns are not the V1 email path                                                                                                   |
| Google Calendar          | OAuth, free/busy, constraint-aware slot proposals, approval-gated event creation                                                                                                                                                                          | External calendar booking is create-only in V1; native CRM appointments support reschedule and cancel                                               |

## External business systems

All entries below are `contract_verified` until a production pilot proves the
real account and vendor approval path.

| Group             | Providers                                     | Implemented contract                                                                                                                         |
| ----------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| CRM               | HubSpot, GoHighLevel                          | Contact lookup/upsert and additive AI Assistant notes; dry-run previews and durable retry. No destructive writes or broad deal-stage control |
| Productivity      | Google Workspace                              | Google contacts, Gmail messages/drafts, calendar read/create/update/delete, OAuth refresh and sync jobs                                      |
| Productivity      | Microsoft 365                                 | Outlook contacts, mail, and calendar read/write through Microsoft Graph, OAuth refresh and sync jobs                                         |
| Field service     | Jobber, Housecall Pro                         | Customer read/create and job read                                                                                                            |
| Field service     | ServiceTitan                                  | Customer/job/appointment read and lead create                                                                                                |
| Field service     | Workiz                                        | Lead read/create and job read                                                                                                                |
| Accounting        | QuickBooks Online                             | Customer read/create plus invoice/payment reads                                                                                              |
| Payments          | Stripe, Square                                | Customer/invoice/payment reads, customer create, and hosted payment-link creation                                                            |
| Call attribution  | CallRail                                      | Attributed calls and form/text lead ingestion where the account exposes them                                                                 |
| Retained phone    | RingCentral, Dialpad, Quo/OpenPhone           | Signed call/message events, caller matching, CRM screen-pop events, history/transcript/summary ingestion where exposed, post-call workflows  |
| Lead and campaign | Meta Lead Ads, Google Ads                     | Lead intake or polling, campaign/spend snapshots, attribution into Marketing                                                                 |
| Reputation        | Google Business Profile, Podium               | Review reads and approval-gated reply updates where the account/API permits                                                                  |
| Reputation        | Birdeye                                       | Review and rating reads                                                                                                                      |
| Forwarded sources | Angi, Thumbtack, Yelp, form/marketplace email | Private per-client receiving address through Resend; normalized intake without a client Zapier account                                       |

Retained phone systems do not automatically gain Twilio Media Streams. They
receive live screen-pop or post-call behavior according to the events and media
their standard API exposes. Managed Twilio is the V1 path for the complete
in-call scheduling coach.

## Restricted providers

Broad Angi, Thumbtack, and Yelp lead APIs remain `restricted` until commercial
access is granted. Google Local Services lead delivery and some review/reply
operations also depend on account eligibility or product approval. The
forwarded lead inbox and signed webhooks are the supported fallbacks; the UI
must not imply that restricted APIs are available.

## Connection ownership

- The platform owner supplies hosting, database, AI, platform OAuth apps,
  Resend receiving, monitoring, and release infrastructure.
- Each partner connects its own Twilio parent account and provisions isolated
  client subaccounts.
- Each client authorizes its own CRM, calendar, email, field-service, finance,
  retained-phone, marketing, and reputation accounts through an expiring
  scoped setup link. The partner never receives the plaintext credentials.
- Northstar chat and generic webhook endpoints are created directly by the
  partner because they are platform-owned endpoints, not client vendor accounts.

## Default CRM mapping

Lead intake normalizes `name`, `email`, `phone`, `address`, and `message`.
HubSpot maps names to `firstname`/`lastname`; GoHighLevel maps them to
`firstName`/`lastName`; the signed webhook uses
`data.contact.first_name`/`last_name`. Empty fields are omitted and never clear
existing provider data. Partner owners, admins, and implementers can add
per-client pull, push, or bidirectional mappings from each connection page.
Mappings support nested API paths, required/default values, and bounded
normalization transforms. Connector-owned identifiers and idempotency fields
cannot be overridden by a custom mapping.
