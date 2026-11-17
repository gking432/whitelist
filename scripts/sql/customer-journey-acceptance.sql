-- Executed only by verify-customer-journey-db.mjs after the isolated-target gate.
-- Every assertion below runs against actual functions/RLS in one rolled-back transaction.
-- Synthetic identities have no passwords, sessions, tokens, or provider credentials.
begin;
set local statement_timeout='35s';
set local lock_timeout='5s';
-- __ISOLATION_ASSERTION__
create temporary table cj_fixture(key text primary key,id uuid not null default extensions.gen_random_uuid());
insert into cj_fixture(key) values ('partner-a'),('partner-b'),('client-a'),('client-b'),('owner-a'),('owner-b'),('connection'),('adoption-key'),('approval'),('booking-approval');
grant select,insert,update on cj_fixture to service_role,authenticated,anon;
insert into auth.users(id,email) select id,'cj-acceptance-__RUN_ID__-'||key||'@synthetic.invalid' from cj_fixture where key in ('owner-a','owner-b');
insert into public.profiles(id,email) select id,'cj-acceptance-__RUN_ID__-'||key||'@synthetic.invalid' from cj_fixture where key in ('owner-a','owner-b') on conflict(id) do nothing;
insert into public.partners(id,name,slug) select id,'Synthetic customer journey acceptance '||key,'cj-acceptance-__RUN_ID__-'||key from cj_fixture where key in ('partner-a','partner-b');
insert into public.client_businesses(id,partner_id,name,slug,status,client_portal_enabled,crm_operating_mode,default_runtime_mode,native_lifecycle_enabled_at)
 select id,(select id from cj_fixture where key=case when f.key='client-a' then 'partner-a' else 'partner-b' end),
 'Synthetic customer journey acceptance '||key,'cj-acceptance-__RUN_ID__-'||key,'active',true,'primary_crm','live',now()-interval '1 minute'
 from cj_fixture f where key in ('client-a','client-b');
insert into public.memberships(user_id,partner_id,client_id,role)
 select id,(select id from cj_fixture where key=case when f.key='owner-a' then 'partner-a' else 'partner-b' end),
 (select id from cj_fixture where key=case when f.key='owner-a' then 'client-a' else 'client-b' end),'client_owner'
 from cj_fixture f where key in ('owner-a','owner-b');
insert into public.crm_contacts(partner_id,client_id,first_name,source)
 values((select id from cj_fixture where key='partner-b'),(select id from cj_fixture where key='client-b'),'Synthetic other-business customer','cj_acceptance');
insert into public.business_workspace_profiles(partner_id,client_id,profile)
 values((select id from cj_fixture where key='partner-a'),(select id from cj_fixture where key='client-a'),'{"description":"Synthetic acceptance business","services":"Synthetic consultation","hours":"By explicit availability","policies":"Owner review required"}');
insert into public.agent_team_settings(partner_id,client_id,status,scheduling_enabled,conversations_enabled)
 values((select id from cj_fixture where key='partner-a'),(select id from cj_fixture where key='client-a'),'paused',true,true);
insert into public.business_agent_activation(partner_id,client_id,status,bookings,website,email,sms,workspace_provider)
 values((select id from cj_fixture where key='partner-a'),(select id from cj_fixture where key='client-a'),'active',true,true,true,true,'google_workspace');

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $cj_context$
declare p uuid:=(select id from cj_fixture where key='partner-a'); c uuid:=(select id from cj_fixture where key='client-a');
 actor uuid:=(select id from cj_fixture where key='owner-a'); denied boolean:=false; r integer; profile_time timestamptz; receipt jsonb;
begin
 select authority_revision into r from public.agent_team_settings where client_id=c;
 begin perform public.apply_business_context_command(p,c,actor,jsonb_build_object('action','set_authority','key',extensions.gen_random_uuid(),'expectedRevision',r,'channel','calendar','mode','require_approval'));
 exception when sqlstate '22023' then denied:=true; end;
 if not denied then raise exception 'Unreviewed business context granted calendar authority'; end if;
 select updated_at into profile_time from public.business_workspace_profiles where client_id=c;
 receipt:=public.apply_business_context_command(p,c,actor,jsonb_build_object('action','review_context','key',extensions.gen_random_uuid(),'expectedContextRevision',profile_time));
 if receipt->>'id' is null or not exists(select 1 from public.business_context_reviews where client_id=c and actor_id=actor and profile_revision::timestamptz=profile_time) then raise exception 'Context review has no durable matching receipt'; end if;
 select authority_revision into r from public.agent_team_settings where client_id=c;
 perform public.apply_business_context_command(p,c,actor,jsonb_build_object('action','manager_control','key',extensions.gen_random_uuid(),'expectedRevision',r,'operation','resume'));
 select authority_revision into r from public.agent_team_settings where client_id=c;
 perform public.apply_business_context_command(p,c,actor,jsonb_build_object('action','set_authority','key',extensions.gen_random_uuid(),'expectedRevision',r,'channel','calendar','mode','require_approval'));
 if not public.business_channel_can_draft(p,c,'calendar',null) then raise exception 'Reviewed enabled internal calendar authority unavailable'; end if;
end $cj_context$;

insert into public.integration_connections(id,partner_id,client_id,provider_id,display_name,status,runtime_mode,credential_status,config)
 select (select id from cj_fixture where key='connection'),(select id from cj_fixture where key='partner-a'),(select id from cj_fixture where key='client-a'),id,
 'Synthetic acceptance form','connected','dry_run','configured','{"workspace_view_only":true,"conversation_intake_enabled":false}'
 from public.integration_providers where provider_key='generic_inbound_webhook';
do $cj_import_adoption$
declare p uuid:=(select id from cj_fixture where key='partner-a'); c uuid:=(select id from cj_fixture where key='client-a');
 actor uuid:=(select id from cj_fixture where key='owner-a'); conn uuid:=(select id from cj_fixture where key='connection'); source public.integration_canonical_records;
 facts jsonb:='{"provider":"generic_inbound_webhook","status":"new","title":"Synthetic consultation inquiry","description":"Synthetic source instructions for rollback acceptance.","name":"Synthetic acceptance customer","email":"nobody@synthetic.invalid"}';
 command jsonb; first jsonb; replay jsonb; denied boolean; previous_count integer;
begin
 if not public.persist_owner_import_record(p,c,conn,'lead','cj-acceptance-__RUN_ID__',null,facts,'{}',now(),now(),now(),'cj-acceptance-__RUN_ID__:1') then raise exception 'Initial canonical import was not persisted'; end if;
 if public.persist_owner_import_record(p,c,conn,'lead','cj-acceptance-__RUN_ID__',null,facts,'{}',now(),now(),now(),'cj-acceptance-__RUN_ID__:1') then raise exception 'Duplicate source event was applied twice'; end if;
 select * into source from public.integration_canonical_records where connection_id=conn and external_object_id='cj-acceptance-__RUN_ID__';
 if source.id is null or source.native_object_id is not null then raise exception 'Read-only import adopted or lost the inquiry'; end if;
 command:=jsonb_build_object('action','adopt_intake','key',(select id from cj_fixture where key='adoption-key'),'connectionId',conn,'recordId',source.id,'externalId',source.external_object_id,'expectedUpdatedAt',source.updated_at,'contact',jsonb_build_object('mode','create'));
 first:=public.adopt_owner_intake_record(p,c,actor,command);
 replay:=public.adopt_owner_intake_record(p,c,actor,command);
 if first->>'id' is null or first->>'id' is distinct from replay->>'id' or replay->>'replayed' is distinct from 'true' then raise exception 'Adoption replay did not recover the same receipt'; end if;
 if (select count(*) from public.crm_leads where client_id=c)<>1 or (select count(*) from public.crm_tasks where client_id=c and task_type='intake_review')<>1 then raise exception 'Adoption duplicated shared lead/task'; end if;
 if not exists(select 1 from public.crm_contacts customer where customer.id=(first->>'contactId')::uuid and customer.source='owner_intake_unverified' and 'source_identity_unverified'=any(customer.tags)) then raise exception 'Source identity claims became verified'; end if;
 insert into cj_fixture(key,id) values('adopted-contact',(first->>'contactId')::uuid),('adopted-lead',(first->>'leadId')::uuid),('adopted-task',(first->>'taskId')::uuid),('source',source.id);
 denied:=false;
 begin perform public.adopt_owner_intake_record(p,c,(select id from cj_fixture where key='owner-b'),command); exception when sqlstate '40001' then denied:=true; end;
 if not denied then raise exception 'Receipt replay accepted another actor'; end if;
 denied:=false;
 begin perform public.adopt_owner_intake_record(p,c,actor,command||jsonb_build_object('contact',jsonb_build_object('mode','existing','id',first->>'contactId','expectedUpdatedAt',now()))); exception when sqlstate '40001' then denied:=true; end;
 if not denied then raise exception 'Same request key accepted changed contact choice'; end if;
 denied:=false;
 begin perform public.adopt_owner_intake_record(p,c,actor,command||jsonb_build_object('key',extensions.gen_random_uuid())); exception when sqlstate '40001' then denied:=true; end;
 if not denied then raise exception 'A new key adopted the same source again'; end if;
 perform public.persist_owner_import_record(p,c,conn,'lead','cj-acceptance-__RUN_ID__-stale',null,facts,'{}',now(),now(),now(),'cj-acceptance-__RUN_ID__:2');
 select * into source from public.integration_canonical_records where connection_id=conn and external_object_id='cj-acceptance-__RUN_ID__-stale';
 denied:=false;
 begin perform public.adopt_owner_intake_record(p,c,actor,command||jsonb_build_object('key',extensions.gen_random_uuid(),'recordId',source.id,'externalId',source.external_object_id,'expectedUpdatedAt',source.updated_at-interval '1 second')); exception when sqlstate '40001' then denied:=true; end;
 if not denied or (select native_object_id from public.integration_canonical_records where id=source.id) is not null then raise exception 'Stale source version changed shared work'; end if;
 select count(*) into previous_count from public.crm_contacts where client_id=c;
 denied:=false;
 begin perform public.adopt_owner_intake_record((select id from cj_fixture where key='partner-b'),c,actor,command||jsonb_build_object('key',extensions.gen_random_uuid())); exception when sqlstate '22023' then denied:=true; end;
 if not denied or previous_count<>(select count(*) from public.crm_contacts where client_id=c) then raise exception 'Cross-tenant adoption changed customer records'; end if;
end $cj_import_adoption$;

reset role;
set local role anon;
select set_config('request.jwt.claim.role','anon',true);
select set_config('request.jwt.claim.sub','',true);
do $cj_anon$
declare denied boolean:=false;
begin
 begin perform public.adopt_owner_intake_record(null,null,null,'{}'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Anon directly executed privileged adoption'; end if;
 denied:=false;
 begin perform public.complete_calendar_mutation(null,null,null); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Anon directly executed privileged calendar completion'; end if;
end $cj_anon$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',(select id::text from cj_fixture where key='owner-a'),true);
do $cj_rls$
declare denied boolean:=false; affected integer;
begin
 begin perform public.adopt_owner_intake_record(null,null,null,'{}'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Authenticated role directly executed privileged adoption'; end if;
 denied:=false;
 begin perform public.complete_calendar_mutation(null,null,null); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Authenticated role directly executed privileged calendar completion'; end if;
 if (select count(*) from public.crm_contacts where client_id=(select id from cj_fixture where key='client-a'))<>1 then raise exception 'Owner cannot read own adopted customer'; end if;
 if exists(select 1 from public.crm_contacts where client_id=(select id from cj_fixture where key='client-b')) then raise exception 'RLS exposed another business customer'; end if;
 update public.crm_contacts set first_name='Cross-business forbidden' where client_id=(select id from cj_fixture where key='client-b');
 get diagnostics affected=row_count;
 if affected<>0 then raise exception 'RLS updated another business customer'; end if;
 denied:=false;
 begin insert into public.crm_contacts(partner_id,client_id,first_name) values((select id from cj_fixture where key='partner-b'),(select id from cj_fixture where key='client-b'),'Forbidden'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'RLS inserted another business customer'; end if;
end $cj_rls$;

reset role;
set local role service_role;
do $cj_privileges$
declare signature text;
begin
 foreach signature in array array['apply_business_context_command(uuid,uuid,uuid,jsonb)','adopt_owner_intake_record(uuid,uuid,uuid,jsonb)',
  'progress_owner_intake_inquiry(uuid,uuid,uuid,jsonb)','prepare_booking_lifecycle_followup(uuid,uuid,uuid,uuid,text,jsonb)',
  'apply_booking_lifecycle_command(uuid,uuid,uuid,jsonb)','claim_agent_work(uuid,uuid)',
  'save_calendar_mutation_offer(uuid,uuid,uuid,jsonb)','prepare_calendar_mutation(uuid,uuid,uuid,jsonb)',
  'calendar_mutation_action_check(uuid,uuid,uuid,uuid)','apply_internal_calendar_mutation(uuid,uuid,uuid,uuid)',
  'complete_calendar_mutation(uuid,uuid,uuid)','recover_internal_calendar_mutations(integer)'] loop
  if has_function_privilege('anon','public.'||signature,'EXECUTE') or has_function_privilege('authenticated','public.'||signature,'EXECUTE') or not has_function_privilege('service_role','public.'||signature,'EXECUTE') then raise exception 'Privileged function execute grants are incorrect: %',signature; end if;
 end loop;
end $cj_privileges$;
insert into public.approval_items(id,partner_id,client_id,type,title,editable_content,proposed_payload)
 values((select id from cj_fixture where key='booking-approval'),(select id from cj_fixture where key='partner-a'),(select id from cj_fixture where key='client-a'),'appointment_booking','Synthetic internal booking',null,
 jsonb_build_object('provider','northstar_internal','contact_id',(select id from cj_fixture where key='adopted-contact'),'lead_id',(select id from cj_fixture where key='adopted-lead'),
 'contact',jsonb_build_object('email','nobody@synthetic.invalid','name','Synthetic acceptance customer'),'timezone','America/Chicago',
 'slot',jsonb_build_object('start_iso',(date_trunc('week',now() at time zone 'America/Chicago')+interval '7 days 10 hours') at time zone 'America/Chicago',
 'end_iso',(date_trunc('week',now() at time zone 'America/Chicago')+interval '7 days 11 hours') at time zone 'America/Chicago','label','Synthetic future acceptance slot')));
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from cj_fixture where key='owner-a'),true);
do $cj_resolution$
declare affected integer; denied boolean:=false; a uuid:=(select id from cj_fixture where key='booking-approval');
begin
 update public.approval_items set status='approved',resolved_by=(select id from cj_fixture where key='owner-a') where id=a and status='pending';
 get diagnostics affected=row_count; if affected<>1 then raise exception 'Owner booking resolution did not acquire pending decision'; end if;
 update public.approval_items set status='approved',resolved_by=(select id from cj_fixture where key='owner-a') where id=a and status='pending';
 get diagnostics affected=row_count; if affected<>0 then raise exception 'A second resolution acquired the same decision'; end if;
 begin update public.approval_items set status='rejected',resolved_by=(select id from cj_fixture where key='owner-a') where id=a; exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'Resolved approval was mutable'; end if;
 if (select count(*) from public.action_jobs where approval_id=a)<>1 then raise exception 'Booking approval did not enqueue exactly one action'; end if;
end $cj_resolution$;
reset role;
set local role service_role;
do $cj_claims$
declare p uuid:=(select id from cj_fixture where key='partner-a'); c uuid:=(select id from cj_fixture where key='client-a');
 a uuid:=(select id from cj_fixture where key='booking-approval'); affected integer; work public.agent_work_items;
begin
 update public.action_jobs set status='processing',claim_token=extensions.gen_random_uuid(),claimed_at=now() where approval_id=a and status='pending';
 get diagnostics affected=row_count; if affected<>1 then raise exception 'Pending booking outbox was not acquired exactly once'; end if;
 update public.action_jobs set status='processing',claim_token=extensions.gen_random_uuid(),claimed_at=now() where approval_id=a and status='pending';
 get diagnostics affected=row_count; if affected<>0 then raise exception 'A second worker acquired the claimed booking outbox'; end if;
 insert into public.agent_work_items(partner_id,client_id,kind,agent_key,title,dedupe_key,source_lead_id,input)
 values(p,c,'booking_request','scheduling','Synthetic lease acceptance','cj-acceptance-__RUN_ID__',(select id from cj_fixture where key='adopted-lead'),'{"origin":"owner_intake"}');
 select * into work from public.claim_agent_work(p,c);
 if work.id is null or work.claim_token is null or work.lease_until<=now() or work.status<>'running' then raise exception 'Scheduling assignment has no exclusive live lease'; end if;
 if exists(select 1 from public.claim_agent_work(p,c)) then raise exception 'A second worker acquired the same live assignment'; end if;
end $cj_claims$;
do $cj_internal_booking$
declare a uuid:=(select id from cj_fixture where key='booking-approval'); p uuid:=(select id from cj_fixture where key='partner-a'); c uuid:=(select id from cj_fixture where key='client-a');
 native uuid; again uuid; before_slot timestamptz; clash uuid; denied boolean:=false; slot_time timestamptz;
begin
 native:=public.book_internal_approved_appointment(a); again:=public.book_internal_approved_appointment(a);
 if native is null or native is distinct from again or (select count(*) from public.crm_appointments where approval_id=a)<>1 then raise exception 'Internal booking replay created a duplicate appointment'; end if;
 if not exists(select 1 from public.crm_appointments where id=native and contact_id=(select id from cj_fixture where key='adopted-contact') and lead_id=(select id from cj_fixture where key='adopted-lead')) then raise exception 'Booking lost exact adopted customer/lead identity'; end if;
 select start_at into before_slot from public.crm_appointments where id=native;
 slot_time:=before_slot+interval '1 day';
 insert into public.crm_appointments(partner_id,client_id,contact_id,title,start_at,end_at,status) values(p,c,(select id from cj_fixture where key='adopted-contact'),'Synthetic overlap guard',slot_time,slot_time+interval '1 hour','booked') returning id into clash;
 begin update public.crm_appointments set start_at=slot_time,end_at=slot_time+interval '1 hour' where id=native; exception when exclusion_violation then denied:=true; end;
 if not denied or (select start_at from public.crm_appointments where id=native) is distinct from before_slot then raise exception 'Rejected overlapping time change did not preserve the old slot'; end if;
 delete from public.crm_appointments where id=clash;
 update public.action_jobs set status='succeeded',external_ref=(select external_ref from public.crm_appointments where id=native),receipt_recorded_at=now()
  where approval_id=a and kind='calendar.book';
 insert into cj_fixture(key,id) values('appointment',native);
end $cj_internal_booking$;
reset role;

-- Temporary fixture helpers call the actual public preparation/execution RPCs.
-- They disappear with this transaction; no persistent helper/schema is installed.
create function pg_temp.cj_book_slot(p_start timestamptz) returns uuid language plpgsql security invoker set search_path='' as $cj_book$
declare p uuid:=(select id from pg_temp.cj_fixture where key='partner-a'); c uuid:=(select id from pg_temp.cj_fixture where key='client-a');
 actor uuid:=(select id from pg_temp.cj_fixture where key='owner-a'); proposal uuid; native uuid;
begin
 insert into public.approval_items(partner_id,client_id,type,title,proposed_payload)
 values(p,c,'appointment_booking','Synthetic calendar mutation acceptance',jsonb_build_object('provider','northstar_internal',
  'contact_id',(select id from pg_temp.cj_fixture where key='adopted-contact'),'lead_id',(select id from pg_temp.cj_fixture where key='adopted-lead'),
  'contact',jsonb_build_object('email','nobody@synthetic.invalid','name','Synthetic acceptance customer'),'timezone','America/Chicago',
  'slot',jsonb_build_object('start_iso',p_start,'end_iso',p_start+interval '1 hour','label','Synthetic separate fixture slot'))) returning id into proposal;
 update public.approval_items set status='approved',resolved_by=actor where id=proposal and status='pending';
 native:=public.book_internal_approved_appointment(proposal);
 update public.action_jobs set status='succeeded',external_ref=(select external_ref from public.crm_appointments where id=native),receipt_recorded_at=now()
  where approval_id=proposal and kind='calendar.book';
 return proposal;
end $cj_book$;
create function pg_temp.cj_prepare_change(p_booking uuid,p_new_start timestamptz default null) returns jsonb language plpgsql security invoker set search_path='' as $cj_change$
declare p uuid:=(select id from pg_temp.cj_fixture where key='partner-a'); c uuid:=(select id from pg_temp.cj_fixture where key='client-a');
 actor uuid:=(select id from pg_temp.cj_fixture where key='owner-a'); native public.crm_appointments; original public.action_jobs; customer public.crm_contacts;
 payload jsonb; owner_request jsonb; selected jsonb; offer_id uuid; revision text; authority integer; returned_offer uuid; denied boolean; result jsonb; replay jsonb;
begin
 select * into native from public.crm_appointments where approval_id=p_booking and partner_id=p and client_id=c;
 select * into original from public.action_jobs where approval_id=p_booking and partner_id=p and client_id=c and kind='calendar.book' and status='succeeded';
 select * into customer from public.crm_contacts where id=native.contact_id and partner_id=p and client_id=c;
 select authority_revision into authority from public.agent_team_settings where partner_id=p and client_id=c;
 payload:=jsonb_build_object('calendar_mutation_version',1,'mutation','cancel','booking_approval_id',p_booking,'booking_action_job_id',original.id,
  'appointment_id',native.id,'appointment_updated_at',native.updated_at,'contact_id',customer.id,'contact_updated_at',customer.updated_at,
  'provider','northstar_internal','calendar_connection_id',null,'calendar_account_id',null,'calendar_id',null,'external_ref',native.external_ref,
  'source_record_id',null,'source_updated_at',native.updated_at,'source_etag',null,'old_slot',jsonb_build_object('start_iso',native.start_at,'end_iso',native.end_at),
  'authority_revision',authority,'customer_activity_id',null,'customer_activity_at',null,'conversation_id',null,'conversation_revision',null);
 revision:='synthetic-current-pins:'||md5(payload::text);
 owner_request:=jsonb_build_object('action',case when p_new_start is null then 'prepare_cancellation' else 'prepare_time_change' end,
  'key',extensions.gen_random_uuid(),'targetId',p_booking,'expectedRevision',revision);
 if p_new_start is not null then
  selected:=jsonb_build_object('start_iso',p_new_start,'end_iso',p_new_start+(native.end_at-native.start_at),'label','Synthetic known-free replacement slot');
  offer_id:=extensions.gen_random_uuid();
  returned_offer:=public.save_calendar_mutation_offer(p,c,actor,jsonb_build_object('id',offer_id,'bookingApprovalId',p_booking,'revision',revision,
   'expiresAt',now()+interval '14 minutes','slots',jsonb_build_array(selected),'payload',payload));
  if returned_offer is distinct from offer_id then raise exception 'Real actor/source-bound calendar offer was not persisted'; end if;
  owner_request:=owner_request||jsonb_build_object('offerId',offer_id,'slot',selected);
  payload:=payload||jsonb_build_object('mutation','reschedule','new_slot',selected-'label');
  denied:=false;
  begin perform public.prepare_calendar_mutation(p,c,(select id from pg_temp.cj_fixture where key='owner-b'),owner_request||jsonb_build_object('payload',payload,'owner_request',owner_request)); exception when sqlstate '40001' then denied:=true; end;
  if not denied then raise exception 'Another actor consumed an owner-bound replacement offer'; end if;
 end if;
 result:=public.prepare_calendar_mutation(p,c,actor,owner_request||jsonb_build_object('payload',payload,'owner_request',owner_request));
 replay:=public.prepare_calendar_mutation(p,c,actor,owner_request||jsonb_build_object('payload',payload,'owner_request',owner_request));
 if result->>'id' is null or replay->>'id' is distinct from result->>'id' or replay->>'approvalId' is distinct from result->>'approvalId' or replay->>'replayed' is distinct from 'true' then raise exception 'Calendar proposal replay did not recover exactly one durable approval'; end if;
 return result;
end $cj_change$;
grant execute on function pg_temp.cj_book_slot(timestamptz),pg_temp.cj_prepare_change(uuid,timestamptz) to service_role;
set local role service_role;
do $cj_verified_reschedule$
declare p uuid:=(select id from cj_fixture where key='partner-a'); c uuid:=(select id from cj_fixture where key='client-a');
 actor uuid:=(select id from cj_fixture where key='owner-a'); booking uuid:=(select id from cj_fixture where key='booking-approval');
 native_id uuid:=(select id from cj_fixture where key='appointment'); before_time timestamptz; selected_time timestamptz; prepared jsonb; approval uuid; change_job public.action_jobs;
 applied jsonb; replay jsonb; completed jsonb; before_due timestamptz; old_booking_payload jsonb; recovered integer;
begin
 select start_at into before_time from public.crm_appointments where id=native_id;
 selected_time:=before_time+interval '1 day';
 select proposed_payload into old_booking_payload from public.approval_items where id=booking;
 prepared:=pg_temp.cj_prepare_change(booking,selected_time); approval:=(prepared->>'approvalId')::uuid;
 if approval is null or prepared->>'bookingApprovalId' is distinct from booking::text then raise exception 'Time-change proposal has no durable linked approval'; end if;
 if (select start_at from public.crm_appointments where id=native_id) is distinct from before_time then raise exception 'Preparing an owner proposal changed the appointment'; end if;
 update public.approval_items set status='approved',resolved_by=actor where id=approval and status='pending';
 select * into change_job from public.action_jobs where approval_id=approval and partner_id=p and client_id=c;
 if change_job.kind is distinct from 'calendar.reschedule' or change_job.status is distinct from 'pending' then raise exception 'Approved time change has no exactly typed durable outbox'; end if;
 update public.action_jobs set status='processing',claim_token=extensions.gen_random_uuid(),claimed_at=now() where id=change_job.id and status='pending';
 applied:=public.apply_internal_calendar_mutation(p,c,approval,change_job.id);
 if applied->>'state' is distinct from 'succeeded' or applied->'receipt'->>'http_status' is distinct from '0' then raise exception 'Internal time change has no transactional native receipt'; end if;
 if public.calendar_mutation_receipt_valid((select proposed_payload from public.approval_items where id=approval),(applied->'receipt')-'old_slot') is distinct from false then raise exception 'Calendar receipt validator accepted missing original slot proof'; end if;
 if not exists(select 1 from public.crm_appointments where id=native_id and start_at=selected_time and calendar_state_job_id=change_job.id)
  or not exists(select 1 from public.action_jobs where id=change_job.id and status='processing' and provider_receipt=applied->'receipt') then raise exception 'Native time change and saved receipt were not atomic'; end if;
 replay:=public.apply_internal_calendar_mutation(p,c,approval,change_job.id);
 if replay->'receipt' is distinct from applied->'receipt' then raise exception 'Interrupted internal execution did not recover its exact receipt'; end if;
 completed:=public.complete_calendar_mutation(p,c,change_job.id);
 if completed->>'state' is distinct from 'blocked' then raise exception 'Processing calendar job was presented as a durable succeeded completion'; end if;
 update public.action_jobs set claimed_at=now()-interval '11 minutes' where id=change_job.id and status='processing';
 recovered:=public.recover_internal_calendar_mutations(10);
 if coalesce(recovered,0)<1 or not exists(select 1 from public.action_jobs where id=change_job.id and status='succeeded' and provider_receipt=applied->'receipt') then raise exception 'Restart recovery lost or repeated the committed internal calendar result'; end if;
 completed:=public.complete_calendar_mutation(p,c,change_job.id);
 if completed->>'state' is distinct from 'completed' or completed->>'jobId' is distinct from change_job.id::text or completed->>'appointmentId' is distinct from native_id::text then raise exception 'Durable calendar completion lost exact receipt/native correlation'; end if;
 select booking_followup_due_at into before_due from public.action_jobs where approval_id=booking and kind='calendar.book';
 replay:=public.complete_calendar_mutation(p,c,change_job.id);
 if replay->>'state' is distinct from 'completed' or replay->>'replayed' is distinct from 'true'
  or before_due is distinct from (select booking_followup_due_at from public.action_jobs where approval_id=booking and kind='calendar.book') then raise exception 'Completion replay renewed the reminder or lost saved state'; end if;
 if (select proposed_payload from public.approval_items where id=booking) is distinct from old_booking_payload
  or (select count(*) from public.crm_appointments where approval_id=booking)<>1 then raise exception 'A time change rewrote original approval history or created another booking'; end if;
 insert into cj_fixture(key,id) values('reschedule-job',change_job.id);
end $cj_verified_reschedule$;
do $cj_cancel_and_overlap$
declare p uuid:=(select id from cj_fixture where key='partner-a'); c uuid:=(select id from cj_fixture where key='client-a'); actor uuid:=(select id from cj_fixture where key='owner-a');
 monday timestamptz:=(date_trunc('week',now() at time zone 'America/Chicago')+interval '7 days 10 hours') at time zone 'America/Chicago';
 booking uuid; native_id uuid; prepared jsonb; approval uuid; job_id uuid; applied jsonb; completed jsonb; clash uuid; old_start timestamptz;
begin
 booking:=pg_temp.cj_book_slot(monday+interval '2 days');
 select id into native_id from public.crm_appointments where approval_id=booking;
 prepared:=pg_temp.cj_prepare_change(booking); approval:=(prepared->>'approvalId')::uuid;
 if (select status from public.crm_appointments where id=native_id) is distinct from 'booked' then raise exception 'A cancellation proposal cancelled the appointment before approval'; end if;
 update public.approval_items set status='approved',resolved_by=actor where id=approval and status='pending';
 select id into job_id from public.action_jobs where approval_id=approval and kind='calendar.cancel';
 update public.action_jobs set status='processing',claim_token=extensions.gen_random_uuid(),claimed_at=now() where id=job_id and status='pending';
 applied:=public.apply_internal_calendar_mutation(p,c,approval,job_id);
 if applied->>'state' is distinct from 'succeeded' or applied->'receipt'->>'operation' is distinct from 'cancel'
  or applied->'receipt'->>'http_status' is distinct from '0' or applied->'receipt'->>'verified_absent' is distinct from 'false' then raise exception 'Internal cancellation claimed an external deletion or lacks its native receipt'; end if;
 update public.action_jobs set status='succeeded',calendar_reconcile_due_at=now() where id=job_id and status='processing';
 completed:=public.complete_calendar_mutation(p,c,job_id);
 if completed->>'state' is distinct from 'completed' or not exists(select 1 from public.crm_appointments where id=native_id and status='cancelled' and calendar_state_job_id=job_id)
  or not exists(select 1 from public.action_jobs where approval_id=booking and kind='calendar.book' and status='succeeded' and booking_followup_phase='stopped') then raise exception 'Verified cancellation lost native state, original success, or old follow-up stop'; end if;
 booking:=pg_temp.cj_book_slot(monday+interval '3 days'); old_start:=monday+interval '3 days';
 select id into native_id from public.crm_appointments where approval_id=booking;
 prepared:=pg_temp.cj_prepare_change(booking,monday+interval '4 days'); approval:=(prepared->>'approvalId')::uuid;
 update public.approval_items set status='approved',resolved_by=actor where id=approval and status='pending';
 select id into job_id from public.action_jobs where approval_id=approval and kind='calendar.reschedule';
 insert into public.crm_appointments(partner_id,client_id,contact_id,title,start_at,end_at,status)
 values(p,c,(select id from cj_fixture where key='adopted-contact'),'Synthetic slot occupied after offer',monday+interval '4 days',monday+interval '4 days 1 hour','booked') returning id into clash;
 update public.action_jobs set status='processing',claim_token=extensions.gen_random_uuid(),claimed_at=now() where id=job_id and status='pending';
 applied:=public.apply_internal_calendar_mutation(p,c,approval,job_id);
 if applied->>'state' is distinct from 'blocked' or (select start_at from public.crm_appointments where id=native_id) is distinct from old_start
  or (select provider_receipt from public.action_jobs where id=job_id) is not null then raise exception 'Late overlap failed to preserve the original appointment and empty provider outcome'; end if;
end $cj_cancel_and_overlap$;
do $cj_corrupt_receipt_review$
declare p uuid:=(select id from cj_fixture where key='partner-a'); c uuid:=(select id from cj_fixture where key='client-a'); job_id uuid:=(select id from cj_fixture where key='reschedule-job');
 completed jsonb; again jsonb; old_slot timestamptz;
begin
 select start_at into old_slot from public.crm_appointments where calendar_state_job_id=job_id;
 update public.action_jobs set provider_receipt='{}'::jsonb where id=job_id and status='succeeded';
 completed:=public.complete_calendar_mutation(p,c,job_id);
 again:=public.complete_calendar_mutation(p,c,job_id);
 if completed->>'state' is distinct from 'review' or completed->>'taskId' is null or completed->>'taskId' is distinct from again->>'taskId'
  or (select count(*) from public.crm_tasks where calendar_action_job_id=job_id and task_type='calendar_change_reconciliation')<>1 then raise exception 'Invalid durable proof was accepted as completed or duplicated review work'; end if;
 if not exists(select 1 from public.action_jobs where id=job_id and status='succeeded')
  or old_slot is distinct from (select start_at from public.crm_appointments where calendar_state_job_id=job_id) then raise exception 'Local review rewrote the succeeded provider outcome or current appointment'; end if;
end $cj_corrupt_receipt_review$;
do $cj_received_evidence$
declare p uuid:=(select id from cj_fixture where key='partner-a'); c uuid:=(select id from cj_fixture where key='client-a');
 customer uuid:=(select id from cj_fixture where key='adopted-contact'); other_customer uuid; communication uuid; conversation uuid; message_id uuid; denied boolean;
begin
 insert into public.crm_contacts(partner_id,client_id,first_name,source) values(p,c,'Synthetic explicit identity selection','cj_acceptance') returning id into other_customer;
 insert into public.crm_communications(partner_id,client_id,contact_id,channel,direction,status,body)
 values(p,c,customer,'email','inbound','received','Synthetic original received customer instructions') returning id into communication;
 denied:=false;
 begin update public.crm_communications set body='Synthetic edited received instructions' where id=communication; exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'Received CRM instruction body was mutable'; end if;
 denied:=false;
 begin update public.crm_communications set status='cancelled' where id=communication; exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'Received CRM instruction status was mutable'; end if;
 update public.crm_communications set contact_id=other_customer where id=communication;
 if not exists(select 1 from public.crm_communications where id=communication and contact_id=other_customer and body='Synthetic original received customer instructions' and status='received') then raise exception 'Safe explicit CRM identity linking was blocked or rewrote instructions'; end if;
 insert into public.business_conversations(partner_id,client_id,connection_id,channel,external_thread_id,contact_id)
 values(p,c,(select id from cj_fixture where key='connection'),'email','cj-acceptance-__RUN_ID__-thread',customer) returning id into conversation;
 insert into public.business_conversation_messages(partner_id,client_id,conversation_id,external_key,direction,status,body)
 values(p,c,conversation,'cj-acceptance-__RUN_ID__-message','inbound','received','Synthetic original shared conversation instructions') returning id into message_id;
 denied:=false;
 begin update public.business_conversation_messages set body='Synthetic edited thread instructions' where id=message_id; exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'Received shared conversation body was mutable'; end if;
 denied:=false;
 begin update public.business_conversation_messages set status='draft' where id=message_id; exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'Received shared conversation status was mutable'; end if;
 update public.business_conversations set contact_id=other_customer,identity_status='owner_verified' where id=conversation;
 if not exists(select 1 from public.business_conversations where id=conversation and contact_id=other_customer and identity_status='owner_verified')
  or not exists(select 1 from public.business_conversation_messages where id=message_id and body='Synthetic original shared conversation instructions' and status='received') then raise exception 'Safe conversation identity linking was blocked or rewrote received evidence'; end if;
end $cj_received_evidence$;
reset role;
rollback;
select '__CUSTOMER_JOURNEY_REPORT__'::text || jsonb_build_object('kind','acceptance','rolledBack',true,
 'remainingFixtures',(select count(*) from public.partners where slug like 'cj-acceptance-__RUN_ID__-%')+(select count(*) from auth.users where email like 'cj-acceptance-__RUN_ID__-%@synthetic.invalid'),
 'checks',jsonb_build_array('context_authority','canonical_import_dedupe','adoption_replay_identity_and_cas','actual_rpc_role_denial','cross_business_rls','privileged_execute_grants','approval_outbox_resolution','outbox_claim_cas_and_assignment_lease','internal_booking_replay','overlap_preserves_old_slot',
 'actor_bound_offer_and_change_approval','internal_reschedule_atomic_receipt_and_restart','internal_cancellation_stops_followups','late_overlap_preserves_old_appointment','invalid_completion_receipt_creates_one_review','received_instruction_immutability_and_identity_linking')) as cj_report;
