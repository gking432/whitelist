# UI Screens And User Flows

## Design Direction

This is an operational B2B tool.

The UI should feel:

- clear.
- dense but readable.
- trustworthy.
- fast to scan.
- action-oriented.
- restrained.

Avoid marketing-page composition inside the app. Avoid oversized hero sections. Use dashboards, tables, tabs, filters, status badges, detail panels, logs, and explicit action buttons.

## Navigation

Primary app areas:

- Dashboard.
- Clients.
- Integrations.
- Workflows.
- Approvals.
- Runs / Logs.
- Reports.
- Settings.

Platform owner users may additionally see:

- Partners.
- Templates.
- System Health.
- Platform Audit.

## Partner Dashboard

Route:

- `/partner`

Purpose:

Show the partner what needs attention across all clients.

Primary components:

- metric strip.
- client health summary.
- attention queue.
- recent workflow failures.
- open approvals.
- integration health.
- usage summary.
- quick actions.

Metrics:

- active clients.
- clients needing attention.
- active workflows.
- failed runs last 24h/7d.
- open approvals.
- integration events this month.
- estimated value impacted.
- usage/cost.

Primary actions:

- Add client.
- Open client.
- View approvals.
- View failed runs.
- Connect integration.

Acceptance:

- partner can understand client health in under 30 seconds.
- no fake demo language.
- empty state guides user to add first client.

## Clients List

Route:

- `/partner/clients`

Purpose:

Manage client businesses.

Columns:

- client name.
- industry.
- status.
- CRM operating mode.
- health.
- active workflows.
- open approvals.
- failed runs.
- last event.
- client portal status.

Filters:

- status.
- health.
- industry.
- CRM mode.
- integration status.

Actions:

- Add client.
- Open client.
- Archive client.

## Add Client Flow

Route:

- `/partner/clients/new`

Steps:

1. Business info.
2. Primary contact.
3. CRM operating mode.
4. Client portal enabled/disabled.
5. Partner edit permission.
6. Initial integration choice.
7. Initial workflow pack.

First pass can implement this as one form if a wizard is too much, but the data model should support these steps.

Required fields:

- client name.
- industry/category.
- timezone.
- primary contact email or phone.
- CRM operating mode.

## Client Workspace

Route:

- `/partner/clients/[clientId]`

Purpose:

The main workspace for one client business.

Header should show:

- client name.
- status.
- health.
- CRM mode.
- runtime mode.
- partner edit permission.
- client portal status.

Tabs:

- Overview.
- Integrations.
- Workflows.
- Runs / Logs.
- Approvals.
- Reports.
- Users.
- Settings.
- Audit.

## Client Overview Tab

Purpose:

Summarize operational state.

Sections:

- health summary.
- active workflows.
- integration status.
- open approvals.
- recent failures.
- recent successful runs.
- onboarding checklist.
- support/escalation info.

Useful cards:

- "Needs attention"
- "Last successful event"
- "Approval backlog"
- "Failed syncs"
- "Live workflows"

## Integrations Tab

Purpose:

Configure and monitor client connections.

List cards/table:

- provider.
- category.
- status.
- runtime mode.
- credential status.
- last success.
- last failure.
- error count.

Actions:

- Add connection.
- Configure.
- Pause.
- Test.
- View events.
- Rotate secret.

Connection detail should show:

- safe config summary.
- endpoint URL if inbound webhook.
- signing status.
- recent events.
- field mapping link if relevant.
- health check result.

Never display raw secrets.

## Workflows Tab

Purpose:

Enable/configure automations per client.

Sections:

- enabled workflows.
- available workflow templates.
- paused/disabled workflows.

Workflow card fields:

- name.
- category.
- status.
- runtime mode.
- required integrations.
- approval policy.
- last run.
- health.

Actions:

- enable.
- pause.
- configure.
- view runs.
- change runtime mode.

## Runs / Logs Tab

Purpose:

Investigate what happened.

Table columns:

- time.
- workflow.
- trigger.
- status.
- integration.
- approval state.
- duration.
- next action.

Filters:

- status.
- workflow.
- integration.
- date.
- runtime mode.
- requires approval.

Run detail should show:

- timeline.
- trigger event.
- input snapshot.
- steps.
- AI output if any.
- integration attempts.
- approval item.
- final output.
- retry/escalate controls.

## Approvals Tab

Purpose:

Review actions that require human permission.

Table/cards:

- title.
- type.
- risk.
- workflow.
- created time.
- assigned to.
- status.

Detail actions:

- approve.
- edit and approve.
- reject.
- assign.
- comment.
- escalate.

The UI should clearly explain what will happen if approved.

## Reports Tab

Purpose:

Show operational outcomes.

First-pass reports:

- workflow volume.
- success/failure rate.
- approval volume.
- integration events.
- time saved estimate.
- client health over time.

Future reports:

- ROI.
- speed-to-lead.
- missed-call recovery.
- estimate follow-up.
- review request outcomes.
- partner cost/margin.

## Users Tab

Purpose:

Manage client users and permissions.

Actions:

- invite client user.
- change role.
- disable user.
- grant/revoke partner edit permission.

This tab should be hidden or read-only for roles without permission.

## Settings Tab

Client settings:

- business info.
- timezone.
- CRM operating mode.
- default runtime mode.
- client portal enabled.
- partner edit permission.
- notification preferences.
- escalation contact.
- live-mode safety settings.

## Audit Tab

Purpose:

Show sensitive activity.

Events:

- integration connected.
- secret rotated.
- workflow enabled.
- runtime mode changed.
- approval resolved.
- partner edited client data.
- user invited.
- permission changed.

## Client Portal

Routes:

- `/client`
- `/client/approvals`
- `/client/activity`
- `/client/integrations`
- `/client/reports`

Client portal should be optional.

When enabled, client users should see:

- their business only.
- partner-branded shell/support.
- integration/workflow health.
- approvals assigned to them.
- logs relevant to their business.
- reports/outcomes.

They should not see:

- other clients.
- partner margin.
- platform templates outside enabled workflows.
- raw integration secrets.
- advanced partner settings unless granted.

## Platform Owner Screens

Do not overbuild first, but reserve structure.

Needed eventually:

- partner list.
- partner detail.
- plan assignment.
- global workflow templates.
- system health.
- support/audit tools.

First pass can include a minimal platform admin seed/access path if needed to create partners.

## Empty States

Every major page needs an empty state:

- no clients: create first client.
- no integrations: add connection.
- no workflows: enable workflow.
- no runs: waiting for first event.
- no approvals: all clear.
- no audit events: no sensitive activity yet.

## Loading And Error States

Every async surface should handle:

- loading.
- permission denied.
- not found.
- validation error.
- integration failure.
- network/server error.

Error messages should say what the user can do next.

