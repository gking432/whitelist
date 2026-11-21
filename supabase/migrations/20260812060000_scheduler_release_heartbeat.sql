create table if not exists public.platform_service_heartbeats (
  service_key text primary key,
  release text not null,
  last_success_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_service_heartbeats_service_key_check
    check (service_key in ('jobs')),
  constraint platform_service_heartbeats_release_check
    check (release ~ '^[a-f0-9]{7,64}$')
);

drop trigger if exists set_platform_service_heartbeats_updated_at
  on public.platform_service_heartbeats;
create trigger set_platform_service_heartbeats_updated_at
before update on public.platform_service_heartbeats
for each row execute function public.set_updated_at();

alter table public.platform_service_heartbeats enable row level security;
revoke all on public.platform_service_heartbeats from public, anon, authenticated;
grant all on public.platform_service_heartbeats to service_role;

insert into public.platform_schema_state (
  singleton,
  current_migration,
  applied_at
) values (
  true,
  '20260812060000_scheduler_release_heartbeat',
  now()
)
on conflict (singleton) do update
set current_migration = excluded.current_migration,
    applied_at = excluded.applied_at;
