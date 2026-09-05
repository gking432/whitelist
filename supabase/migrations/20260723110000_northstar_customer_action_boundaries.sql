-- Partners may inspect managed-client Northstar data for troubleshooting, but
-- only the client can change records or operate customer-facing actions.
-- Partner operators retain write access inside their own agency business.

do $$
declare
  t text;
begin
  foreach t in array array[
    'crm_communications',
    'crm_availability_windows',
    'crm_quotes',
    'crm_feedback'
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
