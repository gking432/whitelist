create table public.partner_enrollments (
  owner_id uuid primary key references auth.users(id),
  agency_name text not null check (length(agency_name) between 2 and 100),
  checkout_key uuid not null default extensions.gen_random_uuid(),
  checkout_session_id text unique,
  partner_id uuid unique references public.partners(id),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text not null default 'pending' check(status in ('pending','active','past_due','cancelled')),
  created_at timestamptz not null default now()
);
alter table public.partner_enrollments enable row level security;
create policy enrollment_owner_read on public.partner_enrollments for select to authenticated
using(owner_id = auth.uid() or public.current_user_has_platform_role());
grant select on public.partner_enrollments to authenticated;
grant all on public.partner_enrollments to service_role;

create or replace function public.fulfill_partner_enrollment(
  p_owner uuid, p_checkout_key uuid, p_session text, p_customer text, p_subscription text
) returns uuid language plpgsql security definer set search_path = public as $$
declare enrollment public.partner_enrollments; new_partner uuid;
begin
  if p_owner is null or p_checkout_key is null or nullif(p_session,'') is null or nullif(p_customer,'') is null or nullif(p_subscription,'') is null then raise exception 'Complete payment identifiers required'; end if;
  select * into enrollment from public.partner_enrollments where owner_id=p_owner for update;
  if not found or enrollment.checkout_key is distinct from p_checkout_key then raise exception 'Enrollment mismatch'; end if;
  if not exists(select 1 from auth.users where id=p_owner and email_confirmed_at is not null) then
    raise exception 'Verified owner required';
  end if;
  if enrollment.partner_id is not null then
    if (enrollment.stripe_subscription_id is distinct from p_subscription or enrollment.stripe_customer_id is distinct from p_customer or enrollment.checkout_session_id is distinct from p_session) then raise exception 'Subscription mismatch'; end if;
    return enrollment.partner_id;
  end if;
  insert into public.partners(name,slug,status,plan_key)
  values(enrollment.agency_name,'agency-'||replace(p_owner::text,'-',''),'active','partner_v1') returning id into new_partner;
  insert into public.partner_branding(partner_id,product_name,support_label,report_footer_text)
  values(new_partner,enrollment.agency_name,enrollment.agency_name||' Support','Managed by '||enrollment.agency_name||'.');
  insert into public.partner_onboarding(partner_id,status,current_step,billing_status)
  values(new_partner,'not_started','agency','active');
  insert into public.memberships(user_id,partner_id,role,status)
  values(p_owner,new_partner,'partner_owner','active');
  update public.partner_enrollments set partner_id=new_partner,checkout_session_id=p_session,
    stripe_customer_id=p_customer,stripe_subscription_id=p_subscription,status='active' where owner_id=p_owner;
  return new_partner;
end $$;
revoke all on function public.fulfill_partner_enrollment(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.fulfill_partner_enrollment(uuid,uuid,text,text,text) to service_role;
