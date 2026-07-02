-- Goal 4: integration provider and connection foundation.
-- Creates the integration catalog, per-client connections, encrypted secrets,
-- and the integration event log with tenant RLS.

do $$
begin
  create type public.integration_status as enum (
    'not_connected',
    'connected',
    'needs_attention',
    'failing',
    'paused',
    'disabled'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.integration_providers (
  id uuid primary key default extensions.gen_random_uuid(),
  provider_key text not null unique,
  display_name text not null,
  category text not null,
  supports_inbound boolean not null default false,
  supports_outbound boolean not null default false,
  supports_oauth boolean not null default false,
  supports_api_key boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.integration_connections (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  provider_id uuid not null references public.integration_providers (id),
  display_name text not null,
  status public.integration_status not null default 'not_connected',
  runtime_mode public.runtime_mode not null default 'sandbox',
  credential_status text not null default 'missing',
  config jsonb not null default '{}',
  health_summary text,
  error_count integer not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_connections_credential_status_check
    check (credential_status in ('missing', 'configured', 'invalid', 'rotating')),
  constraint integration_connections_client_scope_fk
    foreign key (partner_id, client_id)
    references public.client_businesses (partner_id, id)
    on delete cascade
);

create table if not exists public.integration_secrets (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  connection_id uuid not null references public.integration_connections (id) on delete cascade,
  secret_kind text not null,
  encrypted_value text not null,
  last_four text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_secrets_connection_kind_unique unique (connection_id, secret_kind)
);

create table if not exists public.integration_events (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  connection_id uuid references public.integration_connections (id) on delete set null,
  workflow_run_id uuid,
  direction text not null,
  event_type text not null,
  status text not null,
  idempotency_key text,
  external_object_type text,
  external_object_id text,
  request_payload jsonb,
  response_payload jsonb,
  error_code text,
  error_message text,
  redacted boolean not null default true,
  created_at timestamptz not null default now(),
  constraint integration_events_direction_check
    check (direction in ('inbound', 'outbound')),
  constraint integration_events_status_check
    check (status in ('received', 'processed', 'rejected', 'failed', 'skipped'))
);

create index if not exists integration_connections_partner_client_idx
  on public.integration_connections (partner_id, client_id);
create index if not exists integration_secrets_connection_idx
  on public.integration_secrets (connection_id);
create index if not exists integration_events_partner_client_created_idx
  on public.integration_events (partner_id, client_id, created_at desc);
create index if not exists integration_events_connection_created_idx
  on public.integration_events (connection_id, created_at desc);

-- Inbound idempotency: the same external event id for a connection is stored once.
create unique index if not exists integration_events_inbound_idempotency_unique
  on public.integration_events (connection_id, idempotency_key)
  where idempotency_key is not null and direction = 'inbound';

drop trigger if exists set_integration_connections_updated_at on public.integration_connections;
create trigger set_integration_connections_updated_at
before update on public.integration_connections
for each row execute function public.set_updated_at();

drop trigger if exists set_integration_secrets_updated_at on public.integration_secrets;
create trigger set_integration_secrets_updated_at
before update on public.integration_secrets
for each row execute function public.set_updated_at();

alter table public.integration_providers enable row level security;
alter table public.integration_connections enable row level security;
alter table public.integration_secrets enable row level security;
alter table public.integration_events enable row level security;

-- Providers are a global read-only catalog for signed-in users.
create policy "integration_providers_select_authenticated"
on public.integration_providers
for select
to authenticated
using (is_active = true or public.current_user_has_platform_role());

create policy "integration_connections_select_accessible"
on public.integration_connections
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or public.current_user_has_client_role(client_id)
);

create policy "integration_connections_insert_authorized"
on public.integration_connections
for insert
to authenticated
with check (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin',
    'partner_implementer'
  ]::public.membership_role[])
);

create policy "integration_connections_update_authorized"
on public.integration_connections
for update
to authenticated
using (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin',
    'partner_implementer'
  ]::public.membership_role[])
)
with check (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin',
    'partner_implementer'
  ]::public.membership_role[])
);

-- Secrets: rows visible only to partner operators/platform admins, and the
-- encrypted value column is never selectable by browser-session roles.
create policy "integration_secrets_select_partner_operators"
on public.integration_secrets
for select
to authenticated
using (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin',
    'partner_implementer'
  ]::public.membership_role[])
);

create policy "integration_secrets_insert_partner_operators"
on public.integration_secrets
for insert
to authenticated
with check (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin',
    'partner_implementer'
  ]::public.membership_role[])
);

create policy "integration_secrets_update_partner_operators"
on public.integration_secrets
for update
to authenticated
using (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin',
    'partner_implementer'
  ]::public.membership_role[])
)
with check (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin',
    'partner_implementer'
  ]::public.membership_role[])
);

create policy "integration_events_select_accessible"
on public.integration_events
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or public.current_user_has_client_role(client_id, array[
    'client_owner',
    'client_manager'
  ]::public.membership_role[])
);

grant select on public.integration_providers to authenticated;
grant select, insert, update on public.integration_connections to authenticated;

-- Hosted Supabase applies default privileges that grant ALL on new tables to
-- the API roles. Revoke first so the column-level select grant below is the
-- complete privilege set and encrypted_value is never selectable.
revoke all on public.integration_secrets from anon, authenticated;

-- Column-level grants: encrypted_value is intentionally excluded from select.
grant select (
  id,
  partner_id,
  client_id,
  connection_id,
  secret_kind,
  last_four,
  created_at,
  updated_at
) on public.integration_secrets to authenticated;
grant insert, update on public.integration_secrets to authenticated;

grant select on public.integration_events to authenticated;

-- Initial provider catalog. This is product catalog data, not demo data.
insert into public.integration_providers (
  provider_key,
  display_name,
  category,
  supports_inbound,
  supports_outbound,
  supports_api_key
)
values
  ('generic_inbound_webhook', 'Generic Inbound Webhook', 'inbound_webhook', true, false, true),
  ('generic_outbound_webhook', 'Generic Outbound Webhook', 'outbound_webhook', false, true, true),
  ('crm_placeholder', 'CRM (Adapter Pending)', 'crm', false, false, false),
  ('phone_placeholder', 'Phone Provider (Adapter Pending)', 'phone', false, false, false),
  ('sms_placeholder', 'SMS Provider (Adapter Pending)', 'sms', false, false, false),
  ('email_placeholder', 'Email Provider (Adapter Pending)', 'email', false, false, false),
  ('calendar_placeholder', 'Calendar Provider (Adapter Pending)', 'calendar', false, false, false)
on conflict (provider_key) do update
  set display_name = excluded.display_name,
      category = excluded.category,
      supports_inbound = excluded.supports_inbound,
      supports_outbound = excluded.supports_outbound,
      supports_api_key = excluded.supports_api_key;
