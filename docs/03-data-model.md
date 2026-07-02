# Data Model Spec

## Principles

- Model partner/client tenancy from the beginning.
- Prefer explicit ownership columns over clever inference.
- Separate templates from client-specific instances.
- Separate integration connections from integration events.
- Separate workflow runs from approval items.
- Store enough audit/log data to troubleshoot production issues.
- Avoid demo-specific tables.

## Enum Suggestions

```ts
export type PartnerStatus = "active" | "trial" | "paused" | "suspended";
export type ClientStatus = "onboarding" | "active" | "paused" | "at_risk" | "archived";
export type MembershipRole =
  | "platform_owner"
  | "platform_admin"
  | "platform_support"
  | "partner_owner"
  | "partner_admin"
  | "partner_implementer"
  | "partner_viewer"
  | "client_owner"
  | "client_manager"
  | "client_staff"
  | "client_viewer";

export type RuntimeMode = "sandbox" | "dry_run" | "live" | "paused";
export type CrmOperatingMode =
  | "external_crm_only"
  | "mirror"
  | "assist"
  | "primary_crm"
  | "webhook_only"
  | "none";

export type IntegrationStatus =
  | "not_connected"
  | "connected"
  | "needs_attention"
  | "failing"
  | "paused"
  | "disabled";

export type WorkflowStatus = "draft" | "active" | "paused" | "disabled" | "archived";
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "paused_for_approval" | "skipped" | "cancelled";
export type ApprovalStatus = "pending" | "approved" | "edited_and_approved" | "rejected" | "expired" | "cancelled";
```

## Core Tables

### profiles

Extends auth users.

Recommended fields:

- `id uuid primary key references auth.users(id)`
- `email text not null`
- `full_name text`
- `avatar_url text`
- `created_at timestamptz`
- `updated_at timestamptz`

### partners

The agency/customer buying the platform.

Recommended fields:

- `id uuid primary key`
- `name text not null`
- `slug text unique not null`
- `status PartnerStatus not null`
- `plan_key text`
- `website_url text`
- `support_email text`
- `support_phone text`
- `created_at timestamptz`
- `updated_at timestamptz`

### partner_branding

White-label settings for the partner.

Recommended fields:

- `id uuid primary key`
- `partner_id uuid references partners(id)`
- `logo_url text`
- `primary_color text`
- `secondary_color text`
- `accent_color text`
- `portal_domain text`
- `email_sender_name text`
- `email_sender_domain text`
- `report_footer_text text`
- `support_label text`
- `created_at timestamptz`
- `updated_at timestamptz`

### client_businesses

The partner's client.

Recommended fields:

- `id uuid primary key`
- `partner_id uuid references partners(id)`
- `name text not null`
- `slug text not null`
- `status ClientStatus not null`
- `industry text`
- `crm_operating_mode CrmOperatingMode not null`
- `default_runtime_mode RuntimeMode not null`
- `website_url text`
- `primary_contact_name text`
- `primary_contact_email text`
- `primary_contact_phone text`
- `timezone text not null default 'America/Chicago'`
- `client_portal_enabled boolean not null default false`
- `partner_can_edit_client_data boolean not null default false`
- `created_at timestamptz`
- `updated_at timestamptz`

Unique:

- `(partner_id, slug)`

### client_locations

Optional locations/branches.

Recommended fields:

- `id uuid primary key`
- `partner_id uuid references partners(id)`
- `client_id uuid references client_businesses(id)`
- `name text not null`
- `address_line1 text`
- `address_line2 text`
- `city text`
- `state text`
- `postal_code text`
- `timezone text`
- `created_at timestamptz`
- `updated_at timestamptz`

### memberships

User access to platform/partner/client scopes.

Recommended fields:

- `id uuid primary key`
- `user_id uuid references profiles(id)`
- `partner_id uuid references partners(id) null`
- `client_id uuid references client_businesses(id) null`
- `role MembershipRole not null`
- `status text not null default 'active'`
- `invited_by uuid references profiles(id) null`
- `created_at timestamptz`
- `updated_at timestamptz`

Rules:

- platform roles have `partner_id` and `client_id` null.
- partner roles have `partner_id` set and `client_id` null.
- client roles have both `partner_id` and `client_id` set.

## Integration Tables

### integration_providers

Catalog of supported providers.

Recommended fields:

- `id uuid primary key`
- `provider_key text unique not null`
- `display_name text not null`
- `category text not null`
- `supports_inbound boolean not null`
- `supports_outbound boolean not null`
- `supports_oauth boolean not null default false`
- `supports_api_key boolean not null default false`
- `is_active boolean not null default true`
- `created_at timestamptz`

Examples:

- `generic_inbound_webhook`
- `generic_outbound_webhook`
- `hubspot`
- `gohighlevel`
- `twilio`
- `sendgrid`
- `google_calendar`

### integration_connections

One configured connection for a client.

Recommended fields:

- `id uuid primary key`
- `partner_id uuid references partners(id)`
- `client_id uuid references client_businesses(id)`
- `provider_id uuid references integration_providers(id)`
- `display_name text not null`
- `status IntegrationStatus not null`
- `runtime_mode RuntimeMode not null`
- `credential_status text not null`
- `config jsonb not null default '{}'`
- `health_summary text`
- `last_success_at timestamptz`
- `last_failure_at timestamptz`
- `created_by uuid references profiles(id)`
- `created_at timestamptz`
- `updated_at timestamptz`

### integration_secrets

Encrypted secrets or token references.

Recommended fields:

- `id uuid primary key`
- `partner_id uuid references partners(id)`
- `client_id uuid references client_businesses(id)`
- `connection_id uuid references integration_connections(id)`
- `secret_kind text not null`
- `encrypted_value text not null`
- `last_four text`
- `created_at timestamptz`
- `updated_at timestamptz`

Never return `encrypted_value` to client-side code.

### integration_events

Inbound/outbound integration events and failures.

Recommended fields:

- `id uuid primary key`
- `partner_id uuid references partners(id)`
- `client_id uuid references client_businesses(id)`
- `connection_id uuid references integration_connections(id) null`
- `workflow_run_id uuid null`
- `direction text not null`
- `event_type text not null`
- `status text not null`
- `idempotency_key text`
- `external_object_type text`
- `external_object_id text`
- `request_payload jsonb`
- `response_payload jsonb`
- `error_code text`
- `error_message text`
- `redacted boolean not null default true`
- `created_at timestamptz`

## Workflow Tables

### workflow_templates

Global reusable workflow definitions.

Recommended fields:

- `id uuid primary key`
- `template_key text unique not null`
- `name text not null`
- `description text`
- `category text not null`
- `version integer not null`
- `risk_level text not null`
- `default_runtime_mode RuntimeMode not null`
- `requires_approval_default boolean not null`
- `required_provider_categories text[]`
- `settings_schema jsonb not null default '{}'`
- `is_active boolean not null default true`
- `created_at timestamptz`
- `updated_at timestamptz`

### client_workflow_instances

Workflow enabled/configured for one client.

Recommended fields:

- `id uuid primary key`
- `partner_id uuid references partners(id)`
- `client_id uuid references client_businesses(id)`
- `template_id uuid references workflow_templates(id)`
- `name text not null`
- `status WorkflowStatus not null`
- `runtime_mode RuntimeMode not null`
- `settings jsonb not null default '{}'`
- `approval_policy jsonb not null default '{}'`
- `health_status text not null default 'unknown'`
- `last_run_at timestamptz`
- `created_by uuid references profiles(id)`
- `created_at timestamptz`
- `updated_at timestamptz`

### workflow_runs

Execution log for workflow instances.

Recommended fields:

- `id uuid primary key`
- `partner_id uuid references partners(id)`
- `client_id uuid references client_businesses(id)`
- `workflow_instance_id uuid references client_workflow_instances(id)`
- `template_id uuid references workflow_templates(id)`
- `trigger_event_id uuid references integration_events(id) null`
- `status RunStatus not null`
- `runtime_mode RuntimeMode not null`
- `started_at timestamptz`
- `finished_at timestamptz`
- `summary text`
- `input_snapshot jsonb`
- `output_snapshot jsonb`
- `error_code text`
- `error_message text`
- `requires_approval boolean not null default false`
- `created_at timestamptz`

## Approval Tables

### approval_items

Universal approval queue.

Recommended fields:

- `id uuid primary key`
- `partner_id uuid references partners(id)`
- `client_id uuid references client_businesses(id)`
- `workflow_run_id uuid references workflow_runs(id) null`
- `type text not null`
- `status ApprovalStatus not null`
- `title text not null`
- `summary text`
- `risk_level text not null`
- `proposed_payload jsonb`
- `editable_content text`
- `resolved_content text`
- `assigned_to uuid references profiles(id) null`
- `resolved_by uuid references profiles(id) null`
- `resolved_at timestamptz`
- `expires_at timestamptz`
- `created_at timestamptz`
- `updated_at timestamptz`

## Audit Tables

### audit_events

Recommended fields:

- `id uuid primary key`
- `actor_user_id uuid references profiles(id) null`
- `actor_role text`
- `partner_id uuid references partners(id) null`
- `client_id uuid references client_businesses(id) null`
- `action text not null`
- `target_type text not null`
- `target_id uuid null`
- `summary text`
- `before_snapshot jsonb`
- `after_snapshot jsonb`
- `metadata jsonb not null default '{}'`
- `ip_address inet`
- `user_agent text`
- `created_at timestamptz`

## Reporting / Usage Tables

### usage_events

Recommended fields:

- `id uuid primary key`
- `partner_id uuid references partners(id)`
- `client_id uuid references client_businesses(id) null`
- `event_type text not null`
- `quantity numeric not null default 1`
- `unit text not null`
- `cost_cents integer`
- `metadata jsonb not null default '{}'`
- `created_at timestamptz`

### client_metrics_daily

Aggregated reporting table.

Recommended fields:

- `id uuid primary key`
- `partner_id uuid references partners(id)`
- `client_id uuid references client_businesses(id)`
- `date date not null`
- `workflow_runs integer not null default 0`
- `failed_runs integer not null default 0`
- `approvals_created integer not null default 0`
- `approvals_resolved integer not null default 0`
- `integration_events integer not null default 0`
- `estimated_value_cents integer`
- `created_at timestamptz`

Unique:

- `(client_id, date)`

## Optional Future CRM Tables

Do not prioritize these unless primary CRM/mirror mode becomes the immediate build target.

Potential normalized CRM tables:

- `contacts`
- `opportunities`
- `jobs`
- `appointments`
- `messages`
- `notes`
- `tasks`
- `external_object_refs`

If created, every table must include:

- `partner_id`
- `client_id`
- `source_system`
- `external_id` where relevant
- `created_at`
- `updated_at`

## RLS Expectations

Every tenant-scoped table should enforce:

- platform users can access according to platform role.
- partner users can access rows with their `partner_id`.
- client users can access rows with their `client_id` and allowed role.
- no user can access a different partner's clients through direct URL/API/Supabase query.

Do not consider the data model complete until RLS policies and access helper tests exist.

