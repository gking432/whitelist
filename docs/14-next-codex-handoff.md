# 14 — Next Codex Handoff

> Archived historical handoff. It describes the repository before the voice,
> desktop, connector, support, package-deployment, and production-hardening
> work. Use docs/17, docs/24, and docs/25 for current state.

Use this document to restart the work from another Codex chat without needing the full conversation history.

## Current Repo State

Repository:

```text
/Users/gkn/partner-platform
```

GitHub repo:

```text
gking432/whitelist
```

Active branch:

```text
claude/whitelist-mvp-impl-25akg4
```

Most recent known pushed commit when this handoff was written:

```text
c23a647 Grant package table privileges
```

There may be one local dirty file after running Next locally:

```text
next-env.d.ts
```

That is dev-server noise caused by Next changing the generated route type import. Do not treat it as product work unless intentionally updating Next config/types.

## Product Name And Direction

The product/company name is:

```text
Northstar
```

Northstar is a white-label AI operations platform for partners/agencies who sell automation, AI phone, scheduling, messaging, CRM sync, and workflow management to home-service businesses.

The product is not only a CRM, but it may include a built-in CRM mode for clients who do not already have a good operating stack.

The core layers are:

```text
Platform Owner → Partner / Agency → Client Business → Homeowner
```

Homeowners never log into Northstar. They interact with the client business through phone, SMS, email, forms, chat, booking links, etc.

## Most Important Docs

Read these first:

```text
docs/12-end-goal.md
docs/11-fable5-ai-voice-scheduling-handoff.md
docs/13-real-world-pilot-test-plan.md
```

Then skim:

```text
docs/02-architecture.md
docs/03-data-model.md
docs/05-integrations-workflows-ai.md
docs/08-acceptance-verification.md
```

The older docs are still useful, but `docs/12-end-goal.md` is the product compass when direction conflicts.

## What Has Been Built

The app now has:

```text
Partner dashboard
Client list and client detail workspace
Client setup flow
Partner package builder
Package-driven client setup checklist
Lead source setup wizard
Integration connection foundation
Generic secured inbound intake endpoint
Northstar web chat intake provider foundation
AI intake routing workflow foundation
HubSpot pilot adapter
Twilio SMS pilot adapter
Google Calendar OAuth pilot adapter
Approval-gated SMS delivery path
HubSpot contact/note sync from workflow runs
Client portal/approval/activity surfaces
Northstar visual redesign
Local dev auto-login
```

The confusing `Pilot Stack` tab was removed as a partner-facing concept. Pilot providers now appear as normal required integration cards during setup based on the selected package.

## What Was Recently Fixed

The package builder initially failed with:

```text
The starter packages could not be created.
```

Cause:

```text
partner_packages had RLS policies but was missing table grants for authenticated users.
```

Fix:

```text
supabase/migrations/20260705100000_partner_packages.sql
```

Added:

```sql
grant select, insert, update, delete on public.partner_packages to authenticated;
grant update (package_id) on public.client_businesses to authenticated;
```

This fix was pushed in commit:

```text
c23a647 Grant package table privileges
```

## Local Setup Notes

Local app usually runs at:

```text
http://localhost:3000
```

Local Supabase usually runs at:

```text
http://127.0.0.1:54321
```

If a new migration has been pulled but local Supabase migration tracking is drifted, applying only the new migration through Docker has been used successfully:

```bash
docker exec -i supabase_db_partner-platform psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/<migration>.sql
```

Local partner user:

```text
partner@northstar.test
```

Local password:

```text
local-password-change-me
```

Local auto-login exists and redirects unauthenticated local `/partner` and `/client` requests through:

```text
/dev/auto-login
```

## Current Testing Plan

The plan was going to be:

```text
1. Go to Packages.
2. Create starter packages.
3. Add a brand-new fake client business.
4. Choose a package.
5. Follow the setup checklist.
6. Create/connect real HubSpot, Twilio, and Google accounts.
7. Run docs/13 real-world pilot test.
8. Debug.
```

But before doing the full real-world provider test, there is an important product gap:

```text
The staff/end-user popup UI has not been built yet.
```

Without that UI, the backend/provider loop can be tested, but the actual user experience cannot be proven.

## Product Decision: Build Staff Assistant UI Before Full Integration Testing

The next recommended milestone is:

```text
Build a simple Staff Assistant Console / popup prototype before doing the full real-world pilot.
```

Reason:

Northstar's largest packages are not just backend automations. The client business staff need to experience AI help while working.

The important staff-facing experiences include:

```text
Live call assistant popup
Live scheduling assistant popup
Known-customer context popup
Draft assistant popup
CRM change approval popup
Handoff / escalation popup
AI activity visibility
```

Some of these may eventually require:

```text
browser extension
desktop tray app
CRM-native app/extension
web app popup
website widget
```

But do not build all runtimes now.

The immediate version should be a web-app prototype that proves the interaction model.

## Recommended Next Build

Build a first version of:

```text
Staff Assistant Console
```

It should be accessible from a client workspace and act like the future popup.

Suggested route:

```text
/partner/clients/[clientId]/assistant
```

or, if client-staff facing:

```text
/client/assistant
```

It should show fake/live-ready assistant panels for:

```text
Active customer interaction
Customer match
AI intake classification
Urgency
Missing fields
Suggested next question
Draft SMS/email
Suggested appointment slots
CRM sync status
Action buttons
Audit/activity trail
```

Action buttons should include:

```text
Send SMS
Send email
Book appointment
Add CRM note
Sync to CRM
Create task
Escalate
Copy fallback
```

If the action is not wired yet, label it honestly:

```text
Preview only
Requires Twilio live
Requires calendar booking workflow
Requires CRM connection
Coming soon
```

This UI does not need to be a real browser extension or desktop app yet. It should be a realistic web prototype that can later be moved into an overlay/runtime.

## Why This Comes Before Full Real-World Testing

The provider test proves:

```text
Can Northstar receive a lead, route it, sync HubSpot, and send SMS?
```

The staff assistant UI proves:

```text
Can a real employee understand and use Northstar during work?
```

Both matter. The backend loop alone is not enough to know whether the product works.

The next sensible order is:

```text
1. Build minimal Staff Assistant Console / popup prototype.
2. Then create a new fake business.
3. Then create real HubSpot/Twilio/Google accounts.
4. Then onboard that fake business from scratch.
5. Then run docs/13.
6. Then debug both backend behavior and staff-facing UX.
```

## Package-Driven Setup Direction

Partners need to create packages like:

```text
Basic Automation
AI Assist
Full AI Operations
Custom
```

Each package is a set of toggles.

The selected package should drive:

```text
required integrations
enabled workflow packs
AI features
approval defaults
staff runtime requirements
setup checklist
usage/billing expectations later
```

The app now has a package builder and package-driven setup. Continue building from that model.

Do not bring back a separate partner-facing `Pilot Stack` concept.

## Real-World Pilot Scope

The first real-world stack is intentionally small:

```text
HubSpot CRM
Twilio SMS
Google Calendar
Northstar intake
Anthropic/OpenAI fallback AI layer
```

Do not add more CRMs/providers until this one loop feels understandable and works end to end.

Current honest limits:

```text
HubSpot sync is additive contact/note only.
Twilio sends SMS only after human approval and only in live mode.
Google Calendar can connect/check availability and has event-creation adapter, but automatic booking workflow is not fully wired.
Email delivery is not wired.
Voice/live call provider is not wired.
Website chat widget is not built.
Staff popup UI is not built yet.
```

## AI/API Key Decision

Default product direction:

```text
Northstar-owned AI keys by default.
```

Meaning Northstar uses its own OpenAI/Anthropic keys and charges partners/clients through package pricing and/or usage.

Future option:

```text
BYOK / partner-owned AI keys for larger partners.
```

Provider APIs like HubSpot, Twilio, Google Calendar, Gmail, etc. should usually be the client or partner's own accounts, connected per client.

AI usage should eventually be tracked per:

```text
partner
client
workflow
assistant action
model/provider
```

## Database Architecture

Use one shared multi-tenant database.

Data is separated by:

```text
partner_id
client_id
membership roles
RLS policies
```

Conceptual shape:

```text
Northstar database
├── Platform owner data
├── Partner A
│   ├── Client 1
│   ├── Client 2
│   └── Client 3
└── Partner B
    ├── Client 4
    └── Client 5
```

Do not create a separate database per partner/client for the current product stage.

## Prompt For Fable / Next Builder

Use this as the next focused prompt:

```text
Pull the latest branch.

Read:
- docs/12-end-goal.md
- docs/11-fable5-ai-voice-scheduling-handoff.md
- docs/13-real-world-pilot-test-plan.md
- docs/14-next-codex-handoff.md

Before we run the full real-world HubSpot/Twilio/Google test, build the first staff-facing assistant UI prototype.

Goal:
Create a Staff Assistant Console that represents the future popup experience client staff will use while handling calls, chats, emails, scheduling, and CRM updates.

This should not be a desktop app or browser extension yet. Build it as a web-app prototype inside the current app, but design it so it can later become a popup/extension/desktop tray experience.

It should show:
- active customer interaction
- customer match
- AI intake classification
- urgency
- missing fields
- suggested next question
- draft SMS/email
- suggested appointment slots
- CRM sync status
- activity/audit trail
- action buttons

Action buttons:
- send SMS
- send email
- book appointment
- add CRM note
- sync to CRM
- create task
- escalate
- copy fallback

Use honest states:
- works now
- dry run
- requires connection
- preview only
- coming soon

Tie it into the package/setup model:
- only show features relevant to the selected package
- show staff runtime requirements
- show when a feature needs Twilio, CRM, calendar, phone provider, web chat, or future extension/runtime

Do not add more CRMs/providers yet.
Do not build full desktop/browser extension yet.
Do not overbuild.

After this, we will create a fresh fake company and run the real-world pilot test from docs/13.

Run lint, typecheck, and build.
```

## User Preferences / Collaboration Notes

The user prefers very clear, short explanations.

Avoid long walls of prose in chat unless asked.

Use plain language over architecture jargon.

When explaining flows, say exactly what the partner clicks and what happens.

The user is thinking out loud often. Capture important product ideas in docs before they get lost.

When testing, prefer real-world proof over only simulated demos, but do not skip UX proof. The staff popup/assistant UI matters.
