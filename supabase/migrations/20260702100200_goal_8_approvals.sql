-- Goal 8: universal approval queue.

do $$
begin
  create type public.approval_status as enum (
    'pending',
    'approved',
    'edited_and_approved',
    'rejected',
    'expired',
    'cancelled'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.approval_items (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  workflow_run_id uuid references public.workflow_runs (id) on delete set null,
  type text not null,
  status public.approval_status not null default 'pending',
  title text not null,
  summary text,
  risk_level text not null default 'medium',
  proposed_payload jsonb,
  editable_content text,
  resolved_content text,
  resolution_note text,
  assigned_to uuid references public.profiles (id) on delete set null,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_items_risk_level_check
    check (risk_level in ('low', 'medium', 'high')),
  constraint approval_items_client_scope_fk
    foreign key (partner_id, client_id)
    references public.client_businesses (partner_id, id)
    on delete cascade
);

create index if not exists approval_items_partner_client_status_idx
  on public.approval_items (partner_id, client_id, status, created_at desc);
create index if not exists approval_items_assigned_to_idx
  on public.approval_items (assigned_to)
  where assigned_to is not null;

drop trigger if exists set_approval_items_updated_at on public.approval_items;
create trigger set_approval_items_updated_at
before update on public.approval_items
for each row execute function public.set_updated_at();

alter table public.approval_items enable row level security;

-- Partner users see all client approvals; client owner/manager see their
-- client's approvals; client staff see only items assigned to them.
create policy "approval_items_select_accessible"
on public.approval_items
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or public.current_user_has_client_role(client_id, array[
    'client_owner',
    'client_manager'
  ]::public.membership_role[])
  or (
    assigned_to = auth.uid()
    and public.current_user_has_client_role(client_id, array[
      'client_staff'
    ]::public.membership_role[])
  )
);

create policy "approval_items_update_resolvers"
on public.approval_items
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
  or public.current_user_has_client_role(client_id, array[
    'client_owner',
    'client_manager'
  ]::public.membership_role[])
  or (
    assigned_to = auth.uid()
    and public.current_user_has_client_role(client_id, array[
      'client_staff'
    ]::public.membership_role[])
  )
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
  or public.current_user_has_client_role(client_id, array[
    'client_owner',
    'client_manager'
  ]::public.membership_role[])
  or (
    assigned_to = auth.uid()
    and public.current_user_has_client_role(client_id, array[
      'client_staff'
    ]::public.membership_role[])
  )
);

grant select, update on public.approval_items to authenticated;

-- Approval resolution transitions the paused run. Resolvers may update only
-- the run-state columns, and only on rows in their scope. Revoke first so
-- hosted default privileges don't leave broader update rights in place.
revoke update on public.workflow_runs from anon, authenticated;
grant update (status, finished_at, summary) on public.workflow_runs to authenticated;

create policy "workflow_runs_update_resolvers"
on public.workflow_runs
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
  or public.current_user_has_client_role(client_id, array[
    'client_owner',
    'client_manager',
    'client_staff'
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
  or public.current_user_has_client_role(client_id, array[
    'client_owner',
    'client_manager',
    'client_staff'
  ]::public.membership_role[])
);
