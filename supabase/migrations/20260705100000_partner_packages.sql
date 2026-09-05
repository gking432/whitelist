-- Partner package system (docs/12 "Partner Package Builder").
-- Partners define reusable service packages as plain capability toggles,
-- then assign one package per client during onboarding. A package may also
-- be a one-off custom package for a single client (client_id set).
-- The selected package drives the setup checklist, required integrations,
-- and workflow packs. No billing yet — packages carry no pricing.

create table if not exists public.partner_packages (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  -- Set only for custom one-off packages created for a specific client.
  client_id uuid references public.client_businesses (id) on delete cascade,
  name text not null,
  description text,
  -- Map of capability key -> boolean. Capability keys are defined in code
  -- (lib/packages/capabilities.ts) so new capabilities need no migration.
  capabilities jsonb not null default '{}'::jsonb,
  is_archived boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists partner_packages_partner_idx
  on public.partner_packages (partner_id, is_archived);

drop trigger if exists set_partner_packages_updated_at on public.partner_packages;
create trigger set_partner_packages_updated_at
  before update on public.partner_packages
  for each row execute function public.set_updated_at();

alter table public.client_businesses
  add column if not exists package_id uuid
    references public.partner_packages (id) on delete set null;

alter table public.partner_packages enable row level security;

-- All partner members can see their partner's packages; operators manage
-- them. Platform roles retain support access.
drop policy if exists "partner_packages_select_members" on public.partner_packages;
create policy "partner_packages_select_members"
on public.partner_packages
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
);

drop policy if exists "partner_packages_insert_operators" on public.partner_packages;
create policy "partner_packages_insert_operators"
on public.partner_packages
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

drop policy if exists "partner_packages_update_operators" on public.partner_packages;
create policy "partner_packages_update_operators"
on public.partner_packages
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

drop policy if exists "partner_packages_delete_managers" on public.partner_packages;
create policy "partner_packages_delete_managers"
on public.partner_packages
for delete
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin'
  ]::public.membership_role[])
);

grant select, insert, update, delete on public.partner_packages to authenticated;
grant update (package_id) on public.client_businesses to authenticated;
