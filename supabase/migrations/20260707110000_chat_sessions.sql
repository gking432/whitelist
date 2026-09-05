-- Website AI chat widget sessions (docs/12 "Website AI Chat Assistant").
-- One row per visitor conversation. Written only by the widget's public
-- API routes through the service role; tenant members read.

create table if not exists public.chat_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  connection_id uuid not null references public.integration_connections (id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'completed', 'abandoned')),
  visitor_name text,
  visitor_phone text,
  visitor_email text,
  visitor_address text,
  service_need text,
  urgency text,
  appointment_preference text,
  -- [{"role": "visitor"|"assistant", "content": "...", "at": iso}]
  transcript jsonb not null default '[]'::jsonb,
  message_count integer not null default 0,
  -- Set when the completed conversation became an intake event.
  lead_event_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_sessions_client_idx
  on public.chat_sessions (client_id, created_at desc);
create index if not exists chat_sessions_connection_idx
  on public.chat_sessions (connection_id, created_at desc);

drop trigger if exists set_chat_sessions_updated_at on public.chat_sessions;
create trigger set_chat_sessions_updated_at
  before update on public.chat_sessions
  for each row execute function public.set_updated_at();

alter table public.chat_sessions enable row level security;

drop policy if exists "chat_sessions_select_scoped" on public.chat_sessions;
create policy "chat_sessions_select_scoped"
on public.chat_sessions
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or public.current_user_has_partner_client_role(partner_id, client_id)
);

-- Read-only for browser roles; the widget API (service role) writes.
grant select on public.chat_sessions to authenticated;
