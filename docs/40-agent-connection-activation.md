# Owner setup and shared app connections

Implemented in the existing client product at `/client/activate`. This is the packaged customer-team setup, not the custom enterprise consulting workflow or a separate partner CRM. It creates no sample business or customer records during onboarding.

## Owner flow

1. Choose inquiry/customer-care help, appointment help, and customer channels. Booking setup confirms weekdays, hours, appointment length and timezone; service businesses receive a booking suggestion from their saved business details.
2. Save and enable. The server prepares a reusable hosted chat link/embed, configures the existing team, and selects the business's shared account. Replies and bookings remain subject to owner approval.
3. For Google or Microsoft, click Connect, sign in and approve, then return directly to setup. The server stores encrypted authorization, checks inbox and calendar access separately, starts the existing connector sync, and activates the selected connection. There is no second per-agent account or field-mapping form.
4. Review readiness or open the mobile approvals view. Pause stops the team and managed connections; changed settings cannot be overwritten by a stale OAuth callback.

The workspace authorization currently requests the existing email, calendar and contacts permission bundle. It is disclosed in setup. One account can support both email intake and booking; contact access also supports the existing shared-record connector. Reconnecting a different account is rejected so existing approvals cannot silently switch sender/calendar. Account replacement needs an explicit migration flow.

## Implemented behavior and boundaries

| Connection | Implemented | Still required |
|---|---|---|
| Google Workspace / Gmail | Owner OAuth with signed state, PKCE, one-use browser-bound attempt, permission checks, mailbox/calendar read probes, encrypted refresh credentials, approved email send, new-inbox intake, recurring sync | Platform OAuth registration/configuration, provider consent/verification as applicable, actual owner authorization, live delivery and booking proof |
| Microsoft 365 / Outlook | Same owner flow; new inbox bodies hydrate through Graph, including connections with older metadata-only delta cursors | Platform OAuth configuration/tenant consent, actual authorization and live proof |
| Website chat | Reuses or creates one connection and public chat key; hosted link and iframe snippet; shared CRM conversations and approved replies | Owner/site editor installs the snippet. Setup does not claim installation was detected |
| Instagram | Existing signed incoming webhook, encrypted credentials and approved outgoing adapter; selectable in setup; readiness uses actual inbound/outbound receipts | Operator-assisted account authorization, subscription and delivery test. Self-service Instagram OAuth is not implemented by this increment |
| Text messages | Existing Twilio incoming signatures, automatic number callback configuration in the provider setup, approved send adapter; selectable in setup | Operator-assisted number/account configuration, any required registration, and a delivery test. Setup does not buy numbers or claim Twilio is a consumer OAuth connection |

Email uses the existing polling connector: after its initial import, sync continuations are scheduled about every 15 minutes, plus worker latency. This is not instant push delivery. Gmail/Outlook inbox records now enter the existing encrypted inbound queue, then create/reuse the scoped conversation and CRM contact/lead and queue customer-team work. Deduplication uses the provider message ID. Only messages received after explicit email activation qualify. Turning email off and back on resets that cutoff. Historical mail, sent mail, self-mail, drafts, mailing lists, automated replies, attachments and unsupported bodies do not trigger assistant replies. They remain in the original inbox. Full bodies are fetched only for eligible new mail; older canonical metadata sync remains compatible.

Email conversations are currently grouped by authenticated provider sender within a business connection. This increment does not add Gmail/Outlook native reply threading or attachment processing. Cross-channel customer history still requires owner-confirmed identity; an email address claimed in website chat is insufficient.

Booking availability uses the selected account’s primary calendar and saved booking rules. Changing the account, hours or appointment duration invalidates an incompatible pending booking. Inquiry-only setup cannot schedule. Booking-only setup sends unrelated inquiries to owner review. There is still one customer-facing conversation during internal scheduling handoffs.

“Running” requires business knowledge, AI configuration, an active team, fresh provider checks and healthy job services; inbox monitoring also requires a successful recent sync for that business and a healthy connector worker. The page refreshes readiness automatically while open. Instagram/texting require real received and provider-receipted sent messages within 30 days. Readiness never treats a catalog entry or stored token as live delivery proof. Provider access is rechecked periodically by `/api/jobs/run`; failed checks pause that managed connection. Reauthorization restores paused sync state; only selected email/calendar streams are scheduled. A first live approved action is still needed to prove delivery with actual accounts.

## Operator setup

Apply `supabase/migrations/20261009014610_business_agent_activation.sql` after the shared-team and scheduling-handoff migrations. The new activation and transient OAuth tables are service-only, with RLS enabled. Authenticated business owners/managers use the permission-checked application API; they cannot call activation RPCs directly.

Use the existing deployment/environment setup for Supabase, `SECRETS_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, the public `APP_URL`, job scheduler and connector worker. Configure `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `MICROSOFT_OAUTH_CLIENT_ID` and `MICROSOFT_OAUTH_CLIENT_SECRET` in the deployment secret store. Register these exact paths under that public app URL:

- Google: `/api/oauth/google-workspace/callback`
- Microsoft: `/api/oauth/microsoft/callback`

Configure provider applications using their official [Google web-server OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server) and [Microsoft authorization-code documentation](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow). Inbox bodies use [Gmail message retrieval](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get) and [Microsoft message retrieval with plain-text preference](https://learn.microsoft.com/en-us/graph/api/message-get?view=graph-rest-1.0).

At implementation time, local Google/Microsoft OAuth and AI provider credentials were absent. No real account was authorized, no customer was messaged, and no external booking was made. Hosted rollout, provider application approval and live pilot verification remain outstanding.

## Verification

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run verify:activation
npm run verify:conversations
npm run verify:agents
```

Verification passed 306 unit tests, type checking, lint, production build, activation/conversation/agent database flows and signed webhook HTTP tests. Supabase advisors found no new security issues; the pre-existing `set_updated_at` search-path warning remains.

The activation integration test creates isolated local fixtures and removes them. It covers scoped setup, widget reuse, stale edits, service-only grants, cross-business credential rejection, incomplete/stale/replayed OAuth completion, encrypted credentials, new email → durable intake → shared CRM → agent work, history/duplicate filtering, pause controls, and mocked read-only provider checks. Unit tests cover actual adapter body hydration, permission subsets, MIME parsing, booking-rule changes and PKCE transport. Provider responses are fixtures, not live OAuth evidence.

Browser verification covered navigation from the existing workspace, saving email/bookings/website selections, showing missing provider configuration, pause/resume, and a 390px mobile viewport with no horizontal overflow. No browser errors were reported. The existing test business's settings were restored afterward; the temporary website connection was removed.

- [Desktop setup](assets/activation/desktop-setup.png)
- [Phone pause check](assets/activation/mobile-paused.png)
- [Setup preview](assets/activation/setup-preview.png)

Code: `lib/activation`, `/api/business/activation`, `components/business/activation-setup.tsx`, `lib/integrations/inbound/workspace-inbox.ts`, and the existing workspace provider adapters, conversations and job runner.
