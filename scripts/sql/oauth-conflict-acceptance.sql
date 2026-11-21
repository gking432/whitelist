-- Disposable real-Postgres policy tests only. Synthetic token envelopes and JWT
-- claims do not establish live OAuth consent, identity inspection or provider calls.
begin;
set local statement_timeout='45s'; set local lock_timeout='5s';
-- __ISOLATION_ASSERTION__
select pg_advisory_xact_lock(1937402189);
do $blank$ begin
 if current_database() !~ '_(test|acceptance)$' or exists(select 1 from public.partners) or exists(select 1 from public.client_businesses) then raise exception 'OAuth conflicts require a blank isolated disposable database'; end if;
end $blank$;
create temporary table oc_expected(signature regprocedure primary key,body_hash text not null,conflicts integer not null);
insert into oc_expected values
('public.finish_readonly_workspace_oauth(uuid,text,text,text,text)'::regprocedure,'31bb6b1808932335313cb53c08822ec7',2),
('public.finish_google_permission_upgrade(uuid,text,text,text,text,text[],text[])'::regprocedure,'fb3527723833f4c280ed1b64d08a4f29',3),
('public.begin_hubspot_oauth(uuid,uuid,uuid,uuid,text,text,text[],timestamptz)'::regprocedure,'48c4a3b518d8cf0b8554c8c03c532918',1),
('public.finish_hubspot_oauth(uuid,text,text,text,text,text[],text[],timestamptz,uuid)'::regprocedure,'0cced8bb8c1dd4636a0bd7e3bb8c78ee',2);
-- Group1: actual catalog is the old effective body with only deliberate literals
-- replaced, still postgres-owned invoker/empty search path/service-only execute.
do $catalog$ declare f record; begin
 for f in select p.*,e.body_hash,e.conflicts from pg_proc p join oc_expected e on e.signature=p.oid loop
  if pg_get_userbyid(f.proowner)<>'postgres' or f.prosecdef or f.proconfig is distinct from array['search_path=""']::text[]
   or has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE') or not has_function_privilege('service_role',f.oid,'EXECUTE')
   or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
   or md5(f.prosrc)<>f.body_hash or (length(f.prosrc)-length(replace(f.prosrc,'errcode=''PT409''','')))/length('errcode=''PT409''')<>f.conflicts then raise exception 'OAuth function catalog/body boundary differs: %',f.oid::regprocedure; end if;
 end loop;
 if (select count(*) from oc_expected)<>4 or exists(select 1 from pg_class where oid=any(array['public.integration_connections'::regclass,'public.integration_secrets'::regclass,'public.business_connection_oauth_attempts'::regclass]) and not relrowsecurity) then raise exception 'OAuth catalog count or existing RLS differs'; end if;
end $catalog$;
create temporary table oc_fixture(key text primary key,id uuid not null default extensions.gen_random_uuid(),data jsonb);
insert into oc_fixture(key) values('partner'),('package'),('client'),('owner'),('google'),('microsoft'),('hubspot');
grant select,insert,update on oc_fixture to service_role,authenticated,anon;
insert into auth.users(id,email) select id,'cj-acceptance-__RUN_ID__-oauth-owner@synthetic.invalid' from oc_fixture where key='owner';
insert into public.partners(id,name,slug) select id,'Synthetic OAuth conflict acceptance','cj-acceptance-__RUN_ID__-oauth-partner' from oc_fixture where key='partner';
insert into public.partner_packages(id,partner_id,name) select id,(select id from oc_fixture where key='partner'),'Synthetic OAuth conflict package' from oc_fixture where key='package';
insert into public.client_businesses(id,partner_id,package_id,name,slug,status,client_portal_enabled,default_runtime_mode)
 select id,(select id from oc_fixture where key='partner'),(select id from oc_fixture where key='package'),'Synthetic OAuth conflict business','cj-acceptance-__RUN_ID__-oauth-client','active',true,'sandbox' from oc_fixture where key='client';
insert into public.memberships(user_id,partner_id,client_id,role,status) values((select id from oc_fixture where key='owner'),(select id from oc_fixture where key='partner'),(select id from oc_fixture where key='client'),'client_owner','active');
insert into public.agent_team_settings(partner_id,client_id,status,scheduling_enabled,conversations_enabled,channel_authority) values((select id from oc_fixture where key='partner'),(select id from oc_fixture where key='client'),'paused',false,false,'{"calendar":"off","email":"off","website":"off","sms":"off","instagram":"off"}');
insert into public.business_agent_activation(partner_id,client_id,status,bookings,website,email) values((select id from oc_fixture where key='partner'),(select id from oc_fixture where key='client'),'paused',false,false,false);
insert into public.integration_connections(id,partner_id,client_id,provider_id,display_name,status,runtime_mode,credential_status,external_account_id,config)
 select f.id,(select id from oc_fixture where key='partner'),(select id from oc_fixture where key='client'),p.id,'Synthetic OAuth conflict '||f.key,'connected','dry_run','configured','synthetic-__RUN_ID__-'||f.key,'{"workspace_view_only":true,"owner_workspace_imports":true,"google_action_permissions":{"calendar_write":false,"email_send":false}}'
 from oc_fixture f join public.integration_providers p on p.provider_key=case when f.key='google' then 'google_workspace' else 'microsoft_365' end where f.key in('google','microsoft');
insert into public.integration_secrets(partner_id,client_id,connection_id,secret_kind,encrypted_value,last_four)
 select partner_id,client_id,id,'provider_credentials','synthetic-old-envelope-not-provider-proof','test' from public.integration_connections where id in(select id from oc_fixture where key in('google','microsoft'));
create function pg_temp.oc_state() returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('connections',(select jsonb_agg(to_jsonb(t) order by id) from public.integration_connections t),'secrets',(select jsonb_agg(to_jsonb(t) order by id) from public.integration_secrets t),'attempts',(select jsonb_agg(to_jsonb(t) order by id) from public.business_connection_oauth_attempts t),'settings',(select jsonb_agg(to_jsonb(t) order by client_id) from public.agent_team_settings t),'jobs',(select jsonb_agg(to_jsonb(t) order by id) from public.action_jobs t));
$$;
create function pg_temp.oc_expect(p_sql text,p_code text,p_message text default null) returns void language plpgsql security invoker set search_path='' as $$
declare before_state jsonb:=pg_temp.oc_state(); got text; message text;
begin
 begin execute p_sql; exception when others then get stacked diagnostics got=returned_sqlstate,message=message_text; end;
 if got is distinct from p_code or (p_message is not null and message is distinct from p_message) then raise exception 'Expected OAuth SQLSTATE %, received %',p_code,got; end if;
 if before_state is distinct from pg_temp.oc_state() then raise exception 'Rejected OAuth decision changed stored access or work'; end if;
end $$;
create function pg_temp.oc_attempt(p_connection text,p_purpose text default 'read_only',p_permissions text[] default '{}') returns uuid language plpgsql security invoker set search_path='' as $$
declare c public.integration_connections; s public.integration_secrets; aid uuid; provider text;
begin
 select * into strict c from public.integration_connections where id=(select id from pg_temp.oc_fixture where key=p_connection);
 select * into s from public.integration_secrets where connection_id=c.id and secret_kind='provider_credentials';
 select provider_key into strict provider from public.integration_providers where id=c.provider_id;
 insert into public.business_connection_oauth_attempts(partner_id,client_id,connection_id,actor_id,provider_key,purpose,cookie_hash,encrypted_verifier,requested_permissions,expected_account_id,expected_connection_updated_at,expected_secret_updated_at,expires_at,consumed_at)
 values(c.partner_id,c.client_id,c.id,(select id from pg_temp.oc_fixture where key='owner'),provider,p_purpose,repeat('a',64),'synthetic-verifier-not-provider-proof',p_permissions,c.external_account_id,c.updated_at,s.updated_at,now()+interval '10 minutes',now()) returning id into aid;
 return aid;
end $$;
grant execute on function pg_temp.oc_state(),pg_temp.oc_expect(text,text,text),pg_temp.oc_attempt(text,text,text[]) to service_role;
-- Group2: genuine API roles still cannot execute any selected service boundary.
set local role anon;
do $anon$ declare signature text; denied boolean; begin
 foreach signature in array array['finish_readonly_workspace_oauth(null,null,null,null,null)','finish_google_permission_upgrade(null,null,null,null,null,null,null)','begin_hubspot_oauth(null,null,null,null,null,null,null,null)','finish_hubspot_oauth(null,null,null,null,null,null,null,null,null)'] loop
  denied:=false; begin execute 'select public.'||signature; exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Anonymous executed a service-only OAuth function'; end if;
 end loop;
end $anon$;
reset role; set local role authenticated;
do $owner$ declare signature text; denied boolean; begin
 foreach signature in array array['finish_readonly_workspace_oauth(null,null,null,null,null)','finish_google_permission_upgrade(null,null,null,null,null,null,null)','begin_hubspot_oauth(null,null,null,null,null,null,null,null)','finish_hubspot_oauth(null,null,null,null,null,null,null,null,null)'] loop
  denied:=false; begin execute 'select public.'||signature; exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Authenticated owner executed a service-only OAuth function'; end if;
 end loop;
end $owner$;
reset role; set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
-- Group3: Google and Microsoft read-only completion save once; deleted attempts
-- remain strict P0002 on replay, never a fabricated successful retry.
do $readonly_success$ declare provider text; a uuid; account text; command text; begin
 foreach provider in array array['google','microsoft'] loop
  a:=pg_temp.oc_attempt(provider); account:='synthetic-__RUN_ID__-'||provider;
  command:=format('select public.finish_readonly_workspace_oauth(%L,''synthetic-new-readonly-envelope'',''test'',%L,''Synthetic read-only account'')',a,account);
  execute command;
  if exists(select 1 from public.business_connection_oauth_attempts where id=a) or not exists(select 1 from public.integration_secrets where connection_id=(select id from oc_fixture where key=provider) and encrypted_value='synthetic-new-readonly-envelope') then raise exception 'Read-only completion did not persist once and retire attempt'; end if;
  perform pg_temp.oc_expect(command,'P0002');
 end loop;
end $readonly_success$;
-- Group4: both explicit read-only conflicts are PT409; expired/unconsumed and
-- wrong-account validations keep their existing default P0001 behavior.
do $readonly_conflicts$ declare a uuid; command text; variant text; begin
 foreach variant in array array['snapshot','selected','expired','unconsumed','wrong-account'] loop
  if variant='selected' then update public.integration_connections set config=config||'{"google_action_permissions":{"calendar_write":true,"email_send":false}}' where id=(select id from oc_fixture where key='google'); end if;
  a:=pg_temp.oc_attempt('google');
  if variant='snapshot' then update public.business_connection_oauth_attempts set expected_secret_updated_at=expected_secret_updated_at-interval '1 second' where id=a;
  elsif variant='expired' then update public.business_connection_oauth_attempts set expires_at=now()-interval '1 second' where id=a;
  elsif variant='unconsumed' then update public.business_connection_oauth_attempts set consumed_at=null where id=a; end if;
  command:=format('select public.finish_readonly_workspace_oauth(%L,''rejected-envelope'',''test'',%L,''Synthetic account'')',a,case when variant='wrong-account' then 'another-account' else 'synthetic-__RUN_ID__-google' end);
  perform pg_temp.oc_expect(command,case when variant in('snapshot','selected') then 'PT409' else 'P0001' end);
  delete from public.business_connection_oauth_attempts where id=a;
  if variant='selected' then update public.integration_connections set config=config||'{"google_action_permissions":{"calendar_write":false,"email_send":false}}' where id=(select id from oc_fixture where key='google'); end if;
 end loop;
end $readonly_conflicts$;
-- Group5: all three deliberate upgrade branches are PT409, actual incomplete
-- scopes stay 22023, and verified consent does not activate business actions.
do $upgrade$ declare a uuid; command text; variant text; scopes text[]:=array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.calendarlist.readonly']; selected text[]; begin
 foreach variant in array array['business','snapshot','selection','scopes','success'] loop
  a:=pg_temp.oc_attempt('google','permission_upgrade',array['calendar.write']);
  if variant='business' then update public.client_businesses set status='paused' where id=(select id from oc_fixture where key='client');
  elsif variant='snapshot' then update public.business_connection_oauth_attempts set expected_connection_updated_at=expected_connection_updated_at-interval '1 second' where id=a; end if;
  selected:=case when variant='selection' then '{}'::text[] else array['calendar.write'] end;
  command:=format('select public.finish_google_permission_upgrade(%L,''synthetic-upgraded-envelope'',''test'',''synthetic-__RUN_ID__-google'',''Synthetic Google account'',%L::text[],%L::text[])',a,case when variant='scopes' then array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/calendar.events.readonly'] else scopes end,selected);
  if variant='success' then execute command; perform pg_temp.oc_expect(command,'P0002');
  else perform pg_temp.oc_expect(command,case when variant='scopes' then '22023' else 'PT409' end); delete from public.business_connection_oauth_attempts where id=a; end if;
  if variant='business' then update public.client_businesses set status='active' where id=(select id from oc_fixture where key='client'); end if;
 end loop;
 if not exists(select 1 from public.integration_connections where id=(select id from oc_fixture where key='google') and config->'google_action_permissions'->>'calendar_write'='true' and runtime_mode='dry_run') then raise exception 'Verified upgrade was not saved separately from runtime authority'; end if;
end $upgrade$;
-- Group6: new HubSpot OAuth is scoped, consumed once, and completion retires the
-- attempt; reconnect cannot drop prior selected permissions or cross scope.
do $hubspot_success$ declare a jsonb; aid uuid; conn uuid; p uuid:=(select id from oc_fixture where key='partner'); c uuid:=(select id from oc_fixture where key='client'); actor uuid:=(select id from oc_fixture where key='owner'); command text; begin
 a:=public.begin_hubspot_oauth(p,c,actor,null,repeat('a',64),'synthetic-state',array['contact.create'],now()+interval '10 minutes'); aid:=(a->>'attemptId')::uuid; conn:=(a->>'connectionId')::uuid;
 update oc_fixture set id=conn where key='hubspot';
 update public.business_connection_oauth_attempts set consumed_at=now() where id=aid and consumed_at is null;
 if not found then raise exception 'Fresh HubSpot attempt did not have a single consumer'; end if;
 command:=format('select public.finish_hubspot_oauth(%L,''synthetic-hubspot-envelope'',''test'',''810001'',''Synthetic HubSpot portal'',array[''oauth'',''crm.objects.contacts.read'',''crm.objects.deals.read'',''crm.objects.contacts.write''],array[''contact.create''],now()+interval ''30 minutes'',%L)',aid,extensions.gen_random_uuid());
 execute command; perform pg_temp.oc_expect(command,'P0002');
 perform pg_temp.oc_expect(format('select public.begin_hubspot_oauth(%L,%L,%L,%L,%L,''synthetic-state'',''{}'',now()+interval ''10 minutes'')',p,c,actor,conn,repeat('a',64)),'PT409','Reconnect the current selected HubSpot permissions');
 perform pg_temp.oc_expect(format('select public.begin_hubspot_oauth(%L,%L,%L,%L,%L,''synthetic-state'',array[''contact.create''],now()+interval ''10 minutes'')',p,c,actor,extensions.gen_random_uuid(),repeat('a',64)),'P0002');
 if not exists(select 1 from public.integration_connections where id=conn and external_account_id='810001' and config->'hubspot_actions_enabled'='false'::jsonb and config->'hubspot_selected_permissions'='["contact.create"]'::jsonb and runtime_mode='dry_run') then raise exception 'HubSpot consent activated actions or lost its exact portal'; end if;
end $hubspot_success$;
-- Group7: both HubSpot finish branches, invalid grants and expired/unconsumed
-- callbacks fail atomically with PT409; existing saved access is retained.
do $hubspot_conflicts$ declare a jsonb; aid uuid; command text; variant text; p uuid:=(select id from oc_fixture where key='partner'); c uuid:=(select id from oc_fixture where key='client'); actor uuid:=(select id from oc_fixture where key='owner'); conn uuid:=(select id from oc_fixture where key='hubspot'); begin
 foreach variant in array array['business','snapshot','secret','expired','unconsumed','wrong-portal','scopes'] loop
  a:=public.begin_hubspot_oauth(p,c,actor,conn,repeat('a',64),'synthetic-state',array['contact.create'],now()+interval '10 minutes'); aid:=(a->>'attemptId')::uuid;
  if variant<>'unconsumed' then update public.business_connection_oauth_attempts set consumed_at=now() where id=aid and consumed_at is null; end if;
  if variant='business' then update public.client_businesses set status='paused' where id=c;
  elsif variant='snapshot' then update public.business_connection_oauth_attempts set expected_connection_updated_at=expected_connection_updated_at-interval '1 second' where id=aid;
  elsif variant='secret' then update public.business_connection_oauth_attempts set expected_secret_updated_at=expected_secret_updated_at-interval '1 second' where id=aid;
  elsif variant='expired' then update public.business_connection_oauth_attempts set expires_at=now()-interval '1 second' where id=aid; end if;
  command:=format('select public.finish_hubspot_oauth(%L,''rejected-hubspot-envelope'',''test'',%L,''Synthetic HubSpot portal'',%L::text[],array[''contact.create''],now()+interval ''30 minutes'',%L)',aid,case when variant='wrong-portal' then '820001' else '810001' end,case when variant='scopes' then array['oauth'] else array['oauth','crm.objects.contacts.read','crm.objects.deals.read','crm.objects.contacts.write'] end,extensions.gen_random_uuid());
  perform pg_temp.oc_expect(command,'PT409'); delete from public.business_connection_oauth_attempts where id=aid;
  if variant='business' then update public.client_businesses set status='active' where id=c; end if;
 end loop;
end $hubspot_conflicts$;
-- Group8: consent storage never changes business choices, selects a customer
-- system, schedules imports, creates approvals/jobs/agents or sends anything.
do $effects$ begin
 if exists(select 1 from public.agent_team_settings where status<>'paused' or scheduling_enabled or conversations_enabled or channel_authority<>'{"calendar":"off","email":"off","website":"off","sms":"off","instagram":"off"}'::jsonb)
  or exists(select 1 from public.business_agent_activation where status<>'paused' or bookings or website or email)
  or exists(select 1 from public.client_businesses where default_runtime_mode<>'sandbox' or customer_system_connection_id is not null)
  or exists(select 1 from public.action_jobs) or exists(select 1 from public.approval_items) or exists(select 1 from public.agent_work_items)
  or exists(select 1 from public.integration_canonical_records) or exists(select 1 from public.integration_sync_states)
  or exists(select 1 from public.business_connection_oauth_attempts) then raise exception 'OAuth storage created work or changed business authority'; end if;
end $effects$;
reset role;
rollback;
select '__CUSTOMER_JOURNEY_REPORT__'::text || jsonb_build_object('kind','oauth_conflict_acceptance','rolledBack',true,'remainingFixtures',(select count(*) from public.partners where slug like 'cj-acceptance-__RUN_ID__-oauth-%'),'checks',jsonb_build_array('actual_four_function_catalog_and_exact_body_hashes','anonymous_and_owner_cannot_execute_service_oauth','readonly_google_microsoft_success_and_strict_missing_replay','readonly_conflicts_pt409_and_validation_codes_unchanged','google_upgrade_three_conflicts_and_verified_grant_separation','hubspot_scoped_success_permission_union_and_missing_replay','hubspot_two_conflicts_atomic_saved_access','no_authority_activation_import_or_outbox_effects'),
 'catalog',jsonb_build_object('functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'configuration',p.proconfig,'publicExecute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE'),'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE'),'bodyHash',md5(p.prosrc)) order by p.oid::regprocedure::text) from pg_proc p where p.oid=any(array['public.finish_readonly_workspace_oauth(uuid,text,text,text,text)'::regprocedure,'public.finish_google_permission_upgrade(uuid,text,text,text,text,text[],text[])'::regprocedure,'public.begin_hubspot_oauth(uuid,uuid,uuid,uuid,text,text,text[],timestamptz)'::regprocedure,'public.finish_hubspot_oauth(uuid,text,text,text,text,text[],text[],timestamptz,uuid)'::regprocedure]))))::text as cj_report;
