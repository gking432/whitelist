-- Persistent first-run setup for white-label partners. Billing is deliberately
-- tracked separately from onboarding so the product can launch before a
-- payment provider is selected.

create table if not exists public.partner_onboarding (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null unique references public.partners (id) on delete cascade,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'completed')),
  current_step text not null default 'agency'
    check (current_step in ('agency', 'branding', 'team', 'integrations', 'plan')),
  integrations_reviewed_at timestamptz,
  plan_key text,
  setup_fee_cents integer check (setup_fee_cents is null or setup_fee_cents >= 0),
  monthly_fee_cents integer check (monthly_fee_cents is null or monthly_fee_cents >= 0),
  included_active_clients integer
    check (included_active_clients is null or included_active_clients >= 0),
  additional_client_fee_cents integer
    check (additional_client_fee_cents is null or additional_client_fee_cents >= 0),
  billing_status text not null default 'not_configured'
    check (billing_status in ('not_configured', 'pending', 'active', 'past_due', 'cancelled')),
  plan_confirmed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists partner_onboarding_status_idx
  on public.partner_onboarding (status, updated_at desc);

drop trigger if exists set_partner_onboarding_updated_at
  on public.partner_onboarding;
create trigger set_partner_onboarding_updated_at
before update on public.partner_onboarding
for each row execute function public.set_updated_at();

alter table public.partner_onboarding enable row level security;

drop policy if exists "partner_onboarding_select_scoped"
  on public.partner_onboarding;
create policy "partner_onboarding_select_scoped"
on public.partner_onboarding
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
);

drop policy if exists "partner_onboarding_insert_managers"
  on public.partner_onboarding;
create policy "partner_onboarding_insert_managers"
on public.partner_onboarding
for insert
to authenticated
with check (
  public.current_user_has_platform_role(array[
    'platform_owner', 'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner', 'partner_admin'
  ]::public.membership_role[])
);

drop policy if exists "partner_onboarding_update_managers"
  on public.partner_onboarding;
create policy "partner_onboarding_update_managers"
on public.partner_onboarding
for update
to authenticated
using (
  public.current_user_has_platform_role(array[
    'platform_owner', 'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner', 'partner_admin'
  ]::public.membership_role[])
)
with check (
  public.current_user_has_platform_role(array[
    'platform_owner', 'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner', 'partner_admin'
  ]::public.membership_role[])
);

grant select, insert, update on public.partner_onboarding to authenticated;
grant all on public.partner_onboarding to service_role;
