-- Goal 9: client portal access.
-- Portal users see their partner's name and branding (the partner is the
-- reseller), but nothing operational about other clients.

create or replace function public.current_user_is_portal_member_of_partner(
  target_partner_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.memberships m
    join public.client_businesses c
      on c.id = m.client_id
     and c.partner_id = m.partner_id
    where m.user_id = auth.uid()
      and m.status = 'active'
      and m.partner_id = target_partner_id
      and m.client_id is not null
      and m.role in ('client_owner', 'client_manager', 'client_staff', 'client_viewer')
      and c.client_portal_enabled = true
  );
$$;

create policy "partners_select_portal_members"
on public.partners
for select
to authenticated
using (public.current_user_is_portal_member_of_partner(id));

create policy "partner_branding_select_portal_members"
on public.partner_branding
for select
to authenticated
using (public.current_user_is_portal_member_of_partner(partner_id));
