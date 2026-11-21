-- Reusable connector platform. Provider-specific adapters plug into these
-- contracts while credentials remain in integration_secrets.

alter table public.integration_providers
  add column if not exists description text,
  add column if not exists auth_strategy text not null default 'none',
  add column if not exists capabilities text[] not null default array[]::text[],
  add column if not exists connector_status text not null default 'unavailable',
  add column if not exists docs_url text,
  add column if not exists is_requestable boolean not null default true;

alter table public.integration_providers
  drop constraint if exists integration_providers_auth_strategy_check;
alter table public.integration_providers
  add constraint integration_providers_auth_strategy_check
  check (auth_strategy in ('none', 'api_key', 'oauth2', 'basic', 'managed', 'webhook'));

alter table public.integration_providers
  drop constraint if exists integration_providers_connector_status_check;
alter table public.integration_providers
  add constraint integration_providers_connector_status_check
  check (connector_status in (
    'unavailable', 'planned', 'contract_verified', 'live_verified', 'restricted'
  ));

alter table public.integration_connections
  add column if not exists external_account_id text,
  add column if not exists external_account_name text,
  add column if not exists connector_version text,
  add column if not exists last_checked_at timestamptz;

create unique index if not exists integration_connections_scope_unique
  on public.integration_connections (partner_id, client_id, id);

create table if not exists public.integration_object_links (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  connection_id uuid not null references public.integration_connections (id) on delete cascade,
  object_type text not null,
  native_object_id text not null,
  external_object_id text not null,
  external_parent_id text,
  external_updated_at timestamptz,
  last_synced_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_object_links_scope_fk
    foreign key (partner_id, client_id, connection_id)
    references public.integration_connections (partner_id, client_id, id)
    on delete cascade,
  constraint integration_object_links_native_unique
    unique (connection_id, object_type, native_object_id),
  constraint integration_object_links_external_unique
    unique (connection_id, object_type, external_object_id)
);

create table if not exists public.integration_field_mappings (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  connection_id uuid not null references public.integration_connections (id) on delete cascade,
  object_type text not null,
  direction text not null default 'both',
  native_field text not null,
  external_field text not null,
  transform_key text,
  default_value jsonb,
  is_required boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_field_mappings_direction_check
    check (direction in ('pull', 'push', 'both')),
  constraint integration_field_mappings_scope_fk
    foreign key (partner_id, client_id, connection_id)
    references public.integration_connections (partner_id, client_id, id)
    on delete cascade,
  constraint integration_field_mappings_unique
    unique (connection_id, object_type, direction, native_field)
);

create table if not exists public.integration_sync_states (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  connection_id uuid not null references public.integration_connections (id) on delete cascade,
  stream_key text not null,
  cursor_value jsonb,
  status text not null default 'idle',
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_error text,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_sync_states_status_check
    check (status in ('idle', 'running', 'failing', 'paused')),
  constraint integration_sync_states_scope_fk
    foreign key (partner_id, client_id, connection_id)
    references public.integration_connections (partner_id, client_id, id)
    on delete cascade,
  constraint integration_sync_states_unique unique (connection_id, stream_key)
);

create table if not exists public.integration_webhook_registrations (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  connection_id uuid not null references public.integration_connections (id) on delete cascade,
  event_type text not null,
  endpoint_path text not null,
  external_registration_id text,
  status text not null default 'pending',
  expires_at timestamptz,
  last_verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_webhook_registrations_status_check
    check (status in ('pending', 'active', 'expiring', 'failed', 'disabled')),
  constraint integration_webhook_registrations_scope_fk
    foreign key (partner_id, client_id, connection_id)
    references public.integration_connections (partner_id, client_id, id)
    on delete cascade,
  constraint integration_webhook_registrations_unique
    unique (connection_id, event_type, endpoint_path)
);

create table if not exists public.integration_sync_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  connection_id uuid not null references public.integration_connections (id) on delete cascade,
  direction text not null,
  object_type text not null,
  operation text not null,
  status text not null default 'queued',
  idempotency_key text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  scheduled_for timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_sync_jobs_direction_check
    check (direction in ('pull', 'push')),
  constraint integration_sync_jobs_status_check
    check (status in ('queued', 'running', 'succeeded', 'failed', 'dead_letter', 'cancelled')),
  constraint integration_sync_jobs_attempts_check
    check (attempts >= 0 and max_attempts between 1 and 20),
  constraint integration_sync_jobs_scope_fk
    foreign key (partner_id, client_id, connection_id)
    references public.integration_connections (partner_id, client_id, id)
    on delete cascade
);

create unique index if not exists integration_sync_jobs_idempotency_unique
  on public.integration_sync_jobs (connection_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists integration_sync_jobs_queue_idx
  on public.integration_sync_jobs (status, scheduled_for, created_at)
  where status in ('queued', 'failed');
create index if not exists integration_object_links_external_idx
  on public.integration_object_links (connection_id, object_type, external_object_id);
create index if not exists integration_webhooks_expiration_idx
  on public.integration_webhook_registrations (status, expires_at)
  where expires_at is not null;

drop trigger if exists set_integration_object_links_updated_at on public.integration_object_links;
create trigger set_integration_object_links_updated_at
before update on public.integration_object_links
for each row execute function public.set_updated_at();

drop trigger if exists set_integration_field_mappings_updated_at on public.integration_field_mappings;
create trigger set_integration_field_mappings_updated_at
before update on public.integration_field_mappings
for each row execute function public.set_updated_at();

drop trigger if exists set_integration_sync_states_updated_at on public.integration_sync_states;
create trigger set_integration_sync_states_updated_at
before update on public.integration_sync_states
for each row execute function public.set_updated_at();

drop trigger if exists set_integration_webhook_registrations_updated_at on public.integration_webhook_registrations;
create trigger set_integration_webhook_registrations_updated_at
before update on public.integration_webhook_registrations
for each row execute function public.set_updated_at();

drop trigger if exists set_integration_sync_jobs_updated_at on public.integration_sync_jobs;
create trigger set_integration_sync_jobs_updated_at
before update on public.integration_sync_jobs
for each row execute function public.set_updated_at();

alter table public.integration_object_links enable row level security;
alter table public.integration_field_mappings enable row level security;
alter table public.integration_sync_states enable row level security;
alter table public.integration_webhook_registrations enable row level security;
alter table public.integration_sync_jobs enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'integration_object_links',
    'integration_field_mappings',
    'integration_sync_states',
    'integration_webhook_registrations',
    'integration_sync_jobs'
  ]
  loop
    execute format('drop policy if exists "%s_select_scoped" on public.%I', table_name, table_name);
    execute format($policy$
      create policy "%s_select_scoped" on public.%I
      for select to authenticated
      using (
        public.current_user_has_platform_role()
        or public.current_user_has_partner_role(partner_id)
        or public.current_user_has_client_role(client_id, array[
          'client_owner', 'client_manager'
        ]::public.membership_role[])
      )
    $policy$, table_name, table_name);
  end loop;
end $$;

create policy "integration_field_mappings_insert_operators"
on public.integration_field_mappings for insert to authenticated
with check (
  public.current_user_has_platform_role(array['platform_owner', 'platform_admin']::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array['partner_owner', 'partner_admin', 'partner_implementer']::public.membership_role[])
  or public.current_user_has_client_role(client_id, array['client_owner', 'client_manager']::public.membership_role[])
);

create policy "integration_field_mappings_update_operators"
on public.integration_field_mappings for update to authenticated
using (
  public.current_user_has_platform_role(array['platform_owner', 'platform_admin']::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array['partner_owner', 'partner_admin', 'partner_implementer']::public.membership_role[])
  or public.current_user_has_client_role(client_id, array['client_owner', 'client_manager']::public.membership_role[])
)
with check (
  public.current_user_has_platform_role(array['platform_owner', 'platform_admin']::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array['partner_owner', 'partner_admin', 'partner_implementer']::public.membership_role[])
  or public.current_user_has_client_role(client_id, array['client_owner', 'client_manager']::public.membership_role[])
);

create policy "integration_field_mappings_delete_operators"
on public.integration_field_mappings for delete to authenticated
using (
  public.current_user_has_platform_role(array['platform_owner', 'platform_admin']::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array['partner_owner', 'partner_admin', 'partner_implementer']::public.membership_role[])
  or public.current_user_has_client_role(client_id, array['client_owner', 'client_manager']::public.membership_role[])
);

grant select on public.integration_object_links to authenticated;
grant select, insert, update, delete on public.integration_field_mappings to authenticated;
grant select on public.integration_sync_states to authenticated;
grant select on public.integration_webhook_registrations to authenticated;
grant select on public.integration_sync_jobs to authenticated;

grant all on public.integration_object_links to service_role;
grant all on public.integration_field_mappings to service_role;
grant all on public.integration_sync_states to service_role;
grant all on public.integration_webhook_registrations to service_role;
grant all on public.integration_sync_jobs to service_role;

update public.integration_providers
set connector_status = 'contract_verified',
    auth_strategy = case provider_key
      when 'google_calendar' then 'oauth2'
      when 'northstar_web_chat' then 'managed'
      when 'generic_inbound_webhook' then 'webhook'
      when 'generic_outbound_webhook' then 'webhook'
      else 'api_key'
    end
where provider_key in (
  'hubspot', 'gohighlevel', 'twilio', 'resend', 'google_calendar',
  'northstar_web_chat', 'generic_inbound_webhook', 'generic_outbound_webhook'
);
