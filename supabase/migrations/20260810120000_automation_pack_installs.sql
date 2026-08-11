-- Durable one-click automation pack installations. A row represents the
-- desired and observed state of one versioned pack for one client. External
-- provider IDs are metadata only; credentials remain in integration_secrets.

create table if not exists public.client_automation_pack_installs (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  pack_key text not null,
  pack_version integer not null check (pack_version > 0),
  pack_name text not null,
  status text not null check (
    status in ('installing', 'needs_setup', 'ready_to_test', 'active', 'paused', 'failed')
  ),
  layer text not null check (layer in ('native', 'hybrid', 'workflow')),
  platforms text[] not null default array[]::text[],
  workflow_template_keys text[] not null default array[]::text[],
  required_connection_keys text[] not null default array[]::text[],
  missing_connection_keys text[] not null default array[]::text[],
  external_deployments jsonb not null default '[]'::jsonb,
  verification_evidence jsonb not null default '{}'::jsonb,
  last_verified_at timestamptz,
  last_error text,
  installed_by uuid references auth.users (id) on delete set null,
  installed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_automation_pack_installs_client_pack_unique
    unique (client_id, pack_key),
  constraint client_automation_pack_installs_client_scope_fk
    foreign key (partner_id, client_id)
    references public.client_businesses (partner_id, id)
    on delete cascade
);

create index if not exists client_automation_pack_installs_client_idx
  on public.client_automation_pack_installs (client_id, status, updated_at desc);

drop trigger if exists set_client_automation_pack_installs_updated_at
  on public.client_automation_pack_installs;
create trigger set_client_automation_pack_installs_updated_at
  before update on public.client_automation_pack_installs
  for each row execute function public.set_updated_at();

alter table public.client_automation_pack_installs enable row level security;

drop policy if exists "automation_pack_installs_select_scoped"
  on public.client_automation_pack_installs;
create policy "automation_pack_installs_select_scoped"
on public.client_automation_pack_installs
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or public.current_user_has_partner_client_role(partner_id, client_id)
);

drop policy if exists "automation_pack_installs_insert_operators"
  on public.client_automation_pack_installs;
create policy "automation_pack_installs_insert_operators"
on public.client_automation_pack_installs
for insert
to authenticated
with check (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin',
    'partner_implementer'
  ]::public.membership_role[])
);

drop policy if exists "automation_pack_installs_update_operators"
  on public.client_automation_pack_installs;
create policy "automation_pack_installs_update_operators"
on public.client_automation_pack_installs
for update
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin',
    'partner_implementer'
  ]::public.membership_role[])
)
with check (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin',
    'partner_implementer'
  ]::public.membership_role[])
);

grant select, insert, update on public.client_automation_pack_installs
  to authenticated;
