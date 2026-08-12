alter table public.platform_service_heartbeats
  drop constraint if exists platform_service_heartbeats_service_key_check;

alter table public.platform_service_heartbeats
  add constraint platform_service_heartbeats_service_key_check
  check (service_key in ('jobs', 'connector_worker'));

alter table public.platform_service_heartbeats
  add column if not exists instance_id text;

alter table public.platform_service_heartbeats
  drop constraint if exists platform_service_heartbeats_instance_id_check;
alter table public.platform_service_heartbeats
  add constraint platform_service_heartbeats_instance_id_check
  check (instance_id is null or char_length(instance_id) between 1 and 200);

insert into public.platform_schema_state (
  singleton,
  current_migration,
  applied_at
) values (
  true,
  '20260812090000_connector_worker_runtime_heartbeat',
  now()
)
on conflict (singleton) do update
set current_migration = excluded.current_migration,
    applied_at = excluded.applied_at;
