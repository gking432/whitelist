import { execFileSync } from "node:child_process";

// Synthetic fixtures in a rollback transaction on the isolated local schema.
// Never reads environment files or calls a model/calendar/telephone provider.
const sql = `
begin;
create temporary table voice_fixture(key text primary key,id uuid default extensions.gen_random_uuid());
insert into voice_fixture(key) values('partner'),('client'),('owner'),('call-a'),('call-b'),('approval-a'),('approval-b'),('approval-wrong');
grant select on voice_fixture to authenticated,service_role;
insert into auth.users(id,email) select id,'voice-beta@synthetic.invalid' from voice_fixture where key='owner';
insert into public.partners(id,name,slug) select id,'Synthetic voice partner','voice-'||id from voice_fixture where key='partner';
insert into public.client_businesses(id,partner_id,name,slug,client_portal_enabled,crm_operating_mode,timezone,is_test_account,status,default_runtime_mode)
select id,(select id from voice_fixture where key='partner'),'Synthetic voice business','voice-'||id,true,'primary_crm','UTC',true,'active','live' from voice_fixture where key='client';
insert into public.memberships(user_id,partner_id,client_id,role)
values((select id from voice_fixture where key='owner'),(select id from voice_fixture where key='partner'),(select id from voice_fixture where key='client'),'client_owner');
insert into public.call_sessions(id,partner_id,client_id,status)
select id,(select id from voice_fixture where key='partner'),(select id from voice_fixture where key='client'),'in_progress' from voice_fixture where key in('call-a','call-b');
insert into public.approval_items(id,partner_id,client_id,type,title,editable_content,proposed_payload)
select id,(select id from voice_fixture where key='partner'),(select id from voice_fixture where key='client'),'appointment_booking','Synthetic appointment','Approve this synthetic appointment',
 jsonb_build_object('provider',case when f.key='approval-wrong' then 'google_calendar' else 'northstar_internal' end,
 'call_session_id',(select id from voice_fixture where key=case when f.key='approval-a' then 'call-a' else 'call-b' end),
 'slot',jsonb_build_object('start_iso',date_trunc('day',now())+interval '7 days 9 hours','end_iso',date_trunc('day',now())+interval '7 days 9 hours 30 minutes'))
from voice_fixture f where key in('approval-a','approval-b');
do $$ declare blocked boolean:=false; begin
 begin insert into public.approval_items(partner_id,client_id,type,title,proposed_payload)
 select partner_id,client_id,type,'Duplicate same caller',proposed_payload from public.approval_items where id=(select id from voice_fixture where key='approval-a'); exception when unique_violation then blocked:=true; end;
 if not blocked then raise exception 'Same-call pending booking duplicated'; end if;
 if (select count(*) from public.approval_items where client_id=(select id from voice_fixture where key='client'))<>2 then raise exception 'Distinct callers incorrectly deduplicated'; end if;
end $$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare s uuid:=(select id from voice_fixture where key='call-a'); token uuid; blocked boolean:=false; begin
 if not public.append_voice_transcript(s,'caller','Synthetic first turn',now(),'event-a') then raise exception 'First transcript missing'; end if;
 if public.append_voice_transcript(s,'caller','Synthetic repeated turn',now(),'event-a') then raise exception 'Transcript duplicate accepted'; end if;
 perform public.append_voice_transcript(s,'ai_assistant','Synthetic second turn',now(),'event-b');
 if (select array_agg(seq order by seq) from public.call_transcript_turns where call_session_id=s)<>array[1,2] then raise exception 'Transcript ordering failed'; end if;
 perform public.merge_voice_session_extracted(s,'{"first":true}');
 perform public.merge_voice_session_extracted(s,'{"second":true}');
 if not (select extracted @> '{"first":true,"second":true}' from public.call_sessions where id=s) then raise exception 'Extracted state lost'; end if;
 token:=public.claim_staff_voice_analysis(s);
 if token is null or public.claim_staff_voice_analysis(s) is not null then raise exception 'Staff analysis claim duplicated'; end if;
 perform public.enqueue_voice_finalization(s,90);
 perform public.enqueue_voice_finalization(s,10);
 if (select count(*) from public.voice_finalization_jobs where call_session_id=s)<>1 then raise exception 'Finalization job duplicated'; end if;
 update public.voice_finalization_jobs set available_at=now()-interval '1 second' where call_session_id=s;
 if not exists(select 1 from public.claim_voice_finalization_jobs(25) where call_session_id=s) then raise exception 'Finalization claim missing'; end if;
 if exists(select 1 from public.claim_voice_finalization_jobs(25) where call_session_id=s) then raise exception 'Finalization claimed twice'; end if;
 perform public.finish_voice_call(s,'Synthetic summary','Synthetic note','{}','completed');
 perform public.finish_voice_call(s,'Repeated summary','Repeated note','{}','completed');
 if public.append_voice_transcript(s,'caller','Synthetic first turn',now(),'event-a') then raise exception 'Finalized transcript duplicate accepted'; end if;
 if (select count(*) from public.assistant_events where call_session_id=s and event_type='call_completed')<>1 then raise exception 'Completion event duplicated'; end if;
 begin perform public.append_voice_transcript(s,'caller','Late synthetic turn',now(),'late'); exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'Finalized transcript modified'; end if;
 blocked:=false;
 begin perform public.book_internal_approved_appointment((select id from voice_fixture where key='approval-a')); exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'Pending booking executed'; end if;
end $$;
reset role;
-- A distinct provider proposal may share a caller after the first is resolved.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',(select id::text from voice_fixture where key='owner'),true);
update public.approval_items set status='approved',resolved_by=auth.uid() where id in(select id from voice_fixture where key in('approval-a','approval-b'));
reset role;
insert into public.approval_items(id,partner_id,client_id,type,title,proposed_payload)
select (select id from voice_fixture where key='approval-wrong'),partner_id,client_id,type,'Wrong provider',proposed_payload||'{"provider":"google_calendar"}' from public.approval_items where id=(select id from voice_fixture where key='approval-b');
set local role authenticated;
update public.approval_items set status='approved',resolved_by=auth.uid() where id=(select id from voice_fixture where key='approval-wrong');
reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare a uuid:=(select id from voice_fixture where key='approval-a'); booked uuid; repeated uuid; blocked boolean:=false; begin
 booked:=public.book_internal_approved_appointment(a);
 repeated:=public.book_internal_approved_appointment(a);
 if booked is null or repeated<>booked then raise exception 'Internal booking not idempotent'; end if;
 if (select count(*) from public.crm_appointments where approval_id=a)<>1 then raise exception 'Internal booking duplicated'; end if;
 begin perform public.book_internal_approved_appointment((select id from voice_fixture where key='approval-b')); exception when exclusion_violation then blocked:=true; end;
 if not blocked then raise exception 'Approved overlapping appointment accepted'; end if;
 blocked:=false;
 begin perform public.book_internal_approved_appointment((select id from voice_fixture where key='approval-wrong')); exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'Wrong provider booked internally'; end if;
 blocked:=false;
 begin insert into public.crm_appointments(partner_id,client_id,title,start_at,end_at,status)
 select partner_id,client_id,'Direct overlapping edit',start_at+interval '5 minutes',end_at+interval '5 minutes','booked' from public.crm_appointments where id=booked;
 exception when exclusion_violation then blocked:=true; end;
 if not blocked then raise exception 'Direct overlapping appointment accepted'; end if;
 insert into public.crm_appointments(partner_id,client_id,title,start_at,end_at,status)
 select partner_id,client_id,'Adjacent synthetic appointment',end_at,end_at+interval '30 minutes','booked' from public.crm_appointments where id=booked;
end $$;
reset role;
do $$ declare signature text; begin
 foreach signature in array array['enqueue_voice_finalization(uuid,integer)','claim_voice_finalization_jobs(integer)','merge_voice_session_extracted(uuid,jsonb)','append_voice_transcript(uuid,text,text,timestamptz,text)','claim_staff_voice_analysis(uuid)','finish_voice_call(uuid,text,text,jsonb,text)','book_internal_approved_appointment(uuid)','guard_internal_calendar_overlap()'] loop
 if has_function_privilege('anon','public.'||signature,'execute') or has_function_privilege('authenticated','public.'||signature,'execute') then raise exception 'Public privileged voice/calendar RPC: %',signature; end if;
 end loop;
 if has_table_privilege('anon','public.voice_usage_events','select') or has_table_privilege('authenticated','public.voice_usage_events','select') then raise exception 'Raw voice usage table publicly exposed'; end if;
end $$;
-- Native lifecycle producer: explicit opt-in, live selected workflows and no
-- historical outreach. Aging a synthetic sent quote is confined to this rollback.
insert into public.crm_contacts(partner_id,client_id,first_name,email)
values((select id from voice_fixture where key='partner'),(select id from voice_fixture where key='client'),'Lifecycle fixture','lifecycle@synthetic.invalid');
insert into public.workflow_templates(template_key,name,category,trigger_events)
values('appointment_reminder','Synthetic reminder','test',array['appointment.reminder_due']),
('estimate_follow_up','Synthetic estimate follow up','test',array['estimate.follow_up_due']),
('review_request','Synthetic review request','test',array['job.completed']) on conflict(template_key) do nothing;
insert into public.client_workflow_instances(partner_id,client_id,template_id,name,status,runtime_mode)
select (select id from voice_fixture where key='partner'),(select id from voice_fixture where key='client'),id,name,'active','live'
from public.workflow_templates where template_key in('appointment_reminder','estimate_follow_up','review_request');
insert into public.crm_appointments(partner_id,client_id,contact_id,title,start_at,end_at,status,created_at)
select partner_id,client_id,id,'Lifecycle reminder',now()+interval '12 hours',now()+interval '12 hours 30 minutes','booked',now() from public.crm_contacts where client_id=(select id from voice_fixture where key='client');
insert into public.crm_appointments(partner_id,client_id,contact_id,title,start_at,end_at,status,created_at)
select partner_id,client_id,id,'Historical fixture',now()+interval '13 hours',now()+interval '13 hours 30 minutes','booked',now()-interval '10 days' from public.crm_contacts where client_id=(select id from voice_fixture where key='client');
insert into public.crm_appointments(partner_id,client_id,contact_id,title,start_at,end_at,status)
select partner_id,client_id,id,'Completed fixture',now()-interval '2 hours',now()-interval '1 hour','completed' from public.crm_contacts where client_id=(select id from voice_fixture where key='client');
insert into public.crm_quotes(partner_id,client_id,contact_id,service_type,status)
select partner_id,client_id,id,'Synthetic estimate','sent' from public.crm_contacts where client_id=(select id from voice_fixture where key='client');
do $$ begin
 if exists(select 1 from public.native_crm_lifecycle_candidates(50) where client_id=(select id from voice_fixture where key='client')) then raise exception 'Lifecycle ran without opt-in'; end if;
 if not exists(select 1 from public.crm_quotes where client_id=(select id from voice_fixture where key='client') and lifecycle_sent_at=now()) then raise exception 'Quote sent timestamp missing'; end if;
end $$;
alter table public.client_businesses disable trigger guard_native_lifecycle_opt_in;
update public.client_businesses set native_lifecycle_enabled_at=now()-interval '5 days' where id=(select id from voice_fixture where key='client');
alter table public.client_businesses enable trigger guard_native_lifecycle_opt_in;
alter table public.crm_quotes disable trigger stamp_native_quote_lifecycle;
update public.crm_quotes set lifecycle_sent_at=now()-interval '4 days' where client_id=(select id from voice_fixture where key='client');
alter table public.crm_quotes enable trigger stamp_native_quote_lifecycle;
do $$ begin
 if (select count(*) from public.native_crm_lifecycle_candidates(50) where client_id=(select id from voice_fixture where key='client'))<>3 then raise exception 'Native lifecycle due count wrong or history backfilled'; end if;
 if (select count(distinct event_type) from public.native_crm_lifecycle_candidates(50) where client_id=(select id from voice_fixture where key='client'))<>3 then raise exception 'Native lifecycle type missing'; end if;
end $$;
update public.client_workflow_instances set status='paused' where client_id=(select id from voice_fixture where key='client');
do $$ begin
 if exists(select 1 from public.native_crm_lifecycle_candidates(50) where client_id=(select id from voice_fixture where key='client')) then raise exception 'Paused workflows produced lifecycle events'; end if;
end $$;
update public.client_workflow_instances set status='active' where client_id=(select id from voice_fixture where key='client');
insert into public.integration_events(partner_id,client_id,connection_id,direction,event_type,status,idempotency_key)
select partner_id,client_id,null,'inbound',event_type,'received',idempotency_key from public.native_crm_lifecycle_candidates(50) where client_id=(select id from voice_fixture where key='client');
do $$ begin
 if exists(select 1 from public.native_crm_lifecycle_candidates(50) where client_id=(select id from voice_fixture where key='client')) then raise exception 'Native lifecycle event re-produced'; end if;
 if has_function_privilege('anon','public.native_crm_lifecycle_candidates(integer)','execute') or has_function_privilege('authenticated','public.native_crm_lifecycle_candidates(integer)','execute') then raise exception 'Public native lifecycle RPC'; end if;
end $$;
rollback;
`;
try {
  execFileSync("docker", ["exec", "-i", "supabase_db_partner-platform", "psql", "-U", "supabase_admin", "-d", "beta_security_test", "-v", "ON_ERROR_STOP=1"], {
    input: sql, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024,
  });
  console.log("PASS: synthetic voice, calendar, native CRM lifecycle and service-only RPC regressions (rolled back).");
} catch (error) {
  console.error(error.stderr?.toString() ?? error.message);
  process.exitCode = 1;
}
