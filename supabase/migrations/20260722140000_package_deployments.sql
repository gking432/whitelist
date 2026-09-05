-- Package deployment history. Assigning a package now provisions its workflow
-- pack and automation intake bridge, then records what is ready and which real
-- provider connections are still required before go-live.

create table if not exists public.client_package_deployments (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  package_id uuid references public.partner_packages (id) on delete set null,
  package_name text not null,
  status text not null check (status in ('provisioning', 'needs_setup', 'ready', 'failed')),
  capabilities_snapshot jsonb not null default '{}'::jsonb,
  workflow_template_keys text[] not null default array[]::text[],
  provisioned_workflow_keys text[] not null default array[]::text[],
  required_integration_ids text[] not null default array[]::text[],
  missing_integration_ids text[] not null default array[]::text[],
  bridge_connection_id uuid references public.integration_connections (id) on delete set null,
  error_message text,
  deployed_by uuid references auth.users (id) on delete set null,
  deployed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_package_deployments_client_idx
  on public.client_package_deployments (client_id, created_at desc);

drop trigger if exists set_client_package_deployments_updated_at
  on public.client_package_deployments;
create trigger set_client_package_deployments_updated_at
  before update on public.client_package_deployments
  for each row execute function public.set_updated_at();

alter table public.client_package_deployments enable row level security;

drop policy if exists "package_deployments_select_scoped"
  on public.client_package_deployments;
create policy "package_deployments_select_scoped"
on public.client_package_deployments
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or public.current_user_has_partner_client_role(partner_id, client_id)
);

drop policy if exists "package_deployments_insert_operators"
  on public.client_package_deployments;
create policy "package_deployments_insert_operators"
on public.client_package_deployments
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

drop policy if exists "package_deployments_update_operators"
  on public.client_package_deployments;
create policy "package_deployments_update_operators"
on public.client_package_deployments
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

grant select, insert, update on public.client_package_deployments to authenticated;
