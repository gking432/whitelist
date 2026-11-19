-- Isolated PostgreSQL acceptance only. Identities/JWT claims below are synthetic;
-- separate real browser tests prove normal Auth/API HTTP behaviour. No provider,
-- model, invoice-marker shortcut, runtime worker or trigger bypass is used.
begin;
set local statement_timeout='45s'; set local lock_timeout='5s';
-- __ISOLATION_ASSERTION__
select pg_advisory_xact_lock(1937402189);
create temporary table of_fixture(key text primary key,id uuid not null default extensions.gen_random_uuid(),data jsonb);
insert into of_fixture(key) values('partner'),('foreign-partner'),('client'),('foreign-client'),('owner'),('foreign-owner'),('session-owner'),('session-foreign-owner'),('connection'),('contact'),('conversation'),('ordinary'),('stale'),('reject'),('legacy'),('command');
grant select,insert,update on of_fixture to authenticated,service_role,anon;
insert into auth.users(id,email,email_confirmed_at) select id,'cj-acceptance-__RUN_ID__-foundation-'||key||'@synthetic.invalid',now() from of_fixture where key in('owner','foreign-owner');
insert into public.profiles(id,email) select id,'cj-acceptance-__RUN_ID__-foundation-'||key||'@synthetic.invalid' from of_fixture where key in('owner','foreign-owner') on conflict(id) do nothing;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select s.id,u.id,now(),now(),now()+interval '1 hour' from of_fixture s join of_fixture u on u.key=substring(s.key from 9) where s.key like 'session-%';
insert into public.partners(id,name,slug,status) select id,'Synthetic foundation acceptance '||key,'cj-acceptance-__RUN_ID__-foundation-'||key,'active' from of_fixture where key in('partner','foreign-partner');
insert into public.client_businesses(id,partner_id,name,slug,status,client_portal_enabled,default_runtime_mode)
 select id,(select id from of_fixture where key=case when f.key='client' then 'partner' else 'foreign-partner' end),'Synthetic foundation business '||key,'cj-acceptance-__RUN_ID__-foundation-'||key,'active',true,'sandbox' from of_fixture f where key in('client','foreign-client');
insert into public.memberships(user_id,partner_id,client_id,role,status) select id,(select id from of_fixture where key=case when f.key='owner' then 'partner' else 'foreign-partner' end),(select id from of_fixture where key=case when f.key='owner' then 'client' else 'foreign-client' end),'client_owner','active' from of_fixture f where key in('owner','foreign-owner');
create function pg_temp.of_claim(p_key text) returns void language plpgsql security invoker set search_path='' as $$ begin
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',(select id::text from pg_temp.of_fixture where key=p_key),true);
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',(select id from pg_temp.of_fixture where key=p_key),'session_id',(select id from pg_temp.of_fixture where key='session-'||p_key))::text,true);
end $$;
grant execute on function pg_temp.of_claim(text) to authenticated;
-- Group1: actual metadata, original invoker/definer distinction and no new
-- browser function/table privilege. Actual catalog rows are reported below.
do $catalog$ declare p pg_catalog.pg_proc; name text; signatures text[]:=array[
 'public.apply_business_context_command(uuid,uuid,uuid,jsonb)',
 'public.stamp_approval_authority()', 'public.guard_approval_resolution()',
 'public.guard_invoice_followup_approval()', 'public.enqueue_approved_action()',
 'owner_onboarding.guard_approval_authority_decision()']; begin
 foreach name in array signatures loop
  select * into strict p from pg_catalog.pg_proc where oid=name::regprocedure;
  if p.prosecdef is distinct from (name in('public.enqueue_approved_action()','owner_onboarding.guard_approval_authority_decision()'))
   or p.proconfig is distinct from array['search_path=""']::text[]
   or pg_get_userbyid(p.proowner) in('anon','authenticated','service_role')
   or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')
   or not has_function_privilege('service_role',p.oid,'EXECUTE') then raise exception 'Foundation function boundary differs: %',name; end if;
  if p.prosrc ~* 'errcode\s*=\s*''40001''' or p.prosrc ~* 'when\s+(serialization_failure|deadlock_detected)' then raise exception 'Foundation public semantic/transient boundary differs: %',name; end if;
 end loop;
 if not exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid='public.approval_items'::regclass and t.tgfoid='owner_onboarding.guard_approval_authority_decision()'::regprocedure and t.tgenabled='O' and not t.tgisinternal)
  or not (select relrowsecurity from pg_catalog.pg_class where oid='public.approval_items'::regclass)
  or has_table_privilege('authenticated','public.agent_team_settings','UPDATE')
  or has_table_privilege('authenticated','public.agent_team_settings','INSERT') then raise exception 'Approval trigger/RLS/settings privilege boundary differs'; end if;
end $catalog$;
-- Legitimate legacy pending approval created before any settings existed. No
-- trigger disabling or impossible post-stamp payload mutation is used.
insert into public.approval_items(id,partner_id,client_id,type,title,editable_content,proposed_payload)
 values((select id from of_fixture where key='legacy'),(select id from of_fixture where key='foreign-partner'),(select id from of_fixture where key='foreign-client'),'customer_message','Synthetic legacy website review','A legacy review requires a fresh authority pin.','{"channel":"website_chat"}');
insert into public.agent_team_settings(partner_id,client_id,status,conversations_enabled,channel_authority)
 values((select id from of_fixture where key='partner'),(select id from of_fixture where key='client'),'active',true,'{"website":"off"}');
insert into public.business_workspace_profiles(partner_id,client_id,profile)
 values((select id from of_fixture where key='partner'),(select id from of_fixture where key='client'),' {"description":"Synthetic foundation service business","services":"An explicitly reviewed synthetic consultation"}');
set local role service_role; select set_config('request.jwt.claim.role','service_role',true);
-- Group2: ordinary reviewed context, durable exact-key replay and semantic
-- changed-command/stale-context/stale-authority codes (no text guessing).
do $context$ declare p uuid:=(select id from of_fixture where key='partner'); c uuid:=(select id from of_fixture where key='client'); actor uuid:=(select id from of_fixture where key='owner'); at timestamptz; revision integer; command jsonb; receipt jsonb; denied boolean; begin
 select updated_at into at from public.business_workspace_profiles where client_id=c and partner_id=p;
 command:=jsonb_build_object('action','review_context','key',(select id from of_fixture where key='command'),'expectedContextRevision',at);
 receipt:=public.apply_business_context_command(p,c,actor,command);
 if public.apply_business_context_command(p,c,actor,command)->>'id' is distinct from receipt->>'id' then raise exception 'Exact context command did not replay its durable receipt'; end if;
 denied:=false; begin perform public.apply_business_context_command(p,c,actor,command||jsonb_build_object('expectedContextRevision',at-interval '1 day')); exception when sqlstate 'PT409' then denied:=true; end;
 if not denied then raise exception 'Changed-body request key was accepted'; end if;
 denied:=false; begin perform public.apply_business_context_command(p,c,actor,command||jsonb_build_object('key',extensions.gen_random_uuid(),'expectedContextRevision',at-interval '1 day')); exception when sqlstate 'PT409' then denied:=true; end;
 if not denied then raise exception 'Stale reviewed profile revision was accepted'; end if;
 select authority_revision into revision from public.agent_team_settings where client_id=c and partner_id=p;
 perform public.apply_business_context_command(p,c,actor,jsonb_build_object('action','set_authority','key',extensions.gen_random_uuid(),'expectedRevision',revision,'channel','website','mode','require_approval'));
 denied:=false; begin perform public.apply_business_context_command(p,c,actor,jsonb_build_object('action','manager_control','key',extensions.gen_random_uuid(),'expectedRevision',revision,'operation','pause')); exception when sqlstate 'PT409' then denied:=true; end;
 if not denied then raise exception 'Stale authority decision was accepted'; end if;
 if not public.business_channel_can_draft(p,c,'website_chat',null) then raise exception 'Real reviewed website draft policy denied the ordinary fixture'; end if;
end $context$;
reset role;
-- Native website source has no external credential or live provider effect.
insert into public.integration_connections(id,partner_id,client_id,provider_id,display_name,status,runtime_mode,credential_status,config)
 select (select id from of_fixture where key='connection'),(select id from of_fixture where key='partner'),(select id from of_fixture where key='client'),id,'Synthetic foundation native website','connected','dry_run','configured','{"activation_managed":false}' from public.integration_providers where provider_key='northstar_web_chat' and is_active;
insert into public.crm_contacts(id,partner_id,client_id,first_name,source)
 values((select id from of_fixture where key='contact'),(select id from of_fixture where key='partner'),(select id from of_fixture where key='client'),'Synthetic website visitor','cj_acceptance');
insert into public.business_conversations(id,partner_id,client_id,connection_id,channel,external_thread_id,contact_id,identity_status,mode,state)
 values((select id from of_fixture where key='conversation'),(select id from of_fixture where key='partner'),(select id from of_fixture where key='client'),(select id from of_fixture where key='connection'),'website_chat','cj-acceptance-__RUN_ID__-foundation',(select id from of_fixture where key='contact'),'unverified','agent','open');
insert into public.business_conversation_messages(partner_id,client_id,conversation_id,external_key,direction,body,status)
 values((select id from of_fixture where key='partner'),(select id from of_fixture where key='client'),(select id from of_fixture where key='conversation'),'cj-acceptance-__RUN_ID__-foundation-inbound','inbound','Please explain your reviewed consultation service.','received');
set local role service_role;
-- Group3: genuine native customer source/policy and ordinary stamped payload.
do $source$ declare safety jsonb; begin
 safety:=public.conversation_action_check((select id from of_fixture where key='conversation'),1,false);
 if safety->'allowed' is distinct from 'true'::jsonb or exists(select 1 from public.agent_work_items where client_id=(select id from of_fixture where key='client')) then raise exception 'Website source is unsafe or synthetic evidence unexpectedly scheduled work'; end if;
end $source$;
insert into public.approval_items(id,partner_id,client_id,type,title,editable_content,proposed_payload,expires_at)
 select f.id,(select id from of_fixture where key='partner'),(select id from of_fixture where key='client'),'customer_message','Synthetic foundation website '||f.key,'Our team can explain the reviewed consultation service.',
 jsonb_build_object('channel','website_chat','conversation_id',(select id from of_fixture where key='conversation'),'conversation_revision',1,'connection_id',(select id from of_fixture where key='connection'),'to','cj-acceptance-__RUN_ID__-foundation','human_authored',false,'authority_revision',s.authority_revision),now()+interval '1 hour'
 from of_fixture f cross join public.agent_team_settings s where f.key in('ordinary','stale','reject') and s.client_id=(select id from of_fixture where key='client');
reset role;
set local role authenticated; select pg_temp.of_claim('owner');
-- Group4: actual authenticated RLS pending→approved, exactly one outbox job.
do $ordinary$ declare changed integer; begin
 update public.approval_items set status='approved',resolved_by=auth.uid() where id=(select id from of_fixture where key='ordinary') and status='pending';
 get diagnostics changed=row_count; if changed<>1 then raise exception 'Owner approval did not resolve one own pending review'; end if;
 if (select count(*) from public.action_jobs where approval_id=(select id from of_fixture where key='ordinary') and kind='conversation.send' and status='pending')<>1 then raise exception 'Ordinary owner decision did not create exactly one pending outbox job'; end if;
end $ordinary$;
-- Group5: deliberate immutable-history conflict, no duplicate outbox.
do $history$ declare denied boolean:=false; begin
 begin update public.approval_items set status='rejected',resolved_by=auth.uid() where id=(select id from of_fixture where key='ordinary'); exception when sqlstate 'PT409' then denied:=true; end;
 if not denied then raise exception 'Resolved approval history was mutable'; end if;
end $history$;
-- Group6: actor identity and foreign-scope RLS remain restrictive.
do $identity$ declare denied boolean:=false; changed integer; begin
 begin update public.approval_items set status='approved',resolved_by=(select id from of_fixture where key='foreign-owner') where id=(select id from of_fixture where key='stale') and status='pending'; exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Authenticated actor spoof was accepted'; end if;
 update public.approval_items set status='rejected',resolved_by=auth.uid() where id=(select id from of_fixture where key='legacy'); get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Owner mutated foreign approval'; end if;
 denied:=false; begin perform public.apply_business_context_command((select id from of_fixture where key='partner'),(select id from of_fixture where key='client'),auth.uid(),'{}'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Browser directly executed the service-only context mutation'; end if;
end $identity$;
reset role; set local role service_role;
-- Manager stop executes the real cancellation path, not a payload corruption.
do $stop$ declare revision integer; begin
 select authority_revision into revision from public.agent_team_settings where client_id=(select id from of_fixture where key='client');
 perform public.apply_business_context_command((select id from of_fixture where key='partner'),(select id from of_fixture where key='client'),(select id from of_fixture where key='owner'),jsonb_build_object('action','manager_control','operation','stop','key',extensions.gen_random_uuid(),'expectedRevision',revision,'channel','website'));
end $stop$;
reset role; set local role authenticated; select pg_temp.of_claim('owner');
-- Group7: actual stale website proposal blocks approval without a job, while
-- rejection still records the owner's decision under the same changed policy.
do $stale$ declare denied boolean:=false; begin
 begin update public.approval_items set status='approved',resolved_by=auth.uid() where id=(select id from of_fixture where key='stale') and status='pending'; exception when sqlstate 'PT409' then denied:=true; end;
 if not denied or not exists(select 1 from public.approval_items where id=(select id from of_fixture where key='stale') and status='pending') or exists(select 1 from public.action_jobs where approval_id=(select id from of_fixture where key='stale')) then raise exception 'Stale authority decision advanced or created an effect'; end if;
 update public.approval_items set status='rejected',resolved_by=auth.uid() where id=(select id from of_fixture where key='reject') and status='pending';
 if not exists(select 1 from public.approval_items where id=(select id from of_fixture where key='reject') and status='rejected') then raise exception 'Policy change prevented a legitimate rejection'; end if;
end $stale$;
-- Group8: missing legacy settings/pin fails closed for approval; reject works.
select pg_temp.of_claim('foreign-owner');
do $legacy$ declare denied boolean:=false; begin
 begin update public.approval_items set status='approved',resolved_by=auth.uid() where id=(select id from of_fixture where key='legacy') and status='pending'; exception when sqlstate 'PT409' then denied:=true; end;
 if not denied then raise exception 'Missing authority evidence authorized a legacy effect'; end if;
 update public.approval_items set status='rejected',resolved_by=auth.uid() where id=(select id from of_fixture where key='legacy') and status='pending';
end $legacy$;
reset role;
-- Group9: stopped pending outbox, unchanged guards and no delivery/provider work.
do $effects$ begin
 if (select count(*) from public.action_jobs where client_id=(select id from of_fixture where key='client'))<>1
  or not exists(select 1 from public.action_jobs where approval_id=(select id from of_fixture where key='ordinary') and status='cancelled')
  or exists(select 1 from public.business_conversation_messages where client_id=(select id from of_fixture where key='client') and direction='outbound')
  or exists(select 1 from public.agent_work_items where client_id=(select id from of_fixture where key='client'))
  or exists(select 1 from public.integration_secrets where connection_id=(select id from of_fixture where key='connection')) then raise exception 'Foundation decisions created an unintended external/worker effect'; end if;
end $effects$;
rollback;
select '__CUSTOMER_JOURNEY_REPORT__'::text || jsonb_build_object('kind','owner_foundation_conflict_acceptance','rolledBack',true,'remainingFixtures',(select count(*) from public.partners where slug like 'cj-acceptance-__RUN_ID__-foundation-%'),'checks',jsonb_build_array('actual_catalog_and_private_lookup_acl','context_replay_changed_body_stale_revisions','native_website_source_without_provider_grant','authenticated_pending_decision_one_outbox','immutable_history_semantic_conflict','actor_scope_and_service_rpc_boundaries','stale_website_approval_conflict_rejection_allowed','missing_legacy_authority_fails_closed','manager_stop_no_external_or_worker_effect'))::text as cj_report;
-- Actual catalog evidence, not an assumption about migration-runner ownership.
select '__CUSTOMER_JOURNEY_REPORT__'::text || jsonb_build_object('kind','owner_foundation_catalog','functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'configuration',p.proconfig,'publicExecute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE'),'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE')) order by p.oid::regprocedure::text) from pg_proc p where p.oid=any(array['public.apply_business_context_command(uuid,uuid,uuid,jsonb)'::regprocedure,'public.stamp_approval_authority()'::regprocedure,'public.guard_approval_resolution()'::regprocedure,'public.guard_invoice_followup_approval()'::regprocedure,'public.enqueue_approved_action()'::regprocedure,'owner_onboarding.guard_approval_authority_decision()'::regprocedure])),'trigger',(select jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'function',t.tgfoid::regprocedure::text) from pg_trigger t where t.tgrelid='public.approval_items'::regclass and t.tgname='guard_approval_authority_decision'))::text as cj_report;
