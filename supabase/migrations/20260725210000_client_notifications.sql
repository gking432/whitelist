-- Durable, role-routed client notifications generated from real operational
-- records. External delivery is queued here and executed by the job runner.

create table if not exists public.client_notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  kind text not null,
  severity text not null default 'warning'
    check (severity in ('info', 'warning', 'critical')),
  title text not null,
  body text,
  source_type text not null,
  source_id uuid,
  action_path text,
  audience_roles text[] not null default array['owner', 'manager'],
  target_user_id uuid references public.profiles (id) on delete cascade,
  dedupe_key text not null,
  occurred_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint client_notifications_client_dedupe_unique
    unique (client_id, dedupe_key),
  constraint client_notifications_audience_roles_check
    check (
      audience_roles <@ array[
        'owner', 'manager', 'sales', 'front_desk',
        'marketing', 'staff', 'viewer'
      ]::text[]
    ),
  constraint client_notifications_action_path_check
    check (action_path is null or action_path ~ '^/client(/|[?]|$)')
);

create index if not exists client_notifications_client_occurred_idx
  on public.client_notifications (client_id, occurred_at desc);
create index if not exists client_notifications_client_open_idx
  on public.client_notifications (client_id, severity, occurred_at desc)
  where resolved_at is null;
create index if not exists client_notifications_target_user_idx
  on public.client_notifications (target_user_id, occurred_at desc)
  where target_user_id is not null;

create table if not exists public.client_notification_reads (
  notification_id uuid not null
    references public.client_notifications (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create index if not exists client_notification_reads_user_idx
  on public.client_notification_reads (user_id, read_at desc);

create table if not exists public.client_notification_preferences (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  email_enabled boolean not null default true,
  sms_enabled boolean not null default false,
  sms_phone text,
  critical_only boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_notification_preferences_scope_unique
    unique (client_id, user_id),
  constraint client_notification_preferences_client_scope_fk
    foreign key (partner_id, client_id)
    references public.client_businesses (partner_id, id)
    on delete cascade,
  constraint client_notification_preferences_sms_phone_check
    check (
      sms_phone is null
      or sms_phone ~ '^\+[1-9][0-9]{7,14}$'
    )
);

create table if not exists public.client_notification_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  notification_id uuid not null
    references public.client_notifications (id) on delete cascade,
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  channel text not null check (channel in ('email', 'sms')),
  destination text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempt_count integer not null default 0,
  provider_ref text,
  error_message text,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint client_notification_deliveries_once
    unique (notification_id, user_id, channel),
  constraint client_notification_deliveries_client_scope_fk
    foreign key (partner_id, client_id)
    references public.client_businesses (partner_id, id)
    on delete cascade
);

create index if not exists client_notification_deliveries_pending_idx
  on public.client_notification_deliveries (status, last_attempt_at, created_at)
  where status in ('pending', 'failed');
create index if not exists client_notification_deliveries_user_idx
  on public.client_notification_deliveries (user_id, created_at desc);

drop trigger if exists set_client_notification_preferences_updated_at
  on public.client_notification_preferences;
create trigger set_client_notification_preferences_updated_at
before update on public.client_notification_preferences
for each row execute function public.set_updated_at();

alter table public.client_notifications enable row level security;
alter table public.client_notification_reads enable row level security;
alter table public.client_notification_preferences enable row level security;
alter table public.client_notification_deliveries enable row level security;

create policy "client_notifications_select_routed"
on public.client_notifications
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or exists (
    select 1
    from public.memberships membership
    join public.client_businesses client
      on client.id = membership.client_id
     and client.partner_id = membership.partner_id
    where membership.user_id = auth.uid()
      and membership.client_id = client_notifications.client_id
      and membership.partner_id = client_notifications.partner_id
      and membership.status = 'active'
      and client.client_portal_enabled = true
      and (
        client_notifications.target_user_id is null
        or client_notifications.target_user_id = auth.uid()
      )
      and coalesce(
        membership.client_job_role,
        case membership.role
          when 'client_owner' then 'owner'
          when 'client_manager' then 'manager'
          when 'client_viewer' then 'viewer'
          else 'staff'
        end
      ) = any(client_notifications.audience_roles)
  )
);

create policy "client_notification_reads_select_self"
on public.client_notification_reads
for select
to authenticated
using (user_id = auth.uid());

create policy "client_notification_reads_insert_self"
on public.client_notification_reads
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.client_notifications notification
    where notification.id = notification_id
  )
);

create policy "client_notification_reads_update_self"
on public.client_notification_reads
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "client_notification_preferences_select_self"
on public.client_notification_preferences
for select
to authenticated
using (user_id = auth.uid());

create policy "client_notification_preferences_insert_self"
on public.client_notification_preferences
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.memberships membership
    where membership.user_id = auth.uid()
      and membership.client_id = client_notification_preferences.client_id
      and membership.partner_id = client_notification_preferences.partner_id
      and membership.status = 'active'
  )
);

create policy "client_notification_preferences_update_self"
on public.client_notification_preferences
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "client_notification_deliveries_select_scoped"
on public.client_notification_deliveries
for select
to authenticated
using (
  user_id = auth.uid()
  or public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
);

grant select on public.client_notifications to authenticated;
grant select, insert, update on public.client_notification_reads to authenticated;
grant select, insert, update on public.client_notification_preferences to authenticated;
grant select on public.client_notification_deliveries to authenticated;

create or replace function public.upsert_client_notification(
  target_partner_id uuid,
  target_client_id uuid,
  notification_kind text,
  notification_severity text,
  notification_title text,
  notification_body text,
  notification_source_type text,
  notification_source_id uuid,
  notification_action_path text,
  notification_audience_roles text[],
  notification_target_user_id uuid,
  notification_dedupe_key text,
  notification_occurred_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification_id uuid;
begin
  insert into public.client_notifications (
    partner_id,
    client_id,
    kind,
    severity,
    title,
    body,
    source_type,
    source_id,
    action_path,
    audience_roles,
    target_user_id,
    dedupe_key,
    occurred_at,
    resolved_at
  )
  values (
    target_partner_id,
    target_client_id,
    notification_kind,
    notification_severity,
    left(notification_title, 160),
    nullif(left(coalesce(notification_body, ''), 1200), ''),
    notification_source_type,
    notification_source_id,
    notification_action_path,
    notification_audience_roles,
    notification_target_user_id,
    notification_dedupe_key,
    coalesce(notification_occurred_at, now()),
    null
  )
  on conflict (client_id, dedupe_key)
  do update set
    severity = excluded.severity,
    title = excluded.title,
    body = excluded.body,
    action_path = excluded.action_path,
    audience_roles = excluded.audience_roles,
    target_user_id = excluded.target_user_id,
    occurred_at = excluded.occurred_at,
    resolved_at = null
  returning id into notification_id;

  return notification_id;
end;
$$;

revoke all on function public.upsert_client_notification(
  uuid, uuid, text, text, text, text, text, uuid, text, text[], uuid, text,
  timestamptz
) from public;

create or replace function public.enqueue_client_notification_deliveries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.client_notification_deliveries (
    notification_id,
    partner_id,
    client_id,
    user_id,
    channel,
    destination
  )
  select
    new.id,
    new.partner_id,
    new.client_id,
    membership.user_id,
    'email',
    profile.email
  from public.memberships membership
  join public.profiles profile on profile.id = membership.user_id
  left join public.client_notification_preferences preference
    on preference.client_id = membership.client_id
   and preference.user_id = membership.user_id
  where membership.client_id = new.client_id
    and membership.partner_id = new.partner_id
    and membership.status = 'active'
    and (new.target_user_id is null or new.target_user_id = membership.user_id)
    and coalesce(
      membership.client_job_role,
      case membership.role
        when 'client_owner' then 'owner'
        when 'client_manager' then 'manager'
        when 'client_viewer' then 'viewer'
        else 'staff'
      end
    ) = any(new.audience_roles)
    and coalesce(preference.email_enabled, true)
    and (not coalesce(preference.critical_only, false) or new.severity = 'critical')
    and profile.email <> ''
  on conflict (notification_id, user_id, channel) do nothing;

  insert into public.client_notification_deliveries (
    notification_id,
    partner_id,
    client_id,
    user_id,
    channel,
    destination
  )
  select
    new.id,
    new.partner_id,
    new.client_id,
    membership.user_id,
    'sms',
    preference.sms_phone
  from public.memberships membership
  join public.client_notification_preferences preference
    on preference.client_id = membership.client_id
   and preference.user_id = membership.user_id
  where membership.client_id = new.client_id
    and membership.partner_id = new.partner_id
    and membership.status = 'active'
    and (new.target_user_id is null or new.target_user_id = membership.user_id)
    and coalesce(
      membership.client_job_role,
      case membership.role
        when 'client_owner' then 'owner'
        when 'client_manager' then 'manager'
        when 'client_viewer' then 'viewer'
        else 'staff'
      end
    ) = any(new.audience_roles)
    and preference.sms_enabled
    and preference.sms_phone is not null
    and (not preference.critical_only or new.severity = 'critical')
  on conflict (notification_id, user_id, channel) do nothing;

  return new;
end;
$$;

drop trigger if exists enqueue_client_notification_deliveries
  on public.client_notifications;
create trigger enqueue_client_notification_deliveries
after insert on public.client_notifications
for each row execute function public.enqueue_client_notification_deliveries();

create or replace function public.notify_client_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending' then
    perform public.upsert_client_notification(
      new.partner_id,
      new.client_id,
      'approval_required',
      case when new.risk_level = 'high' then 'critical' else 'warning' end,
      new.title,
      coalesce(new.summary, 'An automation is waiting for a decision.'),
      'approval',
      new.id,
      '/client/approvals',
      array['owner', 'manager'],
      null,
      'approval:' || new.id::text || ':decision',
      new.created_at
    );

    if new.assigned_to is not null then
      perform public.upsert_client_notification(
        new.partner_id,
        new.client_id,
        'approval_assigned',
        case when new.risk_level = 'high' then 'critical' else 'warning' end,
        new.title,
        coalesce(new.summary, 'An approval was assigned to you.'),
        'approval',
        new.id,
        '/client/approvals',
        array['owner', 'manager', 'sales', 'front_desk', 'marketing', 'staff', 'viewer'],
        new.assigned_to,
        'approval:' || new.id::text || ':assigned:' || new.assigned_to::text,
        new.created_at
      );
    end if;
  else
    update public.client_notifications
    set resolved_at = coalesce(new.resolved_at, now())
    where client_id = new.client_id
      and source_type = 'approval'
      and source_id = new.id
      and resolved_at is null;
  end if;

  return new;
end;
$$;

drop trigger if exists notify_client_approval on public.approval_items;
create trigger notify_client_approval
after insert or update of status, assigned_to on public.approval_items
for each row execute function public.notify_client_approval();

create or replace function public.notify_client_workflow_failure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  workflow_name text;
begin
  if new.status = 'failed' then
    select instance.name into workflow_name
    from public.client_workflow_instances instance
    where instance.id = new.workflow_instance_id;

    perform public.upsert_client_notification(
      new.partner_id,
      new.client_id,
      'automation_failed',
      'critical',
      coalesce(workflow_name, 'Automation') || ' failed',
      coalesce(new.error_message, new.summary, 'The automation did not complete.'),
      'workflow_run',
      new.id,
      '/client/crm?view=automations',
      array['owner', 'manager'],
      null,
      'workflow-run:' || new.id::text || ':failed',
      coalesce(new.finished_at, new.created_at)
    );
  elsif tg_op = 'UPDATE' and old.status = 'failed' then
    update public.client_notifications
    set resolved_at = now()
    where client_id = new.client_id
      and dedupe_key = 'workflow-run:' || new.id::text || ':failed'
      and resolved_at is null;
  end if;

  return new;
end;
$$;

drop trigger if exists notify_client_workflow_failure on public.workflow_runs;
create trigger notify_client_workflow_failure
after insert or update of status on public.workflow_runs
for each row execute function public.notify_client_workflow_failure();

create or replace function public.notify_client_integration_health()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('needs_attention', 'failing') then
    perform public.upsert_client_notification(
      new.partner_id,
      new.client_id,
      'integration_attention',
      case when new.status = 'failing' then 'critical' else 'warning' end,
      new.display_name || ' needs attention',
      coalesce(new.health_summary, 'The connection is not operating normally.'),
      'integration_connection',
      new.id,
      '/client/crm?view=crm-sync',
      array['owner', 'manager'],
      null,
      'integration:' || new.id::text || ':attention',
      coalesce(new.last_failure_at, new.updated_at)
    );
  elsif new.status = 'connected' then
    update public.client_notifications
    set resolved_at = now()
    where client_id = new.client_id
      and dedupe_key = 'integration:' || new.id::text || ':attention'
      and resolved_at is null;
  end if;

  return new;
end;
$$;

drop trigger if exists notify_client_integration_health
  on public.integration_connections;
create trigger notify_client_integration_health
after insert or update of status, health_summary
on public.integration_connections
for each row execute function public.notify_client_integration_health();

create or replace function public.notify_client_call_attention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'inbound' and new.status in ('abandoned', 'failed') then
    perform public.upsert_client_notification(
      new.partner_id,
      new.client_id,
      case when new.status = 'abandoned' then 'missed_call' else 'call_failed' end,
      case when new.status = 'abandoned' then 'warning' else 'critical' end,
      case when new.status = 'abandoned' then 'Missed inbound call' else 'Inbound call failed' end,
      case
        when new.from_number is not null then 'Caller: ' || new.from_number
        else coalesce(new.summary, 'An inbound call needs follow-up.')
      end,
      'call_session',
      new.id,
      '/client/crm?view=calls',
      array['owner', 'manager', 'sales', 'front_desk'],
      null,
      'call:' || new.id::text || ':attention',
      coalesce(new.ended_at, new.started_at)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists notify_client_call_attention on public.call_sessions;
create trigger notify_client_call_attention
after insert or update of status on public.call_sessions
for each row execute function public.notify_client_call_attention();

create or replace function public.notify_client_assistant_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_type = 'escalation_needed' then
    perform public.upsert_client_notification(
      new.partner_id,
      new.client_id,
      'assistant_escalation',
      'critical',
      coalesce(new.payload->>'title', 'AI assistant escalation'),
      coalesce(
        new.payload->>'reason',
        new.payload->>'message',
        new.payload->>'summary',
        'The AI assistant requested human attention.'
      ),
      'assistant_event',
      new.id,
      '/client/assistant',
      array['owner', 'manager', 'sales', 'front_desk'],
      null,
      'assistant-event:' || new.id::text || ':escalation',
      new.created_at
    );
  end if;

  return new;
end;
$$;

drop trigger if exists notify_client_assistant_escalation
  on public.assistant_events;
create trigger notify_client_assistant_escalation
after insert on public.assistant_events
for each row execute function public.notify_client_assistant_escalation();

create or replace function public.notify_client_urgent_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(coalesce(new.urgency, '')) in ('urgent', 'high', 'emergency')
     and new.status not in ('won', 'lost') then
    perform public.upsert_client_notification(
      new.partner_id,
      new.client_id,
      'urgent_lead',
      'critical',
      'Urgent lead needs a response',
      coalesce(new.summary, 'A new lead was classified as urgent.'),
      'crm_lead',
      new.id,
      '/client/crm?view=pipeline',
      array['owner', 'manager', 'sales', 'front_desk'],
      null,
      'lead:' || new.id::text || ':urgent',
      new.created_at
    );
  elsif tg_op = 'UPDATE' then
    update public.client_notifications
    set resolved_at = now()
    where client_id = new.client_id
      and dedupe_key = 'lead:' || new.id::text || ':urgent'
      and resolved_at is null;
  end if;

  return new;
end;
$$;

drop trigger if exists notify_client_urgent_lead on public.crm_leads;
create trigger notify_client_urgent_lead
after insert or update of urgency, status on public.crm_leads
for each row execute function public.notify_client_urgent_lead();

create or replace function public.notify_client_appointment_conflict()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conflicting_title text;
begin
  if new.status in ('proposed', 'booked') then
    select appointment.title into conflicting_title
    from public.crm_appointments appointment
    where appointment.client_id = new.client_id
      and appointment.id <> new.id
      and appointment.status in ('proposed', 'booked')
      and appointment.start_at < new.end_at
      and appointment.end_at > new.start_at
    order by appointment.start_at
    limit 1;
  end if;

  if conflicting_title is not null then
    perform public.upsert_client_notification(
      new.partner_id,
      new.client_id,
      'appointment_conflict',
      'critical',
      'Appointment conflict detected',
      new.title || ' overlaps with ' || conflicting_title || '.',
      'crm_appointment',
      new.id,
      '/client/crm?view=schedule',
      array['owner', 'manager', 'front_desk'],
      null,
      'appointment:' || new.id::text || ':conflict',
      new.created_at
    );
  else
    update public.client_notifications
    set resolved_at = now()
    where client_id = new.client_id
      and dedupe_key = 'appointment:' || new.id::text || ':conflict'
      and resolved_at is null;
  end if;

  return new;
end;
$$;

drop trigger if exists notify_client_appointment_conflict
  on public.crm_appointments;
create trigger notify_client_appointment_conflict
after insert or update of start_at, end_at, status on public.crm_appointments
for each row execute function public.notify_client_appointment_conflict();

-- Backfill only current actionable records. No sample notifications are made.
insert into public.client_notifications (
  partner_id, client_id, kind, severity, title, body, source_type, source_id,
  action_path, audience_roles, dedupe_key, occurred_at
)
select
  approval.partner_id,
  approval.client_id,
  'approval_required',
  case when approval.risk_level = 'high' then 'critical' else 'warning' end,
  approval.title,
  coalesce(approval.summary, 'An automation is waiting for a decision.'),
  'approval',
  approval.id,
  '/client/approvals',
  array['owner', 'manager'],
  'approval:' || approval.id::text || ':decision',
  approval.created_at
from public.approval_items approval
where approval.status = 'pending'
on conflict (client_id, dedupe_key) do nothing;

insert into public.client_notifications (
  partner_id, client_id, kind, severity, title, body, source_type, source_id,
  action_path, audience_roles, dedupe_key, occurred_at
)
select
  connection.partner_id,
  connection.client_id,
  'integration_attention',
  case when connection.status = 'failing' then 'critical' else 'warning' end,
  connection.display_name || ' needs attention',
  coalesce(connection.health_summary, 'The connection is not operating normally.'),
  'integration_connection',
  connection.id,
  '/client/crm?view=crm-sync',
  array['owner', 'manager'],
  'integration:' || connection.id::text || ':attention',
  coalesce(connection.last_failure_at, connection.updated_at)
from public.integration_connections connection
where connection.status in ('needs_attention', 'failing')
on conflict (client_id, dedupe_key) do nothing;
