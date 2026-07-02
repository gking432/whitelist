-- Audit logs and approval history show who acted. Members of the same
-- partner scope (partner staff and their clients' users) can read each
-- other's basic profile rows; RLS elsewhere still bounds operational data.

create or replace function public.current_user_shares_partner_scope(
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs
      on theirs.partner_id = mine.partner_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and mine.partner_id is not null
      and theirs.user_id = target_user_id
      and theirs.status = 'active'
  );
$$;

create policy "profiles_select_shared_partner_scope"
on public.profiles
for select
to authenticated
using (public.current_user_shares_partner_scope(id));
