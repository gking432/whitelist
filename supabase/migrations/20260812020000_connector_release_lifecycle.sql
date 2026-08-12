-- Versioned, atomic connector release and rollback bookkeeping. These
-- functions record an externally reviewed deployment; they never deploy code.

alter table public.integration_requests
  drop constraint if exists integration_requests_status_check;
alter table public.integration_requests
  add constraint integration_requests_status_check
  check (status in (
    'requested', 'researching', 'needs_information', 'building', 'testing',
    'ready', 'released', 'rolled_back', 'blocked', 'declined'
  ));

alter table public.connector_development_tasks
  drop constraint if exists connector_development_tasks_status_check;
alter table public.connector_development_tasks
  add constraint connector_development_tasks_status_check check (status in (
    'awaiting_approval', 'queued', 'running', 'succeeded', 'failed',
    'review_approved', 'staged', 'released', 'rolled_back', 'cancelled'
  ));

alter table public.connector_development_tasks
  add column if not exists revision_number integer not null default 1;
alter table public.connector_development_tasks
  drop constraint if exists connector_development_tasks_revision_check;
alter table public.connector_development_tasks
  add constraint connector_development_tasks_revision_check
  check (revision_number between 1 and 9999);

alter table public.support_ticket_releases
  add column if not exists release_version text,
  add column if not exists rolled_back_by uuid references public.profiles (id) on delete set null,
  add column if not exists rollback_reason text;

create table if not exists public.connector_release_flags (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid references public.client_businesses (id) on delete cascade,
  release_id uuid not null references public.support_ticket_releases (id) on delete cascade,
  flag_key text not null,
  release_version text not null,
  enabled boolean not null default false,
  enabled_by uuid references public.profiles (id) on delete set null,
  enabled_at timestamptz,
  disabled_by uuid references public.profiles (id) on delete set null,
  disabled_at timestamptz,
  disable_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connector_release_flags_key_check
    check (flag_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$'),
  constraint connector_release_flags_client_scope_fk
    foreign key (partner_id, client_id)
    references public.client_businesses (partner_id, id)
    on delete cascade
);

create unique index if not exists connector_release_flags_scope_key_idx
  on public.connector_release_flags (partner_id, client_id, flag_key)
  nulls not distinct;

drop trigger if exists set_connector_release_flags_updated_at
  on public.connector_release_flags;
create trigger set_connector_release_flags_updated_at
before update on public.connector_release_flags
for each row execute function public.set_updated_at();

alter table public.connector_release_flags enable row level security;
drop policy if exists "connector_release_flags_select_scoped"
  on public.connector_release_flags;
create policy "connector_release_flags_select_scoped"
on public.connector_release_flags for select to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or (client_id is not null and public.current_user_has_client_role(client_id))
);
grant select on public.connector_release_flags to authenticated;
grant all on public.connector_release_flags to service_role;

alter table public.support_notification_outbox
  drop constraint if exists support_notification_outbox_once;
alter table public.support_notification_outbox
  add column if not exists event_key text not null default 'initial';
alter table public.support_notification_outbox
  drop constraint if exists support_notification_outbox_event_once;
alter table public.support_notification_outbox
  add constraint support_notification_outbox_event_once
  unique (ticket_id, recipient_kind, destination, event_key);

create or replace function public.complete_connector_support_release(
  p_ticket_id uuid,
  p_actor_id uuid,
  p_release_version text,
  p_resolution text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_release public.support_ticket_releases%rowtype;
  v_request public.integration_requests%rowtype;
  v_now timestamptz := now();
begin
  if coalesce(length(trim(p_release_version)), 0) = 0
    or length(trim(p_release_version)) > 80 then
    raise exception 'A valid release version is required.';
  end if;

  select * into v_release
  from public.support_ticket_releases
  where ticket_id = p_ticket_id
  for update;

  if not found or v_release.status <> 'requester_approved' then
    return false;
  end if;

  select * into v_request
  from public.integration_requests
  where support_ticket_id = p_ticket_id
  for update;

  if found and v_request.status <> 'ready' then
    return false;
  end if;

  update public.support_ticket_releases
  set status = 'released',
      release_version = trim(p_release_version),
      released_at = v_now,
      rolled_back_at = null,
      rolled_back_by = null,
      rollback_reason = null
  where id = v_release.id;

  update public.support_tickets
  set status = 'resolved',
      current_route = 'owner',
      resolved_by = p_actor_id,
      resolved_at = v_now,
      resolution = coalesce(nullif(trim(p_resolution), ''),
        'Requester validated the change and the owner recorded the production release.')
  where id = p_ticket_id;

  if v_release.feature_flag_key is not null then
    insert into public.connector_release_flags (
      partner_id, client_id, release_id, flag_key, release_version,
      enabled, enabled_by, enabled_at
    ) values (
      v_release.partner_id, v_release.client_id, v_release.id,
      v_release.feature_flag_key, trim(p_release_version), true, p_actor_id, v_now
    )
    on conflict (partner_id, client_id, flag_key) do update
    set release_id = excluded.release_id,
        release_version = excluded.release_version,
        enabled = true,
        enabled_by = excluded.enabled_by,
        enabled_at = excluded.enabled_at,
        disabled_by = null,
        disabled_at = null,
        disable_reason = null;
  end if;

  if v_request.id is not null then
    update public.integration_requests
    set status = 'released',
        release_version = trim(p_release_version),
        released_at = v_now
    where id = v_request.id;

    update public.connector_development_tasks
    set status = 'released', completed_at = v_now
    where request_id = v_request.id;
  end if;

  insert into public.support_ticket_events (
    ticket_id, partner_id, client_id, actor_id, event_type, audience, summary, metadata
  ) values (
    p_ticket_id, v_release.partner_id, v_release.client_id, p_actor_id,
    'ticket.release_completed', 'partner',
    'Requester-approved release recorded by the platform owner.',
    jsonb_build_object('release_version', trim(p_release_version))
  );

  insert into public.audit_events (
    actor_user_id, actor_role, partner_id, client_id, action,
    target_type, target_id, summary, before_snapshot, after_snapshot, metadata
  ) values (
    p_actor_id,
    (select membership.role::text from public.memberships membership
      where membership.user_id = p_actor_id
        and membership.status = 'active'
        and membership.partner_id is null
        and membership.client_id is null
      order by membership.created_at limit 1),
    v_release.partner_id, v_release.client_id,
    'connector.release_completed', 'support_ticket', p_ticket_id,
    'Recorded connector release ' || trim(p_release_version) || '.',
    jsonb_build_object('release_status', v_release.status),
    jsonb_build_object('release_status', 'released'),
    jsonb_build_object(
      'release_version', trim(p_release_version),
      'integration_request_id', v_request.id,
      'feature_flag_key', v_release.feature_flag_key
    )
  );

  return true;
end;
$$;

create or replace function public.rollback_connector_support_release(
  p_ticket_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_release public.support_ticket_releases%rowtype;
  v_request public.integration_requests%rowtype;
  v_now timestamptz := now();
begin
  if coalesce(length(trim(p_reason)), 0) = 0
    or length(trim(p_reason)) > 3000 then
    raise exception 'A rollback reason is required.';
  end if;

  select * into v_release
  from public.support_ticket_releases
  where ticket_id = p_ticket_id
  for update;

  if not found or v_release.status <> 'released' then
    return false;
  end if;

  select * into v_request
  from public.integration_requests
  where support_ticket_id = p_ticket_id
  for update;

  update public.support_ticket_releases
  set status = 'rolled_back',
      rolled_back_at = v_now,
      rolled_back_by = p_actor_id,
      rollback_reason = trim(p_reason)
  where id = v_release.id;

  update public.support_tickets
  set status = 'platform_working',
      current_route = 'owner',
      assigned_to = p_actor_id,
      resolved_by = null,
      resolved_at = null,
      resolution = null
  where id = p_ticket_id;

  update public.connector_release_flags
  set enabled = false,
      disabled_by = p_actor_id,
      disabled_at = v_now,
      disable_reason = trim(p_reason)
  where release_id = v_release.id;

  if v_request.id is not null then
    update public.integration_requests
    set status = 'rolled_back', released_at = null
    where id = v_request.id;

    update public.connector_development_tasks
    set status = 'rolled_back'
    where request_id = v_request.id;
  end if;

  insert into public.support_ticket_events (
    ticket_id, partner_id, client_id, actor_id, event_type, audience, summary, metadata
  ) values (
    p_ticket_id, v_release.partner_id, v_release.client_id, p_actor_id,
    'ticket.release_rolled_back', 'partner',
    'The platform owner recorded a rollback and reopened the request.',
    jsonb_build_object(
      'release_version', v_release.release_version,
      'reason', trim(p_reason)
    )
  );

  insert into public.audit_events (
    actor_user_id, actor_role, partner_id, client_id, action,
    target_type, target_id, summary, before_snapshot, after_snapshot, metadata
  ) values (
    p_actor_id,
    (select membership.role::text from public.memberships membership
      where membership.user_id = p_actor_id
        and membership.status = 'active'
        and membership.partner_id is null
        and membership.client_id is null
      order by membership.created_at limit 1),
    v_release.partner_id, v_release.client_id,
    'connector.release_rolled_back', 'support_ticket', p_ticket_id,
    'Rolled back connector release ' || coalesce(v_release.release_version, 'unknown') || '.',
    jsonb_build_object('release_status', v_release.status),
    jsonb_build_object('release_status', 'rolled_back'),
    jsonb_build_object(
      'release_version', v_release.release_version,
      'integration_request_id', v_request.id,
      'reason', trim(p_reason)
    )
  );

  return true;
end;
$$;

revoke all on function public.complete_connector_support_release(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.rollback_connector_support_release(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_connector_support_release(uuid, uuid, text, text) to service_role;
grant execute on function public.rollback_connector_support_release(uuid, uuid, text) to service_role;
