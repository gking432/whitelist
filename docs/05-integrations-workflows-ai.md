# Integrations, Workflows, And AI Contracts

## Product Principle

Partners are buying operational leverage and visibility. Integrations and AI workflows must be observable, controllable, permissioned, and explainable.

Do not build hidden automations that fail silently.

## Integration Provider Categories

Initial categories:

- CRM.
- inbound webhook.
- outbound webhook.
- phone.
- SMS.
- email.
- calendar.
- form.
- reporting.
- generic API.

First production pass should support generic inbound/outbound webhook concepts well, then leave provider-specific CRM/phone/SMS/email adapters as clearly modeled next steps.

## Generic Inbound Webhook

Purpose:

Let a client system or automation tool send events into the platform.

Examples:

- new lead created.
- missed call logged.
- appointment booked.
- estimate sent.
- job status changed.
- payment received.
- review submitted.

Requirements:

- generated endpoint per connection.
- endpoint secret/token.
- payload schema validation.
- event type required.
- idempotency key support.
- rate limiting.
- safe rejected-event logs.
- mapped to client business.
- triggers workflow instance when configured.

Suggested event envelope:

```json
{
  "event_type": "lead.created",
  "event_version": "2026-06-01",
  "idempotency_key": "external-system-event-id",
  "occurred_at": "2026-06-21T15:30:00Z",
  "source": {
    "provider": "generic_webhook",
    "system": "client_crm",
    "external_account_id": "abc123"
  },
  "data": {
    "name": "Sarah Mitchell",
    "email": "sarah@example.com",
    "phone": "414-555-0188",
    "service_type": "roofing",
    "message": "Storm damage and roof leak after last night."
  }
}
```

## Generic Outbound Webhook

Purpose:

Let the platform send structured events/actions to partner/client systems.

Requirements:

- HTTPS only.
- no private/local network destinations in production.
- signing secret.
- retry/backoff.
- idempotency key.
- delivery status.
- redacted request/response logs.
- manual retry permission.

Outbound event examples:

- `approval.resolved`
- `workflow.completed`
- `workflow.failed`
- `lead.qualified`
- `message.draft_created`
- `appointment.reminder_due`
- `sync.issue_detected`

## Integration Event Lifecycle

Inbound:

1. request received.
2. authentication/signature validated.
3. payload schema validated.
4. idempotency checked.
5. event logged.
6. mapped to client context.
7. matching workflow instances found.
8. workflow run queued/started.

Outbound:

1. workflow/action requests send.
2. payload built.
3. approval checked if needed.
4. delivery attempt created.
5. request sent.
6. response logged.
7. status updated.
8. retry or issue created if failed.

## Workflow Template Contract

Every template should define:

- key.
- name.
- category.
- description.
- version.
- supported trigger events.
- required provider categories.
- input schema.
- settings schema.
- approval policy defaults.
- runtime mode support.
- risk level.
- outputs.
- audit events emitted.
- usage events emitted.

Example:

```ts
interface WorkflowTemplate {
  key: string;
  name: string;
  version: number;
  category: "sales" | "service" | "operations" | "reporting" | "systems";
  triggerEvents: string[];
  inputSchema: unknown;
  settingsSchema: unknown;
  requiredProviderCategories: string[];
  defaultRuntimeMode: RuntimeMode;
  defaultRequiresApproval: boolean;
  riskLevel: "low" | "medium" | "high";
}
```

## Client Workflow Instance Contract

Every client-enabled workflow should define:

- client.
- template version.
- status.
- runtime mode.
- settings.
- approval policy.
- connected integrations.
- health status.
- owner/responsible partner role.

Example:

```ts
interface ClientWorkflowInstance {
  id: string;
  partnerId: string;
  clientId: string;
  templateId: string;
  status: "active" | "paused" | "disabled";
  runtimeMode: "sandbox" | "dry_run" | "live" | "paused";
  settings: Record<string, unknown>;
  approvalPolicy: ApprovalPolicy;
}
```

## Initial Workflow Templates

### New Lead Intake

Trigger:

- `lead.created`

Purpose:

- normalize lead data.
- classify source/service/urgency.
- create workflow run.
- optionally create approval or outbound event.

First-pass output:

- run log.
- normalized payload snapshot.
- optional approval item if configured.

### Missed-Call Rescue

Trigger:

- `call.missed`

Purpose:

- create follow-up task/message approval.
- notify partner/client if high value.

First-pass output:

- approval item for text/email draft or call task.
- run log.

### Appointment Reminder

Trigger:

- scheduled job or `appointment.created`

Purpose:

- remind customer or client staff before appointment.

First-pass output:

- approval item if customer-facing live send is not allowed.
- run log.

### Estimate Follow-Up

Trigger:

- `estimate.sent`
- scheduled delay after estimate sent.

Purpose:

- follow up with unsold estimate.

First-pass output:

- approval item.
- run log.

### Review Request

Trigger:

- `job.completed`

Purpose:

- create/send review request depending on approval policy.

First-pass output:

- approval item.
- run log.

### Sync Failure Alert

Trigger:

- integration event failed.

Purpose:

- notify partner implementer/client owner.
- create issue trail.

First-pass output:

- issue/alert record.
- run log.

## Approval Policy

Suggested shape:

```ts
interface ApprovalPolicy {
  customerMessages: "always_required" | "required_above_risk" | "auto_if_template_locked";
  crmUpdates: "always_required" | "allowed_if_low_risk" | "auto";
  appointmentChanges: "always_required" | "auto_if_client_configured";
  syncRetries: "partner_required" | "auto";
  highRiskTermsAlwaysRequireApproval: boolean;
}
```

High-risk terms/actions should require approval:

- pricing commitments.
- financing language.
- insurance claims.
- legal guarantees.
- angry-customer replies.
- appointment cancellations.
- refund language.
- public review responses.

## AI Contracts

AI should produce structured outputs where possible.

Every AI result should store:

- workflow run id.
- prompt/template version.
- input snapshot, redacted.
- model/provider metadata.
- output.
- confidence/risk.
- approval requirement.
- cost/usage event.

Do not put raw, unbounded model text directly into irreversible customer-facing actions.

## AI Output Types

### Classification

Examples:

- lead urgency.
- service type.
- customer sentiment.
- action category.
- risk level.

### Draft

Examples:

- SMS response.
- email reply.
- follow-up message.
- client summary.

Drafts should default to approval-required.

### Recommendation

Examples:

- recommended next action.
- suggested workflow to enable.
- suggested field mapping.
- suggested retry/resolution.

Recommendations should be clearly labeled as suggestions.

## Run Visibility

A partner should be able to open a run and see:

- trigger.
- timeline.
- inputs.
- workflow steps.
- AI decision/output if any.
- integration attempts.
- approval pause if any.
- final status.
- retry/resolution options.

This run detail view is a core product surface.

## Error Handling

Every failed run/event should provide:

- human-readable summary.
- technical error code.
- affected client/integration/workflow.
- suggested next action.
- retry eligibility.
- raw/redacted payload if permitted.
- assigned owner if applicable.

## Health Status

Client health should consider:

- failing integrations.
- stale connections.
- approval backlog.
- failed workflow rate.
- no successful events in expected period.
- usage cap warnings.
- paused live workflows.

Health statuses:

- healthy.
- attention.
- failing.
- paused.
- onboarding.

