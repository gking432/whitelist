-- Real disposable Postgres policy tests. Synthetic token envelopes are NOT
-- live HubSpot consent, granted-scope inspection, CRM writes or provider proof.
begin;
set local statement_timeout='45s';
set local lock_timeout='5s';
-- __ISOLATION_ASSERTION__
select pg_advisory_xact_lock(1937402189);
do $blank$ begin
 if current_database() !~ '_(test|acceptance)$' or exists(select 1 from public.partners) or exists(select 1 from public.client_businesses) then raise exception 'HubSpot acceptance requires a blank disposable database'; end if;
end $blank$;
create temporary table hf_fixture(key text primary key,id uuid not null default extensions.gen_random_uuid(),data jsonb);
insert into hf_fixture(key) values('partner-a'),('partner-b'),('package-a'),('package-b'),('client-a'),('client-b'),('owner-a'),('owner-b'),('hubspot-a'),('contact-source'),('unknown-job');
grant select,insert,update on hf_fixture to service_role,authenticated,anon;
insert into auth.users(id,email) select id,'cj-acceptance-__RUN_ID__-hubspot-'||key||'@synthetic.invalid' from hf_fixture where key in('owner-a','owner-b');
insert into public.profiles(id,email) select id,'cj-acceptance-__RUN_ID__-hubspot-'||key||'@synthetic.invalid' from hf_fixture where key in('owner-a','owner-b') on conflict(id) do nothing;
insert into public.partners(id,name,slug) select id,'Synthetic HubSpot acceptance '||key,'cj-acceptance-__RUN_ID__-hubspot-'||key from hf_fixture where key in('partner-a','partner-b');
insert into public.partner_packages(id,partner_id,name) select id,(select id from hf_fixture where key=case when f.key='package-a' then 'partner-a' else 'partner-b' end),'Synthetic HubSpot policy acceptance' from hf_fixture f where key in('package-a','package-b');
insert into public.client_businesses(id,partner_id,package_id,name,slug,status,client_portal_enabled,crm_operating_mode,default_runtime_mode)
 select id,(select id from hf_fixture where key=case when f.key='client-a' then 'partner-a' else 'partner-b' end),(select id from hf_fixture where key=case when f.key='client-a' then 'package-a' else 'package-b' end),'Synthetic HubSpot acceptance '||key,'cj-acceptance-__RUN_ID__-hubspot-'||key,'active',true,'primary_crm','sandbox' from hf_fixture f where key in('client-a','client-b');
insert into public.memberships(user_id,partner_id,client_id,role) select id,(select id from hf_fixture where key=case when f.key='owner-a' then 'partner-a' else 'partner-b' end),(select id from hf_fixture where key=case when f.key='owner-a' then 'client-a' else 'client-b' end),'client_owner' from hf_fixture f where key in('owner-a','owner-b');
-- Real owner/package acceptance precedes the live-mode test fixture.
insert into public.client_beta_acceptances(client_id,partner_id,package_id,accepted_by,provider_test_notes,fallback_contact)
 select id,(select id from hf_fixture where key=case when f.key='client-a' then 'partner-a' else 'partner-b' end),(select id from hf_fixture where key=case when f.key='client-a' then 'package-a' else 'package-b' end),(select id from hf_fixture where key=case when f.key='client-a' then 'owner-a' else 'owner-b' end),'Synthetic database policy acceptance only; no live HubSpot authorization, external CRM change, provider accuracy or customer outreach is established.','synthetic-owner@invalid' from hf_fixture f where key in('client-a','client-b');
update public.client_businesses set default_runtime_mode='live' where id in(select id from hf_fixture where key in('client-a','client-b'));
insert into public.agent_team_settings(partner_id,client_id,status,scheduling_enabled,conversations_enabled,channel_authority)
 values((select id from hf_fixture where key='partner-a'),(select id from hf_fixture where key='client-a'),'paused',false,false,'{"calendar":"off","email":"off","sms":"off","website":"off","instagram":"off"}');

create function pg_temp.hf_begin(p_label text,p_connection uuid default null,p_rights text[] default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare attempt jsonb;
begin
 attempt:=public.begin_hubspot_oauth((select id from pg_temp.hf_fixture where key='partner-a'),(select id from pg_temp.hf_fixture where key='client-a'),(select id from pg_temp.hf_fixture where key='owner-a'),p_connection,repeat('a',64),'synthetic-encrypted-server-state-not-provider-proof',p_rights,now()+interval '15 minutes');
 insert into pg_temp.hf_fixture(key,id,data) values('attempt-'||p_label,(attempt->>'attemptId')::uuid,attempt);
 return attempt;
end $$;
create function pg_temp.hf_consume(p_attempt uuid) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 update public.business_connection_oauth_attempts set consumed_at=now() where id=p_attempt and partner_id=(select id from pg_temp.hf_fixture where key='partner-a') and client_id=(select id from pg_temp.hf_fixture where key='client-a') and actor_id=(select id from pg_temp.hf_fixture where key='owner-a') and provider_key='hubspot' and purpose='hubspot_oauth' and cookie_hash=repeat('a',64) and consumed_at is null and expires_at>now();
 return found;
end $$;
create function pg_temp.hf_finish(p_attempt uuid,p_account text default '810001',p_rights text[] default '{}',p_scopes text[] default array['oauth','crm.objects.contacts.read','crm.objects.deals.read']) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.finish_hubspot_oauth(p_attempt,'synthetic-encrypted-token-envelope-not-provider-proof','test',p_account,'Synthetic HubSpot account',p_scopes,p_rights,now()+interval '30 minutes',extensions.gen_random_uuid());
end $$;
grant execute on function pg_temp.hf_begin(text,uuid,text[]),pg_temp.hf_consume(uuid),pg_temp.hf_finish(uuid,text,text[],text[]) to service_role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);

-- Group 1: owner-scoped fresh account, actual consumed callback and no activation.
do $fresh$ declare a jsonb; conn uuid; rev uuid; p uuid:=(select id from hf_fixture where key='partner-a'); c uuid:=(select id from hf_fixture where key='client-a'); begin
 a:=pg_temp.hf_begin('fresh'); conn:=(a->>'connectionId')::uuid;
 update hf_fixture set id=conn where key='hubspot-a';
 if not pg_temp.hf_consume((a->>'attemptId')::uuid) or pg_temp.hf_consume((a->>'attemptId')::uuid) then raise exception 'A HubSpot callback must have exactly one consumer'; end if;
 perform pg_temp.hf_finish((a->>'attemptId')::uuid);
 select (config->>'hubspot_grant_revision')::uuid into rev from public.integration_connections where id=conn;
 if not exists(select 1 from public.integration_connections where id=conn and partner_id=p and client_id=c and external_account_id='810001' and status='connected' and credential_status='configured' and runtime_mode='dry_run' and config->'workspace_view_only'='true'::jsonb and config->'hubspot_actions_enabled'='false'::jsonb and config->>'hubspot_secret_revision'=rev::text)
  or not exists(select 1 from public.agent_team_settings where partner_id=p and client_id=c and status='paused' and channel_authority->>'email'='off')
  or exists(select 1 from public.action_jobs where partner_id=p and client_id=c) or exists(select 1 from public.business_connection_oauth_attempts where id=(a->>'attemptId')::uuid) then raise exception 'OAuth did not preserve exact account/read-only/paused authority or retire its consumed attempt'; end if;
end $fresh$;

-- Group 2: denial, missing grants, wrong portal and stale CAS keep saved access.
do $reconnect$ declare a jsonb; conn uuid:=(select id from hf_fixture where key='hubspot-a'); before_c jsonb; before_s jsonb; denied boolean; label text; aid uuid;
begin
 select to_jsonb(c) into before_c from public.integration_connections c where id=conn;
 select to_jsonb(s) into before_s from public.integration_secrets s where connection_id=conn;
 foreach label in array array['unconsumed','wrong-portal','missing-grants','stale-connection','stale-secret','wrong-purpose'] loop
  a:=pg_temp.hf_begin(label,conn); aid:=(a->>'attemptId')::uuid;
  if label<>'unconsumed' then perform pg_temp.hf_consume(aid); end if;
  if label='stale-connection' then update public.business_connection_oauth_attempts set expected_connection_updated_at=expected_connection_updated_at-interval '1 second' where id=aid;
  elsif label='stale-secret' then update public.business_connection_oauth_attempts set expected_secret_updated_at=expected_secret_updated_at-interval '1 second' where id=aid;
  elsif label='wrong-purpose' then update public.business_connection_oauth_attempts set purpose='read_only' where id=aid; end if;
  denied:=false;
  begin perform pg_temp.hf_finish(aid,case when label='wrong-portal' then '820001' else '810001' end,'{}',case when label='missing-grants' then array['oauth'] else array['oauth','crm.objects.contacts.read','crm.objects.deals.read'] end);
  exception when sqlstate '40001' then denied:=true; end;
  if not denied or before_c is distinct from (select to_jsonb(c) from public.integration_connections c where id=conn) or before_s is distinct from (select to_jsonb(s) from public.integration_secrets s where connection_id=conn) then raise exception 'Rejected HubSpot % reconnect changed saved access',label; end if;
  delete from public.business_connection_oauth_attempts where id=aid;
 end loop;
 -- A denied callback consumes/retires only its attempt, without touching secrets.
 a:=pg_temp.hf_begin('denied',conn); perform pg_temp.hf_consume((a->>'attemptId')::uuid); delete from public.business_connection_oauth_attempts where id=(a->>'attemptId')::uuid;
 if before_s is distinct from (select to_jsonb(s) from public.integration_secrets s where connection_id=conn) then raise exception 'Denied callback discarded an old HubSpot secret'; end if;
end $reconnect$;

-- Group 3: separate attempts cannot duplicate one portal; a deliberate write
-- grant still cannot select the customer system or activate outgoing changes.
do $selection$ declare a jsonb; conn uuid:=(select id from hf_fixture where key='hubspot-a'); duplicate_conn uuid; denied boolean:=false; rev text; p uuid:=(select id from hf_fixture where key='partner-a'); c uuid:=(select id from hf_fixture where key='client-a'); begin
 a:=pg_temp.hf_begin('duplicate'); duplicate_conn:=(a->>'connectionId')::uuid; perform pg_temp.hf_consume((a->>'attemptId')::uuid);
 begin perform pg_temp.hf_finish((a->>'attemptId')::uuid); exception when raise_exception then if sqlerrm not like '%already connected%' then raise; end if; denied:=true; end;
 if not denied or exists(select 1 from public.integration_secrets where connection_id=duplicate_conn) then raise exception 'Two HubSpot connections bound the same portal'; end if;
 delete from public.business_connection_oauth_attempts where connection_id=duplicate_conn; delete from public.integration_connections where id=duplicate_conn;
 a:=pg_temp.hf_begin('actions',conn,array['contact.create','note.create']); perform pg_temp.hf_consume((a->>'attemptId')::uuid);
 perform pg_temp.hf_finish((a->>'attemptId')::uuid,'810001',array['contact.create','note.create'],array['oauth','crm.objects.contacts.read','crm.objects.deals.read','crm.objects.contacts.write']);
 if not exists(select 1 from public.integration_connections where id=conn and config->'hubspot_actions_enabled'='false'::jsonb and runtime_mode='dry_run') or (select customer_system_connection_id from public.client_businesses where id=c) is not null then raise exception 'Provider write consent silently selected or activated the customer system'; end if;
 select config->>'hubspot_config_revision' into rev from public.integration_connections where id=conn;
 perform public.configure_hubspot(p,c,conn,rev,true,false);
 if not exists(select 1 from public.client_businesses where id=c and customer_system_connection_id=conn) or not exists(select 1 from public.integration_connections where id=conn and runtime_mode='dry_run' and config->'hubspot_actions_enabled'='false'::jsonb) then raise exception 'Explicit customer system selection did not remain separate from actions'; end if;
 denied:=false; begin perform public.configure_hubspot(p,c,conn,rev,true,true); exception when sqlstate '40001' then denied:=true; end;
 if not denied then raise exception 'Stale HubSpot configuration revision was reused'; end if;
end $selection$;

-- Group 4: one refresh lease, exact portal/claim/revision/scope CAS, token
-- rotation persists once while the owner grant and authority remain unchanged.
do $rotation$ declare conn uuid:=(select id from hf_fixture where key='hubspot-a'); p uuid:=(select id from hf_fixture where key='partner-a'); c uuid:=(select id from hf_fixture where key='client-a'); rev uuid; grant_rev text; next_rev uuid:=extensions.gen_random_uuid(); claim uuid:=extensions.gen_random_uuid(); authority integer; saved jsonb;
begin
 select (config->>'hubspot_secret_revision')::uuid,config->>'hubspot_grant_revision' into rev,grant_rev from public.integration_connections where id=conn;
 select authority_revision into authority from public.agent_team_settings where partner_id=p and client_id=c;
 select to_jsonb(s) into saved from public.integration_secrets s where connection_id=conn;
 if not public.claim_hubspot_oauth_refresh(p,c,conn,rev,claim) or public.claim_hubspot_oauth_refresh(p,c,conn,rev,extensions.gen_random_uuid()) or public.claim_hubspot_oauth_refresh(p,c,conn,extensions.gen_random_uuid(),extensions.gen_random_uuid()) then raise exception 'Refresh did not have exactly one current lease owner'; end if;
 if public.finish_hubspot_oauth_refresh(p,c,conn,rev,extensions.gen_random_uuid(),next_rev,'synthetic-rotated-envelope','test','810001',array['oauth','crm.objects.contacts.read','crm.objects.deals.read','crm.objects.contacts.write'],now()+interval '30 minutes') or public.finish_hubspot_oauth_refresh(p,c,conn,rev,claim,next_rev,'synthetic-rotated-envelope','test','820001',array['oauth','crm.objects.contacts.read','crm.objects.deals.read','crm.objects.contacts.write'],now()+interval '30 minutes') or public.finish_hubspot_oauth_refresh(p,c,conn,rev,claim,next_rev,'synthetic-rotated-envelope','test','810001',array['oauth'],now()+interval '30 minutes') then raise exception 'Wrong refresh claim/account/scopes committed a token'; end if;
 if saved is distinct from (select to_jsonb(s) from public.integration_secrets s where connection_id=conn) then raise exception 'Rejected refresh replaced the secret'; end if;
 if not public.finish_hubspot_oauth_refresh(p,c,conn,rev,claim,next_rev,'synthetic-rotated-envelope','test','810001',array['oauth','crm.objects.contacts.read','crm.objects.deals.read','crm.objects.contacts.write'],now()+interval '30 minutes') then raise exception 'Current refresh could not commit'; end if;
 if not exists(select 1 from public.integration_connections where id=conn and config->>'hubspot_secret_revision'=next_rev::text and config->>'hubspot_grant_revision'=grant_rev) or (select authority_revision from public.agent_team_settings where partner_id=p and client_id=c)<>authority or exists(select 1 from public.hubspot_oauth_refresh_leases where connection_id=conn) then raise exception 'Token rotation renewed owner authority or left a lease'; end if;
 if public.finish_hubspot_oauth_refresh(p,c,conn,rev,claim,extensions.gen_random_uuid(),'must-not-save','test','810001',array['oauth','crm.objects.contacts.read','crm.objects.deals.read','crm.objects.contacts.write'],now()+interval '30 minutes') then raise exception 'A stale refresh replay committed twice'; end if;
end $rotation$;

-- Group 5: reauthorization failures preserve imported evidence and credentials;
-- retryable failures only release the exact lease, late failures cannot revoke
-- a newer grant. No provider action is repeated by any of these functions.
do $refresh_failures$ declare conn uuid:=(select id from hf_fixture where key='hubspot-a'); p uuid:=(select id from hf_fixture where key='partner-a'); c uuid:=(select id from hf_fixture where key='client-a'); rev uuid; claim uuid:=extensions.gen_random_uuid(); snapshot jsonb; a jsonb;
begin
 select (config->>'hubspot_secret_revision')::uuid into rev from public.integration_connections where id=conn;
 select to_jsonb(s) into snapshot from public.integration_secrets s where connection_id=conn;
 perform public.claim_hubspot_oauth_refresh(p,c,conn,rev,claim); perform public.fail_hubspot_oauth_refresh(p,c,conn,rev,claim,false);
 if exists(select 1 from public.hubspot_oauth_refresh_leases where connection_id=conn) or not exists(select 1 from public.integration_connections where id=conn and credential_status='configured') then raise exception 'Retryable refresh failure revoked access or retained its lease'; end if;
 claim:=extensions.gen_random_uuid(); perform public.claim_hubspot_oauth_refresh(p,c,conn,rev,claim); perform public.fail_hubspot_oauth_refresh(p,c,conn,rev,claim,true);
 if not exists(select 1 from public.integration_connections where id=conn and credential_status='invalid' and status='needs_attention') or snapshot is distinct from (select to_jsonb(s) from public.integration_secrets s where connection_id=conn) then raise exception 'Reauthorization failure lost saved token evidence'; end if;
 a:=pg_temp.hf_begin('recover',conn,array['contact.create','note.create']); perform pg_temp.hf_consume((a->>'attemptId')::uuid); perform pg_temp.hf_finish((a->>'attemptId')::uuid,'810001',array['contact.create','note.create'],array['oauth','crm.objects.contacts.read','crm.objects.deals.read','crm.objects.contacts.write']);
 perform public.fail_hubspot_oauth_refresh(p,c,conn,rev,claim,true);
 if not exists(select 1 from public.integration_connections where id=conn and credential_status='configured' and config->>'hubspot_secret_revision'<>rev::text) then raise exception 'Late refresh failure invalidated a newer reconnected grant'; end if;
end $refresh_failures$;

-- Group 6: true HubSpot record imports stay external-source read models.
do $source_import$ declare conn uuid:=(select id from hf_fixture where key='hubspot-a'); p uuid:=(select id from hf_fixture where key='partner-a'); c uuid:=(select id from hf_fixture where key='client-a'); denied boolean:=false; begin
 perform public.persist_owner_import_record(p,c,conn,'customer','synthetic-contact-__RUN_ID__',null,'{"portal_id":"810001","firstname":"Synthetic source customer","archived":false}','{}',now(),now());
 update hf_fixture set id=(select id from public.integration_canonical_records where connection_id=conn and object_type='customer' and external_object_id='synthetic-contact-__RUN_ID__') where key='contact-source';
 begin perform public.persist_owner_import_record(p,c,conn,'customer','foreign-contact',null,'{"portal_id":"820001","archived":false}','{}',now(),now()); exception when raise_exception then if sqlerrm not like '%Unsupported source object%' then raise; end if; denied:=true; end;
 if not denied or exists(select 1 from public.crm_contacts where partner_id=p and client_id=c) or exists(select 1 from public.crm_leads where partner_id=p and client_id=c) or not exists(select 1 from public.integration_canonical_records where id=(select id from hf_fixture where key='contact-source') and projection_status='skipped' and native_object_id is null) then raise exception 'HubSpot import projected a local identity or accepted another portal'; end if;
end $source_import$;

-- Later gateway groups reuse this actual reviewed business and source identity.
insert into public.business_workspace_profiles(partner_id,client_id,profile) values((select id from hf_fixture where key='partner-a'),(select id from hf_fixture where key='client-a'),'{"description":"Synthetic HubSpot source-owned CRM acceptance","services":"Synthetic service"}');
do $gateway_setup$ declare p uuid:=(select id from hf_fixture where key='partner-a'); c uuid:=(select id from hf_fixture where key='client-a'); actor uuid:=(select id from hf_fixture where key='owner-a'); conn uuid:=(select id from hf_fixture where key='hubspot-a'); revision text; profile_time timestamptz; begin
 update public.agent_team_settings set status='active' where partner_id=p and client_id=c;
 select updated_at into profile_time from public.business_workspace_profiles where partner_id=p and client_id=c;
 perform public.apply_business_context_command(p,c,actor,jsonb_build_object('action','review_context','key',extensions.gen_random_uuid(),'expectedContextRevision',profile_time));
 select config->>'hubspot_config_revision' into revision from public.integration_connections where id=conn;
 perform public.configure_hubspot(p,c,conn,revision,true,true);
end $gateway_setup$;
-- Synthetic completed source scan is explicit fixture state, not provider proof.
insert into public.integration_sync_states(partner_id,client_id,connection_id,stream_key,status,last_completed_at,cursor_value) values((select id from hf_fixture where key='partner-a'),(select id from hf_fixture where key='client-a'),(select id from hf_fixture where key='hubspot-a'),'customer','idle',now(),'{}') on conflict(connection_id,stream_key) do update set status='idle',last_completed_at=now(),last_error=null,cursor_value='{}';

-- Groups 7-9: real owner review/outbox and one-attempt policy, not provider proof.
create function pg_temp.hf_gateway(p_label text,p_operation text default 'note.create') returns jsonb language plpgsql security invoker set search_path='' as $$
declare p uuid:=(select id from pg_temp.hf_fixture where key='partner-a'); c uuid:=(select id from pg_temp.hf_fixture where key='client-a'); actor uuid:=(select id from pg_temp.hf_fixture where key='owner-a'); conn public.integration_connections; src public.integration_canonical_records; pin jsonb; request jsonb; command jsonb; receipt jsonb; authority integer;
begin
 select * into strict conn from public.integration_connections where id=(select id from pg_temp.hf_fixture where key='hubspot-a');
 if p_operation='note.create' then
  perform public.persist_owner_import_record(p,c,conn.id,'customer','synthetic-gateway-'||p_label||'-__RUN_ID__',null,jsonb_build_object('portal_id','810001','firstname','Synthetic policy target '||p_label,'archived',false),'{}',now(),now());
  select * into strict src from public.integration_canonical_records where connection_id=conn.id and object_type='customer' and external_object_id='synthetic-gateway-'||p_label||'-__RUN_ID__';
 end if;
 select authority_revision into authority from public.agent_team_settings where partner_id=p and client_id=c;
 pin:=jsonb_build_object('crm_gateway_version',1,'provider','hubspot','operation',p_operation,'owner_command_id',extensions.gen_random_uuid(),'connection_id',conn.id,'account_id',conn.external_account_id,'grant_revision',conn.config->>'hubspot_grant_revision','authority_revision',authority,'source_record_id',src.id,'source_updated_at',src.updated_at,'source_external_updated_at',src.external_updated_at,'external_id',src.external_object_id,'source_fingerprint',case when src.id is null then null else repeat('a',64) end,'properties',case when p_operation='contact.create' then '{"firstname":"Synthetic deliberate new customer"}'::jsonb else '{}'::jsonb end,'note_body',case when p_operation='note.create' then 'Synthetic exact-target note '||p_label else null end,'new_identity_confirmed',p_operation='contact.create','source_run_id',null);
 request:=jsonb_build_object('action','prepare_hubspot_change','key',extensions.gen_random_uuid(),'connectionId',conn.id,'expectedRevision',conn.config->>'hubspot_config_revision','operation',p_operation,'targetConfirmed',true);
 if p_operation='contact.create' then request:=request||jsonb_build_object('newIdentityConfirmed',true,'properties',pin->'properties');
 else request:=request||jsonb_build_object('recordId',src.id,'expectedSourceRevision',pin->>'source_updated_at','note',pin->>'note_body'); end if;
 command:=jsonb_build_object('owner_request',request,'pin',pin);
 receipt:=public.prepare_hubspot_change(p,c,actor,command);
 insert into pg_temp.hf_fixture(key,id,data) values('gateway-'||p_label,(receipt->>'approvalId')::uuid,jsonb_build_object('command',command,'receipt',receipt));
 return receipt;
end $$;
grant execute on function pg_temp.hf_gateway(text,text) to service_role;
do $gateway_prepare$ declare receipt jsonb; command jsonb; replay jsonb; denied boolean; kind text; p uuid:=(select id from hf_fixture where key='partner-a'); c uuid:=(select id from hf_fixture where key='client-a'); actor uuid:=(select id from hf_fixture where key='owner-a'); begin
 foreach kind in array array['note.create','contact.create'] loop
  receipt:=pg_temp.hf_gateway(case when kind='note.create' then 'note' else 'create' end,kind);
  select data->'command' into command from hf_fixture where id=(receipt->>'approvalId')::uuid;
  replay:=public.prepare_hubspot_change(p,c,actor,command);
  if replay->>'id' is distinct from receipt->>'id' or replay->>'approvalId' is distinct from receipt->>'approvalId' or replay->'replayed' is distinct from 'true'::jsonb then raise exception 'CRM preparation did not replay one immutable receipt'; end if;
  denied:=false; begin perform public.prepare_hubspot_change(p,c,actor,jsonb_set(command,'{owner_request,targetConfirmed}','false')); exception when raise_exception or sqlstate '40001' then denied:=true; end;
  if not denied then raise exception 'Changed CRM request replay was accepted'; end if;
  denied:=false; begin perform public.prepare_hubspot_change(p,c,(select id from hf_fixture where key='owner-b'),command); exception when sqlstate '40001' then denied:=true; end;
  if not denied then raise exception 'Changed CRM actor replay was accepted'; end if;
 end loop;
 if exists(select 1 from public.action_jobs where partner_id=p and client_id=c) or exists(select 1 from public.crm_contacts where partner_id=p and client_id=c) then raise exception 'CRM preparation sent or projected a local customer'; end if;
end $gateway_prepare$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',(select id::text from hf_fixture where key='owner-a'),true);
do $actual_owner_approval$ declare proposal record; begin
 for proposal in select id from hf_fixture where key in('gateway-note','gateway-create') loop
  update public.approval_items set status='approved',resolved_by=(select id from hf_fixture where key='owner-a') where id=proposal.id and status='pending';
  if not found then raise exception 'Authenticated owner failed to approve exact CRM proposal'; end if;
  if (select count(*) from public.action_jobs where approval_id=proposal.id and kind='crm.sync')<>1 then raise exception 'Authenticated CRM approval did not enqueue exactly one job'; end if;
 end loop;
end $actual_owner_approval$;
reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $attempt_once$ declare proposal uuid:=(select id from hf_fixture where key='gateway-note'); job uuid; claim uuid:=extensions.gen_random_uuid(); p uuid:=(select id from hf_fixture where key='partner-a'); c uuid:=(select id from hf_fixture where key='client-a'); verdict jsonb; command jsonb; denied boolean:=false; begin
 update public.action_jobs set status='processing',claimed_at=now(),claim_token=claim where approval_id=proposal returning id into strict job;
 if public.crm_gateway_action_check(p,c,job,null)->>'allowed'='true' or public.crm_gateway_action_check(p,c,job,extensions.gen_random_uuid())->>'allowed'='true' or public.crm_gateway_action_check((select id from hf_fixture where key='partner-b'),c,job,claim)->>'allowed'='true' then raise exception 'Invalid CRM job claim or foreign tenant passed'; end if;
 verdict:=public.crm_gateway_action_check(p,c,job,claim);
 if verdict->>'allowed' is distinct from 'true' or not public.mark_crm_gateway_attempt(p,c,job,claim) or public.mark_crm_gateway_attempt(p,c,job,claim) then raise exception 'CRM POST boundary was not a single-use marker'; end if;
 update public.action_jobs set status='uncertain',last_error='Synthetic unknown POST outcome; no provider request occurred' where id=job;
 verdict:=public.crm_gateway_action_check(p,c,job,claim);
 if verdict->>'allowed' is distinct from 'false' or verdict->>'uncertain' is distinct from 'true' then raise exception 'An unknown CRM creation could repeat its POST'; end if;
 select data->'command' into command from hf_fixture where key='gateway-note';
 command:=jsonb_set(jsonb_set(command,'{owner_request,key}',to_jsonb(extensions.gen_random_uuid())),'{pin,owner_command_id}',to_jsonb(extensions.gen_random_uuid()));
 begin perform public.prepare_hubspot_change(p,c,(select id from hf_fixture where key='owner-a'),command); exception when raise_exception then if sqlerrm not like '%existing CRM decision%' then raise; end if; denied:=true; end;
 if not denied or (select count(*) from public.action_jobs where approval_id=proposal)<>1 then raise exception 'Uncertain CRM operation created another decision or job'; end if;
end $attempt_once$;
-- Each independently pinned source is invalidated before owner approval. The
-- authenticated resolution below must roll back completely, including outbox.
do $negative_setup$ declare label text; receipt jsonb; command jsonb; src uuid; p uuid:=(select id from hf_fixture where key='partner-a'); c uuid:=(select id from hf_fixture where key='client-a'); begin
 foreach label in array array['source-version','archived','grant','authority'] loop
  receipt:=pg_temp.hf_gateway(label);
  select data->'command' into command from hf_fixture where key='gateway-'||label;
  src:=(command->'pin'->>'source_record_id')::uuid;
  if label='source-version' then update public.integration_canonical_records set external_updated_at=external_updated_at+interval '1 second' where id=src;
  elsif label='archived' then update public.integration_canonical_records set canonical_data=canonical_data||'{"archived":true}' where id=src;
  elsif label='grant' then update hf_fixture set data=data||jsonb_build_object('savedGrant',(select config->>'hubspot_grant_revision' from public.integration_connections where id=(select id from hf_fixture where key='hubspot-a'))) where key='gateway-grant';
   update public.integration_connections set config=jsonb_set(config,'{hubspot_grant_revision}',to_jsonb(extensions.gen_random_uuid())) where id=(select id from hf_fixture where key='hubspot-a');
  else update public.agent_team_settings set status='paused' where partner_id=p and client_id=c; end if;
  if public.crm_gateway_source_check(p,c,command->'pin')->>'allowed'='true' then raise exception 'Changed CRM % source remained eligible',label; end if;
  if label='grant' then update public.integration_connections set config=jsonb_set(config,'{hubspot_grant_revision}',to_jsonb((select data->>'savedGrant' from hf_fixture where key='gateway-grant'))) where id=(select id from hf_fixture where key='hubspot-a');
  elsif label='authority' then update public.agent_team_settings set status='active' where partner_id=p and client_id=c; end if;
 end loop;
 -- Grant restoration intentionally renews authority: all four proposals remain stale.
end $negative_setup$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',(select id::text from hf_fixture where key='owner-a'),true);
do $stale_owner_resolution$ declare proposal record; denied boolean; begin
 for proposal in select id from hf_fixture where key in('gateway-source-version','gateway-archived','gateway-grant','gateway-authority') loop
  denied:=false; begin update public.approval_items set status='approved',resolved_by=(select id from hf_fixture where key='owner-a') where id=proposal.id and status='pending'; exception when sqlstate '40001' then denied:=true; end;
  if not denied or not exists(select 1 from public.approval_items where id=proposal.id and status='pending') or exists(select 1 from public.action_jobs where approval_id=proposal.id) then raise exception 'Stale CRM approval escaped atomic owner resolution guard'; end if;
 end loop;
end $stale_owner_resolution$;
reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);

-- Group 6 continued: latest provider versions and archives cannot be undone by
-- a late poll. Equal-clock disagreement blocks notes until a completed import.
do $source_history$ declare receipt jsonb; command jsonb; src public.integration_canonical_records; saved jsonb; conn uuid:=(select id from hf_fixture where key='hubspot-a'); p uuid:=(select id from hf_fixture where key='partner-a'); c uuid:=(select id from hf_fixture where key='client-a'); begin
 receipt:=pg_temp.hf_gateway('import-conflict');
 select data->'command' into command from hf_fixture where key='gateway-import-conflict';
 select * into strict src from public.integration_canonical_records where id=(command->'pin'->>'source_record_id')::uuid;
 if public.persist_owner_import_record(p,c,conn,'customer',src.external_object_id,null,src.canonical_data||'{"archived":true}','{}',src.external_updated_at-interval '1 second',now()) then raise exception 'Older HubSpot source version overwrote current facts'; end if;
 if (select canonical_data from public.integration_canonical_records where id=src.id) is distinct from src.canonical_data then raise exception 'Rejected older HubSpot source changed canonical facts'; end if;
 if public.persist_owner_import_record(p,c,conn,'customer',src.external_object_id,null,src.canonical_data||'{"archived":true}','{}',src.external_updated_at,now()) then raise exception 'Equal-clock conflicting HubSpot facts were accepted'; end if;
 if not exists(select 1 from public.integration_sync_states where connection_id=conn and stream_key='customer' and status='failing' and last_error is not null) or public.crm_gateway_source_check(p,c,command->'pin')->>'allowed'='true' then raise exception 'Conflicting HubSpot import failed to block unsent note'; end if;
 if not public.persist_owner_import_record(p,c,conn,'customer',src.external_object_id,null,src.canonical_data||'{"archived":true}','{}',src.external_updated_at+interval '1 second',now()) then raise exception 'A newer exact HubSpot archive was not saved'; end if;
 select canonical_data into saved from public.integration_canonical_records where id=src.id;
 if public.persist_owner_import_record(p,c,conn,'customer',src.external_object_id,null,src.canonical_data,'{}',src.external_updated_at,now()) or saved is distinct from (select canonical_data from public.integration_canonical_records where id=src.id) or saved->>'archived' is distinct from 'true' then raise exception 'A delayed HubSpot poll resurrected an archived contact'; end if;
 if exists(select 1 from public.crm_contacts where partner_id=p and client_id=c) or exists(select 1 from public.crm_leads where partner_id=p and client_id=c) then raise exception 'HubSpot policy/import tests created an independent local CRM identity'; end if;
end $source_history$;


-- Coordinator integration draft: append before Group 10 of
-- scripts/sql/hubspot-oauth-acceptance.sql while service_role is active.
-- Reuses actual accepted business/owner fixtures. All rows roll back with that
-- asset. No OAuth token, provider request, delivery or hosted data is involved.
do $connector_health$
declare
 p uuid:=(select id from hf_fixture where key='partner-a');
 c uuid:=(select id from hf_fixture where key='client-a');
 foreign_p uuid:=(select id from hf_fixture where key='partner-b');
 foreign_c uuid:=(select id from hf_fixture where key='client-b');
 conn uuid:=extensions.gen_random_uuid(); other_conn uuid:=extensions.gen_random_uuid();
 job uuid:=extensions.gen_random_uuid(); push_job uuid:=extensions.gen_random_uuid();
 original_claim timestamptz:=now()-interval '10 minutes';
 current_claim timestamptz:=now()-interval '2 minutes';
 prior_complete timestamptz:=now()-interval '20 minutes';
 prior_cursor jsonb:='{"version":1,"phase":"archived"}'::jsonb;
 saved_state jsonb; saved_job jsonb; previous_actions integer;
begin
 insert into public.integration_connections(id,partner_id,client_id,provider_id,display_name,status,runtime_mode,credential_status,config)
 select conn,p,c,id,'Synthetic background source health','connected','dry_run','configured','{"workspace_view_only":true,"hubspot_owner_crm":true}' from public.integration_providers where provider_key='hubspot';
 insert into public.integration_connections(id,partner_id,client_id,provider_id,display_name,status,runtime_mode,credential_status,config)
 select other_conn,p,c,id,'Synthetic other account health','connected','dry_run','configured','{"workspace_view_only":true}' from public.integration_providers where provider_key='google_workspace';
 insert into public.integration_sync_states(partner_id,client_id,connection_id,stream_key,status,last_completed_at,cursor_value)
 values(p,c,conn,'customer','idle',prior_complete,prior_cursor),(p,c,conn,'note','idle',prior_complete,'{}'),(p,c,other_conn,'appointment','idle',prior_complete,'{}');
 insert into public.integration_sync_jobs(id,partner_id,client_id,connection_id,direction,object_type,operation,status,locked_at,locked_by,attempts,max_attempts)
 values(job,p,c,conn,'pull','customer','sync','running',original_claim,'synthetic-acceptance',4,5),
       (push_job,p,c,conn,'push','customer','create','running',original_claim,'synthetic-acceptance',0,5);
 select count(*) into previous_actions from public.action_jobs where partner_id=p and client_id=c;
 select to_jsonb(s) into saved_state from public.integration_sync_states s where connection_id=conn and stream_key='customer';
 if public.record_connector_pull_failure(foreign_p,c,conn,job,original_claim,'foreign partner')
  or public.record_connector_pull_failure(p,foreign_c,conn,job,original_claim,'foreign business')
  or public.record_connector_pull_failure(p,c,other_conn,job,original_claim,'wrong account')
  or public.record_connector_pull_failure(p,c,conn,push_job,original_claim,'push cannot change read health')
  or public.record_connector_pull_failure(p,c,conn,job,original_claim-interval '1 second','stale claim') then
  raise exception 'Foreign source, write job or stale read claim changed stream health';
 end if;
 if saved_state is distinct from (select to_jsonb(s) from public.integration_sync_states s where connection_id=conn and stream_key='customer') then raise exception 'Rejected pull failure changed previous successful source evidence'; end if;
 if not public.record_connector_pull_failure(p,c,conn,job,original_claim,'Synthetic current exhausted read') then raise exception 'Exact exhausted read could not record its current failure'; end if;
 if not exists(select 1 from public.integration_sync_states where partner_id=p and client_id=c and connection_id=conn and stream_key='customer' and status='failing' and last_error='Synthetic current exhausted read' and last_completed_at=prior_complete and cursor_value=prior_cursor)
  or not exists(select 1 from public.integration_sync_states where connection_id=conn and stream_key='note' and status='idle' and last_error is null)
  or not exists(select 1 from public.integration_sync_states where connection_id=other_conn and stream_key='appointment' and status='idle' and last_error is null) then raise exception 'Failure erased completion/cursor or contaminated another stream/account'; end if;
 -- A restarted worker owns a new claim. Its predecessor cannot publish a late
 -- error, even though the same durable job remains running.
 update public.integration_sync_jobs set locked_at=current_claim where id=job;
 select to_jsonb(s) into saved_state from public.integration_sync_states s where connection_id=conn and stream_key='customer';
 if public.record_connector_pull_failure(p,c,conn,job,original_claim,'late worker') or saved_state is distinct from (select to_jsonb(s) from public.integration_sync_states s where connection_id=conn and stream_key='customer') then raise exception 'A superseded worker overwrote current read health'; end if;
 update public.integration_connections set runtime_mode='paused' where id=conn;
 if public.record_connector_pull_failure(p,c,conn,job,current_claim,'late paused worker') then raise exception 'A paused account accepted a late read failure'; end if;
 update public.integration_connections set runtime_mode='dry_run' where id=conn;
 -- Legacy stale running rows can lack a clock; only an exact NULL claim may
 -- record their exhaustion. A non-NULL old timestamp never matches them.
 update public.integration_sync_jobs set locked_at=null where id=job;
 if public.record_connector_pull_failure(p,c,conn,job,current_claim,'wrong nonnull legacy claim') or not public.record_connector_pull_failure(p,c,conn,job,null,'Synthetic unclocked stale exhaustion') then raise exception 'Legacy running read claim equality was not exact'; end if;
 update public.integration_sync_jobs set status='dead_letter',completed_at=now()-interval '1 minute',locked_at=null,locked_by=null where id=job;
 select to_jsonb(j) into saved_job from public.integration_sync_jobs j where id=job;
 if public.record_connector_pull_failure(p,c,conn,job,null,'terminal history must remain unchanged') then raise exception 'Terminal read history published a new current failure'; end if;
 -- A later completed import supersedes current health without mutating the old
 -- dead-letter row. Projection tests separately use distinct observation clocks;
 -- now() is intentionally fixed throughout this rolled-back transaction.
 update public.integration_sync_states set status='idle',last_error=null,cursor_value='{}',last_completed_at=now() where connection_id=conn and stream_key='customer';
 if saved_job is distinct from (select to_jsonb(j) from public.integration_sync_jobs j where id=job)
  or not exists(select 1 from public.integration_sync_states where connection_id=conn and stream_key='customer' and status='idle' and last_error is null and last_completed_at=now())
  or (select count(*) from public.action_jobs where partner_id=p and client_id=c)<>previous_actions then raise exception 'Read recovery rewrote historical attempts or created a customer action'; end if;
 if has_function_privilege('anon','public.record_connector_pull_failure(uuid,uuid,uuid,uuid,timestamptz,text)','EXECUTE') or has_function_privilege('authenticated','public.record_connector_pull_failure(uuid,uuid,uuid,uuid,timestamptz,text)','EXECUTE') or not has_function_privilege('service_role','public.record_connector_pull_failure(uuid,uuid,uuid,uuid,timestamptz,text)','EXECUTE') then raise exception 'Read failure RPC grants allow browser mutation'; end if;
end $connector_health$;

-- Group 10: functions and source credentials are inaccessible to browser roles.
do $grants$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('begin_hubspot_oauth','finish_hubspot_oauth','claim_hubspot_oauth_refresh','finish_hubspot_oauth_refresh','fail_hubspot_oauth_refresh','configure_hubspot','prepare_hubspot_change','crm_gateway_source_check','crm_gateway_action_check','mark_crm_gateway_attempt','hubspot_open_review') loop
  if has_function_privilege('anon',f.signature,'EXECUTE') or has_function_privilege('authenticated',f.signature,'EXECUTE') or not has_function_privilege('service_role',f.signature,'EXECUTE') then raise exception 'HubSpot RPC grants are incorrect: %',f.signature; end if;
 end loop;
end $grants$;
reset role;
set local role anon;
select set_config('request.jwt.claim.role','anon',true);
do $anon$ declare denied boolean:=false; begin
 begin perform public.begin_hubspot_oauth(null,null,null,null,null,null,'{}',now()); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Anonymous browser invoked HubSpot OAuth begin'; end if;
end $anon$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',(select id::text from hf_fixture where key='owner-b'),true);
do $sibling$ declare denied boolean:=false; begin
 if exists(select 1 from public.integration_connections where id=(select id from hf_fixture where key='hubspot-a')) then raise exception 'Another business owner read the HubSpot connection'; end if;
 begin perform public.claim_hubspot_oauth_refresh(null,null,null,null,null); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'A browser role invoked token refresh'; end if;
end $sibling$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',(select id::text from hf_fixture where key='owner-a'),true);
do $owner_read$ begin
 if not exists(select 1 from public.integration_connections where id=(select id from hf_fixture where key='hubspot-a')) then raise exception 'Actual owner cannot read its HubSpot connection'; end if;
end $owner_read$;
reset role;
rollback;
select '__CUSTOMER_JOURNEY_REPORT__'::text || jsonb_build_object('kind','hubspot_oauth_acceptance','rolledBack',true,'remainingFixtures',
 (select count(*) from public.partners where slug like 'cj-acceptance-__RUN_ID__-hubspot-%')+(select count(*) from auth.users where email like 'cj-acceptance-__RUN_ID__-hubspot-%@synthetic.invalid'),
 'checks',jsonb_build_array('scoped_single_use_oauth_preserves_pause_and_no_activation','denied_wrong_portal_grants_and_stale_cas_preserve_access','exact_portal_dedup_and_explicit_selection_config_cas','refresh_lease_claim_rotation_and_grant_revision_cas','retryable_reauth_and_late_refresh_failure_preservation','external_portal_pinned_version_archive_conflict_imports_without_local_identity_projection','owner_crm_prepare_replay_and_actual_authenticated_approval_outbox','single_use_crm_attempt_marker_unknown_outcome_never_repeats','changed_source_archive_grant_and_authority_block_unsent_approval','actual_browser_rpc_privileges_and_tenant_read_scope','claim_bound_background_read_failure_and_restart_recovery_preserve_source_history'))::text as cj_report;
