-- DRAFT acceptance asset for root's isolated harness only. NOT database executed.
-- Synthetic OAuth envelopes/scopes/source observations test database policy;
-- they are not valid credentials, live Google consent or provider accuracy proof.
begin;
set local statement_timeout='40s';
set local lock_timeout='5s';
-- __ISOLATION_ASSERTION__
select pg_advisory_xact_lock(1937402189);
do $blank$ begin
 if current_database() !~ '_(test|acceptance)$' or exists(select 1 from public.partners) or exists(select 1 from public.client_businesses) then
  raise exception 'Google acceptance requires an exclusively blank isolated test database'; end if;
end $blank$;
create temporary table ga_fixture(key text primary key,id uuid not null default extensions.gen_random_uuid(),data jsonb);
insert into ga_fixture(key) values('partner-a'),('partner-b'),('package-a'),('package-b'),('client-a'),('client-b'),('owner-a'),('owner-b'),('google-a'),('google-b'),('customer'),('lead'),('native'),('booking'),('booking-job'),('change'),('change-job');
grant select,insert,update on ga_fixture to service_role,authenticated,anon;
insert into auth.users(id,email) select id,'cj-acceptance-__RUN_ID__-google-'||key||'@synthetic.invalid' from ga_fixture where key in ('owner-a','owner-b');
insert into public.profiles(id,email) select id,'cj-acceptance-__RUN_ID__-google-'||key||'@synthetic.invalid' from ga_fixture where key in ('owner-a','owner-b') on conflict(id) do nothing;
insert into public.partners(id,name,slug) select id,'Synthetic customer journey acceptance Google '||key,'cj-acceptance-__RUN_ID__-google-'||key from ga_fixture where key in ('partner-a','partner-b');
insert into public.partner_packages(id,partner_id,name) select id,(select id from ga_fixture where key=case when f.key='package-a' then 'partner-a' else 'partner-b' end),'Synthetic Google acceptance package' from ga_fixture f where key in ('package-a','package-b');
insert into public.client_businesses(id,partner_id,package_id,name,slug,status,client_portal_enabled,crm_operating_mode,default_runtime_mode)
 select id,(select id from ga_fixture where key=case when f.key='client-a' then 'partner-a' else 'partner-b' end),(select id from ga_fixture where key=case when f.key='client-a' then 'package-a' else 'package-b' end),'Synthetic customer journey acceptance Google '||key,'cj-acceptance-__RUN_ID__-google-'||key,'active',true,'primary_crm','sandbox'
 from ga_fixture f where key in ('client-a','client-b');
insert into public.memberships(user_id,partner_id,client_id,role) select id,(select id from ga_fixture where key=case when f.key='owner-a' then 'partner-a' else 'partner-b' end),
 (select id from ga_fixture where key=case when f.key='owner-a' then 'client-a' else 'client-b' end),'client_owner' from ga_fixture f where key in ('owner-a','owner-b');
do $beta_gate$ declare denied boolean:=false; begin
 begin update public.client_businesses set default_runtime_mode='live' where id=(select id from ga_fixture where key='client-a');
 exception when raise_exception then if sqlerrm not like '%supervised beta launch checklist%' then raise; end if; denied:=true; end;
 if not denied then raise exception 'Google fixture bypassed the required business-owner live acceptance'; end if;
end $beta_gate$;
insert into public.client_beta_acceptances(client_id,partner_id,package_id,accepted_by,provider_test_notes,fallback_contact)
 select id,(select id from ga_fixture where key=case when f.key='client-a' then 'partner-a' else 'partner-b' end),(select id from ga_fixture where key=case when f.key='client-a' then 'package-a' else 'package-b' end),
 (select id from ga_fixture where key=case when f.key='client-a' then 'owner-a' else 'owner-b' end),'Synthetic isolated database policy acceptance only; no Google OAuth consent, tokens, external calendar change, inbox or delivery accuracy is established.','synthetic-owner@invalid'
 from ga_fixture f where key in ('client-a','client-b');
update public.client_businesses set default_runtime_mode='live' where id in(select id from ga_fixture where key in('client-a','client-b'));
insert into public.agent_team_settings(partner_id,client_id,status,scheduling_enabled,conversations_enabled,channel_authority)
 values((select id from ga_fixture where key='partner-a'),(select id from ga_fixture where key='client-a'),'paused',false,false,'{"calendar":"off","email":"off"}');
insert into public.business_workspace_profiles(partner_id,client_id,profile) values((select id from ga_fixture where key='partner-a'),(select id from ga_fixture where key='client-a'),'{"description":"Synthetic Google acceptance","services":"Synthetic consultation"}');
insert into public.business_agent_activation(partner_id,client_id,status,bookings,website,email,workspace_provider)
 values((select id from ga_fixture where key='partner-a'),(select id from ga_fixture where key='client-a'),'paused',false,true,false,'google_workspace');
insert into public.integration_connections(id,partner_id,client_id,provider_id,display_name,status,runtime_mode,credential_status,external_account_id,external_account_name,config)
 select f.id,(select id from ga_fixture where key=case when f.key='google-a' then 'partner-a' else 'partner-b' end),(select id from ga_fixture where key=case when f.key='google-a' then 'client-a' else 'client-b' end),p.id,
 'Synthetic selected Google account','connected','paused','configured','ga-__RUN_ID__-'||f.key,'synthetic-__RUN_ID__-'||f.key||'@invalid',
 '{"workspace_view_only":true,"owner_workspace_imports":true,"google_action_permissions":{"calendar_write":false,"email_send":false},"google_verified_scopes":["https://www.googleapis.com/auth/gmail.readonly","https://www.googleapis.com/auth/calendar.events.readonly"]}'
 from ga_fixture f cross join public.integration_providers p where f.key in ('google-a','google-b') and p.provider_key='google_workspace';
insert into public.integration_secrets(partner_id,client_id,connection_id,secret_kind,encrypted_value,last_four)
 select c.partner_id,c.client_id,c.id,'provider_credentials','synthetic-not-an-encrypted-provider-credential','test' from public.integration_connections c where c.id in(select id from ga_fixture where key in('google-a','google-b'));

create function pg_temp.ga_attempt(p_permissions text[]) returns uuid language plpgsql security invoker set search_path='' as $attempt$
declare c public.integration_connections; secret public.integration_secrets; result uuid;
begin
 select * into c from public.integration_connections where id=(select id from pg_temp.ga_fixture where key='google-a');
 select * into secret from public.integration_secrets where connection_id=c.id and secret_kind='provider_credentials';
 insert into public.business_connection_oauth_attempts(partner_id,client_id,connection_id,actor_id,cookie_hash,encrypted_verifier,expires_at,consumed_at,provider_key,purpose,requested_permissions,expected_account_id,expected_connection_updated_at,expected_secret_updated_at)
 values(c.partner_id,c.client_id,c.id,(select id from pg_temp.ga_fixture where key='owner-a'),repeat('a',64),'synthetic-not-an-oauth-verifier',now()+interval '10 minutes',now(),'google_workspace','permission_upgrade',p_permissions,c.external_account_id,c.updated_at,secret.updated_at) returning id into result;
 return result;
end $attempt$;
create function pg_temp.ga_choices(p_email boolean,p_calendar boolean,p_connection uuid) returns jsonb language sql immutable as $choices$
 select jsonb_build_object('status','active','inquiries',true,'bookings',p_calendar,'website',true,'email',p_email,'instagram',false,'sms',false,'workspace_provider','google_workspace','workspace_connection_id',p_connection,
 'booking_start_hour',9,'booking_end_hour',17,'booking_minutes',60,'booking_weekdays',jsonb_build_array(1,2,3,4,5),'timezone','America/Chicago');
$choices$;
grant execute on function pg_temp.ga_attempt(text[]),pg_temp.ga_choices(boolean,boolean,uuid) to service_role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);

-- Group 1: real callback denial must leave credentials, access and authority intact.
do $upgrade_denial$
declare p uuid:=(select id from ga_fixture where key='partner-a'); c uuid:=(select id from ga_fixture where key='client-a'); conn uuid:=(select id from ga_fixture where key='google-a');
 attempt uuid; before_connection jsonb; before_secret jsonb; before_settings jsonb; denied boolean; scopes text[]:=array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
begin
 select to_jsonb(snapshot) into before_connection from public.integration_connections snapshot where id=conn;
 select to_jsonb(snapshot) into before_secret from public.integration_secrets snapshot where connection_id=conn and secret_kind='provider_credentials';
 select to_jsonb(snapshot) into before_settings from public.agent_team_settings snapshot where partner_id=p and client_id=c;
 attempt:=pg_temp.ga_attempt(array['calendar.write']); denied:=false;
 begin perform public.finish_google_permission_upgrade(attempt,'synthetic-wrong','test','wrong-account','Synthetic wrong account',scopes,array['calendar.write']); exception when sqlstate '40001' then denied:=true; end;
 if not denied then raise exception 'Permission callback accepted another Google account'; end if;
 denied:=false;
 begin perform public.finish_google_permission_upgrade(attempt,'synthetic-wrong','test',before_connection->>'external_account_id','Synthetic account',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/calendar.events.readonly'],array['calendar.write']); exception when sqlstate '22023' then denied:=true; end;
 if not denied then raise exception 'Permission callback accepted insufficient actual scopes'; end if;
 update public.business_connection_oauth_attempts set expected_connection_updated_at=(before_connection->>'updated_at')::timestamptz-interval '1 second' where id=attempt; denied:=false;
 begin perform public.finish_google_permission_upgrade(attempt,'synthetic-wrong','test',before_connection->>'external_account_id','Synthetic account',scopes,array['calendar.write']); exception when sqlstate '40001' then denied:=true; end;
 if not denied then raise exception 'Permission callback ignored the connection CAS'; end if;
 update public.business_connection_oauth_attempts set expected_connection_updated_at=(before_connection->>'updated_at')::timestamptz,expected_secret_updated_at=(before_secret->>'updated_at')::timestamptz-interval '1 second' where id=attempt; denied:=false;
 begin perform public.finish_google_permission_upgrade(attempt,'synthetic-wrong','test',before_connection->>'external_account_id','Synthetic account',scopes,array['calendar.write']); exception when sqlstate '40001' then denied:=true; end;
 if not denied then raise exception 'Permission callback ignored the credential CAS'; end if;
 if before_connection is distinct from (select to_jsonb(snapshot) from public.integration_connections snapshot where id=conn) or before_secret is distinct from (select to_jsonb(snapshot) from public.integration_secrets snapshot where connection_id=conn and secret_kind='provider_credentials')
  or before_settings is distinct from (select to_jsonb(snapshot) from public.agent_team_settings snapshot where partner_id=p and client_id=c) then raise exception 'Rejected permission callback changed saved access, pause or authority'; end if;
end $upgrade_denial$;

-- Group 2: consent is not activation; calendar selection cannot grant email.
do $upgrade_preservation$
declare c uuid:=(select id from ga_fixture where key='client-a'); conn uuid:=(select id from ga_fixture where key='google-a'); attempt uuid; account text; before_revision integer; scopes text[]:=array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
begin
 select authority_revision into before_revision from public.agent_team_settings where client_id=c;
 select external_account_id into account from public.integration_connections where id=conn;
 attempt:=pg_temp.ga_attempt(array['calendar.write']);
 perform public.finish_google_permission_upgrade(attempt,'synthetic-calendar-only-envelope','test',account,'Synthetic calendar-only account',scopes,array['calendar.write']);
 if not exists(select 1 from public.integration_connections where id=conn and runtime_mode='paused' and config->'workspace_view_only'='true'::jsonb and config->'google_action_permissions'='{"calendar_write":true,"email_send":false}'::jsonb) then raise exception 'Grant changed pause/view-only flags or selected unrelated email permission'; end if;
 if not exists(select 1 from public.agent_team_settings where client_id=c and status='paused' and channel_authority->>'calendar'='off' and channel_authority->>'email'='off' and authority_revision=before_revision+1) then raise exception 'Grant changed manager controls or did not advance authority exactly once'; end if;
 attempt:=pg_temp.ga_attempt(array['calendar.write']);
 perform public.finish_google_permission_upgrade(attempt,'synthetic-calendar-only-envelope','test',account,'Synthetic calendar-only account',scopes,array['calendar.write']);
 if (select authority_revision from public.agent_team_settings where client_id=c)<>before_revision+1 then raise exception 'Unchanged selected grant renewed authority revision'; end if;
 if (select public.google_config_can_act(config,'calendar') and not public.google_config_can_act(config,'email') from public.integration_connections where id=conn) is distinct from true then raise exception 'Selected calendar grant could authorize email'; end if;
end $upgrade_preservation$;

-- Group 3: explicit activation checks scope and required selected capabilities.
do $activation$
declare p uuid:=(select id from ga_fixture where key='partner-a'); c uuid:=(select id from ga_fixture where key='client-a'); actor uuid:=(select id from ga_fixture where key='owner-a'); conn uuid:=(select id from ga_fixture where key='google-a'); revision integer; denied boolean; before_plan jsonb; profile_time timestamptz;
begin
 select to_jsonb(snapshot) into before_plan from public.business_agent_activation snapshot where client_id=c;
 select plan.revision into revision from public.business_agent_activation plan where client_id=c;
 denied:=false;
 begin perform public.apply_business_activation(p,c,revision,pg_temp.ga_choices(false,true,(select id from ga_fixture where key='google-b')),'wk_synthetic_acceptance_public_key_123456'); exception when sqlstate '40001' or foreign_key_violation then denied:=true; end;
 if not denied or before_plan is distinct from (select to_jsonb(snapshot) from public.business_agent_activation snapshot where client_id=c) then raise exception 'Wrong-account activation changed the saved plan'; end if;
 denied:=false;
 begin perform public.apply_business_activation(p,c,revision,pg_temp.ga_choices(true,false,conn),'wk_synthetic_acceptance_public_key_123456'); exception when sqlstate '22023' then denied:=true; end;
 if not denied or before_plan is distinct from (select to_jsonb(snapshot) from public.business_agent_activation snapshot where client_id=c) then raise exception 'Missing email permission did not roll back explicit activation'; end if;
 select updated_at into profile_time from public.business_workspace_profiles where client_id=c;
 perform public.apply_business_context_command(p,c,actor,jsonb_build_object('action','review_context','key',extensions.gen_random_uuid(),'expectedContextRevision',profile_time));
 perform public.apply_business_activation(p,c,revision,pg_temp.ga_choices(false,true,conn),'wk_synthetic_acceptance_public_key_123456');
 select authority_revision into revision from public.agent_team_settings where client_id=c;
 perform public.apply_business_context_command(p,c,actor,jsonb_build_object('action','set_authority','key',extensions.gen_random_uuid(),'expectedRevision',revision,'channel','calendar','mode','require_approval'));
 select authority_revision into revision from public.agent_team_settings where client_id=c;
 perform public.apply_business_context_command(p,c,actor,jsonb_build_object('action','set_authority','key',extensions.gen_random_uuid(),'expectedRevision',revision,'channel','email','mode','require_approval'));
 if not public.business_channel_can_draft(p,c,'calendar',conn) or public.business_channel_can_draft(p,c,'email',conn) or public.selected_google_inbox_allowed(p,c,conn,now()) then raise exception 'Calendar-only explicit activation leaked email authority or did not enable its selected calendar'; end if;
 if not exists(select 1 from public.integration_connections where id=conn and runtime_mode='live' and config->'workspace_view_only'='true'::jsonb) then raise exception 'Explicit selection lost view-only isolation'; end if;
end $activation$;

-- Group 4: manager pause stops outgoing work, not already-selected inbound evidence.
do $paused_inbound$
declare p uuid:=(select id from ga_fixture where key='partner-a'); c uuid:=(select id from ga_fixture where key='client-a'); actor uuid:=(select id from ga_fixture where key='owner-a'); conn uuid:=(select id from ga_fixture where key='google-a');
 attempt uuid; account text; plan_revision integer; authority integer; connection_time timestamptz; secret_time timestamptz; received jsonb; again jsonb;
 scopes text[]:=array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
begin
 select external_account_id into account from public.integration_connections where id=conn;
 attempt:=pg_temp.ga_attempt(array['email.send']);
 perform public.finish_google_permission_upgrade(attempt,'synthetic-email-and-calendar-envelope','test',account,'Synthetic selected inbox',scopes,array['calendar.write','email.send']);
 select revision into plan_revision from public.business_agent_activation where client_id=c;
 perform public.apply_business_activation(p,c,plan_revision,pg_temp.ga_choices(true,true,conn),'wk_synthetic_acceptance_public_key_123456');
 select revision into plan_revision from public.business_agent_activation where client_id=c;
 select updated_at into connection_time from public.integration_connections where id=conn;
 select updated_at into secret_time from public.integration_secrets where connection_id=conn and secret_kind='provider_credentials';
 perform public.record_selected_workspace_check(p,c,plan_revision,conn,connection_time,secret_time,account,true,true);
 select authority_revision into authority from public.agent_team_settings where client_id=c;
 perform public.apply_business_context_command(p,c,actor,jsonb_build_object('action','manager_control','key',extensions.gen_random_uuid(),'expectedRevision',authority,'operation','pause'));
 if not public.selected_google_inbox_allowed(p,c,conn,now()) then raise exception 'Team pause discarded already-authorized selected inbound collection'; end if;
 received:=public.ingest_business_message(p,c,conn,'email','synthetic-__RUN_ID__@invalid','ga-__RUN_ID__-inbound','Synthetic selected inbound evidence',now());
 again:=public.ingest_business_message(p,c,conn,'email','synthetic-__RUN_ID__@invalid','ga-__RUN_ID__-inbound','Synthetic selected inbound evidence',now());
 if received->>'id' is null or received->>'workId' is not null or again->>'duplicate' is distinct from 'true'
  or (select count(*) from public.business_conversation_messages where partner_id=p and client_id=c and external_key='ga-__RUN_ID__-inbound' and direction='inbound' and status='received')<>1
  or (select count(*) from public.crm_communications where partner_id=p and client_id=c and body='Synthetic selected inbound evidence' and direction='inbound' and status='received')<>1
  or exists(select 1 from public.agent_work_items where partner_id=p and client_id=c) or exists(select 1 from public.action_jobs where partner_id=p and client_id=c) then raise exception 'Selected paused inbox lost evidence, duplicated it, or queued outgoing work'; end if;
end $paused_inbound$;

-- Seed synthetic historical provider rows for reconciliation policy acceptance.
-- No external booking/change/HTTP is performed, and no write response is fabricated.
insert into public.crm_contacts(id,partner_id,client_id,first_name,tags,created_at,updated_at) values((select id from ga_fixture where key='customer'),(select id from ga_fixture where key='partner-a'),(select id from ga_fixture where key='client-a'),'Synthetic historical calendar customer','{}',now()-interval '2 hours',now()-interval '2 hours');
insert into public.crm_leads(id,partner_id,client_id,contact_id,title) values((select id from ga_fixture where key='lead'),(select id from ga_fixture where key='partner-a'),(select id from ga_fixture where key='client-a'),(select id from ga_fixture where key='customer'),'Synthetic historical booking');
insert into public.approval_items(id,partner_id,client_id,type,status,title,resolved_by,created_at,resolved_at,proposed_payload)
 values((select id from ga_fixture where key='booking'),(select id from ga_fixture where key='partner-a'),(select id from ga_fixture where key='client-a'),'appointment_booking','approved','Synthetic historical provider booking',(select id from ga_fixture where key='owner-a'),now()-interval '61 minutes',now()-interval '1 hour',
 jsonb_build_object('provider','google_workspace','calendar_connection_id',(select id from ga_fixture where key='google-a'),'contact_id',(select id from ga_fixture where key='customer'),'lead_id',(select id from ga_fixture where key='lead'),
 'slot',jsonb_build_object('start_iso',now()+interval '7 days','end_iso',now()+interval '7 days 1 hour','label','Synthetic old source slot')));
insert into public.action_jobs(id,partner_id,client_id,approval_id,kind,status,payload,external_ref,receipt_recorded_at)
 select (select id from ga_fixture where key='booking-job'),a.partner_id,a.client_id,a.id,'calendar.book','succeeded',a.proposed_payload,'ga-__RUN_ID__-exact-event',now()-interval '1 hour' from public.approval_items a where a.id=(select id from ga_fixture where key='booking');
insert into public.crm_appointments(id,partner_id,client_id,contact_id,lead_id,approval_id,title,status,start_at,end_at,external_ref,created_at,updated_at)
 values((select id from ga_fixture where key='native'),(select id from ga_fixture where key='partner-a'),(select id from ga_fixture where key='client-a'),(select id from ga_fixture where key='customer'),(select id from ga_fixture where key='lead'),(select id from ga_fixture where key='booking'),'Synthetic current native appointment','booked',now()+interval '7 days',now()+interval '7 days 1 hour','ga-__RUN_ID__-exact-event',now()-interval '1 hour',now()-interval '1 hour');
do $historical_change$
declare p uuid:=(select id from ga_fixture where key='partner-a'); c uuid:=(select id from ga_fixture where key='client-a'); n public.crm_appointments; customer public.crm_contacts; conn public.integration_connections; authority integer; payload jsonb; source_id uuid:=extensions.gen_random_uuid();
begin
 select * into n from public.crm_appointments where id=(select id from ga_fixture where key='native');
 select * into customer from public.crm_contacts where id=n.contact_id;
 select * into conn from public.integration_connections where id=(select id from ga_fixture where key='google-a');
 select authority_revision into authority from public.agent_team_settings where client_id=c;
 payload:=jsonb_build_object('calendar_mutation_version',1,'mutation','reschedule','booking_approval_id',(select id from ga_fixture where key='booking'),'booking_action_job_id',(select id from ga_fixture where key='booking-job'),
  'appointment_id',n.id,'appointment_updated_at',n.updated_at,'contact_id',customer.id,'contact_updated_at',customer.updated_at,'provider','google_workspace','calendar_connection_id',conn.id,'calendar_account_id',conn.external_account_id,'calendar_id','primary',
  'external_ref',n.external_ref,'source_record_id',source_id,'source_updated_at',now()-interval '1 hour','source_etag','"before"','old_slot',jsonb_build_object('start_iso',n.start_at,'end_iso',n.end_at),
  'new_slot',jsonb_build_object('start_iso',n.start_at+interval '1 day','end_iso',n.end_at+interval '1 day'),'authority_revision',authority,'customer_activity_id',null,'customer_activity_at',null,'conversation_id',null,'conversation_revision',null);
 insert into public.integration_canonical_records(id,partner_id,client_id,connection_id,object_type,external_object_id,native_object_id,canonical_data,source_payload,external_updated_at,snapshot_observed_at,projection_status)
 values(source_id,p,c,conn.id,'appointment',n.external_ref,n.id::text,jsonb_build_object('provider','google_workspace','status','confirmed','start_at',n.start_at,'end_at',n.end_at),
  jsonb_build_object('id',n.external_ref,'etag','"before"','updated',now()-interval '1 hour','organizer',jsonb_build_object('self',true)),now()-interval '1 hour',now()-interval '11 minutes','skipped');
 insert into public.approval_items(id,partner_id,client_id,type,status,title,resolved_by,created_at,resolved_at,proposed_payload)
 values((select id from ga_fixture where key='change'),p,c,'appointment_change','approved','Synthetic historical uncertain change',(select id from ga_fixture where key='owner-a'),now()-interval '11 minutes',now()-interval '10 minutes',payload);
 insert into public.action_jobs(id,partner_id,client_id,approval_id,kind,status,payload,created_at,updated_at,last_attempt_at,claimed_at,provider_receipt)
 values((select id from ga_fixture where key='change-job'),p,c,(select id from ga_fixture where key='change'),'calendar.reschedule','uncertain',payload,now()-interval '11 minutes',now()-interval '9 minutes',now()-interval '10 minutes',now()-interval '10 minutes','{"fixture":"uncertain-transport-no-ack"}');
end $historical_change$;
reset role;
create function pg_temp.ga_evidence(p_positive boolean) returns jsonb language plpgsql stable security invoker set search_path='' as $evidence$
declare j public.action_jobs; p jsonb; event jsonb; observed jsonb;
begin
 select * into j from public.action_jobs where id=(select id from pg_temp.ga_fixture where key='change-job'); p:=j.payload;
 event:=jsonb_build_object('id',p->'external_ref','status','confirmed','etag','"after"','updated_at',now()-interval '2 minutes','slot',p->'new_slot','organizer_self',true,'recurring',false,'attendee_count',0,'event_type','default');
 observed:=jsonb_build_object('observed_at',now()-interval '1 minute','account_id',p->'calendar_account_id','requested_calendar_id',p->'calendar_id','resolved_calendar_id','synthetic-calendar-__RUN_ID__@invalid','calendar_access_role','owner','event_id',p->'external_ref',
 'http_status',case when p_positive then 200 else 404 end,'event',case when p_positive then event else 'null'::jsonb end,'tombstone',null,'tombstone_complete',true);
 return jsonb_build_object('version',1,'state',case when p_positive then 'source_state_verified' else 'needs_review' end,'previous_status',j.status,'action_job_id',j.id,'approval_id',j.approval_id,
 'booking_approval_id',p->'booking_approval_id','booking_action_job_id',p->'booking_action_job_id','provider',p->'provider','operation',p->'mutation','calendar_connection_id',p->'calendar_connection_id','calendar_account_id',p->'calendar_account_id','calendar_id',p->'calendar_id',
 'external_ref',p->'external_ref','attempted_at',j.last_attempt_at,'verified_at',now(),'old_slot',p->'old_slot','new_slot',p->'new_slot','observations',jsonb_build_array(observed,observed),'reason','Synthetic source observations for database policy acceptance only');
end $evidence$;
create function pg_temp.ga_command(p_evidence jsonb,p_accept boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $command$
declare j public.action_jobs; n public.crm_appointments; customer public.crm_contacts; account public.integration_connections; request jsonb;
begin
 select * into j from public.action_jobs where id=(select id from pg_temp.ga_fixture where key='change-job');
 select * into n from public.crm_appointments where id=(j.payload->>'appointment_id')::uuid;
 select * into customer from public.crm_contacts where id=(j.payload->>'contact_id')::uuid;
 select * into account from public.integration_connections where id=(j.payload->>'calendar_connection_id')::uuid;
 request:=jsonb_build_object('action','reconcile_calendar_change','key',extensions.gen_random_uuid(),'targetId',j.id,'expectedRevision','synthetic-current-cas-pins');
 if p_accept then request:=request||jsonb_build_object('acceptReviewedSource',true); end if;
 return request||jsonb_build_object('owner_request',request,'expectedJobUpdatedAt',j.updated_at,'expectedAppointmentUpdatedAt',n.updated_at,'expectedContactUpdatedAt',customer.updated_at,'expectedConnectionUpdatedAt',account.updated_at,'evidence',p_evidence);
end $command$;
grant execute on function pg_temp.ga_evidence(boolean),pg_temp.ga_command(jsonb,boolean) to service_role;
set local role service_role;

-- Group 5: absence/original-chain/scope cannot become proof; one review task.
-- Alternate immutable historical chains isolate each original-approval check.
-- No resolved approval is updated and no trigger is disabled.
do $original_chain$
declare p uuid:=(select id from ga_fixture where key='partner-a'); c uuid:=(select id from ga_fixture where key='client-a'); actor uuid:=(select id from ga_fixture where key='owner-a');
 base_payload jsonb; base_evidence jsonb; case_key text; case_index integer:=0; alternate_connection uuid; original_id uuid; original_job uuid; native_id uuid; change_id uuid; change_job uuid; source_id uuid;
 alternate_payload jsonb; alternate_evidence jsonb; alternate_reads jsonb; original_payload jsonb; event_ref text; old_start timestamptz; original_status public.approval_status; current_authority integer;
begin
 select payload into base_payload from public.action_jobs where id=(select id from ga_fixture where key='change-job');
 base_evidence:=pg_temp.ga_evidence(true);
 if public.calendar_reconciliation_valid(p,c,(select id from ga_fixture where key='change-job'),base_evidence) is distinct from true then raise exception 'Original-chain regression control has no complete source proof'; end if;
 insert into public.integration_connections(partner_id,client_id,provider_id,display_name,status,runtime_mode,credential_status,external_account_id,config)
 select p,c,provider_id,'Synthetic alternate original Google account','connected','paused','configured','ga-__RUN_ID__-alternate-original','{"workspace_view_only":true}' from public.integration_connections where id=(select id from ga_fixture where key='google-a') returning id into alternate_connection;
 select authority_revision into current_authority from public.agent_team_settings where partner_id=p and client_id=c;
 foreach case_key in array array['control','unapproved','wrong_provider','wrong_connection'] loop
  case_index:=case_index+1; original_id:=extensions.gen_random_uuid(); original_job:=extensions.gen_random_uuid(); native_id:=extensions.gen_random_uuid(); change_id:=extensions.gen_random_uuid(); change_job:=extensions.gen_random_uuid(); source_id:=extensions.gen_random_uuid();
  event_ref:='ga-__RUN_ID__-original-chain-'||case_key; old_start:=(base_payload->'old_slot'->>'start_iso')::timestamptz+case_index*interval '3 days';
  alternate_payload:=base_payload||jsonb_build_object('booking_approval_id',original_id,'booking_action_job_id',original_job,'appointment_id',native_id,'external_ref',event_ref,'source_record_id',source_id,'authority_revision',current_authority,
   'old_slot',jsonb_build_object('start_iso',old_start,'end_iso',old_start+interval '1 hour'),'new_slot',jsonb_build_object('start_iso',old_start+interval '1 day','end_iso',old_start+interval '1 day 1 hour'));
  original_payload:=jsonb_build_object('provider',case when case_key='wrong_provider' then 'microsoft_365' else 'google_workspace' end,
   'calendar_connection_id',case when case_key='wrong_connection' then alternate_connection else (base_payload->>'calendar_connection_id')::uuid end,
   'contact_id',base_payload->'contact_id','lead_id',(select id from ga_fixture where key='lead'),'slot',alternate_payload->'old_slot');
  original_status:=case when case_key='unapproved' then 'pending'::public.approval_status else 'approved'::public.approval_status end;
  insert into public.approval_items(id,partner_id,client_id,type,status,title,resolved_by,created_at,resolved_at,proposed_payload)
  values(original_id,p,c,'appointment_booking',original_status,'Synthetic original-chain '||case_key,case when original_status='approved' then actor else null end,now()-interval '61 minutes',case when original_status='approved' then now()-interval '1 hour' else null end,original_payload);
  insert into public.action_jobs(id,partner_id,client_id,approval_id,kind,status,payload,external_ref,receipt_recorded_at)
  values(original_job,p,c,original_id,'calendar.book','succeeded',(select proposed_payload from public.approval_items where id=original_id),event_ref,now()-interval '1 hour');
  insert into public.crm_appointments(id,partner_id,client_id,contact_id,lead_id,approval_id,title,status,start_at,end_at,external_ref,created_at,updated_at)
  values(native_id,p,c,(base_payload->>'contact_id')::uuid,(select id from ga_fixture where key='lead'),original_id,'Synthetic original-chain native '||case_key,'booked',old_start,old_start+interval '1 hour',event_ref,now()-interval '1 hour',(base_payload->>'appointment_updated_at')::timestamptz);
  insert into public.integration_canonical_records(id,partner_id,client_id,connection_id,object_type,external_object_id,native_object_id,canonical_data,source_payload,external_updated_at,snapshot_observed_at,projection_status)
  values(source_id,p,c,(base_payload->>'calendar_connection_id')::uuid,'appointment',event_ref,native_id::text,jsonb_build_object('status','confirmed','start_at',old_start,'end_at',old_start+interval '1 hour'),
   jsonb_build_object('id',event_ref,'etag','"before"','updated',now()-interval '1 hour','organizer',jsonb_build_object('self',true)),now()-interval '1 hour',now()-interval '11 minutes','skipped');
  insert into public.approval_items(id,partner_id,client_id,type,status,title,resolved_by,created_at,resolved_at,proposed_payload)
  values(change_id,p,c,'appointment_change','approved','Synthetic immutable change for '||case_key,actor,now()-interval '11 minutes',now()-interval '10 minutes',alternate_payload);
  insert into public.action_jobs(id,partner_id,client_id,approval_id,kind,status,payload,last_attempt_at,claimed_at,provider_receipt)
  values(change_job,p,c,change_id,'calendar.reschedule','uncertain',(select proposed_payload from public.approval_items where id=change_id),now()-interval '10 minutes',now()-interval '10 minutes','{"fixture":"uncertain-transport-no-ack"}');
  select jsonb_agg(value||jsonb_build_object('event_id',event_ref,'event',(value->'event')||jsonb_build_object('id',event_ref,'slot',alternate_payload->'new_slot'))) into alternate_reads from jsonb_array_elements(base_evidence->'observations');
  alternate_evidence:=base_evidence||jsonb_build_object('action_job_id',change_job,'approval_id',change_id,'booking_approval_id',original_id,'booking_action_job_id',original_job,'external_ref',event_ref,
   'old_slot',alternate_payload->'old_slot','new_slot',alternate_payload->'new_slot','observations',alternate_reads);
  if case_key='control' then
   if public.calendar_reconciliation_valid(p,c,change_job,alternate_evidence) is distinct from true then raise exception 'Alternate original-chain positive control is not otherwise valid'; end if;
  elsif public.calendar_reconciliation_valid(p,c,change_job,alternate_evidence) is distinct from false then raise exception 'Source proof accepted an invalid immutable original approval: %',case_key; end if;
 end loop;
end $original_chain$;
do $review_and_scope$
declare p uuid:=(select id from ga_fixture where key='partner-a'); c uuid:=(select id from ga_fixture where key='client-a'); actor uuid:=(select id from ga_fixture where key='owner-a'); j uuid:=(select id from ga_fixture where key='change-job');
 evidence jsonb; request jsonb; first jsonb; again jsonb; denied boolean;
begin
 evidence:=pg_temp.ga_evidence(false); evidence:=evidence||jsonb_build_object('state','source_state_verified');
 if public.calendar_reconciliation_valid(p,c,j,evidence) is distinct from false then raise exception 'Repeated source absence was accepted as verified state'; end if;
 if public.calendar_reconciliation_valid(p,c,j,evidence||jsonb_build_object('observations',jsonb_build_array(evidence->'observations'->0))) is distinct from false then raise exception 'One absent read was accepted as verified state'; end if;
 request:=pg_temp.ga_command(evidence); denied:=false;
 begin perform public.reconcile_calendar_change(p,c,actor,request); exception when sqlstate '22023' then denied:=true; end;
 if not denied then raise exception 'Invalid positive proof reached reconciliation'; end if;
 denied:=false;
 begin perform public.reconcile_calendar_change((select id from ga_fixture where key='partner-b'),c,actor,request); exception when sqlstate '40001' then denied:=true; end;
 if not denied then raise exception 'Reconciliation accepted another partner/client pairing'; end if;
 first:=public.reconcile_calendar_change(p,c,actor,pg_temp.ga_command(pg_temp.ga_evidence(false)));
 again:=public.reconcile_calendar_change(p,c,actor,pg_temp.ga_command(pg_temp.ga_evidence(false)));
 if first->>'state' is distinct from 'needs_review' or first->>'taskId' is null or first->>'taskId' is distinct from again->>'taskId'
  or (select count(*) from public.crm_tasks where calendar_action_job_id=j and task_type='calendar_change_reconciliation')<>1 then raise exception 'Ambiguous source result did not create exactly one linked review task'; end if;
end $review_and_scope$;

-- Group 6: strong independent source evidence mirrors state, never original outcome.
do $positive_and_replay$
declare p uuid:=(select id from ga_fixture where key='partner-a'); c uuid:=(select id from ga_fixture where key='client-a'); actor uuid:=(select id from ga_fixture where key='owner-a'); j uuid:=(select id from ga_fixture where key='change-job');
 evidence jsonb; request jsonb; first jsonb; replay jsonb; before_receipt jsonb; third_time timestamptz;
begin
 evidence:=pg_temp.ga_evidence(true);
 if public.calendar_reconciliation_valid(p,c,j,evidence) is distinct from true then raise exception 'Complete exact two-read source proof was not recognized'; end if;
 select provider_receipt into before_receipt from public.action_jobs where id=j;
 request:=pg_temp.ga_command(evidence); first:=public.reconcile_calendar_change(p,c,actor,request);
 if first->>'state' is distinct from 'source_state_verified' or first->>'actionJobId' is distinct from j::text
  or not exists(select 1 from public.action_jobs where id=j and status='uncertain' and provider_receipt=before_receipt)
  or not exists(select 1 from public.crm_appointments where id=(select id from ga_fixture where key='native') and start_at=(evidence->'new_slot'->>'start_iso')::timestamptz and calendar_reconciliation_job_id=j)
  or public.calendar_reconciled_state(p,c,(select id from ga_fixture where key='booking'),(select id from ga_fixture where key='native')) is null then raise exception 'Source verification rewrote original uncertainty/receipt or lost its native provenance'; end if;
 third_time:=(evidence->'new_slot'->>'start_iso')::timestamptz+interval '1 day';
 update public.crm_appointments set start_at=third_time,end_at=third_time+interval '1 hour' where id=(select id from ga_fixture where key='native');
 replay:=public.reconcile_calendar_change(p,c,actor,request);
 if replay->>'id' is distinct from first->>'id' or replay->>'replayed' is distinct from 'true' or (select start_at from public.crm_appointments where id=(select id from ga_fixture where key='native')) is distinct from third_time then raise exception 'Exact saved receipt replay changed current source facts or failed after a native edit'; end if;
 update ga_fixture set data=request where key='change-job';
end $positive_and_replay$;

-- Group 7: displayed current CAS + explicit fresh acceptance is required after edits.
do $fresh_review$
declare p uuid:=(select id from ga_fixture where key='partner-a'); c uuid:=(select id from ga_fixture where key='client-a'); actor uuid:=(select id from ga_fixture where key='owner-a'); j uuid:=(select id from ga_fixture where key='change-job');
 request jsonb; result jsonb; denied boolean; old_time timestamptz;
begin
 update public.crm_appointments set status='cancelled' where id=(select id from ga_fixture where key='native');
 select start_at into old_time from public.crm_appointments where id=(select id from ga_fixture where key='native');
 request:=pg_temp.ga_command(pg_temp.ga_evidence(true)); denied:=false;
 begin perform public.reconcile_calendar_change(p,c,actor,request); exception when sqlstate '40001' then denied:=true; end;
 if not denied or (select start_at from public.crm_appointments where id=(select id from ga_fixture where key='native')) is distinct from old_time
  or (select status from public.crm_appointments where id=(select id from ga_fixture where key='native')) is distinct from 'cancelled' then raise exception 'Current edited native state was accepted without fresh owner review'; end if;
 request:=pg_temp.ga_command(pg_temp.ga_evidence(true),true); denied:=false;
 begin perform public.reconcile_calendar_change(p,c,actor,request||jsonb_build_object('expectedAppointmentUpdatedAt',now()-interval '1 second')); exception when sqlstate '40001' then denied:=true; end;
 if not denied then raise exception 'Fresh owner acceptance bypassed a stale native CAS'; end if;
 denied:=false;
 begin perform public.reconcile_calendar_change(p,c,(select id from ga_fixture where key='owner-b'),(select data from ga_fixture where key='change-job')); exception when sqlstate '40001' then denied:=true; end;
 if not denied then raise exception 'Historical reconciliation replay accepted another actor'; end if;
 result:=public.reconcile_calendar_change(p,c,actor,request);
 if result->>'state' is distinct from 'source_state_verified' or not exists(select 1 from public.action_jobs where id=j and status='uncertain' and provider_receipt='{"fixture":"uncertain-transport-no-ack"}'::jsonb)
  or (select start_at from public.crm_appointments where id=(select id from ga_fixture where key='native')) is distinct from ((request->'evidence'->'new_slot'->>'start_iso')::timestamptz)
  or (select status from public.crm_appointments where id=(select id from ga_fixture where key='native')) is distinct from 'booked'
  or public.calendar_reconciled_state(p,c,(select id from ga_fixture where key='booking'),(select id from ga_fixture where key='native')) is null
  or exists(select 1 from public.action_jobs where id=(select id from ga_fixture where key='booking-job') and (confirmation_due_at is not null or booking_followup_due_at is not null)) then raise exception 'Fresh source review lost original outcome or automatically renewed old follow-ups'; end if;
end $fresh_review$;

-- Group 8: actual browser roles cannot call privileged RPCs or clear provenance.
do $grants$ declare signature text; begin
 foreach signature in array array['finish_google_permission_upgrade(uuid,text,text,text,text,text[],text[])','record_selected_workspace_check(uuid,uuid,integer,uuid,timestamptz,timestamptz,text,boolean,boolean)','reconcile_calendar_change(uuid,uuid,uuid,jsonb)','calendar_reconciled_state(uuid,uuid,uuid,uuid)'] loop
  if has_function_privilege('anon','public.'||signature,'EXECUTE') or has_function_privilege('authenticated','public.'||signature,'EXECUTE') or not has_function_privilege('service_role','public.'||signature,'EXECUTE') then raise exception 'Google/reconciliation RPC execute grants are incorrect: %',signature; end if;
 end loop;
end $grants$;
reset role;
set local role anon;
select set_config('request.jwt.claim.role','anon',true);
do $anon_denied$ declare denied boolean:=false; begin
 begin perform public.finish_google_permission_upgrade(null,null,null,null,null,null,null); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Anonymous role executed Google permission upgrade'; end if;
 denied:=false; begin perform public.reconcile_calendar_change(null,null,null,'{}'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Anonymous role executed source reconciliation'; end if;
end $anon_denied$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',(select id::text from ga_fixture where key='owner-a'),true);
do $authenticated_denied$ declare denied boolean:=false; begin
 begin perform public.record_selected_workspace_check(null,null,null,null,null,null,null,null,null); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Browser role executed privileged selected-account check'; end if;
 denied:=false; begin perform public.reconcile_calendar_change(null,null,null,'{}'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Browser role executed source reconciliation'; end if;
 denied:=false; begin update public.crm_appointments set calendar_reconciliation_job_id=null where id=(select id from ga_fixture where key='native'); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'Browser role cleared verified source provenance'; end if;
end $authenticated_denied$;
reset role;
rollback;
select '__CUSTOMER_JOURNEY_REPORT__'::text || jsonb_build_object('kind','google_calendar_acceptance','rolledBack',true,'remainingFixtures',
 (select count(*) from public.partners where slug like 'cj-acceptance-__RUN_ID__-google-%')+(select count(*) from auth.users where email like 'cj-acceptance-__RUN_ID__-google-%@synthetic.invalid'),
 'checks',jsonb_build_array('selected_grant_denial_atomicity','grant_preserves_pause_viewonly_modes_revision_once','explicit_activation_scope_and_channel_isolation','selected_paused_inbound_persists_without_queue',
 'reconciliation_absence_scope_review_dedupe','strong_source_proof_preserves_original_outcome_and_replays','fresh_native_acceptance_and_source_cas','actual_privileged_role_and_marker_denial'))::text as cj_report;
