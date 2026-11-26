-- Keep the client lifecycle status in the same atomic transaction as runtime
-- activation. Rollback restores both runtime modes and the prior client status.

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
    'client_status', client.status,
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
  set default_runtime_mode = 'live',
      status = 'active'
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
      )::public.runtime_mode,
      status = coalesce(
        (v_launch.previous_runtime_snapshot ->> 'client_status')::public.client_status,
        'onboarding'::public.client_status
      )
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
