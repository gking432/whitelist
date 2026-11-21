-- Qualify outer CRM and approval columns inside client-business subqueries.
-- Unqualified partner_id resolves to client_businesses.partner_id in both
-- positions, which weakens the partner-agency write boundary.

do $$
declare
  t text;
begin
  foreach t in array array[
    'crm_appointments',
    'crm_availability_windows',
    'crm_communications',
    'crm_contacts',
    'crm_feedback',
    'crm_leads',
    'crm_quotes',
    'crm_tasks',
    'crm_timeline_entries'
  ]
  loop
    execute format('drop policy if exists "%s_insert_editors" on public.%I', t, t);
    execute format($policy$
      create policy "%1$s_insert_editors" on public.%1$I
      for insert to authenticated
      with check (
        public.current_user_has_client_role(%1$I.client_id, array[
          'client_owner', 'client_manager'
        ]::public.membership_role[])
        or (
          public.current_user_has_partner_role(%1$I.partner_id, array[
            'partner_owner', 'partner_admin', 'partner_implementer'
          ]::public.membership_role[])
          and exists (
            select 1 from public.client_businesses business
            where business.id = %1$I.client_id
              and business.partner_id = %1$I.partner_id
              and business.account_kind = 'partner_agency'
          )
        )
      )
    $policy$, t);

    execute format('drop policy if exists "%s_update_editors" on public.%I', t, t);
    execute format($policy$
      create policy "%1$s_update_editors" on public.%1$I
      for update to authenticated
      using (
        public.current_user_has_client_role(%1$I.client_id, array[
          'client_owner', 'client_manager'
        ]::public.membership_role[])
        or (
          public.current_user_has_partner_role(%1$I.partner_id, array[
            'partner_owner', 'partner_admin', 'partner_implementer'
          ]::public.membership_role[])
          and exists (
            select 1 from public.client_businesses business
            where business.id = %1$I.client_id
              and business.partner_id = %1$I.partner_id
              and business.account_kind = 'partner_agency'
          )
        )
      )
      with check (
        public.current_user_has_client_role(%1$I.client_id, array[
          'client_owner', 'client_manager'
        ]::public.membership_role[])
        or (
          public.current_user_has_partner_role(%1$I.partner_id, array[
            'partner_owner', 'partner_admin', 'partner_implementer'
          ]::public.membership_role[])
          and exists (
            select 1 from public.client_businesses business
            where business.id = %1$I.client_id
              and business.partner_id = %1$I.partner_id
              and business.account_kind = 'partner_agency'
          )
        )
      )
    $policy$, t);
  end loop;
end $$;

drop policy if exists "approval_items_update_resolvers" on public.approval_items;

create policy "approval_items_update_resolvers"
on public.approval_items
for update
to authenticated
using (
  public.current_user_has_client_role(approval_items.client_id, array[
    'client_owner', 'client_manager'
  ]::public.membership_role[])
  or (
    approval_items.assigned_to = auth.uid()
    and public.current_user_has_client_role(approval_items.client_id, array[
      'client_staff'
    ]::public.membership_role[])
  )
  or (
    public.current_user_has_partner_role(approval_items.partner_id, array[
      'partner_owner', 'partner_admin', 'partner_implementer'
    ]::public.membership_role[])
    and exists (
      select 1
      from public.client_businesses business
      where business.id = approval_items.client_id
        and business.partner_id = approval_items.partner_id
        and business.account_kind = 'partner_agency'
    )
  )
)
with check (
  public.current_user_has_client_role(approval_items.client_id, array[
    'client_owner', 'client_manager'
  ]::public.membership_role[])
  or (
    approval_items.assigned_to = auth.uid()
    and public.current_user_has_client_role(approval_items.client_id, array[
      'client_staff'
    ]::public.membership_role[])
  )
  or (
    public.current_user_has_partner_role(approval_items.partner_id, array[
      'partner_owner', 'partner_admin', 'partner_implementer'
    ]::public.membership_role[])
    and exists (
      select 1
      from public.client_businesses business
      where business.id = approval_items.client_id
        and business.partner_id = approval_items.partner_id
        and business.account_kind = 'partner_agency'
    )
  )
);
