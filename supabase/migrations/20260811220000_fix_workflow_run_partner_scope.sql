-- Qualify outer workflow_runs columns inside the client-business subquery.
-- Without qualification, PostgreSQL resolves `business.partner_id = partner_id`
-- to the inner table twice, weakening the partner-agency boundary.
drop policy if exists "workflow_runs_update_resolvers" on public.workflow_runs;

create policy "workflow_runs_update_resolvers"
on public.workflow_runs
for update
to authenticated
using (
  public.current_user_has_client_role(workflow_runs.client_id, array[
    'client_owner', 'client_manager', 'client_staff'
  ]::public.membership_role[])
  or (
    public.current_user_has_partner_role(workflow_runs.partner_id, array[
      'partner_owner', 'partner_admin', 'partner_implementer'
    ]::public.membership_role[])
    and exists (
      select 1
      from public.client_businesses business
      where business.id = workflow_runs.client_id
        and business.partner_id = workflow_runs.partner_id
        and business.account_kind = 'partner_agency'
    )
  )
)
with check (
  public.current_user_has_client_role(workflow_runs.client_id, array[
    'client_owner', 'client_manager', 'client_staff'
  ]::public.membership_role[])
  or (
    public.current_user_has_partner_role(workflow_runs.partner_id, array[
      'partner_owner', 'partner_admin', 'partner_implementer'
    ]::public.membership_role[])
    and exists (
      select 1
      from public.client_businesses business
      where business.id = workflow_runs.client_id
        and business.partner_id = workflow_runs.partner_id
        and business.account_kind = 'partner_agency'
    )
  )
);
