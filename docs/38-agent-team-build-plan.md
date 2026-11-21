# Agent team build plan

**Current product task order — November 5, 2026:** use the [complete product roadmap](44-nightly-launch-roadmap.md). Hosting and Google are one foundation package. Agents, manager controls, business workflows, observation/improvement and mobile delivery are core work packages in that plan. The sequence below is historical wherever it conflicts with document 44.

Started October 3, 2026. Build the Symphony-style operating team inside the existing application. Agents share business records, own persistent work, delegate, wait for approvals, and verify outcomes. The owner can use the phone view without maintaining the CRM. This is an implementation plan, not a claim of completed capability.

## Current direction — October 7, 2026

One company, two offers, with the job search continuing in parallel. This section and the revised sequence below supersede the earlier universal-department rollout. This update records the user's direction and recommended build order; it does not implement or deploy new features.

- **Packaged solo-business app:** reusable, easily activated assistance for owners who do the work themselves. Prioritize inquiries, lead follow-up, scheduling, reminders, review/rebooking requests, and routine administration. Chat is one entry point; background work must continue between conversations. Owners can use phone approvals and app links while agents maintain shared customer records. Existing software is optional, not a reason to exclude a customer.
- **Custom "Agents Built In" implementation:** study a client's actual workflows through interviews, data, and exceptions; remove unnecessary steps, use ordinary automation where sufficient, and build bounded agents where useful. Implement inside the client's existing programs. Scope is determined by discovery, not a prepackaged sales/purchasing hierarchy or a larger app subscription. Reuse this repository's integrations, approvals, execution, and monitoring where appropriate; a client portal or replacement CRM is not required.
- **Career evidence:** continue pursuing AI implementation roles alongside delivery. Demonstrable workflows and measured results can support both offers and the job search. A sales workflow informed by the user's Direct Supply experience is a candidate custom example; its exact workflow and systems are not yet selected.
- **Deferred expansion:** new partner/platform-owner CRMs, reseller packaging, white-label commercialization, and universal industry coverage. Purchasing and marketplace sourcing are optional specialist work for relevant reseller clients, not a core app requirement. Voice is optional. Preserve existing working code and tenant protections.

The distinction is repeatable setup versus custom process engineering, not an employee-count threshold. Both offers may share software without becoming the same product experience. The earlier agency pricing in document 33 remains historical and does not set direct-client or custom-engagement pricing.

## Current position

**October 8 update:** the existing app now includes the shared customer team: persistent cross-channel conversations, isolated/verified CRM identity, sales/service/scheduling responsibilities, coordinator delegation to marketing and administration, guarded booking and delivery, and owner takeover and phone approvals. Website, Twilio SMS, Resend receiving, and Instagram have explicit channel paths. See [Shared customer team](39-shared-customer-team.md) for the current capability boundaries, setup, and fresh verification evidence.

Local unit, database, signed-webhook, and browser flows have been verified. Model decisions used explicit test fixtures because no model key was configured. Live external delivery, provider authorization, hosted migration/deployment, and hosted workers still require verification. The October 3 evidence and limitations below describe the first increment; document 39 supersedes them where the new increment is implemented. This remains a supervised implementation, not a certified production release or a completed custom-client engagement.

## First increment implemented locally

Build the durable team foundation and connect two business departments to it.

- Agent definitions for the executive coordinator, sales manager/follow-up specialist, and operations manager/purchasing specialist. Explicit instructions, tools, dependencies, and limits.
- Persistent work with parent/child assignments, ownership, source records, status, deadlines, attempts, result evidence, and an event history.
- An opt-in manager schedule and worker that claims work safely, prevents duplicates, preserves approval waits, and recovers interrupted internal work.
- A sales manager checks actual CRM leads and delegates eligible follow-up. The specialist reads current customer/business context, creates a real AI draft, and submits it through the existing approval and delivery system. Missing AI configuration blocks the assignment explicitly.
- An operations manager checks recorded inventory and delegates replenishment. The purchasing specialist creates a scoped, deduplicated purchase proposal, requests the existing owner approval, and follows the recorded order/receipt. Supplier ordering is an explicit handoff until a provider operation is supported.
- A bounded business-request coordinator routes a request to supported department work. Unsupported requests explain the missing capability rather than inventing execution.
- An owner team/work view in the existing app exposes real assignments, approvals, outcomes, blocked reasons, review controls, and agent activation. Preserve the existing business workspace and detailed CRM.
- Replace the fictional-business shortcut in normal entry with actual workspace access. Keep isolated fixtures confined to tests and explicit development utilities.

Acceptance: a real scoped business can activate a department, run a review, see delegated assignments, review the generated action, and inspect the eventual outcome. Duplicate/concurrent reviews create one assignment; repeated approvals do not duplicate effects; another tenant cannot read or mutate it. A reply, closed lead, changed stock, rejected approval, unavailable model, paused team, provider failure, and interruption remain honest and recoverable states.

### Current implementation and evidence

The first increment now exists in the original application at `/client/team`. It uses `lib/agents`, the existing CRM/knowledge/provider/approval/outbox services, and the additive migration `20261003144749_agent_team_execution`. The migration is applied locally only. The normal landing page and missing-business page now lead to actual account selection instead of opening a fictional development business.

Managers delegate in one database transaction. Assignments use leases, stable request keys, immutable source snapshots, scoped references, and an activity history. Concurrent proposals lock the customer record; follow-up eligibility is rechecked before drafting, approval creation, and provider dispatch. Pausing and new customer activity stop unsent agent messages. A manager continues observing blocked children and notices recovery. Approval, provider acceptance, supplier ordering, and receiving are separate states.

The simple phone view uses the existing approval forms for agent-generated messages and purchases. It also displays blocked work and work awaiting external progress, with links to the relevant assignment or purchase. Team configuration and the detailed assignment list remain optional views.

Verified locally: TypeScript and ESLint; 291 unit tests; `scripts/verify-agent-team.ts` covering tenant isolation, direct-write/RPC denial, deduplication, competing claims, lease recovery, atomic delegation rollback, cancellation, CRM-derived assignments, missing-model behavior, linked approval/outbox creation, reply/pause/opt-out guards, concurrent customer proposals, purchase approval/order/receipt, manager completion, and concurrent schedule ticks. The script creates isolated local fixtures and removes them. Test draft content and simulated provider outcomes are explicitly test fixtures, not evidence of live model generation or delivery.

Browser verification covers team settings → API → persisted assignment → background processing → recorded completion, as well as desktop and 390px phone layouts. The mobile attention surface shares the same persisted work. New API responses omit private lease tokens and model input. The local Supabase security advisor reported no findings for the new objects; it still reports the existing mutable `search_path` on `public.set_updated_at`.

### Running and limits

Use `npm run prototype` for the local app and background worker, then open `/client/team`. Enable only the departments you need and save settings. Direct reviews enter the queue immediately; the local worker checks it approximately once per minute. Optional reviews recur hourly. Hosted execution uses the existing authenticated `/api/jobs/run` scheduler; this does not provision a hosted schedule.

Run `npm run verify:agents` against the local test database. No live customer messages, supplier orders, or paid model calls occur in this verification.

At the October 3 verification, the local environment lacked the existing AI provider configuration, so request planning and generated follow-up were connected in code but had not been verified against a live model. Rules-based sales review, inventory proposals, persistent delegation, approvals, and outcome tracking ran locally. External sending remains subject to configured connections, approval, and live-mode gates. Document 36 recorded a suspended hosted database at that time; recheck its current state before deployment work.

This is a bounded foundation, not the complete operating team or a production-ready release. Reviews create up to 20 new assignments each; inventory review stops if it reaches 1,000 records rather than calculating from an incomplete set. Follow-up is limited to one assignment per lead revision. The team list shows the 100 most recently updated assignments. There is no general autonomous tool loop, event-driven conversation team, complete consent engine, autonomous sourcing/negotiation, automatic supplier ordering, campaign publication, or phone push delivery in this increment. Those remain explicit work in the sequence below.

## Next increments

The following is the recommended sequence for the new direction. Build in the existing project; do not create another app or replace working journeys with new interface-only work.

1. **Recheck and enable the existing runtime.** Establish the actual local/hosted state of the model provider, database migrations, worker/scheduler, and supported channel/calendar connections. Resolve configuration or deployment gaps. Record live provider evidence separately from simulations and local tests.
2. **Finish guided activation.** Extend the existing business description and recommendations with saved, operation-specific connection steps, business hours/services/rules, approval settings, and test results. Show "active" only after the required operations work. Support direct onboarding by the founder without requiring a new agency CRM.
3. **Complete one solo-business customer journey.** Recommended first slice: an appointment-based service business. Inquiry → shared customer record → useful response → qualification/follow-up → availability → booking proposal → owner approval where required → confirmed booking → reminder → post-appointment review/rebooking. Reuse existing handlers rather than assume these steps are absent. Join inbound events and scheduled work to persistent assignments, prove external actions, and retain human takeover, consent, identity checks, and reply/opt-out stops. Begin with supported website/email/SMS/calendar paths; social DMs require their own adapters and verification.
4. **Finish the daily phone experience.** Build on the current Needs you / Apps / Recent view. Add installable mobile behavior and reliable push notifications with an appropriate fallback, expiry/escalation for decisions, useful summaries, and visible pause/error recovery. The owner must be able to supervise supported work without maintaining CRM screens.
5. **Prove a supervised launch.** Complete and verify real-client provisioning/login, permission boundaries, monitoring, retries and uncertain-outcome reconciliation, backups/recovery, usage/cost limits, support, and the chosen charging arrangement. Operate a real pilot through normal and failure cases before describing the app as ready for other customers. This is a verification checklist, not a claim that all these foundations are missing.
6. **Expand proven packages.** Add the next outcome based on pilot needs: eligible customer reactivation, review/referral work, campaign delivery, another conversation channel, or invoice follow-up. Connect approved work to real delivery and results. Broad marketing publishing, reseller sourcing/purchasing, advanced operations, and new industry types remain later modules rather than blockers for the initial solo app.

### Custom implementation track, alongside the app

Start with a specific workflow, potentially one drawn from the user's Direct Supply experience. Map inputs, tools, people, handoffs, exceptions, and baseline effort; decide which steps to remove, automate conventionally, assist with AI, or retain for human judgment. Define the client's completion criteria before building.

Implement the smallest useful improvement inside the existing systems, using shared infrastructure only where it fits. When a client already has a CRM or accounting system, preserve that system's authority; keep linked context and execution history in our system rather than creating competing records. Complete the particular read/write operations, permissions, and reconciliation required by the workflow. Existing connector entries do not establish full support for an external product.

Validate with the client, measure time/quality changes against the baseline, document operation and recovery, and maintain the deployment. Reuse connectors and repeatable patterns in later engagements. Do not build a universal enterprise agent catalog or require a new customer-facing dashboard before taking on this work.

### Pilot exit evidence

- An actual business can finish setup, reconnect a failed connection, and activate a tested capability without a fictional business or a developer editing its records.
- A supported customer journey completes through real providers, with one coherent record/history and verified booking/message outcomes. Draft, approval, provider acceptance, delivery, and completion remain distinct.
- Replies, opt-outs, human takeover, duplicate events/approvals, expired decisions, unavailable booking capacity, and provider failures produce safe and recoverable results.
- The owner receives required decisions on a phone; work resumes correctly after approval, pause, or interruption, with attributable costs and usable support evidence.
- A custom engagement has its own discovered scope and measured acceptance criteria. App pilot success does not certify arbitrary enterprise deployments.

## Engineering decisions

Reuse the existing model provider, permissions, CRM, knowledge, workflow services, approval queue, action outbox, and scheduler. Agent roles do not each require a separate model or continuously running model session. Use rules for eligibility, arithmetic, and transaction state; models for interpretation, planning, and drafting.

Every assignment has a concrete goal and observable completion criteria. Distinguish a draft, approval, provider acceptance, actual delivery, physical receipt, and completion. Do not promote records merely because an agent says it succeeded. Provider-facing effects continue through checked existing services; uncertain external outcomes are reconciled before retrying.

Worker and server operations derive tenant scope from trusted identity or persisted assignments. Agent instructions and customer messages do not grant permissions. Model-produced plans select from supported actions and are validated against current business records before execution.

## Verification and reporting

Use focused unit checks for eligibility, stop conditions, and outcome mapping; local database tests for persistence, parent/child scope, claims, retry safety, RLS, and concurrent approval linking; browser checks for actual-business entry and the team view. Run TypeScript, relevant lint, and the existing test suite after the increment.

Do not seed a fictional business into normal onboarding or send external messages during automated checks. Isolated test records must be removed. Report model/provider tests separately from database and simulated-execution checks. Hosted deployment and live model validation require the corresponding configured services; missing credentials do not justify fabricating an AI result.
