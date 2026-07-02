# Product Requirements

## Product Name

Working name: Partner AI Platform.

The final brand can change. The app should use generic copy like `Partner Portal`, `Integration Hub`, and `Client Operations` until a brand is chosen.

## One-Sentence Product

A partner-branded operations platform that lets agencies manage AI automations, integrations, approvals, workflow logs, and client health for home service businesses.

## Target Market

First category: home service businesses.

The product should support the common home-service operating pattern:

- inbound leads.
- missed calls.
- form submissions.
- lead qualification.
- appointment scheduling.
- estimate follow-up.
- reminders.
- customer communication.
- CRM updates.
- review requests.
- reporting.
- issue troubleshooting.

Do not narrow the product to one trade. It should support roofing, HVAC, plumbing, electrical, restoration, remodeling, windows, doors, baths, landscaping, pest control, gutters, and similar service businesses.

## Primary Users

### Platform Owner User

Internal admin user.

Needs:

- create and manage partners.
- assign plans and feature flags.
- view usage and system health.
- publish workflow templates.
- inspect audit logs.
- support partners.
- suspend/pause risky clients or integrations.

### Partner Owner

The paying customer.

Needs:

- manage client businesses.
- see which clients need attention.
- configure integrations and workflow packs.
- manage users.
- apply partner branding.
- view usage and client value.
- troubleshoot client automation issues without engineering help.

### Partner Implementer

The agency operator who sets up and maintains client automations.

Needs:

- connect systems.
- configure webhooks and credentials.
- map fields.
- enable workflow templates.
- inspect event logs.
- retry failed runs.
- review AI context snapshots.
- resolve sync issues.
- manage approval queues.

### Client Business Owner/Manager

The home service business using the partner's service.

Needs:

- understand what automations are active.
- see what happened recently.
- approve actions when required.
- view integration health.
- see outcomes and ROI.
- report issues to the partner.

Client logins may be optional in early versions. The product should support them without requiring every client to use them.

### Client Staff

Office managers, CSRs, estimators, sales reps, admins, and coordinators.

Needs:

- approve drafts or changes assigned to them.
- view relevant activity.
- see sync/status issues that affect their work.
- avoid complex integration settings unless explicitly allowed.

### Homeowner / End Customer

The client business's customer.

Needs:

- fast response.
- accurate communication.
- easy scheduling.
- clear expectations.
- safe human handoff.

Homeowners are not app users. They should not see partner/platform branding or internal details.

## Core Product Areas

### Partner Dashboard

The partner dashboard is the main command center.

It should show:

- total clients.
- clients needing attention.
- failed integrations.
- open approvals.
- active workflows.
- workflow run volume.
- recent errors.
- usage this month.
- client value/ROI summary.
- onboarding status.

The partner should be able to reach any client in one or two clicks.

### Client Business Workspace

A partner opens a client and sees a workspace for that business.

Core tabs:

- Overview.
- Integrations.
- Workflows.
- Runs / Logs.
- Approvals.
- Reports.
- Settings.
- Users / Access.
- Audit Log.

Future tabs may include CRM, Inbox, Appointments, or Client Portal depending on operating mode.

### Integration Hub

The Integration Hub should track connections to external systems and operational health.

Initial connection types:

- generic inbound webhook.
- generic outbound webhook.
- CRM adapter placeholder.
- phone provider placeholder.
- SMS provider placeholder.
- email provider placeholder.
- calendar provider placeholder.

Each integration should have:

- provider type.
- display name.
- status.
- mode: sandbox/dry-run/live.
- credential status.
- last successful event.
- last failed event.
- error count.
- rate-limit state where applicable.
- owner/responsible role.

### Workflow Library

Workflow templates define reusable automation patterns.

Initial workflow templates:

- New lead intake.
- Missed-call rescue.
- Appointment reminder.
- Estimate follow-up.
- Review request.
- Sync failure alert.
- Approval-required customer message.
- CRM data cleanup suggestion.

Partner users enable workflow templates per client. The enabled per-client copy is a workflow instance.

### Workflow Runs And Event Logs

Every meaningful automation action should leave a trace.

Run/event records should answer:

- what happened?
- when did it happen?
- which client did it affect?
- which integration or workflow caused it?
- what external system was involved?
- did it succeed, fail, pause, or require approval?
- what can the partner do next?

Logs are a core product feature, not only developer diagnostics.

### Approval Queue

High-risk or customer-facing actions should pause for approval.

Approval item examples:

- AI-written customer SMS.
- AI-written email.
- appointment change.
- CRM stage update if configured as high-risk.
- pricing/financing/insurance language.
- retry of a failed outbound sync.

Approval actions:

- approve.
- edit and approve.
- reject.
- assign.
- comment.
- escalate.

### Client Portal

The first version can keep client access minimal.

If enabled, client users should see:

- automation status.
- open approvals assigned to them.
- recent workflow activity.
- integration health.
- issue log.
- reports/outcomes.
- support contact.

They should not see partner margin, global platform settings, other clients, or advanced integration secrets.

### CRM Mode

Do not build a full CRM first.

The app should support these CRM operating modes as settings:

- external CRM only.
- mirror mode.
- assist mode.
- primary CRM mode.
- no CRM / webhook-only mode.

For first pass, focus on external CRM/webhook-only and mirror/assist concepts. Primary CRM can remain planned unless explicitly prioritized.

## Production Requirements

This app should be production-shaped from day one:

- multi-tenant from the database model upward.
- row-level security planned and implemented as early as possible.
- no demo-only shortcuts in the product surface.
- no public unauthenticated mutation endpoints unless secured by signed credentials.
- all cross-tenant access denied by default.
- every sensitive action audited.
- integration secrets never returned to the browser.
- logs should redact secrets.
- live customer communications require clear policies and approval settings.

## Non-Goals For First Pass

- Full CRM feature parity.
- Native adapters for every CRM.
- Visual drag-and-drop workflow builder.
- Native mobile app.
- Full billing/payment automation.
- Enterprise SSO.
- Fully autonomous AI across all customer actions.
- Importing or modifying Northstar.
- Demo tours or fake-data sales flows.

## First-Pass Success Criteria

The first pass is successful if:

- a partner can log in.
- the partner can create/manage client businesses.
- the partner can open a client workspace.
- the partner can create integration connections.
- the partner can enable workflow instances.
- the system can log workflow events/runs.
- failures are visible and actionable.
- approval items can be reviewed and resolved.
- client access can be enabled without exposing other clients.
- audit logs show sensitive actions.
- the app structure can grow into real integrations without rewrites.

