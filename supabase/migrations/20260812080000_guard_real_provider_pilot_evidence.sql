-- Real-account provider pilots must use a production client connection and
-- evidence generated after the owner explicitly starts the pilot.

alter table public.provider_live_pilots
  add column if not exists started_at timestamptz;

update public.provider_live_pilots
set started_at = case
  when status = 'draft' then clock_timestamp()
  else created_at
end
where started_at is null;

alter table public.provider_live_pilots
  alter column started_at set default clock_timestamp(),
  alter column started_at set not null;

-- Existing drafts predate the explicit start boundary. Keep their written
-- notes, but require fresh event proof after this migration.
update public.provider_live_pilots
set inbound_event_id = null,
    outbound_event_id = null
where status = 'draft';

create or replace function public.validate_provider_live_pilot_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_connection record;
  v_event record;
  v_started_at timestamptz;
begin
  if tg_op = 'INSERT' and new.status <> 'draft' then
    raise exception 'New provider pilots must begin in draft status.';
  end if;
  if tg_op = 'UPDATE'
    and new.started_at is distinct from old.started_at then
    raise exception 'Provider pilot start time is immutable.';
  end if;
  if tg_op = 'UPDATE'
    and new.status is distinct from old.status
    and coalesce(auth.role(), '') <> 'service_role'
    and current_user not in ('postgres', 'service_role') then
    raise exception 'Provider pilot status changes require the guarded service operation.';
  end if;
  if tg_op = 'UPDATE'
    and old.status in ('passed', 'revoked')
    and coalesce(auth.role(), '') <> 'service_role'
    and current_user not in ('postgres', 'service_role') then
    raise exception 'Completed provider pilot evidence is immutable.';
  end if;

  select
    connection.provider_id,
    connection.partner_id,
    connection.client_id,
    client.account_kind,
    client.is_test_account
  into v_connection
  from public.integration_connections connection
  join public.client_businesses client on client.id = connection.client_id
  where connection.id = new.connection_id;

  if not found or v_connection.provider_id <> new.provider_id then
    raise exception 'Pilot provider must match its connection provider.';
  end if;
  if v_connection.account_kind <> 'managed_client'
    or v_connection.is_test_account then
    raise exception 'Provider pilots require a real managed client account.';
  end if;

  v_started_at := case
    when tg_op = 'INSERT' then new.started_at
    else old.started_at
  end;

  if new.inbound_event_id is not null then
    select connection_id, partner_id, client_id, direction, status, created_at
    into v_event
    from public.integration_events where id = new.inbound_event_id;
    if not found
      or v_event.connection_id <> new.connection_id
      or v_event.partner_id <> v_connection.partner_id
      or v_event.client_id <> v_connection.client_id
      or v_event.direction <> 'inbound'
      or v_event.status <> 'processed'
      or v_event.created_at < v_started_at then
      raise exception 'Inbound evidence must be a processed post-pilot event for this connection.';
    end if;
  end if;

  if new.outbound_event_id is not null then
    select connection_id, partner_id, client_id, direction, status, created_at
    into v_event
    from public.integration_events where id = new.outbound_event_id;
    if not found
      or v_event.connection_id <> new.connection_id
      or v_event.partner_id <> v_connection.partner_id
      or v_event.client_id <> v_connection.client_id
      or v_event.direction <> 'outbound'
      or v_event.status <> 'processed'
      or v_event.created_at < v_started_at then
      raise exception 'Outbound evidence must be a processed post-pilot event for this connection.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.promote_provider_live_pilot(
  p_pilot_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pilot public.provider_live_pilots%rowtype;
  v_connection public.integration_connections%rowtype;
  v_provider public.integration_providers%rowtype;
  v_client public.client_businesses%rowtype;
begin
  select * into v_pilot
  from public.provider_live_pilots
  where id = p_pilot_id
  for update;

  if not found or v_pilot.status <> 'draft' then
    return false;
  end if;

  select * into v_connection
  from public.integration_connections
  where id = v_pilot.connection_id;
  select * into v_provider
  from public.integration_providers
  where id = v_pilot.provider_id
  for update;
  select * into v_client
  from public.client_businesses
  where id = v_connection.client_id;

  if v_connection.provider_id <> v_provider.id
    or v_connection.status <> 'connected'
    or v_connection.credential_status <> 'configured'
    or v_connection.runtime_mode <> 'live'
    or v_client.account_kind <> 'managed_client'
    or v_client.is_test_account then
    return false;
  end if;

  if length(trim(v_pilot.read_evidence)) < 12
    or length(trim(v_pilot.retry_evidence)) < 12
    or length(trim(v_pilot.revocation_evidence)) < 12 then
    return false;
  end if;

  if v_provider.supports_inbound and not exists (
    select 1 from public.integration_events event
    where event.id = v_pilot.inbound_event_id
      and event.connection_id = v_connection.id
      and event.partner_id = v_connection.partner_id
      and event.client_id = v_connection.client_id
      and event.direction = 'inbound'
      and event.status = 'processed'
      and event.created_at >= v_pilot.started_at
  ) then
    return false;
  end if;
  if v_provider.supports_outbound and not exists (
    select 1 from public.integration_events event
    where event.id = v_pilot.outbound_event_id
      and event.connection_id = v_connection.id
      and event.partner_id = v_connection.partner_id
      and event.client_id = v_connection.client_id
      and event.direction = 'outbound'
      and event.status = 'processed'
      and event.created_at >= v_pilot.started_at
  ) then
    return false;
  end if;

  update public.provider_live_pilots
  set status = 'passed',
      reviewed_by = p_actor_id,
      passed_at = clock_timestamp(),
      revoked_at = null,
      revocation_reason = null
  where id = v_pilot.id;

  update public.integration_providers
  set connector_status = 'live_verified'
  where id = v_provider.id;

  return true;
end;
$$;

revoke all on function public.promote_provider_live_pilot(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.promote_provider_live_pilot(uuid, uuid)
  to service_role;

insert into public.platform_schema_state (
  singleton,
  current_migration,
  applied_at
) values (
  true,
  '20260812080000_guard_real_provider_pilot_evidence',
  now()
)
on conflict (singleton) do update
set current_migration = excluded.current_migration,
    applied_at = excluded.applied_at;
