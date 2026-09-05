create table public.client_beta_acceptances (
  client_id uuid primary key references public.client_businesses(id) on delete cascade,
  partner_id uuid not null references public.partners(id),
  package_id uuid not null references public.partner_packages(id),
  accepted_by uuid not null references auth.users(id),
  provider_test_notes text not null check(length(provider_test_notes) between 40 and 2000),
  fallback_contact text not null check(length(fallback_contact) between 5 and 320),
  terms_version text not null default 'beta-2026-09',
  accepted_at timestamptz not null default now(),
  foreign key(client_id,partner_id) references public.client_businesses(id,partner_id)
);
alter table public.client_beta_acceptances enable row level security;
create policy beta_acceptance_read on public.client_beta_acceptances for select to authenticated using (
  public.current_user_has_platform_role() or public.current_user_has_partner_role(partner_id)
  or exists(select 1 from public.memberships m where m.user_id=auth.uid() and m.client_id=client_beta_acceptances.client_id and m.status='active' and m.role='client_owner')
);
grant select on public.client_beta_acceptances to authenticated;
grant all on public.client_beta_acceptances to service_role;

create or replace function public.require_beta_acceptance_for_live()
returns trigger language plpgsql security definer set search_path=public as $$
declare target_client uuid; target_package uuid; test_account boolean; agency_account boolean; new_mode text; old_mode text;
begin
  if tg_table_name='client_businesses' then
    target_client:=new.id; target_package:=new.package_id; test_account:=new.is_test_account; agency_account:=new.account_kind='partner_agency';
    new_mode:=new.default_runtime_mode::text;
    if tg_op='UPDATE' then old_mode:=old.default_runtime_mode::text; end if;
  else
    target_client:=new.client_id; new_mode:=new.runtime_mode::text;
    if tg_op='UPDATE' then old_mode:=old.runtime_mode::text; end if;
    select package_id,is_test_account,account_kind='partner_agency' into target_package,test_account,agency_account from public.client_businesses where id=target_client;
  end if;
  if new_mode='live' and not coalesce(test_account,false) and not coalesce(agency_account,false) then
    if not exists(select 1 from public.client_beta_acceptances a join public.memberships m
      on m.user_id=a.accepted_by and m.client_id=a.client_id and m.role='client_owner' and m.status='active'
      where a.client_id=target_client and a.package_id=target_package) then
      raise exception 'The business owner must approve the supervised beta launch checklist first';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.require_beta_acceptance_for_live() from public,anon,authenticated;
create trigger require_beta_acceptance before insert or update on public.integration_connections
for each row execute function public.require_beta_acceptance_for_live();
create trigger require_beta_acceptance before insert or update on public.client_workflow_instances
for each row execute function public.require_beta_acceptance_for_live();
create trigger require_beta_acceptance before insert or update on public.client_businesses
for each row execute function public.require_beta_acceptance_for_live();

insert into public.platform_schema_state(singleton,current_migration,applied_at)
values(true,'20260904170000_beta_launch_acceptance',now())
on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;
