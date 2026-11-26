-- Real isolated PostgreSQL assertions with synthetic Auth session claims only.
-- No browser identity, provider consent, model operation or live delivery proof.
begin;
set local statement_timeout='45s'; set local lock_timeout='5s';
-- __ISOLATION_ASSERTION__
select pg_advisory_xact_lock(1937402189);
do $blank$ begin
 if current_database() !~ '_(test|acceptance)$' or exists(select 1 from public.partners) or exists(select 1 from public.client_businesses) then raise exception 'Onboarding acceptance requires a blank disposable database'; end if;
end $blank$;
create temporary table ob_fixture(key text primary key,id uuid not null default extensions.gen_random_uuid(),data jsonb);
insert into ob_fixture(key) values('partner'),('foreign-partner'),('client'),('second'),('foreign'),('owner'),('other'),('manager'),('staff'),('viewer'),('foreign-owner'),('session-owner'),('session-other'),('session-manager'),('session-staff'),('session-viewer'),('session-foreign-owner'),('first-key'),('answer-key'),('work-queued'),('work-protected'),('latest');
grant select,insert,update on ob_fixture to authenticated,service_role,anon;
insert into auth.users(id,email,email_confirmed_at) select id,'cj-acceptance-__RUN_ID__-onboarding-'||key||'@synthetic.invalid',now() from ob_fixture where key in('owner','other','manager','staff','viewer','foreign-owner');
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select s.id,u.id,now(),now(),now()+interval '1 hour' from ob_fixture s join ob_fixture u on u.key=substring(s.key from 9) where s.key like 'session-%';
insert into public.partners(id,name,slug,status) select id,'Synthetic onboarding acceptance '||key,'cj-acceptance-__RUN_ID__-onboarding-'||key,'active' from ob_fixture where key in('partner','foreign-partner');
insert into public.client_businesses(id,partner_id,name,slug,status,client_portal_enabled,default_runtime_mode)
 select id,(select id from ob_fixture where key=case when f.key='foreign' then 'foreign-partner' else 'partner' end),'Synthetic onboarding business '||key,'cj-acceptance-__RUN_ID__-onboarding-'||key,'active',true,'sandbox' from ob_fixture f where key in('client','second','foreign');
insert into public.memberships(user_id,partner_id,client_id,role,status)
 select id,(select id from ob_fixture where key=case when f.key='foreign-owner' then 'foreign-partner' else 'partner' end),(select id from ob_fixture where key=case when f.key='foreign-owner' then 'foreign' else 'client' end),case when f.key='manager' then 'client_manager'::public.membership_role when f.key='staff' then 'client_staff'::public.membership_role when f.key='viewer' then 'client_viewer'::public.membership_role else 'client_owner'::public.membership_role end,'active' from ob_fixture f where key in('owner','other','manager','staff','viewer','foreign-owner');
insert into public.memberships(user_id,partner_id,client_id,role,status) values((select id from ob_fixture where key='owner'),(select id from ob_fixture where key='partner'),(select id from ob_fixture where key='second'),'client_owner','active');
insert into public.agent_team_settings(partner_id,client_id,status,channel_authority) values((select id from ob_fixture where key='partner'),(select id from ob_fixture where key='client'),'paused','{"website":"off","email":"off","sms":"off","instagram":"off","calendar":"off"}');
insert into public.business_workspace_profiles(partner_id,client_id,profile) values((select id from ob_fixture where key='partner'),(select id from ob_fixture where key='client'),'{"description":"Original raw business fact","services":null,"hours":null,"future_fact":{"keep":true,"legacy_hours":["legacy unknown"]},"currency":"CAD"}');
insert into public.client_knowledge_profiles(partner_id,client_id,business_description,business_hours) values((select id from ob_fixture where key='partner'),(select id from ob_fixture where key='client'),'Original raw business fact','Independent source hours');
create function pg_temp.ob_claim(p_key text) returns void language plpgsql security invoker set search_path='' as $$ begin
 perform set_config('request.jwt.claim.role','authenticated',true); perform set_config('request.jwt.claim.sub',(select id::text from pg_temp.ob_fixture where key=p_key),true);
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',(select id from pg_temp.ob_fixture where key=p_key),'session_id',(select id from pg_temp.ob_fixture where key='session-'||p_key))::text,true);
end $$;
grant execute on function pg_temp.ob_claim(text) to authenticated;
-- Group1: actual service-only table RLS, exact public arguments and narrow
-- private-definer/public-invoker modes, owners, search paths and function ACLs.
do $catalog$ declare entry record; begin
 if not (select relrowsecurity from pg_class where oid='public.owner_onboarding_progress'::regclass)
  or exists(select 1 from pg_policy where polrelid='public.owner_onboarding_progress'::regclass)
  or has_table_privilege('anon','public.owner_onboarding_progress','SELECT,INSERT,UPDATE,DELETE')
  or has_table_privilege('authenticated','public.owner_onboarding_progress','SELECT,INSERT,UPDATE,DELETE')
  or exists(select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE']) as permission(privilege_name) where not has_table_privilege('service_role','public.owner_onboarding_progress',permission.privilege_name)) then raise exception 'Onboarding table RLS/ACL differs'; end if;
 for entry in select p.*,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid=any(array['public.get_owner_onboarding(uuid)'::regprocedure,'public.save_owner_onboarding(uuid,uuid,bigint,jsonb)'::regprocedure,'owner_onboarding.onboarding_snapshot(uuid)'::regprocedure,'owner_onboarding.save_onboarding(uuid,uuid,bigint,jsonb)'::regprocedure,'public.get_business_profile_snapshot(uuid,uuid)'::regprocedure,'public.save_business_profile(uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure,'owner_onboarding.lock_profile_actor(uuid)'::regprocedure]) loop
  if entry.prosecdef is distinct from (entry.nspname='owner_onboarding') or entry.proconfig is distinct from array['search_path=""']::text[] or pg_get_userbyid(entry.proowner)<>'postgres'
   or has_function_privilege('anon',entry.oid,'EXECUTE') or has_function_privilege('authenticated',entry.oid,'EXECUTE') is distinct from (entry.proname not in('get_business_profile_snapshot','save_business_profile','lock_profile_actor')) or not has_function_privilege('service_role',entry.oid,'EXECUTE')
   or exists(select 1 from aclexplode(coalesce(entry.proacl,acldefault('f',entry.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
   or entry.prosrc ~* '40001|40P01|serialization_failure|deadlock_detected' then raise exception 'Onboarding function metadata differs: %',entry.oid::regprocedure; end if;
 end loop;
 if exists(select 1 from pg_trigger t where t.tgrelid='public.business_workspace_profiles'::regclass and not t.tgisinternal and (t.tgtype & 2)=2 and t.tgfoid='public.set_updated_at()'::regprocedure) then raise exception 'A transaction-stable profile trigger would overwrite the monotonic onboarding revision'; end if;
 if has_table_privilege('service_role','auth.users','SELECT') or has_table_privilege('service_role','auth.sessions','SELECT')
  or (select prosrc ~* 'from[[:space:]]+auth[.](users|sessions)' from pg_proc where oid='public.save_business_profile(uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure) then raise exception 'Service full-save fixture must not mask private Auth reads'; end if;
 if (select prorettype from pg_proc where oid='owner_onboarding.lock_profile_actor(uuid)'::regprocedure) is distinct from 'void'::regtype
  or (select proargnames from pg_proc where oid='owner_onboarding.lock_profile_actor(uuid)'::regprocedure) is distinct from array['p_actor']::text[] then raise exception 'Private actor lock exposed an identity result or extra authority'; end if;
 if (select proargnames from pg_proc where oid='public.save_owner_onboarding(uuid,uuid,bigint,jsonb)'::regprocedure) is distinct from array['p_client','p_key','p_revision','p_command']::text[] then raise exception 'Onboarding public RPC accepts an unexpected actor/scope'; end if;
end $catalog$;
set local role anon;
do $anon$ declare denied boolean:=false; begin
 begin perform public.get_owner_onboarding((select id from ob_fixture where key='client')); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Anonymous read onboarding'; end if;
end $anon$;
reset role; set local role service_role; select set_config('request.jwt.claim.sub','',true); select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $no_actor$ declare denied boolean:=false; begin
 begin perform public.get_owner_onboarding((select id from ob_fixture where key='client')); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Service transport silently supplied an onboarding actor'; end if;
 denied:=false; begin perform owner_onboarding.lock_profile_actor(null); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Service actor lock accepted a missing identity'; end if;
 denied:=false; begin perform owner_onboarding.lock_profile_actor(extensions.gen_random_uuid()); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Service actor lock accepted an unknown identity'; end if;
end $no_actor$;
-- Establish a real context review before testing no-op and invalidation. No
-- provider/channel activation or live acceptance is created.
do $review$ declare c uuid:=(select id from ob_fixture where key='client'); p uuid:=(select id from ob_fixture where key='partner'); at timestamptz; begin
 select updated_at into at from public.business_workspace_profiles where client_id=c;
 perform public.apply_business_context_command(p,c,(select id from ob_fixture where key='owner'),jsonb_build_object('action','review_context','key',extensions.gen_random_uuid(),'expectedContextRevision',at));
end $review$;
reset role; set local role authenticated; select pg_temp.ob_claim('owner');
-- Group2: raw description only; unknown extra facts never become defaults,
-- default progress reads do not write rows or advertise readiness/authority.
do $defaults$ declare s jsonb; denied boolean; begin
 s:=public.get_owner_onboarding((select id from ob_fixture where key='client'));
 if s->'answers' is distinct from '{"description":"Original raw business fact"}'::jsonb or s->'progress' is distinct from '{"revision":0,"step":"description","skipped":[],"finished":false}'::jsonb or s-array['available','canEdit','profileRevision','answers','progress']<>'{}'::jsonb then raise exception 'Onboarding read fabricated defaults or exposed extra data'; end if;
 s:=public.get_owner_onboarding((select id from ob_fixture where key='second'));
 if coalesce(s->>'profileRevision','')!~'^[a-f0-9]{32}$' or s->'answers' is distinct from '{"description":null}'::jsonb then raise exception 'Missing facts were materialized as known'; end if;
 denied:=false; begin perform 1 from public.owner_onboarding_progress; exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Browser read private progress directly'; end if;
 denied:=false; begin delete from public.owner_onboarding_progress where false; exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Browser mutated private progress directly'; end if;
 denied:=false; begin perform public.get_business_profile_snapshot((select id from ob_fixture where key='partner'),(select id from ob_fixture where key='client')); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'Browser bypassed the scoped settings server'; end if;
 denied:=false; begin perform public.save_business_profile(null,null,null,null,null,null); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'Browser invoked privileged full settings write'; end if;
 denied:=false; begin perform owner_onboarding.lock_profile_actor((select id from ob_fixture where key='owner')); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'Browser invoked privileged actor lock'; end if;
end $defaults$;
reset role;
do $no_read_writes$ begin if exists(select 1 from public.owner_onboarding_progress) or exists(select 1 from public.business_workspace_profiles where client_id=(select id from ob_fixture where key='second')) then raise exception 'Read-only onboarding created progress or facts'; end if; end $no_read_writes$;
-- Group3: an identical raw answer advances presentation once, preserving the
-- profile clock, current review, source knowledge and authority revision.
update ob_fixture set data=jsonb_build_object('profile',(select to_jsonb(p) from public.business_workspace_profiles p where client_id=(select id from ob_fixture where key='client')),'knowledge',(select to_jsonb(k) from public.client_knowledge_profiles k where client_id=(select id from ob_fixture where key='client')),'settings',(select to_jsonb(s) from public.agent_team_settings s where client_id=(select id from ob_fixture where key='client')),'review',(select to_jsonb(r) from public.business_context_reviews r where client_id=(select id from ob_fixture where key='client'))) where key='latest';
set local role authenticated; select pg_temp.ob_claim('owner');
do $noop$ declare c uuid:=(select id from ob_fixture where key='client'); s jsonb; cmd jsonb; receipt jsonb; begin
 s:=public.get_owner_onboarding(c); cmd:=jsonb_build_object('action','answer','field','description','value','Original raw business fact','expectedProfileRevision',s->>'profileRevision');
 receipt:=public.save_owner_onboarding(c,(select id from ob_fixture where key='first-key'),0,cmd);
 if receipt->'result'->>'revision'<>'1' or receipt->'result'->>'cancelledWork'<>'0' or receipt->'snapshot'->>'profileRevision' is distinct from s->>'profileRevision' or receipt->'snapshot'->'progress'->>'step'<>'connections' then raise exception 'No-op answer altered facts or did not atomically advance presentation'; end if;
 update ob_fixture set data=data||jsonb_build_object('firstCommand',cmd,'firstResult',receipt->'result') where key='latest';
end $noop$;
reset role;
do $noop_preserved$ declare saved jsonb:=(select data from ob_fixture where key='latest'); c uuid:=(select id from ob_fixture where key='client'); begin
 if saved->'profile' is distinct from (select to_jsonb(p) from public.business_workspace_profiles p where client_id=c) or saved->'knowledge' is distinct from (select to_jsonb(k) from public.client_knowledge_profiles k where client_id=c) or saved->'settings' is distinct from (select to_jsonb(s) from public.agent_team_settings s where client_id=c) or saved->'review' is distinct from (select to_jsonb(r) from public.business_context_reviews r where client_id=c) then raise exception 'No-op answer invalidated or overwrote facts/knowledge/review/authority'; end if;
end $noop_preserved$;
-- Synthetic durable state rows below test cancellation policy only. There is
-- no provider, execution, successful live receipt or customer identity claim.
insert into public.agent_work_items(id,partner_id,client_id,kind,agent_key,title,status,dedupe_key)
 select id,(select id from ob_fixture where key='partner'),(select id from ob_fixture where key='client'),'business_request','manager','Synthetic onboarding cancellation policy',case when key='work-queued' then 'queued' else 'waiting_external' end,'cj-acceptance-__RUN_ID__-'||key from ob_fixture where key in('work-queued','work-protected');
insert into public.action_jobs(partner_id,client_id,kind,status,payload,external_ref)
 select (select id from ob_fixture where key='partner'),(select id from ob_fixture where key='client'),case when v.label='failed-crm' then 'crm.sync' else 'email.send' end,v.status,
 jsonb_build_object('synthetic_onboarding_case',v.label,'agent_work_id',case when v.label='uncertain' then (select id::text from ob_fixture where key='work-protected') else null end),case when v.label='failed-external' then 'synthetic-accepted-reference' else null end
 from (values('pending','pending'),('failed','failed'),('dry_run','dry_run'),('skipped','skipped'),('processing','processing'),('provider_pending','provider_pending'),('uncertain','uncertain'),('succeeded','succeeded'),('failed-crm','failed'),('failed-external','failed')) v(label,status);
set local role authenticated; select pg_temp.ob_claim('owner');
-- Group4: changed description patches one raw key atomically with progress,
-- invalidates review once, and stops only safe never-accepted work.
do $answer$ declare c uuid:=(select id from ob_fixture where key='client'); s jsonb; cmd jsonb; r jsonb; begin
 s:=public.get_owner_onboarding(c); cmd:=jsonb_build_object('action','answer','field','description','value',E'New raw business fact\nWith an ordinary\ttab','expectedProfileRevision',s->>'profileRevision');
 r:=public.save_owner_onboarding(c,(select id from ob_fixture where key='answer-key'),1,cmd);
 if r->'result'->>'revision'<>'2' or r->'result'->>'cancelledWork'<>'5' or r->'result'->>'profileRevision'=s->>'profileRevision' or r->'snapshot'->'answers'->>'description' is distinct from cmd->>'value' or r->'snapshot'->'progress'->>'step'<>'connections' then raise exception 'Fact/progress/cancellation did not commit atomically'; end if;
 update ob_fixture set data=data||jsonb_build_object('answerCommand',cmd,'answerResult',r->'result') where key='latest';
end $answer$;
reset role;
do $answer_preserved$ declare saved jsonb:=(select data from ob_fixture where key='latest'); c uuid:=(select id from ob_fixture where key='client'); raw jsonb; settings jsonb; begin
 select profile into raw from public.business_workspace_profiles where client_id=c;
 select to_jsonb(s) into settings from public.agent_team_settings s where client_id=c;
 if raw-'description' is distinct from (saved->'profile'->'profile')-'description' or (saved->'knowledge')-array['business_description','updated_at'] is distinct from (select to_jsonb(k)-array['business_description','updated_at'] from public.client_knowledge_profiles k where client_id=c)
  or not exists(select 1 from public.client_knowledge_profiles k join public.business_workspace_profiles p on p.client_id=k.client_id where k.client_id=c and k.business_description=p.profile->>'description')
  or exists(select 1 from public.business_context_reviews where client_id=c) or (settings->>'authority_revision')::integer<=(saved->'settings'->>'authority_revision')::integer
  or settings-'authority_revision' is distinct from (saved->'settings')-'authority_revision'
  or (select count(*) from public.action_jobs where client_id=c and status='cancelled')<>4
  or exists(select 1 from public.action_jobs where client_id=c and payload->>'synthetic_onboarding_case' in('processing','provider_pending','uncertain','succeeded','failed-crm','failed-external') and status is distinct from (case when payload->>'synthetic_onboarding_case' like 'failed-%' then 'failed' else payload->>'synthetic_onboarding_case' end))
  or not exists(select 1 from public.agent_work_items where id=(select id from ob_fixture where key='work-queued') and status='cancelled')
  or not exists(select 1 from public.agent_work_items where id=(select id from ob_fixture where key='work-protected') and status='waiting_external') then raise exception 'Changed fact lost raw data, authority separation or protected execution history'; end if;
end $answer_preserved$;
set local role authenticated; select pg_temp.ob_claim('owner');
-- Group5: immutable exact receipts survive later progress changes; changed key
-- bodies/revisions and stale progress/profile tokens are PT409 without writes.
do $replay$ declare c uuid:=(select id from ob_fixture where key='client'); saved jsonb:=(select data from ob_fixture where key='latest'); before_s jsonb; first_change jsonb; second_change jsonb; before_clock timestamptz; first_clock timestamptz; second_clock timestamptz; r jsonb; denied boolean; begin
 r:=public.save_owner_onboarding(c,extensions.gen_random_uuid(),2,'{"action":"navigate","step":"assistant"}'); before_s:=r->'snapshot';
 r:=public.save_owner_onboarding(c,(select id from ob_fixture where key='answer-key'),1,saved->'answerCommand');
 if (r->'result')-'replayed' is distinct from (saved->'answerResult')-'replayed' or r->'result'->'replayed'<>'true'::jsonb or r->'snapshot' is distinct from before_s or r->'snapshot'->'progress'->>'revision'<>'3' then raise exception 'Historical retry rewrote progress or fabricated a current applied receipt'; end if;
 denied:=false; begin perform public.save_owner_onboarding(c,(select id from ob_fixture where key='answer-key'),1,jsonb_set(saved->'answerCommand','{value}','"Changed request body"')); exception when sqlstate 'PT409' then denied:=true; end; if not denied then raise exception 'Changed request reused receipt'; end if;
 denied:=false; begin perform public.save_owner_onboarding(c,(select id from ob_fixture where key='answer-key'),3,saved->'answerCommand'); exception when sqlstate 'PT409' then denied:=true; end; if not denied then raise exception 'Changed revision reused receipt'; end if;
 denied:=false; begin perform public.save_owner_onboarding(c,extensions.gen_random_uuid(),2,'{"action":"navigate","step":"review"}'); exception when sqlstate 'PT409' then denied:=true; end; if not denied then raise exception 'Stale presentation overwrote progress'; end if;
 denied:=false; begin perform public.save_owner_onboarding(c,extensions.gen_random_uuid(),3,saved->'firstCommand'); exception when sqlstate 'PT409' then denied:=true; end; if not denied then raise exception 'Stale profile clock overwrote shared fact'; end if;
 if public.get_owner_onboarding(c) is distinct from before_s then raise exception 'Rejected request changed snapshot'; end if;
 -- Two real changes in this SAME outer transaction must advance beyond now(),
 -- and a fresh second owner's progress cannot authorize an old shared token.
 select updated_at into before_clock from public.business_workspace_profiles where client_id=c;
 first_change:=public.save_owner_onboarding(c,extensions.gen_random_uuid(),3,jsonb_build_object('action','answer','field','description','value','First change in the same transaction','expectedProfileRevision',before_s->>'profileRevision'));
 select updated_at into first_clock from public.business_workspace_profiles where client_id=c;
 second_change:=public.save_owner_onboarding(c,extensions.gen_random_uuid(),4,jsonb_build_object('action','answer','field','description','value','Second change in the same transaction','expectedProfileRevision',first_change->'snapshot'->>'profileRevision'));
 select updated_at into second_clock from public.business_workspace_profiles where client_id=c;
 if first_clock<=before_clock or second_clock<=first_clock or first_change->'snapshot'->>'profileRevision'=before_s->>'profileRevision' or second_change->'snapshot'->>'profileRevision'=first_change->'snapshot'->>'profileRevision' then raise exception 'Shared profile clock/token did not advance for same-transaction changes'; end if;
 perform pg_temp.ob_claim('other'); denied:=false;
 begin perform public.save_owner_onboarding(c,extensions.gen_random_uuid(),0,jsonb_build_object('action','answer','field','description','value','Stale other owner change','expectedProfileRevision',first_change->'snapshot'->>'profileRevision'));
 exception when sqlstate 'PT409' then denied:=true; end;
 if not denied or public.get_owner_onboarding(c)->'answers' is distinct from second_change->'snapshot'->'answers' or public.get_owner_onboarding(c)->'progress'->>'revision'<>'0' then raise exception 'Cross-owner stale shared token overwrote a fact or progress'; end if;
 perform pg_temp.ob_claim('owner');
end $replay$;
update ob_fixture set data=data||jsonb_build_object('beforeKnowledgeOnly',public.get_owner_onboarding((select id from ob_fixture where key='client'))) where key='latest';
reset role;
update public.client_knowledge_profiles set business_description='Legacy knowledge-only edit at the same transaction clock' where client_id=(select id from ob_fixture where key='client');
set local role authenticated; select pg_temp.ob_claim('owner');
do $knowledge_cas$ declare c uuid:=(select id from ob_fixture where key='client'); before_s jsonb:=(select data->'beforeKnowledgeOnly' from ob_fixture where key='latest'); s jsonb; r jsonb; denied boolean:=false; begin
 s:=public.get_owner_onboarding(c);
 if s->>'profileRevision'=before_s->>'profileRevision' then raise exception 'Combined token missed a same-clock knowledge-only edit'; end if;
 begin perform public.save_owner_onboarding(c,extensions.gen_random_uuid(),(s->'progress'->>'revision')::bigint,jsonb_build_object('action','answer','field','description','value',s->'answers'->'description','expectedProfileRevision',before_s->>'profileRevision')); exception when sqlstate 'PT409' then denied:=true; end;
 if not denied then raise exception 'Knowledge-only edit did not invalidate the old shared token'; end if;
 -- The raw fact already matches this answer; reconciling its stale agent copy
 -- must still change the token, invalidate authority and persist progress.
 r:=public.save_owner_onboarding(c,extensions.gen_random_uuid(),(s->'progress'->>'revision')::bigint,jsonb_build_object('action','answer','field','description','value',s->'answers'->'description','expectedProfileRevision',s->>'profileRevision'));
 if r->'snapshot'->>'profileRevision'=s->>'profileRevision' or r->'snapshot'->'answers' is distinct from s->'answers'
  or not exists(select 1 from public.client_knowledge_profiles k where k.client_id=c and k.business_description=s->'answers'->>'description') then raise exception 'Same raw answer left an old agent description or claimed a true no-op'; end if;
end $knowledge_cas$;
-- Group6: skip is intent only, preserves saved facts; explicit done/back is
-- presentation only and cannot review context, connect apps or grant access.
do $presentation$ declare c uuid:=(select id from ob_fixture where key='client'); s jsonb:=public.get_owner_onboarding((select id from ob_fixture where key='client')); answers_before jsonb; r jsonb; step_value text; begin
 answers_before:=s->'answers';
 foreach step_value in array array['description','connections','assistant','assistant_choice','review','permissions'] loop
  r:=public.save_owner_onboarding(c,extensions.gen_random_uuid(),(s->'progress'->>'revision')::bigint,jsonb_build_object('action','skip','step',step_value)); s:=r->'snapshot';
  if s->'answers' is distinct from answers_before or not (s->'progress'->'skipped') ? step_value then raise exception 'Skip lost existing fact or its intent'; end if;
 end loop;
 if s->'progress'->'finished'<>'true'::jsonb or s->'progress'->>'step'<>'done' then raise exception 'Final presentation step did not finish'; end if;
 r:=public.save_owner_onboarding(c,extensions.gen_random_uuid(),(s->'progress'->>'revision')::bigint,'{"action":"navigate","step":"description"}');
 if r->'snapshot'->'progress'->'finished'<>'false'::jsonb then raise exception 'Revisiting presentation retained finished state'; end if;
end $presentation$;
-- Group7: strict one-field requests, real null removal and legacy unknowns.
do $shape$ declare c uuid:=(select id from ob_fixture where key='client'); s jsonb; candidate jsonb; denied boolean; begin
 s:=public.get_owner_onboarding(c);
 foreach candidate in array array[null::jsonb,'null'::jsonb,'[]'::jsonb,'{}'::jsonb,'{"action":"answer","field":"services","value":"Unsupported","expectedProfileRevision":"unconfigured"}'::jsonb,'{"action":"skip","step":"done"}'::jsonb,'{"action":"navigate","step":"configure_provider"}'::jsonb,'{"action":"navigate","step":"review","actorId":"spoofed"}'::jsonb,
  jsonb_build_object('action','answer','field','description','value','  Not canonical  ','expectedProfileRevision',s->>'profileRevision'),jsonb_build_object('action','answer','field','description','value','','expectedProfileRevision',s->>'profileRevision'),jsonb_build_object('action','answer','field','description','value',jsonb_build_object('not','text'),'expectedProfileRevision',s->>'profileRevision'),jsonb_build_object('action','answer','field','description','value',repeat('a',3001),'expectedProfileRevision',s->>'profileRevision'),jsonb_build_object('action','answer','field','description','value','Valid text','expectedProfileRevision','infinity'),jsonb_build_object('action','answer','field','description','value','Bad'||chr(1)||'control','expectedProfileRevision',s->>'profileRevision')]
 loop denied:=false; begin perform public.save_owner_onboarding(c,extensions.gen_random_uuid(),(s->'progress'->>'revision')::bigint,candidate); exception when invalid_parameter_value then denied:=true; end; if not denied then raise exception 'Invalid onboarding command accepted'; end if; end loop;
 perform public.save_owner_onboarding(c,extensions.gen_random_uuid(),(s->'progress'->>'revision')::bigint,jsonb_build_object('action','answer','field','description','value',null,'expectedProfileRevision',s->>'profileRevision'));
 if public.get_owner_onboarding(c)->'answers' is distinct from '{"description":null}'::jsonb then raise exception 'Explicit unknown removal invented a default'; end if;
end $shape$;
reset role;
do $unknown$ declare c uuid:=(select id from ob_fixture where key='client'); begin
 if (select profile ? 'description' from public.business_workspace_profiles where client_id=c) or (select profile-'description' from public.business_workspace_profiles where client_id=c) is distinct from (select (data->'profile'->'profile')-'description' from ob_fixture where key='latest') then raise exception 'Unknown removal replaced unrelated raw facts'; end if;
 update public.business_workspace_profiles set profile=profile||'{"description":""}',updated_at=clock_timestamp() where client_id=c;
end $unknown$;
set local role authenticated; select pg_temp.ob_claim('owner');
do $legacy_blank$ begin if public.get_owner_onboarding((select id from ob_fixture where key='client'))->'answers' is distinct from '{"description":""}'::jsonb then raise exception 'Legacy blank was materialized as a replacement fact'; end if; end $legacy_blank$;
-- Group8: first raw fact insertion (without a settings/profile row) is atomic,
-- invalidates authority and starts paused/off with only the actual description copy.
do $first_insert$ declare c uuid:=(select id from ob_fixture where key='second'); r jsonb; begin
 r:=public.save_owner_onboarding(c,extensions.gen_random_uuid(),0,jsonb_build_object('action','answer','field','description','value','First explicitly supplied fact','expectedProfileRevision',public.get_owner_onboarding(c)->>'profileRevision'));
 if r->'snapshot'->'answers' is distinct from '{"description":"First explicitly supplied fact"}'::jsonb or r->'result'->>'revision'<>'1' or coalesce(r->'result'->>'profileRevision','')!~'^[a-f0-9]{32}$' then raise exception 'First fact and progress were not saved together'; end if;
end $first_insert$;
reset role;
do $first_insert_effects$ declare c uuid:=(select id from ob_fixture where key='second'); begin
 if not exists(select 1 from public.agent_team_settings where client_id=c and authority_revision=1 and status='paused' and channel_authority='{"website":"off","email":"off","sms":"off","instagram":"off","calendar":"off"}'::jsonb)
  or not exists(select 1 from public.client_knowledge_profiles where client_id=c and business_description='First explicitly supplied fact' and services_offered is null and business_hours is null and booking_rules is null) or exists(select 1 from public.business_context_reviews where client_id=c) then raise exception 'First fact insertion lost the exact agent description or invented unrelated knowledge'; end if;
end $first_insert_effects$;
-- Group9: existing service-authorized full settings edits share exactly the
-- same combined-CAS/receipt transaction and cannot overwrite a later wizard fact.
reset role;
update ob_fixture set data=data||jsonb_build_object('beforeFullProgress',(select to_jsonb(p) from public.owner_onboarding_progress p where p.user_id=(select id from ob_fixture where key='owner') and p.client_id=(select id from ob_fixture where key='client')),'beforeFullKnowledge',(select to_jsonb(k) from public.client_knowledge_profiles k where k.client_id=(select id from ob_fixture where key='client'))) where key='latest';
set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
do $full_save$ declare p uuid:=(select id from ob_fixture where key='partner'); c uuid:=(select id from ob_fixture where key='client'); actor uuid:=(select id from ob_fixture where key='manager'); k uuid:=extensions.gen_random_uuid(); before_s jsonb; current_s jsonb; profile_value jsonb:='{"description":"Full business settings fact","industry":"services","goals":[],"services":"Explicit full services","audience":"Local customers","tone":"Calm","hours":"Explicit full hours","policies":"Explicit full policies","currency":"CAD","website":"https://synthetic.invalid"}'; receipt jsonb; r jsonb; denied boolean; begin
 before_s:=public.get_business_profile_snapshot(p,c);
 receipt:=public.save_business_profile(p,c,actor,k,before_s->>'revision',profile_value);
 current_s:=public.get_business_profile_snapshot(p,c);
 if receipt->>'revision' is distinct from current_s->>'revision' or current_s->>'revision'=before_s->>'revision' or current_s->'profile'->'future_fact' is distinct from before_s->'profile'->'future_fact' or (current_s->'profile')-array['description','industry','goals','services','audience','tone','hours','policies','currency','website'] is distinct from (before_s->'profile')-array['description','industry','goals','services','audience','tone','hours','policies','currency','website'] then raise exception 'Full settings save lost its combined revision or unknown raw fields'; end if;
 r:=public.save_business_profile(p,c,actor,k,before_s->>'revision',profile_value);
 if r-'replayed' is distinct from receipt-'replayed' or r->'replayed'<>'true'::jsonb then raise exception 'Full profile exact retry did not replay the durable receipt'; end if;
 denied:=false; begin perform public.save_business_profile(p,c,actor,k,before_s->>'revision',jsonb_set(profile_value,'{description}','"Changed full body"')); exception when sqlstate 'PT409' then denied:=true; end; if not denied then raise exception 'Full profile key accepted a changed body'; end if;
 denied:=false; begin perform public.save_business_profile(p,c,(select id from ob_fixture where key='owner'),k,before_s->>'revision',profile_value); exception when sqlstate 'PT409' then denied:=true; end; if not denied then raise exception 'Full profile key accepted another actor'; end if;
 denied:=false; begin perform public.save_business_profile(p,c,actor,extensions.gen_random_uuid(),before_s->>'revision',profile_value); exception when sqlstate 'PT409' then denied:=true; end; if not denied then raise exception 'Full profile stale source overwrote facts'; end if;
 r:=public.save_business_profile(p,c,actor,extensions.gen_random_uuid(),current_s->>'revision',profile_value);
 if r->>'revision' is distinct from current_s->>'revision' or r->>'cancelledWork'<>'0' then raise exception 'True full-profile no-op changed source revision or cancelled more work'; end if;
 update ob_fixture set data=data||jsonb_build_object('fullProfile',profile_value,'beforeFullToken',before_s->>'revision','fullResult',receipt,'fullToken',current_s->>'revision') where key='latest';
end $full_save$;
reset role;
do $full_preserved$ declare c uuid:=(select id from ob_fixture where key='client'); saved jsonb:=(select data from ob_fixture where key='latest'); begin
 if saved->'beforeFullProgress' is distinct from (select to_jsonb(p) from public.owner_onboarding_progress p where p.user_id=(select id from ob_fixture where key='owner') and p.client_id=c)
  or (saved->'beforeFullKnowledge')-array['business_description','services_offered','business_hours','booking_rules','updated_at'] is distinct from (select to_jsonb(k)-array['business_description','services_offered','business_hours','booking_rules','updated_at'] from public.client_knowledge_profiles k where k.client_id=c)
  or not exists(select 1 from public.client_knowledge_profiles where client_id=c and business_description='Full business settings fact' and services_offered='Explicit full services' and business_hours='Explicit full hours' and booking_rules='Explicit full policies') then raise exception 'Full settings changed private progress or unrelated agent knowledge'; end if;
end $full_preserved$;
set local role authenticated; select pg_temp.ob_claim('owner');
do $partial_after_full$ declare c uuid:=(select id from ob_fixture where key='client'); saved jsonb:=(select data from ob_fixture where key='latest'); s jsonb; r jsonb; denied boolean:=false; begin
 s:=public.get_owner_onboarding(c);
 begin perform public.save_owner_onboarding(c,extensions.gen_random_uuid(),(s->'progress'->>'revision')::bigint,jsonb_build_object('action','answer','field','description','value','Stale partial fact','expectedProfileRevision',saved->>'beforeFullToken')); exception when sqlstate 'PT409' then denied:=true; end; if not denied then raise exception 'Partial save ignored a completed full-profile revision'; end if;
 r:=public.save_owner_onboarding(c,extensions.gen_random_uuid(),(s->'progress'->>'revision')::bigint,jsonb_build_object('action','answer','field','description','value','Fresh wizard fact after full settings','expectedProfileRevision',s->>'profileRevision'));
 if r->'snapshot'->'answers' is distinct from '{"description":"Fresh wizard fact after full settings"}'::jsonb then raise exception 'Partial save after full settings did not commit'; end if;
end $partial_after_full$;
reset role; set local role service_role;
do $full_after_partial$ declare p uuid:=(select id from ob_fixture where key='partner'); c uuid:=(select id from ob_fixture where key='client'); saved jsonb:=(select data from ob_fixture where key='latest'); denied boolean:=false; begin
 begin perform public.save_business_profile(p,c,(select id from ob_fixture where key='manager'),extensions.gen_random_uuid(),saved->>'fullToken',saved->'fullProfile'); exception when sqlstate 'PT409' then denied:=true; end;
 if not denied or not exists(select 1 from public.client_knowledge_profiles where client_id=c and business_description='Fresh wizard fact after full settings' and services_offered='Explicit full services') then raise exception 'Stale full save overwrote the wizard or its agent description'; end if;
end $full_after_partial$;
reset role;

-- Group10: private per-actor progress, shared fact visibility, wrong tenant,
-- manager/staff/viewer and revoked/ended-session retries all fail closed.
set local role authenticated; select pg_temp.ob_claim('other');
do $other$ declare c uuid:=(select id from ob_fixture where key='client'); s jsonb; denied boolean:=false; begin
 s:=public.get_owner_onboarding(c); if s->'progress'->>'revision'<>'0' or s->'answers' is distinct from '{"description":"Fresh wizard fact after full settings"}'::jsonb then raise exception 'Another owner inherited private progress or a fabricated fact'; end if;
 begin perform public.save_owner_onboarding(c,(select id from ob_fixture where key='answer-key'),1,(select data->'answerCommand' from ob_fixture where key='latest')); exception when sqlstate 'PT409' then denied:=true; end; if not denied then raise exception 'Another actor replayed an owner receipt'; end if;
end $other$;
reset role; set local role authenticated;
do $denied_roles$ declare who text; denied boolean; begin
 foreach who in array array['manager','staff','viewer','foreign-owner'] loop
  perform pg_temp.ob_claim(who); denied:=false; begin perform public.get_owner_onboarding((select id from ob_fixture where key='client')); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'Non-owner read onboarding'; end if;
  denied:=false; begin perform public.save_owner_onboarding((select id from ob_fixture where key='client'),extensions.gen_random_uuid(),0,'{"action":"navigate","step":"done"}'); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'Non-owner saved onboarding'; end if;
 end loop;
end $denied_roles$;
reset role;
update public.memberships set status='disabled' where user_id=(select id from ob_fixture where key='owner') and client_id=(select id from ob_fixture where key='client');
set local role authenticated; select pg_temp.ob_claim('owner');
do $revoked$ declare denied boolean:=false; begin
 begin perform public.save_owner_onboarding((select id from ob_fixture where key='client'),(select id from ob_fixture where key='answer-key'),1,(select data->'answerCommand' from ob_fixture where key='latest')); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'Revoked owner replayed saved receipt'; end if;
end $revoked$;
reset role;
update public.memberships set status='active' where user_id=(select id from ob_fixture where key='owner') and client_id=(select id from ob_fixture where key='client');
delete from auth.sessions where id=(select id from ob_fixture where key='session-owner');
set local role authenticated; select pg_temp.ob_claim('owner');
do $ended$ declare denied boolean:=false; begin
 begin perform public.get_owner_onboarding((select id from ob_fixture where key='client')); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'Ended session read onboarding'; end if;
end $ended$;
reset role;
-- Group11: presentation finishing never reviews/activates/connects or creates
-- additional work. Only labelled policy fixture jobs exist, with safe rows stopped.
do $no_authority$ begin
 if exists(select 1 from public.integration_connections) or exists(select 1 from public.business_agent_activation) or exists(select 1 from public.approval_items)
  or exists(select 1 from public.business_context_reviews) or exists(select 1 from public.ai_call_usage) or exists(select 1 from public.usage_events) or exists(select 1 from public.voice_usage_events)
  or exists(select 1 from public.agent_team_settings where status<>'paused' or channel_authority<>'{"website":"off","email":"off","sms":"off","instagram":"off","calendar":"off"}'::jsonb)
  or (select count(*) from public.action_jobs)<>10 or (select count(*) from public.agent_work_items)<>2
  or exists(select 1 from public.client_businesses where default_runtime_mode<>'sandbox') then raise exception 'Presentation progress created permission, live state or execution effects'; end if;
end $no_authority$;
rollback;
select '__CUSTOMER_JOURNEY_REPORT__'::text || jsonb_build_object('kind','owner_onboarding_acceptance','rolledBack',true,'remainingFixtures',(select count(*) from public.partners where slug like 'cj-acceptance-__RUN_ID__-onboarding-%'),'checks',jsonb_build_array('actual_progress_table_rls_and_seven_function_metadata','raw_description_only_and_neutral_read_defaults','true_no_op_preserves_review_authority_and_knowledge','atomic_raw_patch_progress_review_invalidation_safe_cancellation','historical_replay_and_combined_profile_knowledge_progress_cas','skipped_intent_and_presentation_finish_revisit_only','strict_description_shape_null_removal_and_legacy_unknowns','first_fact_insert_syncs_only_agent_description_without_activation','legacy_atomic_full_settings_and_partial_cas_interoperation','private_actor_tenant_owner_role_revocation_session_boundaries','no_provider_model_permission_or_new_execution_effects'),
 'catalog',jsonb_build_object('table',jsonb_build_object('name','owner_onboarding_progress','owner',(select pg_get_userbyid(relowner) from pg_class where oid='public.owner_onboarding_progress'::regclass),'rls',(select relrowsecurity from pg_class where oid='public.owner_onboarding_progress'::regclass),'policies',(select count(*) from pg_policy where polrelid='public.owner_onboarding_progress'::regclass),'anonRead',has_table_privilege('anon','public.owner_onboarding_progress','SELECT'),'authenticatedRead',has_table_privilege('authenticated','public.owner_onboarding_progress','SELECT'),'authenticatedWrite',has_table_privilege('authenticated','public.owner_onboarding_progress','INSERT,UPDATE,DELETE'),'serviceReadWrite',(select bool_and(has_table_privilege('service_role','public.owner_onboarding_progress',permission.privilege_name)) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) as permission(privilege_name))),
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'configuration',p.proconfig,'publicExecute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'),'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE')) order by p.oid::regprocedure::text) from pg_proc p where p.oid=any(array['public.get_owner_onboarding(uuid)'::regprocedure,'public.save_owner_onboarding(uuid,uuid,bigint,jsonb)'::regprocedure,'owner_onboarding.onboarding_snapshot(uuid)'::regprocedure,'owner_onboarding.save_onboarding(uuid,uuid,bigint,jsonb)'::regprocedure,'public.get_business_profile_snapshot(uuid,uuid)'::regprocedure,'public.save_business_profile(uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure,'owner_onboarding.lock_profile_actor(uuid)'::regprocedure]))))::text as cj_report;
