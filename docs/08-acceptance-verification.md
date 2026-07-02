# Acceptance And Verification

## Definition Of Done

A feature is not done because the happy path works.

For every meaningful feature, verify:

- authenticated access.
- tenant isolation.
- role permissions.
- empty state.
- loading state.
- error state.
- audit event if sensitive.
- safe logging/redaction.
- server-side validation.
- no secret exposure.
- responsive UI.
- lint/typecheck/build.

## Required Commands

Run before considering a goal complete:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Add test commands once the test framework exists.

## Tenant Isolation Scenarios

Create local dev data:

- Platform Admin.
- Partner A.
- Partner B.
- Client A1 under Partner A.
- Client A2 under Partner A.
- Client B1 under Partner B.
- Partner A Owner.
- Partner A Implementer.
- Partner A Viewer.
- Partner B Owner.
- Client A1 Owner.
- Client A2 Owner.

Verify:

1. Partner A Owner cannot access Partner B dashboard.
2. Partner A Owner cannot access Client B1 detail by direct URL.
3. Partner A Implementer cannot manage Partner A billing/owner settings.
4. Partner A Viewer cannot create integrations.
5. Client A1 Owner cannot access Client A2 or Client B1.
6. Client A1 Owner cannot access `/partner`.
7. Client A1 Owner cannot view partner margin or other clients.
8. Platform Admin can access all partners through platform routes.
9. Every denied direct URL returns not found/forbidden without leaking names.

## Integration Security Scenarios

Inbound webhook:

1. valid token/signature creates event.
2. invalid token/signature rejects event.
3. missing event type rejects event.
4. malformed payload rejects event.
5. duplicate idempotency key does not double-process.
6. event appears only for correct client.
7. rejected event logs do not leak secrets.

Outbound webhook:

1. HTTPS URL accepted.
2. HTTP URL rejected.
3. local/private network URL rejected in production mode.
4. signing secret not returned to browser.
5. failed delivery logs status and error.
6. retry requires permission.
7. retry creates new attempt.

## Workflow Scenarios

Workflow enablement:

1. partner enables workflow for Client A1.
2. workflow does not appear for Client A2 unless separately enabled.
3. paused workflow does not run.
4. disabled workflow does not run.
5. runtime mode is visible.

Workflow run:

1. inbound event triggers matching active workflow.
2. workflow run stores trigger event, status, input snapshot, and output.
3. successful run appears in Runs / Logs.
4. failed run appears with actionable error.
5. run detail is accessible only to authorized users.

Approval:

1. high-risk/customer-facing workflow creates approval item.
2. approval appears in partner queue.
3. client user sees approval only if client portal/permission allows.
4. approve updates approval state and audit log.
5. edit-and-approve stores edited content.
6. reject records reason if supplied.

## Audit Scenarios

Audit these actions:

- client created.
- client settings changed.
- partner edit permission changed.
- integration connection created.
- integration secret changed.
- workflow enabled.
- workflow paused.
- runtime mode changed.
- approval resolved.
- webhook retried.
- user invited/role changed.

Verify:

- audit event has actor.
- audit event has partner/client scope.
- audit event is visible only to authorized users.
- audit snapshots do not include secrets.

## UI Acceptance

Partner dashboard:

- clear client health.
- open approvals visible.
- failed runs visible.
- empty state if no clients.
- no demo wording.

Client workspace:

- client name/status/health visible.
- tabs are clear.
- actions match permissions.
- unauthorized controls hidden or disabled with explanation.

Integration Hub:

- connection status clear.
- credential state clear without showing secrets.
- recent events visible.
- failure next action visible.

Runs / Logs:

- status filters.
- run detail timeline.
- input/output snapshots where permitted.
- approval linkage.
- retry/escalation options where permitted.

Approvals:

- proposed action clear.
- risk clear.
- approve/edit/reject clear.
- consequence of approval clear.

Client portal:

- partner branding visible where appropriate.
- only client-specific data visible.
- no partner margin/platform internals.

## Production Readiness Checklist

Before live customer data:

- RLS policies reviewed.
- server actions verify access.
- secrets encrypted.
- webhook signatures implemented.
- private network blocking for outbound webhooks.
- logs redact tokens/secrets.
- audit coverage in place.
- rate limits in place for public endpoints.
- backups configured.
- error monitoring configured.
- privacy/retention policy drafted.
- terms around AI/customer messaging drafted.

## Things That Should Fail Fast

The app should block:

- live workflow without required integration.
- live outbound webhook without HTTPS.
- live customer message without approval policy.
- partner edit of client data when permission is off.
- client access when client portal is disabled.
- workflow run for paused/disabled workflow.
- use of missing or invalid secrets.

