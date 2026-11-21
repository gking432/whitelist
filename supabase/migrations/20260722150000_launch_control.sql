-- Mobile launch control: package-derived test evidence, explicit activation,
-- and a complete runtime snapshot that can be restored in one transaction.

create table if not exists public.client_launches (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  package_id uuid references public.partner_packages (id) on delete set null,
  deployment_id uuid references public.client_package_deployments (id) on delete set null,
  status text not null check (
    status in ('testing', 'blocked', 'ready', 'live', 'rolled_back', 'failed')
  ),
  readiness_snapshot jsonb not null default '{}'::jsonb,
  test_summary jsonb not null default '{}'::jsonb,
  target_workflow_ids uuid[] not null default array[]::uuid[],
  target_connection_ids uuid[] not null default array[]::uuid[],
  previous_runtime_snapshot jsonb,
  error_message text,
  created_by uuid references auth.users (id) on delete set null,
  launched_by uuid references auth.users (id) on delete set null,
  rolled_back_by uuid references auth.users (id) on delete set null,
  tests_completed_at timestamptz,
  launched_at timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_launch_test_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  launch_id uuid not null references public.client_launches (id) on delete cascade,
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  scenario_key text not null,
  scenario_title text not null,
  status text not null check (status in ('running', 'passed', 'failed')),
  result jsonb not null default '{}'::jsonb,
  event_id uuid references public.integration_events (id) on delete set null,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists client_launches_client_idx
  on public.client_launches (client_id, created_at desc);

create unique index if not exists client_launches_one_live_per_client_idx
  on public.client_launches (client_id)
  where status = 'live';

create index if not exists client_launch_test_runs_launch_idx
  on public.client_launch_test_runs (launch_id, started_at);

drop trigger if exists set_client_launches_updated_at on public.client_launches;
create trigger set_client_launches_updated_at
  before update on public.client_launches
  for each row execute function public.set_updated_at();

alter table public.client_launches enable row level security;
alter table public.client_launch_test_runs enable row level security;

drop policy if exists "client_launches_select_scoped" on public.client_launches;
create policy "client_launches_select_scoped"
on public.client_launches
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or public.current_user_has_partner_client_role(partner_id, client_id)
);

drop policy if exists "client_launches_insert_operators" on public.client_launches;
create policy "client_launches_insert_operators"
on public.client_launches
for insert
to authenticated
with check (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin',
    'partner_implementer'
  ]::public.membership_role[])
);

drop policy if exists "client_launches_update_operators" on public.client_launches;
create policy "client_launches_update_operators"
on public.client_launches
for update
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin',
    'partner_implementer'
  ]::public.membership_role[])
)
with check (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin',
    'partner_implementer'
  ]::public.membership_role[])
);

drop policy if exists "launch_tests_select_scoped" on public.client_launch_test_runs;
create policy "launch_tests_select_scoped"
on public.client_launch_test_runs
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or public.current_user_has_partner_client_role(partner_id, client_id)
);

drop policy if exists "launch_tests_insert_operators" on public.client_launch_test_runs;
create policy "launch_tests_insert_operators"
on public.client_launch_test_runs
for insert
to authenticated
with check (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin',
    'partner_implementer'
  ]::public.membership_role[])
);

drop policy if exists "launch_tests_update_operators" on public.client_launch_test_runs;
create policy "launch_tests_update_operators"
on public.client_launch_test_runs
for update
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin',
    'partner_implementer'
  ]::public.membership_role[])
)
with check (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin',
    'partner_implementer'
  ]::public.membership_role[])
);

grant select, insert, update on public.client_launches to authenticated;
grant select, insert, update on public.client_launch_test_runs to authenticated;

create or replace function public.activate_client_launch(
  p_launch_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_launch public.client_launches%rowtype;
  v_snapshot jsonb;
begin
  select * into v_launch
  from public.client_launches
  where id = p_launch_id
  for update;

  if not found or v_launch.status <> 'ready' then
    raise exception 'Launch is not ready for activation.';
  end if;

  if exists (
    select 1
    from unnest(v_launch.target_workflow_ids) as target(id)
    left join public.client_workflow_instances workflow on workflow.id = target.id
    where workflow.id is null
      or workflow.client_id <> v_launch.client_id
      or workflow.partner_id <> v_launch.partner_id
      or workflow.status <> 'active'
  ) then
    raise exception 'A launch workflow is no longer active.';
  end if;

  if exists (
    select 1
    from unnest(v_launch.target_connection_ids) as target(id)
    left join public.integration_connections connection on connection.id = target.id
    where connection.id is null
      or connection.client_id <> v_launch.client_id
      or connection.partner_id <> v_launch.partner_id
      or connection.status <> 'connected'
  ) then
    raise exception 'A launch connection is no longer connected.';
  end if;

  select jsonb_build_object(
    'client_default_runtime_mode', client.default_runtime_mode,
    'workflows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', workflow.id,
        'runtime_mode', workflow.runtime_mode
      ))
      from public.client_workflow_instances workflow
      where workflow.id = any(v_launch.target_workflow_ids)
    ), '[]'::jsonb),
    'connections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', connection.id,
        'runtime_mode', connection.runtime_mode
      ))
      from public.integration_connections connection
      where connection.id = any(v_launch.target_connection_ids)
    ), '[]'::jsonb)
  ) into v_snapshot
  from public.client_businesses client
  where client.id = v_launch.client_id;

  update public.client_workflow_instances
  set runtime_mode = 'live'
  where id = any(v_launch.target_workflow_ids);

  update public.integration_connections
  set runtime_mode = 'live'
  where id = any(v_launch.target_connection_ids);

  update public.client_businesses
  set default_runtime_mode = 'live'
  where id = v_launch.client_id;

  update public.client_launches
  set status = 'live',
      previous_runtime_snapshot = v_snapshot,
      launched_by = p_actor_id,
      launched_at = now(),
      error_message = null
  where id = p_launch_id;
end;
$$;

create or replace function public.rollback_client_launch(
  p_launch_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_launch public.client_launches%rowtype;
begin
  select * into v_launch
  from public.client_launches
  where id = p_launch_id
  for update;

  if not found or v_launch.status <> 'live' then
    raise exception 'Only the active live launch can be rolled back.';
  end if;

  if v_launch.previous_runtime_snapshot is null then
    raise exception 'The pre-launch runtime snapshot is missing.';
  end if;

  update public.client_workflow_instances workflow
  set runtime_mode = snapshot.runtime_mode::public.runtime_mode
  from jsonb_to_recordset(v_launch.previous_runtime_snapshot -> 'workflows')
    as snapshot(id uuid, runtime_mode text)
  where workflow.id = snapshot.id
    and workflow.client_id = v_launch.client_id;

  update public.integration_connections connection
  set runtime_mode = snapshot.runtime_mode::public.runtime_mode
  from jsonb_to_recordset(v_launch.previous_runtime_snapshot -> 'connections')
    as snapshot(id uuid, runtime_mode text)
  where connection.id = snapshot.id
    and connection.client_id = v_launch.client_id;

  update public.client_businesses
  set default_runtime_mode = (
    v_launch.previous_runtime_snapshot ->> 'client_default_runtime_mode'
  )::public.runtime_mode
  where id = v_launch.client_id;

  update public.client_launches
  set status = 'rolled_back',
      rolled_back_by = p_actor_id,
      rolled_back_at = now(),
      error_message = null
  where id = p_launch_id;
end;
$$;

revoke all on function public.activate_client_launch(uuid, uuid) from public;
revoke all on function public.rollback_client_launch(uuid, uuid) from public;
grant execute on function public.activate_client_launch(uuid, uuid) to service_role;
grant execute on function public.rollback_client_launch(uuid, uuid) to service_role;
