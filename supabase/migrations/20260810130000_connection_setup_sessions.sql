-- Secure, expiring client-facing connection links. Only a hash of the bearer
-- token is queryable; the encrypted copy exists solely so OAuth callbacks can
-- return the browser to the same setup session.

create table if not exists public.client_connection_setup_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  token_hash text not null unique,
  encrypted_token text not null,
  allowed_provider_keys text[] not null default array[]::text[],
  status text not null default 'active',
  expires_at timestamptz not null,
  completed_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_connection_setup_sessions_status_check
    check (status in ('active', 'completed', 'revoked')),
  constraint client_connection_setup_sessions_client_scope_fk
    foreign key (partner_id, client_id)
    references public.client_businesses (partner_id, id)
    on delete cascade
);

create index if not exists client_connection_setup_sessions_client_idx
  on public.client_connection_setup_sessions (partner_id, client_id, created_at desc);

drop trigger if exists set_client_connection_setup_sessions_updated_at
  on public.client_connection_setup_sessions;
create trigger set_client_connection_setup_sessions_updated_at
before update on public.client_connection_setup_sessions
for each row execute function public.set_updated_at();

alter table public.client_connection_setup_sessions enable row level security;

create policy "connection_setup_sessions_select_partner_operators"
on public.client_connection_setup_sessions
for select
to authenticated
using (
  public.current_user_has_platform_role(array[
    'platform_owner', 'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner', 'partner_admin', 'partner_implementer'
  ]::public.membership_role[])
);

create policy "connection_setup_sessions_insert_partner_operators"
on public.client_connection_setup_sessions
for insert
to authenticated
with check (
  public.current_user_has_platform_role(array[
    'platform_owner', 'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner', 'partner_admin', 'partner_implementer'
  ]::public.membership_role[])
);

create policy "connection_setup_sessions_update_partner_operators"
on public.client_connection_setup_sessions
for update
to authenticated
using (
  public.current_user_has_platform_role(array[
    'platform_owner', 'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner', 'partner_admin', 'partner_implementer'
  ]::public.membership_role[])
)
with check (
  public.current_user_has_platform_role(array[
    'platform_owner', 'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner', 'partner_admin', 'partner_implementer'
  ]::public.membership_role[])
);

revoke all on public.client_connection_setup_sessions from anon, authenticated;
grant select, insert, update on public.client_connection_setup_sessions to authenticated;
grant all on public.client_connection_setup_sessions to service_role;
