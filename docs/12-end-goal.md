# End Goal

## Purpose

This document is the product compass.

Use it to keep the build pointed at the actual end state, not just the next technical goal.

When this document conflicts with older generic MVP language, this document should guide product direction. Implementation docs can still define narrow engineering steps, but this file defines what the product is trying to become.

## Product Name

Working product/company name:

```text
Northstar
```

Northstar can refer to:

- the overall AI operations platform.
- the built-in CRM option.
- the internal product/company identity.

For partners and their clients, the app must support white-label branding. Partners should be able to present the system under their own brand/logo/domain where appropriate.

The existing project at `/Users/gkn/new` remains a read-only reference/demo project. Do not modify it or import it directly. It contains useful CRM, AI, call, quote, review, automation, and demo concepts that can be adapted into this platform.

## One-Sentence End State

Northstar is a white-label AI operations platform that lets partners sell AI phone, scheduling, messaging, CRM, and workflow automation to home service businesses, whether those businesses already have a CRM or need Northstar's built-in CRM.

## The Three Levels

### 1. Platform Owner

This is the owner/operator of Northstar.

The platform owner manages:

- partners/agencies.
- plans/packages.
- global workflow packs.
- provider integrations.
- system health.
- usage/cost.
- support tools.
- global audit/risk controls.

This level needs a platform admin UI later. It is not the main buyer experience.

### 2. Partner / Agency

This is the paying buyer.

The partner sells and manages AI operations for many client businesses.

The partner needs the deep control plane:

- add client businesses.
- choose each client's operating mode.
- connect CRM/phone/SMS/email/calendar/forms.
- enable workflow packs.
- configure approval rules.
- monitor AI actions.
- inspect failures.
- review logs/audit trails.
- view client health.
- report value back to clients.

The partner should be able to onboard a normal client in 30 minutes or less.

### 3. Client Business

This is the home service company served by the partner.

The client may use:

- their existing CRM/tools, with Northstar layered on top.
- Northstar's built-in CRM, if they do not already have good systems.

Most client staff should not need to live inside Northstar. They should mainly experience AI assistance through:

- their existing CRM.
- phone/SMS/email/calendar tools.
- lightweight popups.
- CRM notes/timeline updates.
- approval prompts when needed.

Managers/client owners may use a simple portal to see:

- active AI assistants.
- recent AI actions.
- approvals.
- call/message/appointment activity.
- integration health.
- emergency pause controls.

Homeowners never use this app. They only interact with the client business brand.

## Client Operating Modes

Northstar must support different client situations.

### Existing Stack Mode

For clients that already use tools like HubSpot, ServiceTitan, Jobber, GoHighLevel, OpenPhone, Twilio, Gmail, Outlook, Google Calendar, Zapier, Make, or n8n.

Northstar acts as the AI layer on top.

The client keeps using existing systems. Northstar connects, assists, sends, books, syncs, logs, and monitors.

### Built-In CRM Mode

For clients that do not have a strong CRM or operating stack.

Northstar provides the CRM directly:

- leads.
- contacts.
- pipeline.
- notes.
- tasks.
- appointments.
- messages.
- activity timeline.
- AI assistant actions.

This mode should adapt the useful concepts from the existing Northstar demo, but inside the new multi-tenant partner platform.

### Supported CRM Operating Modes

Keep these explicit per client:

- external CRM only.
- mirror mode.
- assist mode.
- primary CRM mode.
- webhook only.

## The Partner Setup Flow

The finished product should make onboarding feel simple.

A partner should be able to:

1. Log in.
2. Click Clients.
3. Click Add client.
4. Enter business info.
5. Choose operating mode.
6. Connect CRM.
7. Connect phone provider.
8. Connect SMS/email provider.
9. Connect calendar.
10. Connect forms/lead sources.
11. Map basic fields.
12. Enable workflow/AI packages.
13. Set approval and safety rules.
14. Send a test event/call/message.
15. See a working run, approval, CRM note, and dashboard update.

Target setup time:

```text
30 minutes or less for a normal client
```

Each connection should clearly show:

- connected or not connected.
- permissions granted.
- what AI can do with that provider.
- whether live assistance is supported.
- whether only post-call/post-event processing is supported.
- what setup is missing.
- test button/result.

## Partner Package Builder

Partners need to differentiate their offers.

Northstar should let each partner create reusable service packages, then apply one package to each client during setup.

Examples:

- basic automation package with no AI.
- standard package with some AI assistance.
- premium/full AI operations package.
- custom package for one-off deals.

The partner should have a package builder with plain toggles, such as:

- CRM sync.
- lead source intake.
- missed-call rescue.
- SMS/email drafting.
- approval-gated sending.
- AI intake routing.
- website AI chat assistant.
- live call assistant.
- live scheduling assistant.
- AI phone answering.
- appointment booking.
- review requests.
- quote prep.
- reports.
- client portal.
- manager approvals.

During client onboarding, the partner should choose:

```text
Which package did you sell this client?
```

Then Northstar should automatically:

- enable the right workflow packs.
- show only the integrations needed for that package.
- guide the partner through setup step by step.
- explain what will and will not work until each provider is connected.
- create a custom package when the sold deal does not match a saved package.

The package choice should drive the setup checklist, integration requirements, AI features, approvals, and billing/usage tracking.

## Pilot Stack Vs Real Integrations

The current "Pilot Stack" is a build/testing milestone, not the final product model.

It exists to prove one real end-to-end path using a small provider set:

- HubSpot.
- Twilio.
- Google Calendar.
- Northstar intake.

Long term, these should feel like normal integration/setup cards, not a separate concept partners have to understand.

The product should evolve toward:

```text
Setup → choose package → connect required integrations → run tests → go live
```

and:

```text
Integrations → manage all connected providers
```

The pilot stack can remain as an internal/pilot label while building, but partner-facing language should eventually say "Required setup" or "Integrations for this package."

## Lead Source Setup Options

Northstar should give partners many ways to connect a client's lead sources, because partners will not all be technical and client websites will vary.

The product should prefer the easiest available path:

1. One-click native connection, when the provider supports it.
2. Partner-friendly app/plugin, for ecosystems like WordPress, Wix, Shopify, or similar.
3. Zapier, Make, or n8n bridge.
4. Hosted Northstar form, chat widget, booking page, or tracking link.
5. Copy/paste website snippet.
6. Generic webhook/API setup.
7. Manual entry fallback.

Examples:

- WordPress: plugin first, snippet/webhook fallback.
- Wix: Wix app later, Zapier/Make or embed fallback first.
- Squarespace/Webflow: embed snippet, form webhook, or Zapier/Make.
- Custom site: snippet, direct API, or form endpoint.
- Google Business Profile: tracking number, booking/contact link, supported Google connection paths, and campaign/source attribution.
- No website access: hosted Northstar page, tracking phone number, or manual lead entry.

The setup UI should ask plain questions, not expose technical language first:

```text
Where do this client's leads come from?
What website platform do they use?
Do they already have a CRM?
Do they already have a phone/SMS provider?
Can you edit their website?
```

Then Northstar should recommend the simplest setup path and provide a checklist with test buttons.

## Universal AI Intake Routing

Every inbound customer interaction should be classified before workflows run.

This applies to:

- phone calls.
- website chat.
- website forms.
- inbound email.
- inbound SMS.
- social/paid-ad leads.
- Google Business Profile messages or calls, where supported.
- manual entries.

The AI should identify where the request belongs, such as:

- sales opportunity.
- customer service issue.
- scheduling request.
- estimate/quote request.
- urgent/emergency request.
- billing/admin request.
- review/reputation issue.
- PR/media/opportunity.
- spam/vendor/low-value contact.

That classification should drive routing, visibility, workflow selection, urgency, approval rules, CRM notes, and reporting.

## Website AI Chat Assistant

Northstar should eventually include a customer service and sales AI chat assistant that can live on a client's website.

This assistant should:

- answer basic questions using approved business information.
- collect lead/contact details.
- qualify the request.
- identify whether it is sales, service, scheduling, billing/admin, PR, or another category.
- suggest or book appointments when calendar/provider access allows.
- create a lead or ticket in the CRM.
- hand off to a human when needed.
- leave a visible AI Assistant note and audit trail.

The chat assistant should be installable through the same lead-source setup options:

- native website app/plugin where available.
- snippet/embed.
- hosted chat page or booking/contact link.
- Zapier/Make/n8n bridge where needed.

## Staff-Facing UI: Popups, Not A Full Dashboard

Most day-to-day users should not need a large dashboard.

Northstar should run in the background and surface small assistant popups when a human is actively doing something.

The popup should be an action console, not just a suggestion box.

Possible popup actions:

- send SMS.
- send email.
- book appointment.
- sync to CRM.
- add CRM note.
- create task.
- update safe fields.
- escalate to manager.
- copy as fallback.

When a provider integration exists, the user should click the action and Northstar should execute it through the connected API, then log/sync the result automatically.

Copy/paste should be a fallback only.

Some staff-facing assistance may require software running on the client's computers or browsers.

Possible delivery modes:

- browser extension for CRM/website overlays.
- desktop tray app for call popups and notifications.
- web app popup when staff live inside Northstar.
- embeddable widget inside partner/client sites.
- CRM-native app/extension where a provider supports it.

The end state should not assume every client installs a desktop app, but the live call assistant and cross-CRM popups may need a small client-side runtime to appear over the tools staff already use.

Setup should clearly say which staff install, extension, or permission is required for each package feature.

## Popups Needed

### Live Call Assistant

Appears for staff on an active call when live provider support exists.

Shows:

- live transcript or running notes.
- caller/customer match.
- extracted fields.
- missing intake fields.
- urgency flags.
- suggested next question.
- CRM/calendar sync status.

### Live Scheduling Assistant

Appears during a call or active scheduling task.

Suggests times that:

- work for the customer.
- match actual worker/estimator availability.
- obey service duration rules.
- avoid unavailable calendar slots.
- respect territory/travel/business rules where available.

This requires live audio or live transcript access from the phone provider. If a provider only supports post-call recordings/transcripts, Northstar can provide post-call scheduling suggestions but not the real-time popup.

### Known-Customer Context Popup

Appears when a caller/email/SMS matches an existing CRM contact.

Shows:

- customer identity.
- open jobs/leads.
- last notes.
- upcoming appointments.
- current estimate/deal status.
- relevant warnings.

### Draft Assistant Popup

Appears when a user is replying to a customer or reviewing an AI-generated message.

Supports:

- edit.
- approve.
- send.
- create draft in provider.
- sync note to CRM.
- copy fallback.

### CRM Change Approval Popup

Appears when AI wants to change something meaningful.

Examples:

- update lead stage.
- create task.
- change appointment.
- add high-risk note.
- update contact details.

Most changes should start as suggestions or approval-gated actions.

### Handoff / Escalation Popup

Appears when AI transfers a call or flags an issue.

Shows:

- what happened so far.
- transcript summary.
- known customer context.
- urgency/risk.
- recommended next action.

## Manager / Partner Dashboards

The dashboard is for oversight, not minute-by-minute staff work.

Managers and partners should see:

- active AI assistants.
- recent AI actions.
- calls handled.
- appointments booked.
- messages drafted/sent.
- approvals waiting.
- failed integrations.
- AI changes to CRM records.
- workflow run logs.
- sync status.
- usage/cost.
- client health.

## AI Assistant As A CRM Contributor

When Northstar updates or comments in a client's CRM, it should appear as an "AI Assistant" actor.

Examples:

- AI Assistant summarized call.
- AI Assistant extracted missing lead fields.
- AI Assistant suggested appointment slots.
- AI Assistant sent confirmation SMS.
- AI Assistant created follow-up task.
- AI Assistant updated urgency field.

If AI changes anything directly, it must leave a CRM note and an audit event explaining what changed.

## AI Phone Answering Disclosure Modes

AI phone answering and speed-to-lead callback should be configurable per partner/client policy.

Proposed modes:

1. Off.
2. On with explicit disclosure and opt-out.
3. On with minimal disclosure, if legally and ethically allowed.

Preferred default:

```text
Explicit disclosure
```

Example:

```text
Hi, I'm an AI scheduling assistant. I can help book your appointment, but if you prefer a human, press 2 at any time.
```

Before production launch, legal/compliance review should confirm whether AI disclosure is always required for target regions and call types.

## What The Largest Package Includes

The largest package should eventually include:

- AI phone answering.
- speed-to-lead callback.
- live call assistant popup.
- live scheduling assistant popup.
- website AI chat assistant.
- post-call transcript and notes.
- known-customer matching.
- universal AI intake classification and routing.
- AI lead analysis.
- AI urgency/quality scoring.
- missing-field detection.
- AI SMS/email drafting.
- approval-gated sends.
- one-click send/book/sync actions.
- appointment booking.
- appointment reminders.
- estimate follow-up.
- review requests.
- quote prep.
- review/reputation analysis.
- CRM sync.
- calendar sync.
- phone/SMS/email sync.
- workflow logs.
- AI activity dashboard.
- client portal.
- partner control plane.

## Reality Check: Provider Capabilities

Some features depend on connected provider capabilities.

If phone provider supports live audio/live transcript:

- live call assistant works.
- live scheduler popup works.
- AI can assist while the call is happening.

If phone provider only supports post-call recordings/transcripts:

- post-call notes work.
- post-call scheduling suggestions work.
- live popup does not work.

If phone provider only supports missed-call events:

- missed-call rescue works.
- live assistance does not.
- transcript-based notes do not work unless another transcript source exists.

Scheduling also requires calendar access. Phone access is only one input.

## Roadmap To A Usable Product

### Stage 1: Make Current App Usable Locally

Goal:

The builder can log in as every role and understand the product.

Needs:

- local seed working.
- simple dev login or clear magic-link flow.
- obvious demo path.
- seeded client with integrations/workflows enabled.
- one-click sample event.
- visible run/approval/result.

### Stage 2: Partner Onboarding Flow

Goal:

A partner can add a client and understand setup.

Needs:

- guided client setup checklist.
- operating mode choice.
- integrations checklist.
- workflow pack selection.
- approval settings.
- test connection buttons.
- setup completeness score.

### Stage 3: Lead Response Pack

Goal:

One real AI workflow pack feels useful.

Needs:

- AI lead analysis.
- missed-call rescue.
- estimate follow-up.
- appointment confirmation draft.
- approval flow.
- run detail with AI/fallback metadata.
- CRM note/sync placeholder.

### Stage 4: Popup Action Console Prototype

Goal:

Staff can see how AI helps during work.

Needs:

- simple popup/sidebar UI.
- active-call mock/live contract.
- extracted fields.
- scheduling suggestions.
- draft actions.
- sync/send/book buttons.
- fallback states.

### Stage 5: Integration Setup That Feels Easy

Goal:

Normal partner setup takes 30 minutes or less.

Needs:

- native adapter priority list.
- OAuth/API connection flows.
- provider capability matrix.
- field mapping defaults.
- test buttons.
- clear "what works / what does not" status.

### Stage 6: Built-In CRM Mode

Goal:

Clients without strong systems can use Northstar as their CRM.

Needs:

- leads.
- contacts.
- timeline.
- tasks.
- appointments.
- messages.
- pipeline.
- AI assistant contributions.

Adapt concepts from `/Users/gkn/new`, but rebuild inside this platform.

### Stage 7: Voice + Scheduling

Goal:

AI voice and live scheduling become real.

Needs:

- phone provider adapter.
- live transcript/audio support where available.
- call session model.
- transcript model.
- scheduling provider interface.
- internal calendar adapter.
- booking/reschedule flow.
- human handoff.

### Stage 8: Production Hardening

Goal:

Safe enough to use with real clients.

Needs:

- permission regression tests.
- RLS review.
- audit review.
- secret redaction review.
- queue/background jobs.
- monitoring.
- error handling.
- usage/cost tracking.
- legal/compliance review.

## Immediate Next Step

Do not build more abstract backend first.

Next, make the product understandable and usable locally:

1. Create a guided demo/setup path.
2. Seed one client with integrations/workflows ready.
3. Add a one-click sample event.
4. Show the resulting run, approval, and dashboard changes.
5. Add clear role-switching/dev-login instructions.

The fastest way to understand the product is to use it at all three levels:

- partner dashboard.
- client workspace.
- client portal.

Then build the popup/action-console prototype.
