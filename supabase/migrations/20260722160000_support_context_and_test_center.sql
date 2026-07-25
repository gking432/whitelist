-- Separate partner-agency operations from managed-client support, add
-- auditable support impersonation, and persist feature-level test evidence.

alter table public.partners
  add column if not exists is_test_account boolean not null default false;

alter table public.client_businesses
  add column if not exists account_kind text not null default 'managed_client',
  add column if not exists is_test_account boolean not null default false;

alter table public.client_businesses
  drop constraint if exists client_businesses_account_kind_check;
alter table public.client_businesses
  add constraint client_businesses_account_kind_check
  check (account_kind in ('managed_client', 'partner_agency'));

create unique index if not exists client_businesses_one_partner_agency_idx
  on public.client_businesses (partner_id)
  where account_kind = 'partner_agency';

update public.partners
set is_test_account = true
where slug in ('acme-partner-operations', 'beacon-partner-group');

update public.client_businesses
set is_test_account = true
where slug in (
  'summit-home-services',
  'ridgeview-roofing',
  'lakeside-hvac',
  'northstar-scenario-lab'
);

create table if not exists public.support_impersonation_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  actor_user_id uuid not null references auth.users (id) on delete cascade,
  actor_role public.membership_role not null,
  target_kind text not null check (target_kind in ('partner', 'client')),
  target_partner_id uuid not null references public.partners (id) on delete cascade,
  target_client_id uuid references public.client_businesses (id) on delete cascade,
  mode text not null check (mode in ('read_only', 'sandbox_full')),
  reason text not null,
  return_path text not null default '/control',
  expires_at timestamptz not null default (now() + interval '1 hour'),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint support_impersonation_target_check check (
    (target_kind = 'partner' and target_client_id is null)
    or (target_kind = 'client' and target_client_id is not null)
  ),
  constraint support_impersonation_client_scope_fk
    foreign key (target_partner_id, target_client_id)
    references public.client_businesses (partner_id, id)
    on delete cascade
);

create index if not exists support_impersonation_actor_idx
  on public.support_impersonation_sessions (actor_user_id, created_at desc);
create index if not exists support_impersonation_active_idx
  on public.support_impersonation_sessions (id, actor_user_id)
  where ended_at is null;

alter table public.support_impersonation_sessions enable row level security;

drop policy if exists "support_impersonation_select_actor"
  on public.support_impersonation_sessions;
create policy "support_impersonation_select_actor"
on public.support_impersonation_sessions
for select
to authenticated
using (actor_user_id = auth.uid());

grant select on public.support_impersonation_sessions to authenticated;

create table if not exists public.client_feature_test_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  package_id uuid references public.partner_packages (id) on delete set null,
  capability_key text not null,
  audience text not null check (audience in ('platform', 'partner', 'client')),
  status text not null check (status in ('running', 'passed', 'failed')),
  result jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint client_feature_test_runs_scope_fk
    foreign key (partner_id, client_id)
    references public.client_businesses (partner_id, id)
    on delete cascade
);

create index if not exists client_feature_test_runs_client_idx
  on public.client_feature_test_runs (client_id, capability_key, created_at desc);

alter table public.client_feature_test_runs enable row level security;

drop policy if exists "feature_test_runs_select_scoped"
  on public.client_feature_test_runs;
create policy "feature_test_runs_select_scoped"
on public.client_feature_test_runs
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or public.current_user_has_partner_client_role(partner_id, client_id)
);

grant select on public.client_feature_test_runs to authenticated;

-- Managed-client approvals are client decisions. Partners retain read access
-- for troubleshooting and may resolve approvals only for their own agency
-- operating business.
drop policy if exists "approval_items_update_resolvers" on public.approval_items;
create policy "approval_items_update_resolvers"
on public.approval_items
for update
to authenticated
using (
  public.current_user_has_client_role(client_id, array[
    'client_owner',
    'client_manager'
  ]::public.membership_role[])
  or (
    assigned_to = auth.uid()
    and public.current_user_has_client_role(client_id, array[
      'client_staff'
    ]::public.membership_role[])
  )
  or (
    public.current_user_has_partner_role(partner_id, array[
      'partner_owner',
      'partner_admin',
      'partner_implementer'
    ]::public.membership_role[])
    and exists (
      select 1
      from public.client_businesses business
      where business.id = client_id
        and business.partner_id = partner_id
        and business.account_kind = 'partner_agency'
    )
  )
)
with check (
  public.current_user_has_client_role(client_id, array[
    'client_owner',
    'client_manager'
  ]::public.membership_role[])
  or (
    assigned_to = auth.uid()
    and public.current_user_has_client_role(client_id, array[
      'client_staff'
    ]::public.membership_role[])
  )
  or (
    public.current_user_has_partner_role(partner_id, array[
      'partner_owner',
      'partner_admin',
      'partner_implementer'
    ]::public.membership_role[])
    and exists (
      select 1
      from public.client_businesses business
      where business.id = client_id
        and business.partner_id = partner_id
        and business.account_kind = 'partner_agency'
    )
  )
);

drop policy if exists "workflow_runs_update_resolvers" on public.workflow_runs;
create policy "workflow_runs_update_resolvers"
on public.workflow_runs
for update
to authenticated
using (
  public.current_user_has_client_role(client_id, array[
    'client_owner', 'client_manager', 'client_staff'
  ]::public.membership_role[])
  or (
    public.current_user_has_partner_role(partner_id, array[
      'partner_owner', 'partner_admin', 'partner_implementer'
    ]::public.membership_role[])
    and exists (
      select 1 from public.client_businesses business
      where business.id = client_id
        and business.partner_id = partner_id
        and business.account_kind = 'partner_agency'
    )
  )
)
with check (
  public.current_user_has_client_role(client_id, array[
    'client_owner', 'client_manager', 'client_staff'
  ]::public.membership_role[])
  or (
    public.current_user_has_partner_role(partner_id, array[
      'partner_owner', 'partner_admin', 'partner_implementer'
    ]::public.membership_role[])
    and exists (
      select 1 from public.client_businesses business
      where business.id = client_id
        and business.partner_id = partner_id
        and business.account_kind = 'partner_agency'
    )
  )
);

-- Partners can read managed-client CRM data for support. CRM writes are only
-- available to client operators or to partners inside their own agency CRM.
do $$
declare
  t text;
begin
  foreach t in array array[
    'crm_contacts', 'crm_leads', 'crm_timeline_entries', 'crm_tasks', 'crm_appointments'
  ]
  loop
    execute format('drop policy if exists "%s_insert_editors" on public.%I', t, t);
    execute format($p$
      create policy "%s_insert_editors" on public.%I
      for insert to authenticated
      with check (
        public.current_user_has_client_role(client_id, array[
          'client_owner', 'client_manager'
        ]::public.membership_role[])
        or (
          public.current_user_has_partner_role(partner_id, array[
            'partner_owner', 'partner_admin', 'partner_implementer'
          ]::public.membership_role[])
          and exists (
            select 1 from public.client_businesses business
            where business.id = client_id
              and business.partner_id = partner_id
              and business.account_kind = 'partner_agency'
          )
        )
      )
    $p$, t, t);

    execute format('drop policy if exists "%s_update_editors" on public.%I', t, t);
    execute format($p$
      create policy "%s_update_editors" on public.%I
      for update to authenticated
      using (
        public.current_user_has_client_role(client_id, array[
          'client_owner', 'client_manager'
        ]::public.membership_role[])
        or (
          public.current_user_has_partner_role(partner_id, array[
            'partner_owner', 'partner_admin', 'partner_implementer'
          ]::public.membership_role[])
          and exists (
            select 1 from public.client_businesses business
            where business.id = client_id
              and business.partner_id = partner_id
              and business.account_kind = 'partner_agency'
          )
        )
      )
      with check (
        public.current_user_has_client_role(client_id, array[
          'client_owner', 'client_manager'
        ]::public.membership_role[])
        or (
          public.current_user_has_partner_role(partner_id, array[
            'partner_owner', 'partner_admin', 'partner_implementer'
          ]::public.membership_role[])
          and exists (
            select 1 from public.client_businesses business
            where business.id = client_id
              and business.partner_id = partner_id
              and business.account_kind = 'partner_agency'
          )
        )
      )
    $p$, t, t);
  end loop;
end $$;
