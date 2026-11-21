-- Real isolated PostgreSQL assertions. Identities/session JWT claims below are
-- synthetic; this is not browser Auth, assistant OAuth, provider or voice proof.
begin;
set local statement_timeout='45s'; set local lock_timeout='5s';
-- __ISOLATION_ASSERTION__
select pg_advisory_xact_lock(1937402189);
create temporary table pa_fixture(key text primary key,id uuid not null default extensions.gen_random_uuid(),data jsonb);
insert into pa_fixture(key) values('partner'),('foreign-partner'),('client'),('second'),('foreign'),('owner'),('other'),('manager'),('restricted'),('staff'),('foreign-owner'),('session-owner'),('session-other'),('session-manager'),('session-restricted'),('session-staff'),('session-foreign-owner'),('save'),('latest');
grant select,insert,update on pa_fixture to authenticated,service_role,anon;
insert into auth.users(id,email,email_confirmed_at) select id,'cj-acceptance-__RUN_ID__-personal-'||key||'@synthetic.invalid',now() from pa_fixture where key in('owner','other','manager','restricted','staff','foreign-owner');
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select s.id,u.id,now(),now(),now()+interval '1 hour' from pa_fixture s join pa_fixture u on u.key=substring(s.key from 9) where s.key like 'session-%';
insert into public.partners(id,name,slug,status) select id,'Synthetic personal assistant acceptance '||key,'cj-acceptance-__RUN_ID__-personal-'||key,'active' from pa_fixture where key in('partner','foreign-partner');
insert into public.client_businesses(id,partner_id,name,slug,status,client_portal_enabled,default_runtime_mode)
 select id,(select id from pa_fixture where key=case when f.key='foreign' then 'foreign-partner' else 'partner' end),'Synthetic personal assistant business '||key,'cj-acceptance-__RUN_ID__-personal-'||key,'active',true,'sandbox' from pa_fixture f where key in('client','second','foreign');
insert into public.memberships(user_id,partner_id,client_id,role,status,client_permissions)
 select id,(select id from pa_fixture where key=case when f.key='foreign-owner' then 'foreign-partner' else 'partner' end),(select id from pa_fixture where key=case when f.key='foreign-owner' then 'foreign' else 'client' end),case when f.key in('manager','restricted') then 'client_manager'::public.membership_role when f.key='staff' then 'client_staff'::public.membership_role else 'client_owner'::public.membership_role end,'active',case when f.key='restricted' then '{"sections":["overview"]}'::jsonb else '{}'::jsonb end from pa_fixture f where key in('owner','other','manager','restricted','staff','foreign-owner');
insert into public.memberships(user_id,partner_id,client_id,role,status) values((select id from pa_fixture where key='owner'),(select id from pa_fixture where key='partner'),(select id from pa_fixture where key='second'),'client_owner','active');
create function pg_temp.pa_claim(p_key text) returns void language plpgsql security invoker set search_path='' as $$ begin
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',(select id::text from pg_temp.pa_fixture where key=p_key),true);
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',(select id from pg_temp.pa_fixture where key=p_key),'session_id',(select id from pg_temp.pa_fixture where key='session-'||p_key))::text,true);
end $$;
grant execute on function pg_temp.pa_claim(text) to authenticated;
-- Group1: actual catalog RLS, grants and private-definer/public-invoker modes.
do $catalog$ declare entry record; begin
 if not (select relrowsecurity from pg_class where oid='public.owner_personal_assistant_preferences'::regclass)
  or exists(select 1 from pg_policy where polrelid='public.owner_personal_assistant_preferences'::regclass)
  or has_table_privilege('anon','public.owner_personal_assistant_preferences','SELECT,INSERT,UPDATE,DELETE')
  or has_table_privilege('authenticated','public.owner_personal_assistant_preferences','SELECT,INSERT,UPDATE,DELETE')
  or exists(select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE']) as permission(privilege_name) where not has_table_privilege('service_role','public.owner_personal_assistant_preferences',permission.privilege_name)) then raise exception 'Personal preference table RLS/ACL boundary differs'; end if;
 for entry in select p.*,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid=any(array[
  'public.get_owner_personal_assistant(uuid)'::regprocedure,'public.save_owner_personal_assistant(uuid,uuid,bigint,jsonb)'::regprocedure,
  'owner_onboarding.personal_assistant(uuid)'::regprocedure,'owner_onboarding.save_personal_assistant(uuid,uuid,bigint,jsonb)'::regprocedure]) loop
  if entry.prosecdef is distinct from (entry.nspname='owner_onboarding') or entry.proconfig is distinct from array['search_path=""']::text[]
   or entry.proowner<>(select proowner from pg_proc where oid='owner_onboarding.workspace_actor(uuid)'::regprocedure)
   or has_function_privilege('anon',entry.oid,'EXECUTE') or not has_function_privilege('authenticated',entry.oid,'EXECUTE') or not has_function_privilege('service_role',entry.oid,'EXECUTE')
   or exists(select 1 from aclexplode(coalesce(entry.proacl,acldefault('f',entry.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE')
   or entry.prosrc ~* '40001|40P01|serialization_failure|deadlock_detected' then raise exception 'Personal preference function boundary differs: %',entry.oid::regprocedure; end if;
 end loop;
 if (select proargnames from pg_proc where oid='public.get_owner_personal_assistant(uuid)'::regprocedure) is distinct from array['p_client']::text[]
  or (select proargnames from pg_proc where oid='public.save_owner_personal_assistant(uuid,uuid,bigint,jsonb)'::regprocedure) is distinct from array['p_client','p_key','p_revision','p_settings']::text[] then raise exception 'Public preference RPC accepts an unexpected supplied actor/scope argument'; end if;
end $catalog$;
set local role anon;
do $anon$ declare denied boolean:=false; begin
 begin perform public.get_owner_personal_assistant((select id from pa_fixture where key='client')); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Anonymous personal preference read was accepted'; end if;
end $anon$;
reset role; set local role service_role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $no_actor$ declare denied boolean:=false; begin
 begin perform public.get_owner_personal_assistant((select id from pa_fixture where key='client')); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Privileged transport silently supplied a personal preference actor'; end if;
end $no_actor$;
reset role; set local role authenticated; select pg_temp.pa_claim('owner');
-- Group2: read-only unanswered default, exact preference-only output.
do $defaults$ declare snapshot jsonb; denied boolean; begin
 snapshot:=public.get_owner_personal_assistant((select id from pa_fixture where key='client'));
 if snapshot is distinct from '{"preferences":{"answer":"unanswered","assistant":null,"revision":0},"available":true,"canEdit":true}'::jsonb then raise exception 'Default preferences imply a choice, connection or unsupported fields'; end if;
 denied:=false; begin perform 1 from public.owner_personal_assistant_preferences; exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'Browser directly read private preferences'; end if;
 denied:=false; begin delete from public.owner_personal_assistant_preferences where false; exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'Browser has direct personal-preference mutation privilege'; end if;
end $defaults$;
reset role;
do $read_side_effect$ begin if exists(select 1 from public.owner_personal_assistant_preferences where client_id=(select id from pa_fixture where key='client')) then raise exception 'Default read persisted an inferred answer'; end if; end $read_side_effect$;
set local role authenticated; select pg_temp.pa_claim('owner');
-- Group3: durable first save, exact key/body/request-revision retry, both stale
-- and changed-key-payload conflicts are deliberate PT409 without partial writes.
do $cas$ declare c uuid:=(select id from pa_fixture where key='client'); k uuid:=(select id from pa_fixture where key='save'); snapshot jsonb; denied boolean; begin
 snapshot:=public.save_owner_personal_assistant(c,k,0,'{"answer":"yes","assistant":"muse"}');
 if snapshot is distinct from '{"preferences":{"answer":"yes","assistant":"muse","revision":1},"available":true,"canEdit":true}'::jsonb then raise exception 'First explicit personal choice was not persisted exactly'; end if;
 if public.save_owner_personal_assistant(c,k,0,'{"answer":"yes","assistant":"muse"}') is distinct from snapshot then raise exception 'Exact personal preference retry did not replay'; end if;
 denied:=false; begin perform public.save_owner_personal_assistant(c,k,0,'{"answer":"no","assistant":"workstation"}'); exception when sqlstate 'PT409' then denied:=true; end; if not denied then raise exception 'Changed choice reused a committed save key'; end if;
 denied:=false; begin perform public.save_owner_personal_assistant(c,k,1,'{"answer":"yes","assistant":"muse"}'); exception when sqlstate 'PT409' then denied:=true; end; if not denied then raise exception 'Changed request revision reused a committed save key'; end if;
 denied:=false; begin perform public.save_owner_personal_assistant(c,extensions.gen_random_uuid(),0,'{"answer":"no","assistant":null}'); exception when sqlstate 'PT409' then denied:=true; end; if not denied then raise exception 'A stale client overwrote the saved choice'; end if;
 if public.get_owner_personal_assistant(c) is distinct from snapshot then raise exception 'A rejected personal choice had partial writes'; end if;
end $cas$;
-- Group4: strict shape, combinations and bounded CAS args, no actor/tenant,
-- status, permission, credential or fabricated connection field accepted.
do $invalid$ declare candidate jsonb; denied boolean; revision_arg bigint; begin
 foreach candidate in array array[
  null::jsonb,'null'::jsonb,'[]'::jsonb,'{}'::jsonb,'{"answer":"yes"}'::jsonb,'{"assistant":"muse"}'::jsonb,
  '{"answer":null,"assistant":null}'::jsonb,'{"answer":1,"assistant":null}'::jsonb,'{"answer":"YES","assistant":"muse"}'::jsonb,
  '{"answer":"yes","assistant":null}'::jsonb,'{"answer":"yes","assistant":"workstation"}'::jsonb,'{"answer":"yes","assistant":"unknown"}'::jsonb,
  '{"answer":"yes","assistant":true}'::jsonb,'{"answer":"yes","assistant":{}}'::jsonb,'{"answer":"yes","assistant":[]}'::jsonb,
  '{"answer":"no","assistant":"muse"}'::jsonb,'{"answer":"unanswered","assistant":"muse"}'::jsonb,'{"answer":"skipped","assistant":"workstation"}'::jsonb,
  '{"answer":"no","assistant":null,"actorId":"spoofed"}'::jsonb,'{"answer":"no","assistant":null,"partnerId":"spoofed"}'::jsonb,
  '{"answer":"no","assistant":null,"connectionStatus":"connected"}'::jsonb,'{"answer":"no","assistant":null,"permissions":["send"]}'::jsonb
 ] loop
  denied:=false; begin perform public.save_owner_personal_assistant((select id from pa_fixture where key='client'),extensions.gen_random_uuid(),1,candidate); exception when invalid_parameter_value then denied:=true; end;
  if not denied then raise exception 'Invalid personal assistant payload was accepted'; end if;
 end loop;
 foreach revision_arg in array array[null::bigint,-1::bigint,9007199254740991::bigint] loop
  denied:=false; begin perform public.save_owner_personal_assistant((select id from pa_fixture where key='client'),extensions.gen_random_uuid(),revision_arg,'{"answer":"no","assistant":null}'); exception when invalid_parameter_value then denied:=true; end;
  if not denied then raise exception 'Invalid personal assistant revision was accepted'; end if;
 end loop;
 denied:=false; begin perform public.save_owner_personal_assistant((select id from pa_fixture where key='client'),null,1,'{"answer":"no","assistant":null}'); exception when invalid_parameter_value then denied:=true; end;
 if not denied then raise exception 'Missing save key was accepted'; end if;
end $invalid$;
-- Group5: each supported explicit answer, including decline/skip/reset, is
-- durable and readable; none confers a connected state or permission.
do $choices$ declare candidate jsonb; snapshot jsonb; k uuid; revision_arg bigint; denied boolean:=false; begin
 foreach candidate in array array[
  '{"answer":"yes","assistant":"muse"}'::jsonb,'{"answer":"yes","assistant":"chatgpt_dot"}'::jsonb,
  '{"answer":"yes","assistant":"grok"}'::jsonb,'{"answer":"yes","assistant":"other"}'::jsonb,
  '{"answer":"no","assistant":null}'::jsonb,'{"answer":"no","assistant":"workstation"}'::jsonb,
  '{"answer":"skipped","assistant":null}'::jsonb,'{"answer":"unanswered","assistant":null}'::jsonb
 ] loop
  snapshot:=public.get_owner_personal_assistant((select id from pa_fixture where key='client')); revision_arg:=(snapshot->'preferences'->>'revision')::bigint; k:=extensions.gen_random_uuid();
  snapshot:=public.save_owner_personal_assistant((select id from pa_fixture where key='client'),k,revision_arg,candidate);
  if snapshot is distinct from jsonb_build_object('preferences',candidate||jsonb_build_object('revision',revision_arg+1),'available',true,'canEdit',true)
   or public.get_owner_personal_assistant((select id from pa_fixture where key='client')) is distinct from snapshot then raise exception 'Explicit personal assistant choice did not survive readback'; end if;
  update pa_fixture set data=jsonb_build_object('key',k,'requestRevision',revision_arg,'settings',candidate) where key='latest';
 end loop;
 begin perform public.save_owner_personal_assistant((select id from pa_fixture where key='client'),(select id from pa_fixture where key='save'),0,'{"answer":"yes","assistant":"muse"}'); exception when sqlstate 'PT409' then denied:=true; end;
 if not denied then raise exception 'A superseded original-revision request replayed over a later choice'; end if;
end $choices$;
reset role;
-- The table constraint also rejects SQL-NULL crossfield combinations even for
-- trusted service writes. CHECK(NULL) must not accidentally admit yes/null.
do $constraint$ declare denied boolean:=false; begin
 begin update public.owner_personal_assistant_preferences set settings='{"answer":"yes","assistant":null}' where user_id=(select id from pa_fixture where key='owner') and client_id=(select id from pa_fixture where key='client'); exception when check_violation then denied:=true; end;
 if not denied then raise exception 'The persistence constraint admitted an invalid assistant combination'; end if;
end $constraint$;
set local role authenticated; select pg_temp.pa_claim('other');
-- Group6: independent actor and business defaults, no cross-tenant fallback.
do $isolation$ declare snapshot jsonb; denied boolean:=false; begin
 snapshot:=public.get_owner_personal_assistant((select id from pa_fixture where key='client'));
 if snapshot->'preferences' is distinct from '{"answer":"unanswered","assistant":null,"revision":0}'::jsonb then raise exception 'Another actor inherited the first owner personal choice'; end if;
 perform public.save_owner_personal_assistant((select id from pa_fixture where key='client'),extensions.gen_random_uuid(),0,'{"answer":"no","assistant":"workstation"}');
 begin perform public.get_owner_personal_assistant((select id from pa_fixture where key='foreign')); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Foreign-business personal preferences were readable'; end if;
 denied:=false; begin perform public.save_owner_personal_assistant((select id from pa_fixture where key='foreign'),extensions.gen_random_uuid(),0,'{"answer":"yes","assistant":"muse"}'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Foreign-business personal preferences were writable'; end if;
end $isolation$;
select pg_temp.pa_claim('owner');
do $business$ declare snapshot jsonb; begin
 snapshot:=public.get_owner_personal_assistant((select id from pa_fixture where key='second'));
 if snapshot->'preferences' is distinct from '{"answer":"unanswered","assistant":null,"revision":0}'::jsonb then raise exception 'One business inherited another business personal choice'; end if;
 perform public.save_owner_personal_assistant((select id from pa_fixture where key='second'),extensions.gen_random_uuid(),0,'{"answer":"yes","assistant":"grok"}');
 if public.get_owner_personal_assistant((select id from pa_fixture where key='client'))->'preferences'->>'answer' is distinct from 'unanswered' then raise exception 'Saving a second business overwrote the first business personal choice'; end if;
end $business$;
-- Group7: unchanged workspace roles/sections and actual session pin checks.
do $roles$ declare label text; denied boolean; snapshot jsonb; begin
 perform pg_temp.pa_claim('manager');
 snapshot:=public.save_owner_personal_assistant((select id from pa_fixture where key='client'),extensions.gen_random_uuid(),0,'{"answer":"skipped","assistant":null}');
 if snapshot is distinct from '{"preferences":{"answer":"skipped","assistant":null,"revision":1},"available":true,"canEdit":true}'::jsonb then raise exception 'Existing fully permitted manager role could not save its own choice'; end if;
 foreach label in array array['restricted','staff'] loop
  perform pg_temp.pa_claim(label); denied:=false;
  begin perform public.get_owner_personal_assistant((select id from pa_fixture where key='client')); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Insufficient workspace role/sections read personal preferences'; end if;
  denied:=false; begin perform public.save_owner_personal_assistant((select id from pa_fixture where key='client'),extensions.gen_random_uuid(),0,'{"answer":"no","assistant":null}'); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Insufficient workspace role/sections saved personal preferences'; end if;
 end loop;
 perform pg_temp.pa_claim('owner');
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',(select id from pa_fixture where key='owner'),'session_id',(select id from pa_fixture where key='session-other'))::text,true);
 denied:=false; begin perform public.get_owner_personal_assistant((select id from pa_fixture where key='client')); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Another owner session authenticated this actor'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',(select id from pa_fixture where key='owner'))::text,true);
 denied:=false; begin perform public.get_owner_personal_assistant((select id from pa_fixture where key='client')); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Missing actual Auth session authenticated the owner'; end if;
 perform pg_temp.pa_claim('owner');
end $roles$;
reset role;
-- Group8: revocation/disabled portal/stale session reject reads and even an
-- exact committed-key retry before consulting the personal preference row.
update public.client_businesses set client_portal_enabled=false where id=(select id from pa_fixture where key='client');
set local role authenticated; select pg_temp.pa_claim('owner');
do $portal$ declare denied boolean:=false; latest jsonb:=(select data from pa_fixture where key='latest'); begin
 begin perform public.save_owner_personal_assistant((select id from pa_fixture where key='client'),(latest->>'key')::uuid,(latest->>'requestRevision')::bigint,latest->'settings'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Disabled portal allowed committed-key personal save replay'; end if;
end $portal$;
reset role;
update public.client_businesses set client_portal_enabled=true where id=(select id from pa_fixture where key='client');
update public.memberships set status='disabled' where user_id=(select id from pa_fixture where key='owner') and client_id=(select id from pa_fixture where key='client');
set local role authenticated; select pg_temp.pa_claim('owner');
do $revoked$ declare denied boolean:=false; latest jsonb:=(select data from pa_fixture where key='latest'); begin
 begin perform public.get_owner_personal_assistant((select id from pa_fixture where key='client')); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Revoked membership read personal preferences'; end if;
 denied:=false; begin perform public.save_owner_personal_assistant((select id from pa_fixture where key='client'),(latest->>'key')::uuid,(latest->>'requestRevision')::bigint,latest->'settings'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Revoked membership replayed a committed personal save'; end if;
end $revoked$;
reset role;
update public.memberships set status='active' where user_id=(select id from pa_fixture where key='owner') and client_id=(select id from pa_fixture where key='client');
delete from auth.sessions where id=(select id from pa_fixture where key='session-owner');
set local role authenticated; select pg_temp.pa_claim('owner');
do $ended_session$ declare denied boolean:=false; latest jsonb:=(select data from pa_fixture where key='latest'); begin
 begin perform public.get_owner_personal_assistant((select id from pa_fixture where key='client')); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'Ended Auth session read personal preferences'; end if;
 denied:=false; begin perform public.save_owner_personal_assistant((select id from pa_fixture where key='client'),(latest->>'key')::uuid,(latest->>'requestRevision')::bigint,latest->'settings'); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'Ended Auth session replayed a personal save'; end if;
end $ended_session$;
reset role;
-- Group9: declared preference changes produce no connections, business
-- authority, activity, approvals, jobs, agents, voice/model or provider effects.
do $effects$ begin
 if (select count(*) from public.owner_personal_assistant_preferences where partner_id=(select id from pa_fixture where key='partner'))<>4
  or exists(select 1 from public.integration_connections where partner_id in(select id from pa_fixture where key in('partner','foreign-partner')))
  or exists(select 1 from public.agent_team_settings where partner_id=(select id from pa_fixture where key='partner'))
  or exists(select 1 from public.business_agent_activation where partner_id=(select id from pa_fixture where key='partner'))
  or exists(select 1 from public.approval_items where partner_id=(select id from pa_fixture where key='partner'))
  or exists(select 1 from public.action_jobs where partner_id=(select id from pa_fixture where key='partner'))
  or exists(select 1 from public.agent_work_items where partner_id=(select id from pa_fixture where key='partner'))
  or exists(select 1 from public.owner_workspace_preferences where partner_id=(select id from pa_fixture where key='partner'))
  or exists(select 1 from public.owner_workspace_activity where partner_id=(select id from pa_fixture where key='partner'))
  or exists(select 1 from public.client_businesses where partner_id in(select id from pa_fixture where key in('partner','foreign-partner')) and default_runtime_mode<>'sandbox') then raise exception 'Personal assistant onboarding expanded business authority or created an action/connection'; end if;
end $effects$;
rollback;
select '__CUSTOMER_JOURNEY_REPORT__'::text || jsonb_build_object('kind','personal_assistant_acceptance','rolledBack',true,'remainingFixtures',(select count(*) from public.partners where slug like 'cj-acceptance-__RUN_ID__-personal-%'),'checks',jsonb_build_array('actual_private_table_rls_acl_and_invoker_wrappers','neutral_read_without_inferred_choice_or_write','durable_exact_retry_and_semantic_cas_conflicts','strict_shape_choices_and_no_actor_connection_injection','all_explicit_choices_durable_without_connection_claim','independent_actor_business_and_foreign_scope','workspace_roles_sections_and_exact_session_binding','revocation_portal_and_ended_session_block_retry','no_connections_authority_models_or_action_effects'),
 'catalog',jsonb_build_object('table',jsonb_build_object('name','owner_personal_assistant_preferences','owner',(select pg_get_userbyid(relowner) from pg_class where oid='public.owner_personal_assistant_preferences'::regclass),'rls',(select relrowsecurity from pg_class where oid='public.owner_personal_assistant_preferences'::regclass),'policies',(select count(*) from pg_policy where polrelid='public.owner_personal_assistant_preferences'::regclass),'anonRead',has_table_privilege('anon','public.owner_personal_assistant_preferences','SELECT'),'authenticatedRead',has_table_privilege('authenticated','public.owner_personal_assistant_preferences','SELECT'),'authenticatedWrite',has_table_privilege('authenticated','public.owner_personal_assistant_preferences','INSERT,UPDATE,DELETE'),'serviceReadWrite',(select bool_and(has_table_privilege('service_role','public.owner_personal_assistant_preferences',permission.privilege_name)) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) as permission(privilege_name))),
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'configuration',p.proconfig,'publicExecute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE'),'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE')) order by p.oid::regprocedure::text) from pg_proc p where p.oid=any(array['public.get_owner_personal_assistant(uuid)'::regprocedure,'public.save_owner_personal_assistant(uuid,uuid,bigint,jsonb)'::regprocedure,'owner_onboarding.personal_assistant(uuid)'::regprocedure,'owner_onboarding.save_personal_assistant(uuid,uuid,bigint,jsonb)'::regprocedure]))))::text as cj_report;
