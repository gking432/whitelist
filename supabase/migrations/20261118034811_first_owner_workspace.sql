-- A first owner creates one setup workspace under an explicitly configured
-- first-party operator/package. No agency, enrollment or beta acceptance is
-- manufactured. Existing billing/capacity/launch triggers remain authoritative.
create schema if not exists owner_onboarding;
revoke all on schema owner_onboarding from public,anon;
grant usage on schema owner_onboarding to authenticated,service_role;
create table public.first_owner_signup_configuration(
 singleton boolean primary key default true check(singleton),
 partner_id uuid not null references public.partners(id),
 package_id uuid not null references public.partner_packages(id),
 enabled boolean not null default false, updated_at timestamptz not null default now()
);
create table public.first_owner_workspaces(
 user_id uuid primary key references auth.users(id) on delete cascade,
 id uuid not null unique default extensions.gen_random_uuid(),
 partner_id uuid references public.partners(id) on delete set null,
 client_id uuid unique references public.client_businesses(id) on delete set null,
 request_key uuid not null, business jsonb not null check(jsonb_typeof(business)='object'),
 created_at timestamptz not null default now()
);
alter table public.first_owner_signup_configuration enable row level security;
alter table public.first_owner_workspaces enable row level security;
revoke all on public.first_owner_signup_configuration,public.first_owner_workspaces from public,anon,authenticated;
grant all on public.first_owner_signup_configuration,public.first_owner_workspaces to service_role;

create function public.configure_first_owner_signup(p_partner uuid,p_package uuid,p_enabled boolean)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.first_owner_signup_configuration where singleton for update;
 perform 1 from public.partners p join public.partner_packages package on package.partner_id=p.id
 where p.id=p_partner and p.status='active' and package.id=p_package and not package.is_archived and package.client_id is null for update of p,package;
 if not found or p_enabled is null then raise exception 'Configure an existing active first-party operator and its shared, nonarchived package'; end if;
 insert into public.first_owner_signup_configuration(singleton,partner_id,package_id,enabled)
 values(true,p_partner,p_package,p_enabled)
 on conflict(singleton) do update set partner_id=excluded.partner_id,package_id=excluded.package_id,enabled=excluded.enabled,updated_at=now();
end $$;
revoke all on function public.configure_first_owner_signup(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.configure_first_owner_signup(uuid,uuid,boolean) to service_role;

-- Server routes validate current session state as well as the signed JWT.
-- General established accounts do not gain the first-owner email requirements.
create function owner_onboarding.session_actor() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); session_key uuid;
begin
 begin session_key:=nullif(auth.jwt()->>'session_id','')::uuid;
 exception when invalid_text_representation then raise exception 'This sign-in session ended' using errcode='42501'; end;
 if actor is null or session_key is null or not exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
  where u.id=actor and s.id=session_key and (s.not_after is null or s.not_after>clock_timestamp())
   and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())) then
  raise exception 'This sign-in session ended' using errcode='42501'; end if;
 return actor;
end $$;
revoke all on function owner_onboarding.session_actor() from public,anon;
grant execute on function owner_onboarding.session_actor() to authenticated,service_role;
create function public.current_session_actor() returns uuid
language sql stable security invoker set search_path='' as $$ select owner_onboarding.session_actor(); $$;
revoke all on function public.current_session_actor() from public,anon;
grant execute on function public.current_session_actor() to authenticated,service_role;

-- Only these private routines need privileged reads/writes for initial tenant
-- creation. Public RPC wrappers remain invoker; no table/RLS grant is widened.
create function owner_onboarding.verified_actor() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); session_key uuid;
begin
 begin session_key:=nullif(auth.jwt()->>'session_id','')::uuid;
 exception when invalid_text_representation then raise exception 'Sign in again with a verified account' using errcode='42501'; end;
 if actor is null or session_key is null or not exists(
  select 1 from auth.users u join auth.sessions s on s.user_id=u.id
  where u.id=actor and s.id=session_key and (s.not_after is null or s.not_after>clock_timestamp())
   and u.email_confirmed_at is not null and nullif(u.email,'') is not null
   and not coalesce(u.is_anonymous,false) and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=clock_timestamp())
 ) then raise exception 'Sign in again with a verified account' using errcode='42501'; end if;
 return actor;
end $$;
revoke all on function owner_onboarding.verified_actor() from public,anon,authenticated;

-- Serialize invitations/revocations with initial creation. The trigger only
-- locks an existing auth identity; it grants no membership or lookup access.
create function owner_onboarding.lock_membership_actor() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from auth.users where id=new.user_id for update;
 return new;
end $$;
revoke all on function owner_onboarding.lock_membership_actor() from public,anon,authenticated;
create trigger first_owner_membership_actor_lock before insert or update on public.memberships
for each row execute function owner_onboarding.lock_membership_actor();

create function owner_onboarding.entry() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=owner_onboarding.verified_actor(); destination text;
begin
 -- Match normal primary-client routing: a disabled/archived first membership
 -- must not be silently replaced by a new account or a different tenant.
 select case when c.client_portal_enabled and c.status<>'archived' then '/client' end into destination
 from public.memberships m join public.client_businesses c on c.id=m.client_id and c.partner_id=m.partner_id
 where m.user_id=actor and m.status='active' and m.role in ('client_owner','client_manager','client_staff','client_viewer')
 order by m.created_at,m.id limit 1;
 if destination is not null then return jsonb_build_object('state','existing','destination',destination); end if;
 if exists(select 1 from public.memberships where user_id=actor and status='active' and role in ('platform_owner','platform_admin','platform_support')) then return jsonb_build_object('state','existing','destination','/control'); end if;
 if exists(select 1 from public.memberships m join public.partners p on p.id=m.partner_id where m.user_id=actor and m.status='active' and m.client_id is null and m.role in ('partner_owner','partner_admin','partner_implementer','partner_viewer')) then return jsonb_build_object('state','existing','destination','/partner'); end if;
 if exists(select 1 from public.memberships where user_id=actor) or exists(select 1 from public.first_owner_workspaces where user_id=actor) then
  return jsonb_build_object('state','blocked','reason','Your account has an existing invitation, workspace or access restriction. Use your existing access or ask its administrator to restore it. Creating a new business cannot restore revoked access.');
 end if;
 if not exists(select 1 from public.first_owner_signup_configuration cfg
  join public.partners p on p.id=cfg.partner_id
  join public.partner_packages package on package.id=cfg.package_id and package.partner_id=p.id
  where cfg.singleton and cfg.enabled and p.status='active' and not package.is_archived and package.client_id is null) then
  return jsonb_build_object('state','setup_required','reason','New-business setup is not enabled. The operator must configure an existing active first-party workspace operator and its shared package. Your sign-in is saved; you can retry when setup is ready.');
 end if;
 return jsonb_build_object('state','new');
end $$;
revoke all on function owner_onboarding.entry() from public,anon;
grant execute on function owner_onboarding.entry() to authenticated,service_role;
create function public.get_first_owner_entry() returns jsonb
language sql stable security invoker set search_path='' as $$ select owner_onboarding.entry(); $$;
revoke all on function public.get_first_owner_entry() from public,anon;
grant execute on function public.get_first_owner_entry() to authenticated,service_role;

create function owner_onboarding.provision(p_key uuid,p_business jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=owner_onboarding.verified_actor(); cfg public.first_owner_signup_configuration;
 prior public.first_owner_workspaces; business jsonb; name_value text; description_value text; timezone_value text;
 new_client uuid:=extensions.gen_random_uuid(); receipt_id uuid:=extensions.gen_random_uuid(); email_value text;
begin
 if p_key is null or jsonb_typeof(p_business) is distinct from 'object' or p_business-array['name','description','timezone']<>'{}'::jsonb or
  jsonb_typeof(p_business->'name') is distinct from 'string' or jsonb_typeof(p_business->'description') is distinct from 'string' or jsonb_typeof(p_business->'timezone') is distinct from 'string' then
  raise exception 'Enter the business name, description and timezone' using errcode='22023'; end if;
 name_value:=btrim(p_business->>'name'); description_value:=btrim(p_business->>'description'); timezone_value:=btrim(p_business->>'timezone');
 if length(name_value) not between 2 and 100 or length(description_value) not between 10 and 2000 or length(timezone_value) not between 1 and 100 or
  name_value ~ '[[:cntrl:]]' or timezone_value ~ '[[:cntrl:]]' or not exists(select 1 from pg_catalog.pg_timezone_names where name=timezone_value) then
  raise exception 'Review the bounded business details and a supported timezone' using errcode='22023'; end if;
 business:=jsonb_build_object('name',name_value,'description',description_value,'timezone',timezone_value);
 -- The actor lock serializes concurrent tabs, different keys, invitation and
 -- membership revocation. A lost response does not create a second business.
 select u.email into strict email_value from auth.users u where u.id=actor for update;
 perform 1 from auth.sessions s where s.id=(auth.jwt()->>'session_id')::uuid and s.user_id=actor and (s.not_after is null or s.not_after>clock_timestamp()) for update;
 if not found then raise exception 'This sign-in session ended. Sign in again' using errcode='42501'; end if;
 perform owner_onboarding.verified_actor(); -- Recheck current user eligibility after waiting for actor/session locks.
 select * into prior from public.first_owner_workspaces where user_id=actor;
 if prior.user_id is not null then
  if prior.business is distinct from business then raise exception 'This account already created a workspace. Open its existing business instead of creating another' using errcode='40001'; end if;
  if prior.client_id is null or not exists(select 1 from public.memberships m join public.client_businesses c on c.id=m.client_id and c.partner_id=m.partner_id
   where m.user_id=actor and m.partner_id=prior.partner_id and m.client_id=prior.client_id and m.role='client_owner' and m.status='active' and c.client_portal_enabled and c.status<>'archived') then
   raise exception 'Existing workspace access was removed. Creation cannot restore it' using errcode='42501'; end if;
  return jsonb_build_object('id',prior.id,'partnerId',prior.partner_id,'clientId',prior.client_id,'destination','/client/onboarding','replayed',true);
 end if;
 if exists(select 1 from public.memberships where user_id=actor) then raise exception 'Use your existing workspace or invitation; this account cannot create a first workspace' using errcode='42501'; end if;
 select * into cfg from public.first_owner_signup_configuration where singleton for update;
 if cfg.singleton is null or not cfg.enabled then raise exception 'New-business setup is not configured by the operator' using errcode='P1101'; end if;
 perform 1 from public.partners p join public.partner_packages package on package.partner_id=p.id
 where p.id=cfg.partner_id and p.status='active' and package.id=cfg.package_id and not package.is_archived and package.client_id is null for update of p,package;
 if not found then raise exception 'The configured operator or shared package is unavailable' using errcode='P1101'; end if;
 insert into public.profiles(id,email) values(actor,email_value) on conflict(id) do nothing;
 -- Ordinary capacity/billing triggers execute here, unchanged. No test-account
 -- flags, partner-agency exemption, enrollment or beta acceptance is inserted.
 insert into public.client_businesses(id,partner_id,package_id,name,slug,status,crm_operating_mode,client_experience_mode,default_runtime_mode,timezone,primary_contact_email,client_portal_enabled,partner_can_edit_client_data,account_kind,is_test_account)
 values(new_client,cfg.partner_id,cfg.package_id,name_value,'business-'||replace(new_client::text,'-',''),'active','external_crm_only','background_only','sandbox',timezone_value,email_value,true,false,'managed_client',false);
 insert into public.memberships(user_id,partner_id,client_id,role,status,client_job_role)
 values(actor,cfg.partner_id,new_client,'client_owner','active','owner');
 insert into public.agent_team_settings(partner_id,client_id,status,sales_enabled,operations_enabled,scheduled_reviews,scheduling_enabled,conversations_enabled,channel_authority)
 values(cfg.partner_id,new_client,'paused',false,false,false,false,false,'{"website":"off","email":"off","sms":"off","instagram":"off","calendar":"off"}');
 insert into public.business_workspace_profiles(partner_id,client_id,profile)
 values(cfg.partner_id,new_client,jsonb_build_object('description',description_value));
 insert into public.business_workspace_events(partner_id,client_id,actor_id,action,summary)
 values(cfg.partner_id,new_client,actor,'owner_workspace_created','Business details were provided by the owner. Context review, connections and action authority remain separate.');
 insert into public.first_owner_workspaces(user_id,id,partner_id,client_id,request_key,business)
 values(actor,receipt_id,cfg.partner_id,new_client,p_key,business);
 return jsonb_build_object('id',receipt_id,'partnerId',cfg.partner_id,'clientId',new_client,'destination','/client/onboarding','replayed',false);
end $$;
revoke all on function owner_onboarding.provision(uuid,jsonb) from public,anon;
grant execute on function owner_onboarding.provision(uuid,jsonb) to authenticated,service_role;
create function public.provision_first_owner(p_key uuid,p_business jsonb) returns jsonb
language sql volatile security invoker set search_path='' as $$ select owner_onboarding.provision(p_key,p_business); $$;
revoke all on function public.provision_first_owner(uuid,jsonb) from public,anon;
grant execute on function public.provision_first_owner(uuid,jsonb) to authenticated,service_role;

-- Persist only the failure of the still-current pull claim. Old workers,
-- paused connections and terminal job history cannot rewrite current health.
create function public.record_connector_pull_failure(p_partner uuid,p_client uuid,p_connection uuid,p_job uuid,p_locked_at timestamptz,p_error text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare c public.integration_connections; j public.integration_sync_jobs;
begin
 select * into c from public.integration_connections where id=p_connection and partner_id=p_partner and client_id=p_client for update;
 if c.id is null or c.status not in ('connected','needs_attention') or c.runtime_mode='paused' then return false; end if;
 select * into j from public.integration_sync_jobs where id=p_job and partner_id=p_partner and client_id=p_client and connection_id=p_connection for update;
 if j.id is null or j.direction<>'pull' or j.status<>'running' or j.locked_at is distinct from p_locked_at or nullif(btrim(p_error),'') is null or length(p_error)>1500 then return false; end if;
 insert into public.integration_sync_states(partner_id,client_id,connection_id,stream_key,status,last_error)
 values(p_partner,p_client,p_connection,j.object_type,'failing',p_error)
 on conflict(connection_id,stream_key) do update set status='failing',last_error=excluded.last_error;
 return true;
end $$;
revoke all on function public.record_connector_pull_failure(uuid,uuid,uuid,uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.record_connector_pull_failure(uuid,uuid,uuid,uuid,timestamptz,text) to service_role;
insert into public.platform_schema_state(singleton,current_migration,applied_at) values(true,'20261118034811_first_owner_workspace',now()) on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;
