-- Durable normalized records received from external connectors. These are a
-- provider-neutral staging/audit layer before records are projected into the
-- built-in CRM or another destination.

create table if not exists public.integration_canonical_records (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  connection_id uuid not null references public.integration_connections (id) on delete cascade,
  object_type text not null,
  external_object_id text not null,
  external_parent_id text,
  canonical_data jsonb not null default '{}'::jsonb,
  source_payload jsonb not null default '{}'::jsonb,
  external_updated_at timestamptz,
  native_object_id text,
  projection_status text not null default 'pending',
  projection_error text,
  projected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_canonical_records_projection_check
    check (projection_status in ('pending', 'projected', 'skipped', 'failed')),
  constraint integration_canonical_records_scope_fk
    foreign key (partner_id, client_id, connection_id)
    references public.integration_connections (partner_id, client_id, id)
    on delete cascade,
  constraint integration_canonical_records_unique
    unique (connection_id, object_type, external_object_id)
);

create index if not exists integration_canonical_records_projection_idx
  on public.integration_canonical_records (client_id, projection_status, created_at)
  where projection_status in ('pending', 'failed');

drop trigger if exists set_integration_canonical_records_updated_at
  on public.integration_canonical_records;
create trigger set_integration_canonical_records_updated_at
before update on public.integration_canonical_records
for each row execute function public.set_updated_at();

alter table public.integration_canonical_records enable row level security;

create policy "integration_canonical_records_select_scoped"
on public.integration_canonical_records for select to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or public.current_user_has_client_role(client_id, array[
    'client_owner', 'client_manager'
  ]::public.membership_role[])
);

grant select on public.integration_canonical_records to authenticated;
grant all on public.integration_canonical_records to service_role;
