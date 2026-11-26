# Shared customer team

Implemented and checked locally October 8, 2026, inside the existing application. This document is the current implementation record; documents 34–38 preserve the vision and earlier increments. Local verification does not establish hosted or live-provider readiness.

## What the owner gets

- **Team** (`/client/team`): activate useful departments, assign a business request, and see assignments, approval waits, results, and problems.
- **Business manager chat** (`/client/manager`): ask questions about recent saved leads, appointments, approvals, app connections, and assignments, or request a supported department review. Messages reuse durable business-request work items, and delegated work appears beneath the manager reply. The chat is linked from desktop navigation, Team, and the simple phone view. It requires the team to be active. Without an AI provider, a recorded-status reply and explicit standard reviews still work; open-ended answers state the limitation. It does not perform unconnected actions or bypass approvals.
- **Conversations** (`/client/conversations`): see the same customer work the agents use, take over, prepare a reply, or return a conversation to the team.
- **Phone view** (`/client/mobile`): existing approvals, work needing attention, and links to connected apps. A full CRM session is optional.
- **Shared business records**: customer contacts, leads, messages, appointments, tasks, campaigns, inventory and purchases, plus durable assignments and their evidence. The existing CRM remains available.

There is one team behind the channels. A separate Instagram employee, text employee, and website employee is unnecessary. Channel adapters receive and deliver messages; sales, service, and scheduling responsibilities use the same scoped business data. A coordinator routes supported work and tracks its children. It cannot invent a tool or complete an unsupported request by saying it did.

## Scheduling handoff — October 8 follow-up

Inquiry and customer care now keep ownership of the customer conversation while a **separate durable scheduling assignment** handles booking. Both customer-facing roles can call the same availability service. They pass a structured assignment rather than starting another customer chat or asking the customer to repeat their request.

The assignment contains the verified customer and lead, the conversation revision, the sent availability offer, selected slot, source calendar connection, timezone, service recorded on the lead, request summary, and originating role. The database checks the lease, tenant, identity, offer, and selection before creating one child assignment. Scheduling rechecks availability, creates the booking approval, and follows the existing calendar action and confirmation delivery. The originating assistant waits for that result without another model call. The existing Team view shows parent/child work, and Conversations shows the current next action and internal handoff event.

A vague “yes” cannot choose a slot, even if the model outputs an index. A clear option number, ordinal, or uniquely matching offered clock time is required; otherwise the assistant prepares a clarification. Options are not reservations. A new customer message, opt-out, or owner takeover supersedes both unsent assignments. Calendar conflicts, paused scheduling, rejected approvals, and uncertain outcomes stay visible rather than producing a false confirmation. Approved external bookings remain bound to the calendar that supplied the offer. Confirmation requires a saved successful appointment receipt; the assignment completes only after confirmation delivery succeeds. Customer read status remains unknown.

This layer retains owner approval for replies, bookings, and confirmations. It does not introduce unattended messaging or change the account-connection wizard. External calendar availability checks are not a provider-side reservation or atomic hold.

## Implemented responsibilities

| Role | Can do now in code | Boundary |
| --- | --- | --- |
| Business manager | Answer from recent saved business records, interpret a request, delegate supported sales/conversation/inventory/marketing/administration reviews, track assignments, prepare a recorded-work briefing | Recent records are bounded samples; no unrestricted autonomous CEO |
| Sales manager | Find neglected open leads, delegate follow-up, track approval and delivery outcomes | Uses recorded activity; does not manufacture sales-stage progress |
| Sales assistant | Answer product/service inquiries from approved knowledge, capture explicitly supplied contact details, prepare a next step | Replies need approval; supplied identity details are not verification |
| Sales follow-up | Draft an eligible lead follow-up and track approved delivery | Stops for new activity, opt-out, closed leads, pause, or changed records |
| Customer service | Use authorized customer context to prepare replies and escalate exceptions | No invented policies, refunds, concessions, or access to another customer's records |
| Scheduling assistant | Read real availability, offer slots, propose a clear selection, follow booking, prepare confirmation after success | Booking requires verified identity, enabled scheduling, and approval; arbitrary calendar requests are unsupported |
| Marketing specialist | Prepare a campaign from business facts and the owner's goal, save it, track review | Publication is an explicit owner handoff; no automatic ads or social posting |
| Operations & administration | Save a review of real open jobs, tasks, unassigned work, and upcoming appointments | Reports recorded state; no accounting, payroll, or arbitrary external process execution |
| Operations manager | Review stock and existing purchase work, delegate eligible shortages | Optional inventory module |
| Purchasing specialist | Calculate replenishment, prepare a purchase proposal, track approval and recorded order/receipt | Supplier ordering is manual; no marketplace research, negotiation, or buying |

Some responsibilities use rules and database transactions rather than a model. AI is used for interpretation and drafting. Roles share infrastructure; they are not ten continuously running model sessions.

## Customer journey and channel support

Inbound message → durable conversation and isolated CRM record → assigned sales/service/scheduling work → current knowledge and authorized customer history → proposed response or booking → owner approval → checked delivery/calendar operation → recorded outcome and next action.

| Channel | Implemented | Verification and activation limits |
| --- | --- | --- |
| Website chat | Session-scoped intake, durable history, approved reply polling, refresh recovery | Verified through the browser and database; shared mode requires the conversation team to be enabled |
| Text messages | Signed Twilio intake, correct account/phone routing, deduplication, shared conversation work, existing approved SMS executor | Signed local HTTP tests passed; a real Twilio connection and live sending check remain necessary |
| Email | Signed Resend receiving webhook and Google/Microsoft new-inbox polling enter durable intake; approved email executor is bound to the original connection | Real receiving domain/account and workspace OAuth verification are pending; workspace inbox polling is not instant push delivery |
| Instagram | Signed intake, verification challenge, account routing, deduplication, bounded text reply adapter, source-time reply-window check | Signed local HTTP tests passed. Operator-assisted Meta authorization, required permissions/app review, and live account verification are still needed; this is not a completed one-click OAuth flow |

Existing voice and other integration capabilities remain separate. Their presence in the catalog does not establish participation in this shared conversation path.

### Customer identity and context

A new channel/thread gets an isolated CRM contact and lead. Agents can collect explicitly supplied details but **do not merge records because somebody types an email, name, or phone number**. The owner can link a conversation to a scoped existing contact with a recorded reason. Linked, verified conversations can then use that customer's shared history. Public website responses never expose drafts, internal notes, or another thread's history.

New activity invalidates obsolete unsent proposals, including linked conversations. Human takeover stops agent replies; a human-authored draft also establishes takeover. Resume is explicit. Opt-outs and provider reply windows are checked again before sending.

## Execution and safety boundaries

- Model output selects validated actions; it does not bypass permissions or write directly to external tools.
- Tenant-scoped database functions persist ingestion, delegation, proposals, approvals, and result links atomically. Browser roles cannot call the service-only execution functions or write the conversation tables directly.
- Stable provider event IDs prevent duplicate intake. Leases and record revisions protect worker execution; older drafts are cancelled when the context changes.
- Approval, provider acceptance, read status, confirmed booking, and physical receipt are distinct. A timed-out external send is uncertain and requires reconciliation, rather than being blindly retried.
- Booking options come from configured internal availability or the existing supported calendar adapters. A selected time must match previously sent options. Confirmation is prepared only after the calendar executor succeeds.
- Unknown or unsupported actions stop with a visible explanation. Missing model configuration blocks generated work; no fabricated AI reply is substituted.
- All new outbound conversation replies currently require owner approval. This is supervised automation, not a configurable unattended-response policy.

## Activation and operation

1. Apply the repository migrations through `20261008160728_conversation_booking_handoff` to the intended environment. These migrations were applied **locally only** during these builds.
2. Configure the existing Supabase environment, encrypted credential store (`SECRETS_ENCRYPTION_KEY`), `ANTHROPIC_API_KEY`, and the desired `AI_MODEL`. Do not put credentials in chat or documentation.
3. Use a real business workspace. Supply its services, hours, and approved knowledge. Connect the channels and calendar it actually needs through the existing connection setup.
4. In Team, enable customer conversations and the applicable departments, then activate the team. Scheduling must be separately enabled; built-in availability must be configured before it can offer slots. Purchasing remains optional.
5. For local work, `npm run prototype` runs the app at `http://localhost:3210` and its internal worker. Hosted operation must configure the existing authenticated `/api/jobs/run` scheduler and queue processing. Running the local launcher does not provision a hosted worker.
6. Verify one real inbound inquiry, a response approval, an external delivery, and a calendar booking with the business's accounts before enabling customer traffic. Exercise takeover, rejection, changed availability, and failed connections as well.

For Resend receiving, configure the connection's receiving address and webhook secret, then use the callback shown by setup. For Instagram, setup stores the authorized account ID, access token, app secret, verification token, and explicit supported API version in the existing encrypted store; complete the provider subscription/authorization steps. Provider account authorization cannot be created from local test credentials.

## Verification evidence

The following checks use temporary, isolated local records and remove them afterward. They do not send customer messages or invoke a paid model. Model decisions in the conversation integration script are explicitly injected test fixtures, not evidence of live AI generation.

```sh
npm run typecheck
npm run lint
npm run build
npm test
npm run verify:agents
npm run verify:conversations
# Requires the local app running, default localhost:3210:
npm run verify:conversation-webhooks
```

- 297 unit tests passed, including slot-choice ambiguity, channel signature, reply-window, and authoritative-action guards.
- Type checking, lint, and the optimized Next.js production build passed.
- Agent-team database verification covers tenant isolation, claims, delegation, approval/outbox outcomes, and stopping stale work.
- Conversation database verification covers concurrent deduplication, isolated CRM creation, RLS, missing-model behavior, fixture model decisions, owner approval, actual website outbox delivery, stale-action cancellation, takeover, verified shared history, real internal availability, approved booking, confirmation deduplication, opt-out, campaign review, and administration briefs.
- The scheduling follow-up additionally verifies durable parent/child delegation, replay and browser-role denial, ambiguous-choice clarification, a paused specialist, cancellation of both assignments, a competing calendar appointment, rejection of premature confirmation, original-thread confirmation delivery, and parent completion without another model call.
- Signed HTTP tests verify Twilio and Instagram intake, invalid-signature rejection, wrong-number rejection, verification challenge, duplicate provider events, original timestamps, and paused-team intake.
- Browser verification completed website inquiry → owner inbox/CRM → human takeover/reply → phone approval → customer-visible reply, including refresh recovery. Temporary records were removed; no fictional business was added to normal onboarding.
- Local Supabase security advisors reported no new findings. The existing `public.set_updated_at` mutable `search_path` warning remains.

Browser evidence uses clearly identified verification content, not a deployed customer's data:

- [Phone approval](assets/shared-customer-team/mobile-approved.png)
- [Customer receives the approved reply](assets/shared-customer-team/customer-reply.png)

## What is still needed before a live launch

At verification time, the local environment had no AI provider key. Live model quality, actual channel delivery, external-calendar booking, Meta account authorization, hosted migrations/deployment, and scheduled hosted execution remain unverified. Configure and test those services before claiming live readiness.

The phone view is mobile web; reliable push notifications and native distribution are not implemented. Automated campaign publication, supplier ordering, autonomous sourcing, broad consent/campaign management, and arbitrary custom enterprise workflows are not implemented by this increment. Guided customer-team activation is now described in [document 40](40-agent-connection-activation.md): Google/Microsoft owner OAuth, website provisioning, selected calendar rules and new-inbox intake are implemented; Instagram/texting remain assisted setup. Live proof and the full reminder → review/rebooking lifecycle remain outstanding. Existing prototypes or catalog cards are not evidence those outcomes run end to end.

The product now has the shared team execution path rather than disconnected channel personas. A production release still requires the supervised pilot and operational evidence in document 38. Custom “Agents Built In” engagements continue to require workflow discovery and scoped implementation.

## Code map

- `lib/agents`: roles, settings, durable coordinator/department execution, schedules.
- `lib/conversations`: shared ingestion, customer context, model decisions, availability, delivery checks.
- `lib/conversations/booking.ts`: scheduling specialist and return-to-conversation outcome tracking.
- `app/api/conversations` and `components/conversations`: authenticated owner supervision.
- `app/api/widget`, `app/api/integrations/inbound`: channel intake and public website updates.
- `lib/jobs`, `lib/delivery`, `lib/crm`: reused approved execution and operational records.
- `supabase/migrations/20261008131741_shared_customer_team.sql`: scoped records, service-only transitions, approvals, and guarded booking.
- `supabase/migrations/20261008160728_conversation_booking_handoff.sql`: atomic booking handoff, specialist ownership, calendar binding, and receipt-backed confirmation.
