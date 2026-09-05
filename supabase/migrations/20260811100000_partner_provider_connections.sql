-- Partner-owned infrastructure. A partner connects its own provider account
-- once; client resources are then provisioned beneath that account. Platform
-- operators do not own or pay for these provider resources.

create table if not exists public.partner_provider_connections (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  provider_key text not null,
  display_name text not null,
  status text not null default 'not_connected',
  credential_status text not null default 'missing',
  config jsonb not null default '{}',
  health_summary text,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_provider_connections_partner_provider_unique
    unique (partner_id, provider_key),
  constraint partner_provider_connections_id_partner_unique
    unique (id, partner_id),
  constraint partner_provider_connections_status_check
    check (status in ('not_connected', 'connected', 'needs_attention', 'disabled')),
  constraint partner_provider_connections_credential_status_check
    check (credential_status in ('missing', 'configured', 'invalid', 'rotating'))
);

create table if not exists public.partner_provider_secrets (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  connection_id uuid not null,
  secret_kind text not null,
  encrypted_value text not null,
  last_four text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_provider_secrets_connection_kind_unique
    unique (connection_id, secret_kind),
  constraint partner_provider_secrets_connection_partner_fk
    foreign key (connection_id, partner_id)
    references public.partner_provider_connections (id, partner_id)
    on delete cascade
);

drop trigger if exists set_partner_provider_connections_updated_at
  on public.partner_provider_connections;
create trigger set_partner_provider_connections_updated_at
before update on public.partner_provider_connections
for each row execute function public.set_updated_at();

drop trigger if exists set_partner_provider_secrets_updated_at
  on public.partner_provider_secrets;
create trigger set_partner_provider_secrets_updated_at
before update on public.partner_provider_secrets
for each row execute function public.set_updated_at();

alter table public.partner_provider_connections enable row level security;
alter table public.partner_provider_secrets enable row level security;

create policy "partner_provider_connections_select_managers"
on public.partner_provider_connections for select to authenticated
using (
  public.current_user_has_platform_role(array['platform_owner', 'platform_admin']::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array['partner_owner', 'partner_admin']::public.membership_role[])
);

create policy "partner_provider_connections_insert_managers"
on public.partner_provider_connections for insert to authenticated
with check (
  public.current_user_has_platform_role(array['platform_owner', 'platform_admin']::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array['partner_owner', 'partner_admin']::public.membership_role[])
);

create policy "partner_provider_connections_update_managers"
on public.partner_provider_connections for update to authenticated
using (
  public.current_user_has_platform_role(array['platform_owner', 'platform_admin']::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array['partner_owner', 'partner_admin']::public.membership_role[])
)
with check (
  public.current_user_has_platform_role(array['platform_owner', 'platform_admin']::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array['partner_owner', 'partner_admin']::public.membership_role[])
);

create policy "partner_provider_secrets_select_managers"
on public.partner_provider_secrets for select to authenticated
using (
  public.current_user_has_platform_role(array['platform_owner', 'platform_admin']::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array['partner_owner', 'partner_admin']::public.membership_role[])
);

create policy "partner_provider_secrets_insert_managers"
on public.partner_provider_secrets for insert to authenticated
with check (
  public.current_user_has_platform_role(array['platform_owner', 'platform_admin']::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array['partner_owner', 'partner_admin']::public.membership_role[])
);

create policy "partner_provider_secrets_update_managers"
on public.partner_provider_secrets for update to authenticated
using (
  public.current_user_has_platform_role(array['platform_owner', 'platform_admin']::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array['partner_owner', 'partner_admin']::public.membership_role[])
)
with check (
  public.current_user_has_platform_role(array['platform_owner', 'platform_admin']::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array['partner_owner', 'partner_admin']::public.membership_role[])
);

revoke all on public.partner_provider_secrets from anon, authenticated;
grant select (id, partner_id, connection_id, secret_kind, last_four, created_at, updated_at)
  on public.partner_provider_secrets to authenticated;
grant insert, update on public.partner_provider_secrets to authenticated;
grant select, insert, update on public.partner_provider_connections to authenticated;
grant all on public.partner_provider_connections to service_role;
grant all on public.partner_provider_secrets to service_role;
