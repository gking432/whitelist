create table if not exists public.platform_schema_state (
  singleton boolean primary key default true check (singleton),
  current_migration text not null,
  applied_at timestamptz not null default now()
);

alter table public.platform_schema_state enable row level security;

revoke all on public.platform_schema_state from public, anon, authenticated;
grant all on public.platform_schema_state to service_role;

insert into public.platform_schema_state (
  singleton,
  current_migration,
  applied_at
) values (
  true,
  '20260812050000_production_schema_marker',
  now()
)
on conflict (singleton) do update
set current_migration = excluded.current_migration,
    applied_at = excluded.applied_at;
