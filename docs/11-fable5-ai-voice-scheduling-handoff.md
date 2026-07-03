# Fable 5 Handoff: AI Voice, Scheduling, And Workflow Automation

## Why This Exists

This project is no longer just a partner dashboard or a generic white-label automation hub.

When this document conflicts with earlier generic MVP or goal-sequence prompts, this document is the source of truth for the next implementation pass.

The product should become a white-label AI operations layer that partners/agencies can sell to home service businesses.

The special product value is:

1. AI voice.
2. AI scheduling.
3. AI workflow automation.
4. CRM/calendar/phone/email sync as required infrastructure.

The product should not be positioned as "a CRM replacement" first. Most target businesses already have a CRM. The platform should work on top of existing CRMs and operational systems, with as little day-to-day visibility into this platform as possible for the end business.

The partner/agency needs deep configuration and monitoring. The client business mostly needs confidence that everything is working, a few approval controls, and visibility into failures or approvals.

## Existing Projects

### Northstar Demo

Path:

```text
/Users/gkn/new
```

Purpose:

- Single-business Northstar AI CRM demo.
- Portfolio/proof-of-capability artifact.
- Contains the best working examples of AI voice, scheduling, call notes, lead analysis, quote prep, review analysis, automation ideas, CRM sync dry-run, and guided demo behavior.

Rules:

- Treat as read-only reference material.
- Do not modify it.
- Do not import it as a runtime dependency.
- Do not copy demo-only behavior into production.
- Do not copy Northstar-specific routes, auth assumptions, database schema, guided tour logic, or hardcoded scenarios directly.

### Partner Platform

Path:

```text
/Users/gkn/partner-platform
```

Current branch:

```text
claude/whitelist-mvp-impl-25akg4
```

Purpose:

- Production-shaped multi-tenant partner/agency platform.
- Partners manage many client businesses.
- Client businesses may keep their existing CRM.
- This app manages integrations, workflow packs, approvals, run logs, audit logs, client health, and client-level controls.

Current foundation already exists:

- tenant/auth foundation.
- partners and client businesses.
- partner dashboard.
- client workspace.
- integration connections.
- generic inbound webhook endpoint.
- workflow templates.
- client workflow instances.
- workflow run engine.
- approval queue.
- client portal.
- reports/health.
- audit logs.

Do not restart from Goal 0. Continue from the current branch and current architecture.

## Product Reframe

The product should be framed as:

```text
White-label AI operations infrastructure for home service businesses.
```

The AI layer should connect to the client's existing:

- CRM.
- phone system.
- SMS provider.
- email inbox.
- calendar.
- form sources.
- automation platforms.
- reporting stack.

The partner sells and manages the system. The home service business should mostly experience the result inside their existing tools.

## Core Product Pillars

### 1. AI Voice Layer

This is the flagship "wow" capability.

It includes these Northstar demo activities:

- AI answers inbound calls.
- AI calls new leads back quickly after form submission.
- AI listens while a human rep answers.
- AI plays a homeowner in demo/practice mode, but that should remain demo-only.
- AI recognizes known customers by phone number.
- AI handles unknown caller intake.
- AI collects name, phone, email, address, service need, urgency, project details, and appointment preferences.
- AI stores full transcript separately from the clean CRM note.
- AI writes a concise CRM-ready call summary.
- AI creates or updates the customer/lead record through CRM integration.
- AI creates tasks or workflow outputs.
- AI drafts confirmation/follow-up messages.
- AI can route failed, missed, or after-hours calls into workflow recovery.

Important product interpretation:

- "Speed to lead callback" is not a separate product pack. It is a use case of AI voice.
- The AI voice system must support inbound answering and outbound callback.
- The platform must be able to run in test/sandbox/dry-run/live modes.
- Nothing should imply real telephony exists until actual providers are connected.

### 2. AI Scheduling Layer

This is the second flagship capability.

It includes these Northstar demo activities:

- AI listens during calls and understands appointment requests.
- AI understands customer constraints such as:
  - "I work until 5."
  - "Mornings are better."
  - "Not tomorrow."
  - "Can you come today?"
- AI checks actual worker/estimator calendars.
- AI sees open slots across multiple staff members.
- AI suggests a slot that works for the customer, the company, the service type, the location, and the required appointment length.
- AI avoids unavailable slots.
- AI books the appointment only after confirmation.
- AI updates the calendar.
- AI updates the CRM.
- AI queues or sends appointment confirmation based on approval policy.
- AI schedules reminders.
- AI handles reschedule requests from call, SMS, email, or form.
- AI removes booked slots from availability.
- AI notifies the assigned estimator/worker.

Scheduling should eventually support:

- calendar provider adapters.
- worker calendars.
- territories/service areas.
- service duration rules.
- travel windows.
- urgency overrides.
- manual business rules.
- approval settings for appointment changes.

### 3. AI Workflow Automation Layer

This is the product spine.

It includes these Northstar demo activities:

- lead analysis.
- urgency scoring.
- lead quality scoring.
- missing-field detection.
- task recommendations.
- follow-up drafting.
- appointment confirmation drafting.
- appointment reminder logic.
- missed-call rescue.
- estimate follow-up.
- review risk triage.
- quote prep.
- CRM update suggestions.
- external webhook payload previews.
- integration health monitoring.
- role-based AI guardrails.

In the partner platform, workflows should be:

- tenant-scoped by partner and client.
- template-driven.
- configurable per client.
- observable through run logs.
- approval-gated where needed.
- auditable.
- safe to retry.
- able to degrade to deterministic fallback output.

### 4. CRM And Systems Integration Layer

This is not the sexy feature. It is the required plumbing.

It includes these Northstar demo activities:

- HubSpot dry-run sync.
- contact payload creation.
- deal/job payload creation.
- AI note payload creation.
- task/message payload creation.
- webhook payload previews.
- CRM sync event logs.
- dry-run/live distinction.
- connector gallery ideas.

Production direction:

- The AI voice, scheduling, and workflow layers must work on top of existing systems.
- The client business should not need to live inside this platform.
- The platform should sync the right outputs into the client's existing CRM/calendar/inbox/phone system.
- The partner platform should be the control plane, not necessarily the system of record.

## Client Business Experience

The individual home service business should not need a complex dashboard.

The client-level app should mostly show:

- Everything is working.
- Active workflows.
- Calls handled.
- Appointments booked.
- Messages waiting for approval.
- Failed integrations.
- Approval settings.
- Connected CRM/calendar/phone/email.
- Emergency pause.

Most staff should never need to log into this app. They should see the results inside their existing CRM, phone system, inbox, and calendar.

One manager/admin may log in to:

- approve messages if required.
- change approval settings.
- pause/resume workflows.
- inspect failures.
- check integration health.
- view basic ROI.

## Partner / Agency Experience

The partner needs the deeper control plane:

- all clients.
- client health.
- workflow packs enabled per client.
- integration setup.
- field mappings.
- credentials/connection status.
- approval policy settings.
- run logs.
- AI input/output snapshots.
- audit logs.
- failures and retries.
- usage/cost.
- value generated.
- billing/package tier.
- client-facing status reports.

This is where most product complexity belongs.

## Product Decisions To Preserve

### Live Call Assistant UI

The product needs a lightweight real-time UI for staff who are actively on calls.

This is not a full CRM replacement. It is an assistant layer that can appear while the user works in or beside the client's existing CRM/phone system.

For live calls, the UI should eventually show:

- live transcript or running call notes, when provider support allows.
- caller/customer match.
- extracted fields.
- missing intake fields.
- customer scheduling constraints.
- valid appointment slot suggestions.
- next-question suggestions.
- urgency or risk flags.
- CRM/calendar sync status.

The live scheduling assistant specifically requires live audio or live transcript access from the phone provider. If a provider only supports post-call recordings/transcripts, the product can still provide post-call notes and follow-up scheduling suggestions, but not the real-time popup assistant.

### AI Activity Visibility

The platform needs a simple way to show what AI assistants are doing.

Visibility can vary by role:

- staff on an active call should see real-time assistance relevant to that call.
- managers should see active AI work, recent AI actions, failures, approvals, and audit history.
- client owners may need visibility into AI changes affecting their business records.
- partners need the deepest monitoring/configuration view across all clients.

When the AI reads, updates, or suggests changes to a client/customer record, the action should be visible in logs and, where appropriate, in the connected CRM as an "AI Assistant" contribution.

### AI As A CRM Contributor

When syncing to a client's existing CRM, AI-generated notes and changes should be attributed to an "AI Assistant" actor rather than hidden as system activity.

Examples:

- AI Assistant summarized a call.
- AI Assistant extracted missing lead fields.
- AI Assistant suggested appointment slots.
- AI Assistant drafted a confirmation message.
- AI Assistant updated a safe field, if policy allows.

Most CRM changes should start as suggestions or approval-gated actions. If the assistant is allowed to make a direct change, it must leave a note and audit event explaining what changed and why.

### AI Phone Answering Disclosure Modes

AI phone answering and speed-to-lead callback should be configurable per partner/client policy.

Proposed modes:

1. Off.
2. On with explicit disclosure and opt-out: "Hi, I'm an AI scheduling assistant. I can help book your appointment, but you can press 2 at any time to speak with a human."
3. On with minimal disclosure, if legally and ethically allowed.

Product default should lean toward explicit disclosure. Before production launch, legal/compliance review should confirm whether AI disclosure is always required for target regions and call types.

### Existing Stack Mode Vs Built-In CRM Mode

The product must support two common client situations.

Some clients already have a real operating stack:

- CRM.
- phone provider.
- SMS provider.
- email provider.
- calendar.
- forms/lead sources.

For these clients, the partner platform should act as the AI operations layer on top of their existing systems. The client keeps working in their CRM/tools, while this platform connects, assists, sends/books/syncs where allowed, logs activity, and monitors health.

Other clients do not have a strong operating stack yet. For them, the platform should eventually offer a built-in CRM/client operating mode based on the useful Northstar CRM concepts. In that mode, the AI assistant can work natively against first-party leads, contacts, timeline notes, tasks, appointments, messages, and pipeline records.

Do not force every client into the built-in CRM. Keep CRM operating mode explicit:

- external CRM only.
- mirror mode.
- assist mode.
- primary CRM mode.
- webhook only.

The partner should choose the mode per client during setup.

### Popup Action Console

The best version of the staff-facing popup is not copy/paste. It is a small action console.

When integrations and permissions allow, the popup should let a user click actions such as:

- send SMS.
- send email.
- book appointment.
- sync to CRM.
- add CRM note.
- create task.
- update safe CRM fields.
- escalate to manager.

Those actions should call the connected provider APIs, then log/sync the result automatically.

Example:

1. AI drafts appointment confirmation.
2. User clicks "Send SMS."
3. Platform sends through the connected SMS provider.
4. Platform adds a CRM timeline note as "AI Assistant."
5. Platform records workflow/audit logs.
6. Popup shows "Sent and synced."

Copy-to-clipboard should exist only as a fallback when provider integrations are missing or unavailable.

### Partner Integration Setup Must Be Simple

Partner setup for a client must be extremely simple.

Target:

- a partner should be able to connect the client's CRM, phone, SMS, email, and calendar APIs in 30 minutes or less for a normal client.

The setup flow should be guided and checklist-based:

1. Add client.
2. Choose operating mode.
3. Connect CRM.
4. Connect phone provider.
5. Connect SMS/email provider.
6. Connect calendar.
7. Map basic fields.
8. Enable workflow pack.
9. Set approval/safety rules.
10. Send a test event/call/message.

Each connection should clearly show:

- connected/not connected.
- permissions granted.
- what the AI can do with that provider.
- what still needs setup.
- whether live assistance is supported.
- whether only post-call/post-event processing is supported.

If a native provider adapter is not available, the fallback should be generic webhook/API setup with clear copy/paste instructions and test buttons.

## What To Pull From Northstar

Use Northstar as a reference for product behavior and logic.

### AI Voice / Call Intelligence Reference Files

```text
/Users/gkn/new/components/calls/
/Users/gkn/new/lib/calls/
/Users/gkn/new/lib/realtime/
/Users/gkn/new/lib/ai/summarizeCall.ts
/Users/gkn/new/lib/ai/callSchemas.ts
```

Useful concepts:

- realtime voice.
- scripted fallback.
- transcript turns.
- caller/customer role handling.
- known-customer matching.
- call completion pipeline.
- CRM-ready note vs full transcript.
- extracted fields.
- confirmation draft after call.

Do not copy:

- guided demo call scripts.
- hardcoded Jordan/Gunnar scenarios.
- Northstar-specific UI behavior.
- demo-only phone frame assumptions.

### Scheduling Reference Files

```text
/Users/gkn/new/lib/integrations/calendar/internalCalendar.ts
/Users/gkn/new/components/appointments/
/Users/gkn/new/lib/communications/reminders.ts
/Users/gkn/new/components/calls/CallProvider.tsx
```

Useful concepts:

- internal availability.
- open slots.
- slot labels.
- booking/reschedule flow.
- confirmation draft.
- appointment reminders.

Production direction:

- Replace demo calendar with provider adapter interface.
- Support Google Calendar, Outlook, CRM calendars, and generic scheduling webhooks later.
- Start with a clean internal calendar abstraction if native providers are not ready.

### AI Workflow Reference Files

```text
/Users/gkn/new/lib/ai/
/Users/gkn/new/lib/ai-workflows/
/Users/gkn/new/lib/automations/
/Users/gkn/new/components/automations/
/Users/gkn/new/components/app/AutomationLibrary.tsx
```

Useful concepts:

- lead analysis.
- follow-up drafting.
- quote prep.
- manager alerts.
- CRM update suggestions.
- external webhook sync.
- automation library by business unit.
- workflow run logs.
- approval-gated customer-facing drafts.

### CRM Sync Reference Files

```text
/Users/gkn/new/lib/actions/crm.ts
/Users/gkn/new/lib/integrations/hubspot/client.ts
/Users/gkn/new/components/crm-sync/
/Users/gkn/new/app/app/crm-sync/page.tsx
```

Useful concepts:

- dry-run mode.
- live mode.
- payload preview.
- field mapping.
- sync event log.
- CRM note with AI summary.

### Quote Prep Reference Files

```text
/Users/gkn/new/lib/property/
/Users/gkn/new/lib/actions/quotes.ts
/Users/gkn/new/components/quote/
```

Useful concepts:

- property profile.
- internal ballpark quote.
- assumptions.
- inspection questions.
- confidence.
- "requires inspection before final quote" guardrail.

Quote prep is useful, but it is not the core wedge. Implement after voice/scheduling/workflow foundations.

### Review / Reputation Reference Files

```text
/Users/gkn/new/lib/ai/analyzeFeedback.ts
/Users/gkn/new/lib/ai/prompts.ts
/Users/gkn/new/lib/ai/schemas.ts
/Users/gkn/new/components/app/FeedbackAnalyzer.tsx
/Users/gkn/new/app/app/feedback/page.tsx
```

Useful concepts:

- sentiment.
- risk level.
- complaint themes.
- suggested internal action.
- suggested customer response.
- marketing quote opportunity.
- manager escalation.

Good add-on pack, but not first priority.

## Current Partner Platform Code To Upgrade

Start with:

```text
/Users/gkn/partner-platform/lib/workflows/handlers.ts
/Users/gkn/partner-platform/lib/workflows/engine.ts
/Users/gkn/partner-platform/app/api/integrations/inbound/[connectionId]/route.ts
/Users/gkn/partner-platform/app/partner/clients/[clientId]/workflows/
/Users/gkn/partner-platform/app/partner/clients/[clientId]/runs/
/Users/gkn/partner-platform/app/partner/clients/[clientId]/approvals/
/Users/gkn/partner-platform/supabase/migrations/
```

Important note:

`lib/workflows/handlers.ts` currently says handlers are rule-based and no external model calls happen. That is the right first upgrade point.

Do not destroy the fallback behavior. Add AI-backed behavior with deterministic fallback.

## Recommended Implementation Sequence

### Phase 1: AI Workflow Foundation

Goal:

Turn the current rule-based workflow engine into an AI-capable workflow engine.

Deliverables:

- `lib/ai/` or `lib/workflows/ai/` provider layer.
- prompt builders.
- Zod schemas.
- model metadata.
- deterministic fallbacks.
- redacted input/output snapshots.
- workflow run metadata showing AI vs fallback.
- `.env.example` updates.

Requirements:

- AI calls happen server-side only.
- No secrets in browser.
- No raw sensitive data in logs.
- Every output is scoped to partner_id/client_id.
- Every customer-facing draft goes to approval unless policy allows otherwise.
- Fallbacks must keep workflow runs from dying when AI is unavailable.

### Phase 2: Lead Response Pack

Goal:

Port the demo's lead intake intelligence into a real multi-tenant workflow pack.

Activities:

- new lead event analysis.
- missed-call rescue draft.
- estimate follow-up draft.
- appointment confirmation/reminder draft.
- urgency scoring.
- missing field detection.
- next-action recommendation.
- approval item creation.

Trigger examples:

- `lead.created`
- `form.submitted`
- `missed_call.created`
- `email.lead_received`
- `estimate.sent`
- `appointment.booked`

### Phase 3: Scheduling Foundation

Goal:

Create the scheduling abstraction that AI voice and workflows will use.

Deliverables:

- calendar provider interface.
- internal availability adapter.
- worker/estimator availability model.
- appointment slot query.
- booking/reschedule contract.
- conflict detection.
- appointment confirmation workflow trigger.
- calendar update events.

Do not start with every native provider. Build the interface first.

### Phase 4: Voice Foundation

Goal:

Make voice a first-class workflow input/output type.

Deliverables:

- call session model.
- transcript model.
- call summary model.
- caller match contract.
- AI voice provider abstraction.
- call completion workflow trigger.
- inbound answering contract.
- outbound callback contract.
- handoff to scheduling interface.

Do not make browser demo UI the center of the product. The product center is provider-integrated calls that create workflow outputs.

### Phase 5: CRM Sync Foundation

Goal:

Make outputs from workflows/voice/scheduling land in external CRMs.

Deliverables:

- outbound adapter interface.
- field mapping configuration.
- dry-run payload preview.
- sync event logs.
- retry/failure flow.
- initial HubSpot adapter or generic outbound webhook adapter.

CRM sync is table stakes, not a feature pack to sell by itself.

### Phase 6: Add-On Packs

After the core is real:

- quote prep pack.
- review/reputation pack.
- reports/value pack.
- campaign/weather/storm pack.
- job-cost/margin pack.

## Acceptance Criteria For The First Major Pass

Fable should not claim success until this works:

1. Partner creates or opens a client.
2. Partner creates inbound webhook integration for that client.
3. Partner enables Lead Response Pack workflow(s).
4. A valid inbound webhook event is posted.
5. Integration event is stored.
6. Workflow run is created.
7. AI or fallback analysis runs.
8. Run detail shows:
   - trigger event.
   - normalized input.
   - AI/fallback status.
   - redacted prompt/context snapshot.
   - structured output.
   - steps taken.
   - linked approval if created.
9. Customer-facing draft creates an approval item.
10. Approving/rejecting the item updates the run.
11. Client/partner dashboards reflect the health/approval/runs state.
12. No real customer message is sent.
13. No secrets are exposed.
14. Tenant boundaries remain intact.

## Verification Commands

Run:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## Copy/Paste Prompt For Fable 5

```text
You are working in /Users/gkn/partner-platform on branch claude/whitelist-mvp-impl-25akg4.

Read /Users/gkn/partner-platform/docs/11-fable5-ai-voice-scheduling-handoff.md first, then read the rest of /Users/gkn/partner-platform/docs.

Important:
- /Users/gkn/new is the Northstar demo. It is read-only reference material.
- Do not modify /Users/gkn/new.
- Do not import /Users/gkn/new as a dependency.
- Do not restart from Goal 0.
- Continue from the current partner-platform architecture.

The product is a white-label AI operations layer for partners/agencies selling to home service businesses.

The core product value is:
1. AI voice.
2. AI scheduling.
3. AI workflow automation.
4. CRM/calendar/phone/email integration as required infrastructure.

First implementation target:
Upgrade the existing workflow engine from rule-based handlers to AI-capable, production-shaped workflow packs, starting with the AI Workflow Foundation and Lead Response Pack.

Before coding:
Produce a migration map:
Northstar demo capability -> Northstar reference files -> partner-platform destination -> priority.

Then implement Phase 1 and Phase 2 from docs/11-fable5-ai-voice-scheduling-handoff.md only:
- AI Workflow Foundation.
- Lead Response Pack.

Keep customer-facing drafts approval-gated.
Store redacted AI input/output snapshots.
Label AI vs deterministic fallback output.
Use tenant-scoped workflow_runs, approval_items, integration_events, and audit_events.
Do not send real SMS/email.
Do not build guided demo behavior.
Do not build the full voice or scheduling provider integration yet, but design the contracts so those can come next.

Run:
- npm run lint
- npx tsc --noEmit
- npm run build

Final report:
1. Migration map.
2. Features implemented.
3. Files changed.
4. How to trigger each workflow through inbound webhook.
5. What partners see.
6. What client users see.
7. What remains for scheduling, voice, CRM sync, quote prep, and reputation.
```
