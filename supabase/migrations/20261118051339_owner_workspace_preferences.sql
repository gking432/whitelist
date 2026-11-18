-- Personal presentation only: no business authority, external action or content
-- collection. Direct table access is service-only; invoker RPCs use the current
-- live session and private scoped routines, never a supplied actor/operator.
create table public.owner_workspace_preferences (
 user_id uuid not null references auth.users(id) on delete cascade,
 client_id uuid not null references public.client_businesses(id) on delete cascade,
 partner_id uuid not null references public.partners(id) on delete cascade,
 revision bigint not null default 1 check(revision>0), settings jsonb not null,
 request_key uuid not null, updated_at timestamptz not null default now(),
 primary key(user_id,client_id)
);
create table public.owner_workspace_activity (
 user_id uuid not null references auth.users(id) on delete cascade,
 client_id uuid not null references public.client_businesses(id) on delete cascade,
 partner_id uuid not null references public.partners(id) on delete cascade,
 module text not null check(module in('messages','appointments','todo','money')),
 activity_date date not null, primary key(user_id,client_id,module,activity_date)
);
alter table public.owner_workspace_preferences enable row level security;
alter table public.owner_workspace_activity enable row level security;
revoke all on public.owner_workspace_preferences,public.owner_workspace_activity from public,anon,authenticated;
grant all on public.owner_workspace_preferences,public.owner_workspace_activity to service_role;

create function owner_onboarding.workspace_actor(p_client uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=owner_onboarding.session_actor();
begin
 if not exists(select 1 from public.memberships m join public.client_businesses c on c.id=m.client_id and c.partner_id=m.partner_id
  where m.user_id=actor and c.id=p_client and m.status='active' and c.status<>'archived' and c.client_portal_enabled
  and m.role in('client_owner','client_manager')
  and public.current_user_client_sections(c.id,array['settings']) and public.current_user_client_sections(c.id,array['marketing'])
  and public.current_user_client_sections(c.id,array['tasks']) and public.current_user_client_sections(c.id,array['contacts'])
  and public.current_user_client_sections(c.id,array['automations']) and public.current_user_client_sections(c.id,array['action-center'])) then
  raise exception 'This business is not available to your account' using errcode='42501'; end if;
 return actor;
end $$;
revoke all on function owner_onboarding.workspace_actor(uuid) from public,anon,authenticated;

create function owner_onboarding.workspace_preferences(p_client uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=owner_onboarding.workspace_actor(p_client); saved public.owner_workspace_preferences; activity jsonb; zone text;
begin
 select * into saved from public.owner_workspace_preferences where user_id=actor and client_id=p_client;
 select case when exists(select 1 from pg_catalog.pg_timezone_names where name=c.timezone) then c.timezone else 'UTC' end into zone from public.client_businesses c where id=p_client;
 select coalesce(jsonb_agg(jsonb_build_object('module',a.module,'days',a.days) order by a.module),'[]'::jsonb) into activity
 from (select module,count(*) days from public.owner_workspace_activity where user_id=actor and client_id=p_client
  and activity_date between (now() at time zone zone)::date-13 and (now() at time zone zone)::date group by module) a;
 return jsonb_build_object('preferences',coalesce(saved.settings,'{"displayName":null,"order":["messages","appointments","todo","money"],"pinned":[]}'::jsonb)||jsonb_build_object('revision',coalesce(saved.revision,0)),
  'activity',activity,'available',true,'canEdit',true);
end $$;
revoke all on function owner_onboarding.workspace_preferences(uuid) from public,anon;
grant execute on function owner_onboarding.workspace_preferences(uuid) to authenticated,service_role;
create function public.get_owner_workspace_preferences(p_client uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select owner_onboarding.workspace_preferences(p_client); $$;
revoke all on function public.get_owner_workspace_preferences(uuid) from public,anon;
grant execute on function public.get_owner_workspace_preferences(uuid) to authenticated,service_role;

create function owner_onboarding.save_workspace_preferences(p_client uuid,p_key uuid,p_revision bigint,p_settings jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=owner_onboarding.workspace_actor(p_client); saved public.owner_workspace_preferences; settings jsonb; partner uuid; name_value text;
begin
 if p_key is null or p_revision is null or p_revision<0 or p_revision>9007199254740991 or jsonb_typeof(p_settings) is distinct from 'object'
  or p_settings-array['displayName','order','pinned']<>'{}'::jsonb or not p_settings ?& array['displayName','order','pinned']
  or jsonb_typeof(p_settings->'displayName') not in('string','null')
  or jsonb_typeof(p_settings->'order') is distinct from 'array' or jsonb_typeof(p_settings->'pinned') is distinct from 'array' then
  raise exception 'Check the name and Today preferences' using errcode='22023'; end if;
 name_value:=nullif(btrim(p_settings->>'displayName'),'');
 if (p_settings->>'displayName' is not null and (name_value is null or length(name_value)>60 or name_value ~ '[[:cntrl:]]'))
  or jsonb_array_length(p_settings->'order')<>4 or jsonb_array_length(p_settings->'pinned')>4
  or exists(select 1 from jsonb_array_elements(p_settings->'order') v where jsonb_typeof(v)<>'string' or v#>>'{}' not in('messages','appointments','todo','money'))
  or exists(select 1 from jsonb_array_elements(p_settings->'pinned') v where jsonb_typeof(v)<>'string' or v#>>'{}' not in('messages','appointments','todo','money'))
  or (select count(distinct v) from jsonb_array_elements(p_settings->'order') v)<>4
  or (select count(distinct v) from jsonb_array_elements(p_settings->'pinned') v)<>jsonb_array_length(p_settings->'pinned') then
  raise exception 'Check the name and Today preferences' using errcode='22023'; end if;
 settings:=jsonb_build_object('displayName',name_value,'order',p_settings->'order','pinned',p_settings->'pinned');
 -- Same actor lock also serializes membership changes; recheck after waiting.
 perform 1 from auth.users where id=actor for update;
 perform 1 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=actor for update;
 perform owner_onboarding.workspace_actor(p_client);
 select c.partner_id into strict partner from public.client_businesses c where id=p_client for share;
 perform owner_onboarding.workspace_actor(p_client); -- Portal/status may have changed while the client lock waited.
 select * into saved from public.owner_workspace_preferences where user_id=actor and client_id=p_client for update;
 if saved.request_key=p_key then
  if saved.settings is distinct from settings then raise exception 'This save key was already used for different preferences' using errcode='40001'; end if;
  return owner_onboarding.workspace_preferences(p_client);
 end if;
 if coalesce(saved.revision,0)<>p_revision then raise exception 'Your preferences changed elsewhere. Reload them before saving' using errcode='40001'; end if;
 insert into public.owner_workspace_preferences(user_id,client_id,partner_id,revision,settings,request_key)
 values(actor,p_client,partner,p_revision+1,settings,p_key)
 on conflict(user_id,client_id) do update set revision=excluded.revision,settings=excluded.settings,request_key=excluded.request_key,updated_at=now();
 return owner_onboarding.workspace_preferences(p_client);
end $$;
revoke all on function owner_onboarding.save_workspace_preferences(uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function owner_onboarding.save_workspace_preferences(uuid,uuid,bigint,jsonb) to authenticated,service_role;
create function public.save_owner_workspace_preferences(p_client uuid,p_key uuid,p_revision bigint,p_settings jsonb) returns jsonb
language sql volatile security invoker set search_path='' as $$ select owner_onboarding.save_workspace_preferences(p_client,p_key,p_revision,p_settings); $$;
revoke all on function public.save_owner_workspace_preferences(uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.save_owner_workspace_preferences(uuid,uuid,bigint,jsonb) to authenticated,service_role;

create function owner_onboarding.record_workspace_activity(p_client uuid,p_module text) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=owner_onboarding.workspace_actor(p_client); partner uuid; zone text; day_value date;
begin
 if p_module is null or p_module not in('messages','appointments','todo','money') then raise exception 'Choose a supported workspace area' using errcode='22023'; end if;
 perform 1 from auth.users where id=actor for update;
 perform 1 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=actor for update;
 perform owner_onboarding.workspace_actor(p_client);
 select c.partner_id,case when exists(select 1 from pg_catalog.pg_timezone_names where name=c.timezone) then c.timezone else 'UTC' end into strict partner,zone from public.client_businesses c where id=p_client for share;
 perform owner_onboarding.workspace_actor(p_client);
 day_value:=(now() at time zone zone)::date;
 delete from public.owner_workspace_activity where user_id=actor and client_id=p_client and activity_date<day_value-13;
 insert into public.owner_workspace_activity(user_id,client_id,partner_id,module,activity_date) values(actor,p_client,partner,p_module,day_value) on conflict do nothing;
end $$;
revoke all on function owner_onboarding.record_workspace_activity(uuid,text) from public,anon;
grant execute on function owner_onboarding.record_workspace_activity(uuid,text) to authenticated,service_role;
create function public.record_owner_workspace_activity(p_client uuid,p_module text) returns void
language sql volatile security invoker set search_path='' as $$ select owner_onboarding.record_workspace_activity(p_client,p_module); $$;
revoke all on function public.record_owner_workspace_activity(uuid,text) from public,anon;
grant execute on function public.record_owner_workspace_activity(uuid,text) to authenticated,service_role;
-- The existing protected operational-retention job also prunes inactive owners;
-- retention does not depend on that owner returning to the workspace.
create function public.purge_owner_workspace_activity() returns bigint
language sql volatile security invoker set search_path='' as $$
 with removed as (delete from public.owner_workspace_activity a using public.client_businesses c
  where c.id=a.client_id and c.partner_id=a.partner_id and a.activity_date <
   (now() at time zone (case when exists(select 1 from pg_catalog.pg_timezone_names where name=c.timezone) then c.timezone else 'UTC' end))::date-13 returning 1)
 select count(*) from removed;
$$;
revoke all on function public.purge_owner_workspace_activity() from public,anon,authenticated;
grant execute on function public.purge_owner_workspace_activity() to service_role;
insert into public.platform_schema_state(singleton,current_migration,applied_at) values(true,'20261118051339_owner_workspace_preferences',now())
on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;
