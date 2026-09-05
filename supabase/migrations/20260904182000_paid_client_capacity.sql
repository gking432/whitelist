-- Only self-service enrollments opt into these paid-plan creation limits.
-- Existing managed workspaces and manually provisioned beta partners remain usable.
alter table public.partner_enrollments drop constraint partner_enrollments_status_check;
alter table public.partner_enrollments add constraint partner_enrollments_status_check
  check(status in ('pending','active','trialing','past_due','cancelled'));

create or replace function public.enforce_paid_client_capacity()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare enrollment_status text;
begin
  if new.account_kind <> 'managed_client' then return new; end if;
  -- Only writes that add a managed-client slot consume capacity. Ordinary
  -- edits remain available even after subscription cancellation or downgrade.
  if tg_op='UPDATE' and old.partner_id=new.partner_id and old.account_kind='managed_client' then return new; end if;
  -- The enrollment row serializes both concurrent client creates and billing
  -- status changes. A count made without this lock can oversubscribe a plan.
  select status into enrollment_status from public.partner_enrollments
    where partner_id=new.partner_id for update;
  if not found then return new; end if;
  if enrollment_status not in ('active','trialing') then
    raise exception using errcode='P1001',message='An active agency subscription is required to add a client. Open agency billing to update your subscription.';
  end if;
  if (select count(*) from public.client_businesses where partner_id=new.partner_id and account_kind='managed_client') >= 10 then
    raise exception using errcode='P1002',message='Your agency plan includes 10 client businesses. Contact platform support before adding another client.';
  end if;
  return new;
end $$;
revoke all on function public.enforce_paid_client_capacity() from public,anon,authenticated;
create trigger enforce_paid_client_capacity before insert or update of partner_id,account_kind on public.client_businesses
for each row execute function public.enforce_paid_client_capacity();
