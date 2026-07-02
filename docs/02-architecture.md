# Architecture Spec

## Architecture Goal

Create a production-grade multi-tenant app where partner organizations manage client businesses, integrations, workflow instances, run logs, approvals, and audit history.

The architecture must support real client data and real integrations. It should not rely on demo behavior.

## Recommended App Shape

```text
partner-platform/
  app/
    (auth)/
    platform/
    partner/
    client/
    api/
  components/
    platform/
    partner/
    client/
    integrations/
    workflows/
    approvals/
    audit/
    ui/
  lib/
    auth/
    db/
    tenancy/
    permissions/
    integrations/
    workflows/
    approvals/
    audit/
    billing/
    ai/
  supabase/
    migrations/
    seed.sql
  docs/
```

## Route Model

### Platform Owner Routes

Use `/platform`.

Examples:

- `/platform`
- `/platform/partners`
- `/platform/partners/[partnerId]`
- `/platform/templates/workflows`
- `/platform/usage`
- `/platform/audit`
- `/platform/support`

Only platform owner roles can access these.

### Partner Routes

Use `/partner`.

Examples:

- `/partner`
- `/partner/clients`
- `/partner/clients/[clientId]`
- `/partner/clients/[clientId]/integrations`
- `/partner/clients/[clientId]/workflows`
- `/partner/clients/[clientId]/runs`
- `/partner/clients/[clientId]/approvals`
- `/partner/clients/[clientId]/reports`
- `/partner/clients/[clientId]/settings`
- `/partner/branding`
- `/partner/users`
- `/partner/audit`

Partner users can access only their partner organization and its client businesses.

### Client Routes

Use `/client`.

Examples:

- `/client`
- `/client/approvals`
- `/client/activity`
- `/client/integrations`
- `/client/reports`
- `/client/settings`

Client routes should be optional and permissioned. Some client businesses may never log in.

### API Routes

Use `/api`.

Recommended namespaces:

- `/api/integrations/inbound/[connectionId]`
- `/api/integrations/webhooks/[connectionId]`
- `/api/workflows/run`
- `/api/approvals/[approvalId]`
- `/api/support/events`

Do not create unauthenticated mutation routes without signed authentication, API keys, or equivalent security.

## Tenancy Model

Use organizations and memberships, not hard-coded user roles.

Core concepts:

- platform owner users.
- partner organizations.
- client businesses.
- client locations.
- memberships.
- role grants.

Every tenant-scoped business record should carry enough ownership identifiers to enforce access:

- `partner_id`
- `client_id`
- `location_id` where relevant

When in doubt, store `partner_id` and `client_id` redundantly on operational records to simplify RLS and queries.

## Auth And Sessions

Recommended:

- Supabase Auth.
- `profiles` table for user profile metadata.
- `memberships` table for access.
- server-side helpers that always resolve the current user's accessible partner/client scope.

Do not rely on client-provided IDs alone. Every server action/query must verify that the current user has access to the target partner/client.

## Permission Philosophy

Default deny.

Partner users:

- can view/manage their own partner organization.
- can view clients attached to their partner.
- can configure integrations and workflows if their role allows.
- can inspect client data/logs.
- can edit client operational data only if client permission/settings allow it.

Client users:

- can view only their own client business.
- can approve/reject only items assigned or visible to their role.
- cannot see partner margin, other clients, platform-level settings, or secrets.

Platform users:

- can access all partners/clients through audited admin tools.
- impersonation must be audited.

## Runtime Modes

The production app can support different runtime modes for integrations/workflows:

- `sandbox`
- `dry_run`
- `live`
- `paused`

Do not use `demo` as a product mode.

`sandbox` means real configuration but no real-world side effects.

`dry_run` means build payloads/log decisions without sending to external systems.

`live` means real side effects can happen according to approval and safety policy.

`paused` means no workflow runs until re-enabled.

## Integration Architecture

Use an adapter pattern.

Each integration adapter should have:

- provider key.
- display name.
- supported auth method.
- connection validation.
- inbound event parser.
- outbound action sender.
- field mapping support where relevant.
- health check.
- error normalization.
- secret handling rules.

Initial adapters can be simple:

- generic inbound webhook.
- generic outbound webhook.
- manual placeholder CRM adapter.

Design the interface so HubSpot/GoHighLevel/ServiceTitan/etc. can be added later.

## Workflow Architecture

Separate templates from client-specific instances.

Workflow template:

- global reusable definition.
- owned by platform.
- versioned.
- category.
- risk level.
- required integrations.
- configurable settings schema.

Workflow instance:

- enabled for one client.
- references a template version.
- has client-specific settings.
- has runtime mode.
- has approval policy.
- has health status.

Workflow run:

- one execution or attempted execution.
- links to client, template, instance, trigger event, integration events, approval items, and audit events.

## Approval Architecture

Use a universal approval item model.

Approval items should not be limited to messages. They may represent:

- customer message.
- CRM update.
- external sync retry.
- appointment change.
- workflow mode change.
- high-risk AI suggestion.

Approval state machine:

- `pending`
- `approved`
- `edited_and_approved`
- `rejected`
- `expired`
- `cancelled`

Every approval resolution should create an audit event.

## Audit Architecture

Audit logs are not optional.

Audit sensitive actions:

- user invite.
- role change.
- client created.
- client settings changed.
- integration connected/disconnected.
- secret changed.
- workflow enabled/disabled.
- runtime mode changed.
- approval resolved.
- live send triggered.
- webhook retried.
- impersonation started/ended.
- client data edited by partner.

Audit events should include:

- actor user.
- actor membership/role.
- partner/client scope.
- action.
- target type/id.
- before/after summary where safe.
- timestamp.
- IP/user agent if available.

## Data Safety

Secrets:

- store encrypted/server-side.
- never return decrypted values to browser.
- show only last four characters or connection status.

Logs:

- redact auth headers, tokens, API keys, and secrets.
- consider redacting customer PII in debug views unless user has elevated permission.
- define retention periods later.

Outbound webhooks:

- require HTTPS.
- block private/local network addresses in production.
- support signing secrets.
- support idempotency keys.
- support retries with backoff.

Inbound webhooks:

- require a signed secret, token, or generated endpoint key.
- validate payload schema.
- rate-limit.
- log rejected attempts safely.

## Background Jobs

Plan for background execution even if the first pass runs synchronously.

Future job types:

- workflow execution.
- webhook delivery.
- retry failed integration event.
- sync external CRM records.
- send digest reports.
- expire approvals.
- health checks.
- usage aggregation.

The first code pass should keep workflow execution logic isolated so it can move into a queue later.

## AI Architecture

AI should be treated as a workflow capability, not magic sprinkled through components.

Store:

- prompt/template version.
- input snapshot, redacted.
- output.
- confidence/risk level.
- approval requirement.
- model/provider metadata.
- cost/usage.
- human resolution.

AI-generated customer-facing content should default to approval-required until policies are explicitly configured.

## Reporting Architecture

Reports should eventually answer:

- how many leads/events were processed?
- how many workflows ran?
- how many failures?
- how many approvals?
- speed-to-lead improvements.
- estimate follow-up volume.
- missed-call recoveries.
- reviews requested.
- client usage.
- partner margin.

First pass can store enough structured event data to make these reports possible later.

