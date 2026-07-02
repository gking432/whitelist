# Goal Build Sequence

Use this file to drive implementation one `/goal` at a time.

Each goal should produce a working vertical slice. Do not skip verification. Do not move to the next goal if the current goal breaks tenant boundaries, auth, or core navigation.

## Global Build Rules

- Do not modify `/Users/gkn/new`.
- Do not import Northstar code.
- Do not create demo-only features.
- Use real app architecture from the first pass.
- Keep seed data clearly local-development only.
- Add loading, empty, and error states.
- Add permission checks on server and UI.
- Add audit events for sensitive changes.
- Keep work scoped to the current goal.

## Goal 0: Project Scaffold

Objective:

Create the new app skeleton for Partner AI Platform.

Deliverables:

- Next.js TypeScript app.
- Tailwind/shadcn-style UI setup.
- Supabase client/server helpers.
- basic layout system.
- env example.
- lint/typecheck/build scripts.
- docs copied into project.

Routes:

- `/`
- `/login`
- `/partner`

Acceptance:

- app runs locally.
- lint/typecheck pass.
- no dependency on `/Users/gkn/new`.
- `/partner` is protected or ready to be protected by auth.

Suggested `/goal` prompt:

```text
Read /Users/gkn/partner-platform/docs. Complete Goal 0 from docs/07-goal-build-sequence.md. Scaffold the production app only. Do not implement business features yet. Do not touch /Users/gkn/new.
```

## Goal 1: Tenant And Auth Foundation

Objective:

Add the core tenant model and access helpers.

Deliverables:

- Supabase migrations for:
  - profiles.
  - partners.
  - partner_branding.
  - client_businesses.
  - client_locations.
  - memberships.
  - audit_events.
- RLS policies.
- access helper functions.
- seed script for local dev with one platform owner, one partner, and one client business.

Acceptance:

- platform user can access platform scope.
- partner user can access only their partner.
- client user can access only their client.
- direct URL/API access to another partner/client is denied.
- audit event helper exists.

Verification:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## Goal 2: Partner Dashboard

Objective:

Build the partner command center.

Deliverables:

- `/partner` dashboard.
- metric cards.
- client health list.
- attention queue.
- open approvals summary.
- failed runs summary.
- integration health summary.
- empty state for no clients.

Data:

- reads real partner/client tables.
- uses local seed data only for development.

Acceptance:

- partner sees only their clients.
- dashboard remains useful with zero clients, one client, or many clients.
- no fake demo language.

## Goal 3: Client Businesses

Objective:

Let partners create and manage client businesses.

Deliverables:

- `/partner/clients`
- `/partner/clients/new`
- `/partner/clients/[clientId]`
- client create/edit forms.
- status/health fields.
- CRM operating mode field.
- default runtime mode field.
- client portal toggle.
- partner edit permission toggle.
- audit events for create/update/permission changes.

Acceptance:

- partner can create a client.
- partner can edit allowed settings.
- partner cannot access another partner's client.
- client detail header clearly shows status, health, CRM mode, runtime mode, and edit permission.

## Goal 4: Integration Provider And Connection Foundation

Objective:

Build the Integration Hub data model and UI.

Deliverables:

- migration for:
  - integration_providers.
  - integration_connections.
  - integration_secrets.
  - integration_events.
- provider seed data.
- `/partner/clients/[clientId]/integrations`
- add connection form.
- connection status/health UI.
- secret-safe display.
- audit events for connect/update/pause/secret changes.

Initial providers:

- generic inbound webhook.
- generic outbound webhook.
- CRM placeholder.
- phone placeholder.
- SMS placeholder.
- email placeholder.
- calendar placeholder.

Acceptance:

- partner can add a connection.
- secrets are not returned to browser.
- connection appears in client workspace.
- integration status and runtime mode are visible.

## Goal 5: Secure Generic Webhook Intake

Objective:

Add the first real integration capability: secure inbound webhook events.

Deliverables:

- generated webhook endpoint/key per inbound connection.
- route handler for inbound events.
- event envelope validation.
- signature/token verification.
- idempotency handling.
- integration event log.
- rejected event log summary.
- UI instructions for endpoint use.

Acceptance:

- valid webhook creates an integration event.
- invalid secret/token is rejected.
- malformed payload is rejected.
- duplicate idempotency key does not double-process.
- partner can view event in logs.

## Goal 6: Workflow Templates And Client Workflow Instances

Objective:

Add reusable workflow templates and client-enabled workflow instances.

Deliverables:

- migration for:
  - workflow_templates.
  - client_workflow_instances.
  - workflow_runs.
- seed workflow templates.
- `/partner/clients/[clientId]/workflows`
- enable/pause/configure workflow instance.
- runtime mode and approval policy settings.
- audit events for workflow changes.

Initial templates:

- New Lead Intake.
- Missed-Call Rescue.
- Appointment Reminder.
- Estimate Follow-Up.
- Review Request.
- Sync Failure Alert.

Acceptance:

- partner can enable a template for a client.
- enabled workflow appears as a client instance.
- workflow cannot run if paused/disabled.
- settings are client-specific.

## Goal 7: Workflow Run Engine V1

Objective:

Connect inbound events to workflow runs.

Deliverables:

- event-to-workflow matcher.
- synchronous run engine abstraction.
- workflow run timeline structure.
- run status updates.
- run detail page.
- failed run handling.
- usage event emitted for workflow run.

Acceptance:

- inbound `lead.created` event can trigger enabled New Lead Intake workflow.
- run is visible under Runs / Logs.
- run detail shows trigger, input, steps, status, and output.
- failed run shows actionable error.

## Goal 8: Approval Queue

Objective:

Add universal approval items.

Deliverables:

- migration for approval_items.
- `/partner/clients/[clientId]/approvals`
- optional `/client/approvals` if client portal is enabled.
- create approval item from workflow run.
- approve/edit/reject flows.
- audit event on resolution.

Acceptance:

- workflow can pause for approval.
- partner/client user with permission can resolve approval.
- resolution updates workflow/run state or creates a follow-up event.
- every resolution is audited.

## Goal 9: Client Portal V1

Objective:

Add minimal permissioned client access.

Deliverables:

- `/client`
- `/client/approvals`
- `/client/activity`
- `/client/integrations`
- client-scoped navigation.
- partner-branded shell/support footer.
- client membership invite flow or seed path.

Acceptance:

- client user sees only their client business.
- client user cannot access partner routes.
- client user can resolve allowed approvals.
- client user can view integration health and recent activity.

## Goal 10: Reports And Health

Objective:

Make client and partner health useful.

Deliverables:

- usage_events.
- daily metric aggregation placeholder.
- client health calculation.
- partner dashboard health rollups.
- client report tab.

Acceptance:

- failed events affect health.
- approval backlog affects health.
- paused live workflows affect health.
- dashboard directs partner to actionable issues.

## Goal 11: Outbound Webhook Delivery

Objective:

Add secure outbound webhook delivery.

Deliverables:

- outbound webhook connection config.
- signed payloads.
- HTTPS validation.
- private network blocking.
- delivery attempts.
- retries.
- response logs.
- manual retry button with permission check.

Acceptance:

- partner can configure outbound webhook.
- workflow can send outbound event in live mode.
- failed delivery is logged and visible.
- retry creates new attempt and audit/event logs.

## Goal 12: Hardening Pass

Objective:

Make the first production slice safer and more complete.

Deliverables:

- permission regression checks.
- RLS review.
- loading/error/empty states.
- audit coverage review.
- secret redaction review.
- webhook abuse/rate-limit review.
- docs updated with actual implementation decisions.

Acceptance:

- all previous goals still pass.
- cross-tenant access tests pass.
- no known route exposes another tenant's data.
- no secret leaks in browser payloads.
- build/lint/typecheck pass.

## Stop Conditions

Stop and ask the user before:

- changing the product name.
- choosing a paid provider.
- implementing a specific CRM adapter.
- adding real SMS/email/voice sends.
- changing the Northstar app.
- making homeowners aware of partner/platform branding.
- turning the app into a full CRM.

