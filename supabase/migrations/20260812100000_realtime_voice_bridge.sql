create table if not exists public.voice_tool_executions (
  id uuid primary key default extensions.gen_random_uuid(),
  call_session_id uuid not null references public.call_sessions (id) on delete cascade,
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  external_call_id text not null check (char_length(external_call_id) between 1 and 200),
  tool_name text not null check (char_length(tool_name) between 1 and 100),
  arguments jsonb not null default '{}'::jsonb,
  result jsonb,
  status text not null check (status in ('executing', 'succeeded', 'failed')),
  end_call boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (call_session_id, external_call_id)
);

create index if not exists voice_tool_executions_client_idx
  on public.voice_tool_executions (client_id, created_at desc);

alter table public.voice_tool_executions enable row level security;

drop policy if exists voice_tool_executions_select_scoped
  on public.voice_tool_executions;
create policy voice_tool_executions_select_scoped
  on public.voice_tool_executions
  for select to authenticated
  using (
    public.current_user_has_platform_role()
    or public.current_user_has_partner_role(partner_id)
    or public.current_user_has_partner_client_role(partner_id, client_id)
  );

grant select on public.voice_tool_executions to authenticated;

insert into public.platform_schema_state (
  singleton,
  current_migration,
  applied_at
) values (
  true,
  '20260812100000_realtime_voice_bridge',
  now()
)
on conflict (singleton) do update
set current_migration = excluded.current_migration,
    applied_at = excluded.applied_at;
