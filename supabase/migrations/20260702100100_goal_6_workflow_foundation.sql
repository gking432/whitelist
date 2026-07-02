-- Goal 6/7: workflow templates, client workflow instances, workflow runs,
-- and usage events emitted by the run engine.

do $$
begin
  create type public.workflow_status as enum ('draft', 'active', 'paused', 'disabled', 'archived');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.run_status as enum (
    'queued',
    'running',
    'succeeded',
    'failed',
    'paused_for_approval',
    'skipped',
    'cancelled'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.workflow_templates (
  id uuid primary key default extensions.gen_random_uuid(),
  template_key text not null unique,
  name text not null,
  description text,
  category text not null,
  version integer not null default 1,
  risk_level text not null default 'low',
  default_runtime_mode public.runtime_mode not null default 'sandbox',
  requires_approval_default boolean not null default false,
  trigger_events text[] not null default '{}',
  required_provider_categories text[] not null default '{}',
  settings_schema jsonb not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_templates_risk_level_check
    check (risk_level in ('low', 'medium', 'high'))
);

create table if not exists public.client_workflow_instances (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  template_id uuid not null references public.workflow_templates (id),
  name text not null,
  status public.workflow_status not null default 'active',
  runtime_mode public.runtime_mode not null default 'sandbox',
  settings jsonb not null default '{}',
  approval_policy jsonb not null default '{}',
  health_status text not null default 'unknown',
  last_run_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_workflow_instances_client_template_unique unique (client_id, template_id),
  constraint client_workflow_instances_client_scope_fk
    foreign key (partner_id, client_id)
    references public.client_businesses (partner_id, id)
    on delete cascade
);

create table if not exists public.workflow_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  workflow_instance_id uuid not null references public.client_workflow_instances (id) on delete cascade,
  template_id uuid not null references public.workflow_templates (id),
  trigger_event_id uuid references public.integration_events (id) on delete set null,
  status public.run_status not null default 'queued',
  runtime_mode public.runtime_mode not null,
  started_at timestamptz,
  finished_at timestamptz,
  summary text,
  input_snapshot jsonb,
  output_snapshot jsonb,
  error_code text,
  error_message text,
  requires_approval boolean not null default false,
  created_at timestamptz not null default now(),
  constraint workflow_runs_client_scope_fk
    foreign key (partner_id, client_id)
    references public.client_businesses (partner_id, id)
    on delete cascade
);

create table if not exists public.usage_events (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid references public.client_businesses (id) on delete set null,
  event_type text not null,
  quantity numeric not null default 1,
  unit text not null default 'count',
  cost_cents integer,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Link integration events to the run that processed them.
do $$
begin
  alter table public.integration_events
    add constraint integration_events_workflow_run_fk
    foreign key (workflow_run_id) references public.workflow_runs (id) on delete set null;
exception
  when duplicate_object then null;
end $$;

create index if not exists client_workflow_instances_partner_client_idx
  on public.client_workflow_instances (partner_id, client_id);
create index if not exists workflow_runs_partner_client_created_idx
  on public.workflow_runs (partner_id, client_id, created_at desc);
create index if not exists workflow_runs_instance_created_idx
  on public.workflow_runs (workflow_instance_id, created_at desc);
create index if not exists usage_events_partner_created_idx
  on public.usage_events (partner_id, created_at desc);
create index if not exists usage_events_client_created_idx
  on public.usage_events (client_id, created_at desc);

drop trigger if exists set_workflow_templates_updated_at on public.workflow_templates;
create trigger set_workflow_templates_updated_at
before update on public.workflow_templates
for each row execute function public.set_updated_at();

drop trigger if exists set_client_workflow_instances_updated_at on public.client_workflow_instances;
create trigger set_client_workflow_instances_updated_at
before update on public.client_workflow_instances
for each row execute function public.set_updated_at();

alter table public.workflow_templates enable row level security;
alter table public.client_workflow_instances enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.usage_events enable row level security;

create policy "workflow_templates_select_authenticated"
on public.workflow_templates
for select
to authenticated
using (is_active = true or public.current_user_has_platform_role());

create policy "client_workflow_instances_select_accessible"
on public.client_workflow_instances
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or public.current_user_has_client_role(client_id)
);

create policy "client_workflow_instances_insert_authorized"
on public.client_workflow_instances
for insert
to authenticated
with check (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin',
    'partner_implementer'
  ]::public.membership_role[])
);

create policy "client_workflow_instances_update_authorized"
on public.client_workflow_instances
for update
to authenticated
using (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin',
    'partner_implementer'
  ]::public.membership_role[])
)
with check (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin',
    'partner_implementer'
  ]::public.membership_role[])
);

create policy "workflow_runs_select_accessible"
on public.workflow_runs
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or public.current_user_has_client_role(client_id, array[
    'client_owner',
    'client_manager'
  ]::public.membership_role[])
);

create policy "usage_events_select_partner"
on public.usage_events
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
);

grant select on public.workflow_templates to authenticated;
grant select, insert, update on public.client_workflow_instances to authenticated;
grant select on public.workflow_runs to authenticated;
grant select on public.usage_events to authenticated;

-- Initial workflow template catalog (product data, versioned).
insert into public.workflow_templates (
  template_key,
  name,
  description,
  category,
  version,
  risk_level,
  default_runtime_mode,
  requires_approval_default,
  trigger_events,
  required_provider_categories,
  settings_schema
)
values
  (
    'new_lead_intake',
    'New Lead Intake',
    'Normalizes inbound lead events, classifies urgency with rule-based checks, and records an actionable run log.',
    'sales',
    1,
    'low',
    'sandbox',
    false,
    array['lead.created'],
    array['inbound_webhook'],
    '{"fields":[{"key":"high_urgency_keywords","label":"High urgency keywords","type":"text","help":"Comma-separated keywords that mark a lead as high urgency."}]}'
  ),
  (
    'missed_call_rescue',
    'Missed-Call Rescue',
    'Creates a follow-up message draft for missed calls and pauses for human approval before any send.',
    'sales',
    1,
    'high',
    'sandbox',
    true,
    array['call.missed'],
    array['inbound_webhook'],
    '{"fields":[{"key":"message_template","label":"Follow-up message template","type":"textarea","help":"Draft template. Placeholders: {{name}}, {{business}}."}]}'
  ),
  (
    'appointment_reminder',
    'Appointment Reminder',
    'Prepares an appointment reminder draft when an appointment is created and pauses for approval.',
    'service',
    1,
    'medium',
    'sandbox',
    true,
    array['appointment.created'],
    array['inbound_webhook'],
    '{"fields":[{"key":"message_template","label":"Reminder message template","type":"textarea","help":"Draft template. Placeholders: {{name}}, {{business}}, {{appointment_time}}."}]}'
  ),
  (
    'estimate_follow_up',
    'Estimate Follow-Up',
    'Prepares a follow-up draft after an estimate is sent and pauses for approval.',
    'sales',
    1,
    'high',
    'sandbox',
    true,
    array['estimate.sent'],
    array['inbound_webhook'],
    '{"fields":[{"key":"message_template","label":"Follow-up message template","type":"textarea","help":"Draft template. Placeholders: {{name}}, {{business}}."}]}'
  ),
  (
    'review_request',
    'Review Request',
    'Prepares a review request draft when a job completes and pauses for approval.',
    'service',
    1,
    'medium',
    'sandbox',
    true,
    array['job.completed'],
    array['inbound_webhook'],
    '{"fields":[{"key":"message_template","label":"Review request template","type":"textarea","help":"Draft template. Placeholders: {{name}}, {{business}}."}]}'
  ),
  (
    'sync_failure_alert',
    'Sync Failure Alert',
    'Records an actionable issue trail when an external system reports a sync failure.',
    'systems',
    1,
    'low',
    'sandbox',
    false,
    array['sync.failed'],
    array['inbound_webhook'],
    '{"fields":[]}'
  )
on conflict (template_key) do update
  set name = excluded.name,
      description = excluded.description,
      category = excluded.category,
      risk_level = excluded.risk_level,
      trigger_events = excluded.trigger_events,
      required_provider_categories = excluded.required_provider_categories,
      settings_schema = excluded.settings_schema;
