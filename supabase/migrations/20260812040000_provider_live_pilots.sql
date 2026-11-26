-- Audited real-account evidence for promoting connector contracts to live use.
-- Browser roles can maintain evidence, but only the guarded service-role
-- functions can change the global connector verification status.

create table if not exists public.provider_live_pilots (
  id uuid primary key default extensions.gen_random_uuid(),
  provider_id uuid not null references public.integration_providers (id) on delete cascade,
  connection_id uuid not null references public.integration_connections (id) on delete cascade,
  status text not null default 'draft',
  inbound_event_id uuid references public.integration_events (id) on delete set null,
  outbound_event_id uuid references public.integration_events (id) on delete set null,
  read_evidence text not null default '',
  retry_evidence text not null default '',
  revocation_evidence text not null default '',
  notes text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  passed_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_live_pilots_status_check
    check (status in ('draft', 'passed', 'revoked')),
  constraint provider_live_pilots_evidence_length_check check (
    length(read_evidence) <= 4000
    and length(retry_evidence) <= 4000
    and length(revocation_evidence) <= 4000
    and length(notes) <= 8000
    and coalesce(length(revocation_reason), 0) <= 2000
  )
);

alter table public.provider_live_pilots
  drop constraint if exists provider_live_pilots_connection_unique;
create unique index if not exists provider_live_pilots_active_connection_idx
  on public.provider_live_pilots (connection_id)
  where status in ('draft', 'passed');
create index if not exists provider_live_pilots_provider_status_idx
  on public.provider_live_pilots (provider_id, status, updated_at desc);

create or replace function public.validate_provider_live_pilot_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_connection_provider_id uuid;
  v_event record;
begin
  if tg_op = 'INSERT' and new.status <> 'draft' then
    raise exception 'New provider pilots must begin in draft status.';
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

  select provider_id into v_connection_provider_id
  from public.integration_connections
  where id = new.connection_id;

  if v_connection_provider_id is null or v_connection_provider_id <> new.provider_id then
    raise exception 'Pilot provider must match its connection provider.';
  end if;

  if new.inbound_event_id is not null then
    select connection_id, direction, status into v_event
    from public.integration_events where id = new.inbound_event_id;
    if not found
      or v_event.connection_id <> new.connection_id
      or v_event.direction <> 'inbound'
      or v_event.status <> 'processed' then
      raise exception 'Inbound evidence must be a processed event for this connection.';
    end if;
  end if;

  if new.outbound_event_id is not null then
    select connection_id, direction, status into v_event
    from public.integration_events where id = new.outbound_event_id;
    if not found
      or v_event.connection_id <> new.connection_id
      or v_event.direction <> 'outbound'
      or v_event.status <> 'processed' then
      raise exception 'Outbound evidence must be a processed event for this connection.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_provider_live_pilot_scope
  on public.provider_live_pilots;
create trigger validate_provider_live_pilot_scope
before insert or update on public.provider_live_pilots
for each row execute function public.validate_provider_live_pilot_scope();

drop trigger if exists set_provider_live_pilots_updated_at
  on public.provider_live_pilots;
create trigger set_provider_live_pilots_updated_at
before update on public.provider_live_pilots
for each row execute function public.set_updated_at();

alter table public.provider_live_pilots enable row level security;

drop policy if exists "provider_live_pilots_platform_read"
  on public.provider_live_pilots;
create policy "provider_live_pilots_platform_read"
on public.provider_live_pilots for select to authenticated
using (public.current_user_has_platform_role());

drop policy if exists "provider_live_pilots_platform_insert"
  on public.provider_live_pilots;
create policy "provider_live_pilots_platform_insert"
on public.provider_live_pilots for insert to authenticated
with check (
  public.current_user_has_platform_role(
    array['platform_owner', 'platform_admin']::public.membership_role[]
  )
);

drop policy if exists "provider_live_pilots_platform_update"
  on public.provider_live_pilots;
create policy "provider_live_pilots_platform_update"
on public.provider_live_pilots for update to authenticated
using (
  public.current_user_has_platform_role(
    array['platform_owner', 'platform_admin']::public.membership_role[]
  )
)
with check (
  public.current_user_has_platform_role(
    array['platform_owner', 'platform_admin']::public.membership_role[]
  )
);

grant select, insert, update on public.provider_live_pilots to authenticated;
grant all on public.provider_live_pilots to service_role;

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

  if v_connection.provider_id <> v_provider.id
    or v_connection.status <> 'connected'
    or v_connection.credential_status <> 'configured'
    or v_connection.runtime_mode <> 'live' then
    return false;
  end if;

  if length(trim(v_pilot.read_evidence)) < 12
    or length(trim(v_pilot.retry_evidence)) < 12
    or length(trim(v_pilot.revocation_evidence)) < 12 then
    return false;
  end if;

  if v_provider.supports_inbound and v_pilot.inbound_event_id is null then
    return false;
  end if;
  if v_provider.supports_outbound and v_pilot.outbound_event_id is null then
    return false;
  end if;

  update public.provider_live_pilots
  set status = 'passed',
      reviewed_by = p_actor_id,
      passed_at = now(),
      revoked_at = null,
      revocation_reason = null
  where id = v_pilot.id;

  update public.integration_providers
  set connector_status = 'live_verified'
  where id = v_provider.id;

  return true;
end;
$$;

create or replace function public.revoke_provider_live_pilot(
  p_pilot_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pilot public.provider_live_pilots%rowtype;
begin
  if length(trim(coalesce(p_reason, ''))) < 12 then
    return false;
  end if;

  select * into v_pilot
  from public.provider_live_pilots
  where id = p_pilot_id
  for update;

  if not found or v_pilot.status <> 'passed' then
    return false;
  end if;

  update public.provider_live_pilots
  set status = 'revoked',
      reviewed_by = p_actor_id,
      revoked_at = now(),
      revocation_reason = trim(p_reason)
  where id = v_pilot.id;

  if not exists (
    select 1 from public.provider_live_pilots
    where provider_id = v_pilot.provider_id
      and status = 'passed'
      and id <> v_pilot.id
  ) then
    update public.integration_providers
    set connector_status = 'contract_verified'
    where id = v_pilot.provider_id;
  end if;

  return true;
end;
$$;

revoke all on function public.promote_provider_live_pilot(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.revoke_provider_live_pilot(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.promote_provider_live_pilot(uuid, uuid)
  to service_role;
grant execute on function public.revoke_provider_live_pilot(uuid, uuid, text)
  to service_role;
