-- Client users can follow requests submitted from their workspace, but must
-- not see partner, platform, or system tickets that reference their account.

drop policy if exists "support_tickets_select_scoped" on public.support_tickets;
create policy "support_tickets_select_scoped"
on public.support_tickets for select to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or (
    origin = 'client'
    and client_id is not null
    and public.current_user_has_client_role(client_id)
  )
);
