-- Real Postgres/session/CAS acceptance. Claims here are synthetic; the separate
-- browser stage proves real email sign-in and saved layout controls.
begin;
set local statement_timeout='45s'; set local lock_timeout='5s';
-- __ISOLATION_ASSERTION__
select pg_advisory_xact_lock(1937402189);
create temporary table ow_fixture(key text primary key,id uuid not null default extensions.gen_random_uuid());
insert into ow_fixture(key) values('partner'),('client'),('foreign'),('owner'),('other'),('restricted'),('session-owner'),('session-other'),('session-restricted'),('save');
grant select on ow_fixture to authenticated,anon;
insert into auth.users(id,email,email_confirmed_at) select id,'cj-acceptance-__RUN_ID__-workspace-'||key||'@synthetic.invalid',now() from ow_fixture where key in('owner','other','restricted');
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select s.id,u.id,now(),now(),now()+interval '1 hour' from ow_fixture s join ow_fixture u on u.key=substring(s.key from 9) where s.key like 'session-%';
insert into public.partners(id,name,slug,status) select id,'Synthetic customer journey acceptance workspace preferences','cj-acceptance-__RUN_ID__-workspace','active' from ow_fixture where key='partner';
insert into public.client_businesses(id,partner_id,name,slug,status,client_portal_enabled,default_runtime_mode,timezone)
 select id,(select id from ow_fixture where key='partner'),'Synthetic customer journey acceptance workspace '||key,'cj-acceptance-__RUN_ID__-workspace-'||key,'active',true,'sandbox','America/Chicago' from ow_fixture where key in('client','foreign');
insert into public.memberships(user_id,partner_id,client_id,role,status,client_permissions)
 select id,(select id from ow_fixture where key='partner'),(select id from ow_fixture where key='client'),case when key='restricted' then 'client_manager'::public.membership_role else 'client_owner'::public.membership_role end,'active',case when key='restricted' then '{"sections":["overview"]}'::jsonb else '{}'::jsonb end from ow_fixture where key in('owner','other','restricted');
create function pg_temp.ow_claim(p_label text) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claim.sub',(select id::text from ow_fixture where key=p_label),true);
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',(select id from ow_fixture where key=p_label),'session_id',(select id from ow_fixture where key='session-'||p_label))::text,true);
end $$;
grant execute on function pg_temp.ow_claim(text) to authenticated;
-- Group1: API grants and private data boundaries.
do $grants$ begin
 if has_table_privilege('authenticated','public.owner_workspace_preferences','SELECT') or has_table_privilege('authenticated','public.owner_workspace_activity','INSERT')
  or has_function_privilege('anon','public.get_owner_workspace_preferences(uuid)','EXECUTE')
  or not has_function_privilege('authenticated','public.save_owner_workspace_preferences(uuid,uuid,bigint,jsonb)','EXECUTE')
  or has_function_privilege('authenticated','public.purge_owner_workspace_activity()','EXECUTE')
  or has_function_privilege('authenticated','owner_onboarding.workspace_actor(uuid)','EXECUTE') then raise exception 'Workspace privilege boundary changed'; end if;
end $grants$;
set local role authenticated; select pg_temp.ow_claim('owner');
-- Group2: neutral defaults, read has no write/telemetry side effect.
do $defaults$ declare snapshot jsonb; begin
 snapshot:=public.get_owner_workspace_preferences((select id from ow_fixture where key='client'));
 if snapshot->'preferences' is distinct from '{"revision":0,"displayName":null,"order":["messages","appointments","todo","money"],"pinned":[]}'::jsonb or snapshot->'activity'<>'[]'::jsonb then raise exception 'Default preferences imply activity or personalization'; end if;
end $defaults$;
-- Group3: real save, exact replay, changed body and stale revision reject.
do $save$ declare snapshot jsonb; denied boolean; begin
 snapshot:=public.save_owner_workspace_preferences((select id from ow_fixture where key='client'),(select id from ow_fixture where key='save'),0,'{"displayName":" Alex ","order":["money","messages","appointments","todo"],"pinned":["messages"]}');
 if snapshot->'preferences'->>'displayName'<>'Alex' or snapshot->'preferences'->>'revision'<>'1' then raise exception 'Preferences were not persisted'; end if;
 if public.save_owner_workspace_preferences((select id from ow_fixture where key='client'),(select id from ow_fixture where key='save'),0,'{"displayName":"Alex","order":["money","messages","appointments","todo"],"pinned":["messages"]}') is distinct from snapshot then raise exception 'Exact retry changed saved preferences'; end if;
 denied:=false; begin perform public.save_owner_workspace_preferences((select id from ow_fixture where key='client'),(select id from ow_fixture where key='save'),1,'{"displayName":null,"order":["money","messages","appointments","todo"],"pinned":[]}'); exception when sqlstate 'PT409' then denied:=true; when sqlstate '40001' then raise exception 'Public preference RPC leaked transient 40001 instead of semantic PT409'; end; if not denied then raise exception 'Changed replay accepted'; end if;
 denied:=false; begin perform public.save_owner_workspace_preferences((select id from ow_fixture where key='client'),extensions.gen_random_uuid(),0,'{"displayName":null,"order":["money","messages","appointments","todo"],"pinned":[]}'); exception when sqlstate 'PT409' then denied:=true; when sqlstate '40001' then raise exception 'Public preference RPC leaked transient 40001 instead of semantic PT409'; end; if not denied then raise exception 'Stale save accepted'; end if;
end $save$;
-- Group4: actor/tenant injection, repeated/unsupported modules and name bounds.
do $invalid$ declare candidate jsonb; denied boolean; begin
 foreach candidate in array array[
 '{"displayName":"Alex","order":["messages","messages","todo","money"],"pinned":[]}'::jsonb,
 '{"displayName":null,"order":["messages","appointments","todo","money"],"pinned":["ads"]}'::jsonb,
 '{"displayName":"","order":["messages","appointments","todo","money"],"pinned":[]}'::jsonb,
 '{"displayName":null,"order":["messages","appointments","todo","money"],"pinned":[],"actorId":"spoofed"}'::jsonb,
 '{"displayName":null,"order":["messages","appointments","todo","money"],"pinned":["money","money"]}'::jsonb,
 jsonb_build_object('displayName',repeat('x',61),'order','["messages","appointments","todo","money"]'::jsonb,'pinned','[]'::jsonb)
 ] loop
 denied:=false; begin perform public.save_owner_workspace_preferences((select id from ow_fixture where key='client'),extensions.gen_random_uuid(),1,candidate); exception when invalid_parameter_value then denied:=true; end;
 if not denied then raise exception 'Invalid preference payload accepted'; end if;
 end loop;
end $invalid$;
-- Group5: exact owner AND business isolation, restricted role denied.
select pg_temp.ow_claim('other');
do $isolation$ declare denied boolean:=false; begin
 if public.get_owner_workspace_preferences((select id from ow_fixture where key='client'))->'preferences'->>'revision'<>'0' then raise exception 'Another owner inherited personal preferences'; end if;
 begin perform public.get_owner_workspace_preferences((select id from ow_fixture where key='foreign')); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Foreign business preferences readable'; end if;
end $isolation$;
select pg_temp.ow_claim('restricted');
do $restricted$ declare denied boolean:=false; begin begin perform public.get_owner_workspace_preferences((select id from ow_fixture where key='client')); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'Restricted manager preferences allowed'; end if; end $restricted$;
select pg_temp.ow_claim('owner');
-- Group6: visible module opens only, once per business-local day, no arbitrary strings.
select public.record_owner_workspace_activity((select id from ow_fixture where key='client'),'messages');
select public.record_owner_workspace_activity((select id from ow_fixture where key='client'),'messages');
do $activity$ declare denied boolean:=false; begin
 if public.get_owner_workspace_preferences((select id from ow_fixture where key='client'))->'activity' is distinct from '[{"module":"messages","days":1}]'::jsonb then raise exception 'Repeated route opens manufactured repeated day evidence'; end if;
 begin perform public.record_owner_workspace_activity((select id from ow_fixture where key='client'),'https://unrelated.invalid/private'); exception when invalid_parameter_value then denied:=true; end; if not denied then raise exception 'Arbitrary activity accepted'; end if;
end $activity$;
reset role;
-- Group7: bounded retention, independent actor, exact business timezone date.
insert into public.owner_workspace_activity(user_id,client_id,partner_id,module,activity_date)
 select (select id from ow_fixture where key='owner'),(select id from ow_fixture where key='client'),(select id from ow_fixture where key='partner'),'messages',(now() at time zone 'America/Chicago')::date-20;
set local role authenticated; select pg_temp.ow_claim('owner');
select public.record_owner_workspace_activity((select id from ow_fixture where key='client'),'appointments');
reset role;
do $retention$ begin
 if exists(select 1 from public.owner_workspace_activity where user_id=(select id from ow_fixture where key='owner') and activity_date<(now() at time zone 'America/Chicago')::date-13) then raise exception 'Old layout activity retained'; end if;
 if exists(select 1 from public.owner_workspace_activity where user_id=(select id from ow_fixture where key='other')) then raise exception 'Other actor activity was fabricated'; end if;
end $retention$;
insert into public.owner_workspace_activity(user_id,client_id,partner_id,module,activity_date)
 select (select id from ow_fixture where key='other'),(select id from ow_fixture where key='client'),(select id from ow_fixture where key='partner'),'money',(now() at time zone 'America/Chicago')::date-20;
set local role service_role;
do $purge$ begin if public.purge_owner_workspace_activity()<>1 then raise exception 'Protected operational cleanup did not prune inactive-owner layout evidence'; end if; end $purge$;
reset role;
do $preserve$ begin if (select count(*) from public.owner_workspace_activity where client_id=(select id from ow_fixture where key='client'))<>2 then raise exception 'Layout cleanup deleted current evidence'; end if; end $preserve$;
-- Group8: revocation prevents new reads/saves/collection; preferences never
-- change business authority, launch flags, membership or source records.
update public.client_businesses set client_portal_enabled=false where id=(select id from ow_fixture where key='client');
set local role authenticated; select pg_temp.ow_claim('owner');
do $portal_disabled$ declare denied boolean; begin
 denied:=false; begin perform public.save_owner_workspace_preferences((select id from ow_fixture where key='client'),(select id from ow_fixture where key='save'),0,'{"displayName":"Alex","order":["money","messages","appointments","todo"],"pinned":["messages"]}'); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'Disabled portal replay accepted'; end if;
 denied:=false; begin perform public.record_owner_workspace_activity((select id from ow_fixture where key='client'),'money'); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'Disabled portal activity accepted'; end if;
end $portal_disabled$;
reset role;
update public.client_businesses set client_portal_enabled=true where id=(select id from ow_fixture where key='client');
update public.memberships set status='disabled' where user_id=(select id from ow_fixture where key='owner');
set local role authenticated; select pg_temp.ow_claim('owner');
do $revoked$ declare denied boolean:=false; begin
 begin perform public.get_owner_workspace_preferences((select id from ow_fixture where key='client')); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'Revoked owner preferences readable'; end if;
 denied:=false; begin perform public.save_owner_workspace_preferences((select id from ow_fixture where key='client'),(select id from ow_fixture where key='save'),0,'{"displayName":"Alex","order":["money","messages","appointments","todo"],"pinned":["messages"]}'); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'Revoked owner save replay accepted'; end if;
 denied:=false; begin perform public.record_owner_workspace_activity((select id from ow_fixture where key='client'),'money'); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'Revoked owner activity accepted'; end if;
end $revoked$;
reset role;
update public.memberships set status='active' where user_id=(select id from ow_fixture where key='owner');
delete from auth.sessions where id=(select id from ow_fixture where key='session-owner');
set local role authenticated; select pg_temp.ow_claim('owner');
do $session$ declare denied boolean:=false; begin begin perform public.record_owner_workspace_activity((select id from ow_fixture where key='client'),'money'); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'Ended session collected activity'; end if; end $session$;
reset role;
do $effects$ begin
 if (select count(*) from public.owner_workspace_preferences where client_id=(select id from ow_fixture where key='client'))<>1
  or exists(select 1 from public.integration_connections where partner_id=(select id from ow_fixture where key='partner'))
  or exists(select 1 from public.client_businesses where partner_id=(select id from ow_fixture where key='partner') and default_runtime_mode<>'sandbox') then raise exception 'Personal layout changed business authority or connections'; end if;
end $effects$;
rollback;
select '__CUSTOMER_JOURNEY_REPORT__'::text || jsonb_build_object('kind','owner_workspace_acceptance','rolledBack',true,'remainingFixtures',(select count(*) from public.partners where slug='cj-acceptance-__RUN_ID__-workspace'),'checks',jsonb_build_array('private_tables_and_live_session_rpc_grants','neutral_defaults_without_usage_inference','durable_cas_and_exact_retry','strict_bounded_no_actor_tenant_payload','per_owner_business_and_permission_isolation','once_per_module_local_day_no_contents_or_urls','bounded_retention_without_foreign_activity','revoked_session_and_membership_no_business_effects'))::text as cj_report;
