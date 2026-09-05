import { execFileSync } from "node:child_process";

// Deliberately targets only the disposable local database; never reads .env.
const sql = `
begin;
create temporary table fixture (key text primary key, id uuid default extensions.gen_random_uuid());
insert into fixture(key) values ('partner'),('other-partner'),('client'),('sibling'),('other-client'),('partner-user'),('owner'),('viewer'),('manager'),('sibling-user'),('provider'),('connection'),('other-connection'),('secret'),('enrollment-owner');
grant select on fixture to authenticated, service_role;
insert into auth.users(id,email) select id,key||'@beta-test.invalid' from fixture where key in ('partner-user','owner','viewer','manager','sibling-user','enrollment-owner');
insert into public.partners(id,name,slug) select id,key,key||'-'||id from fixture where key in ('partner','other-partner');
insert into public.client_businesses(id,partner_id,name,slug,client_portal_enabled)
select id,(select id from fixture where key=case when f.key='other-client' then 'other-partner' else 'partner' end),key,key,true from fixture f where key in ('client','sibling','other-client');
insert into public.memberships(user_id,partner_id,client_id,role,client_permissions)
select id,(select id from fixture where key='partner'),
 case when f.key='partner-user' then null when f.key='sibling-user' then (select id from fixture where key='sibling') else (select id from fixture where key='client') end,
 case f.key when 'partner-user' then 'partner_owner' when 'owner' then 'client_owner' when 'manager' then 'client_manager' else 'client_viewer' end::public.membership_role,
 case when f.key='manager' then '{"sections":["contacts"],"edit_crm_data":false,"resolve_approvals":false}'::jsonb else '{}'::jsonb end
from fixture f where key in ('partner-user','owner','viewer','manager','sibling-user');
insert into public.crm_contacts(partner_id,client_id,first_name) values ((select id from fixture where key='partner'),(select id from fixture where key='client'),'Synthetic customer');
insert into public.integration_providers(id,provider_key,display_name,category) values ((select id from fixture where key='provider'),'beta-test','Beta test','test');
insert into public.integration_connections(id,partner_id,client_id,provider_id,display_name)
select id,(select id from fixture where key=case when f.key='connection' then 'partner' else 'other-partner' end),(select id from fixture where key=case when f.key='connection' then 'client' else 'other-client' end),(select id from fixture where key='provider'),'Synthetic connection' from fixture f where key in ('connection','other-connection');
insert into public.integration_secrets(id,partner_id,client_id,connection_id,secret_kind,encrypted_value)
values((select id from fixture where key='secret'),(select id from fixture where key='partner'),(select id from fixture where key='client'),(select id from fixture where key='connection'),'provider_credentials','synthetic-not-a-credential');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',(select id::text from fixture where key='partner-user'),true);
do $$ declare blocked boolean := false; begin
  begin update public.profiles set email='victim@beta-test.invalid' where id=auth.uid(); exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'Mutable profile email'; end if;
  blocked:=false;
  begin insert into public.memberships(user_id,partner_id,client_id,role) values(auth.uid(),(select id from fixture where key='partner'),(select id from fixture where key='client'),'client_owner'); exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'Partner self-granted client ownership'; end if;
  blocked:=false;
  begin update public.client_businesses set is_test_account=true where id=(select id from fixture where key='client'); exception when raise_exception then blocked:=true; end;
  if not blocked then raise exception 'Partner changed sandbox classification'; end if;
  blocked:=false;
  begin update public.client_businesses set native_lifecycle_enabled_at=now() where id=(select id from fixture where key='client'); exception when raise_exception then blocked:=true; end;
  if not blocked then raise exception 'Partner enabled client native lifecycle without business authority'; end if;
  blocked:=false;
  begin update public.integration_secrets set connection_id=(select id from fixture where key='other-connection') where id=(select id from fixture where key='secret'); exception when foreign_key_violation then blocked:=true; end;
  if not blocked then raise exception 'Secret crossed tenant boundary'; end if;
end $$;
select set_config('request.jwt.claim.sub',(select id::text from fixture where key='viewer'),true);
do $$ begin
 if exists(select 1 from public.crm_contacts) then raise exception 'Viewer read contacts'; end if;
 if exists(select 1 from public.profiles where id=(select id from fixture where key='sibling-user')) then raise exception 'Sibling profile leaked'; end if;
end $$;
select set_config('request.jwt.claim.sub',(select id::text from fixture where key='manager'),true);
do $$ declare n integer; begin
 if not exists(select 1 from public.crm_contacts) then raise exception 'Allowed contacts were hidden'; end if;
 update public.crm_contacts set first_name='Unauthorized'; get diagnostics n=row_count;
 if n<>0 then raise exception 'Manager overrode denied edit permission'; end if;
 if public.current_user_client_permission((select id from fixture where key='client'),'resolve_approvals') then raise exception 'Manager overrode approval permission'; end if;
end $$;
select set_config('request.jwt.claim.sub',(select id::text from fixture where key='owner'),true);
do $$ declare n integer; begin
 update public.crm_contacts set first_name='Authorized owner edit'; get diagnostics n=row_count;
 if n<>1 then raise exception 'Owner edit was blocked'; end if;
end $$;
reset role;
insert into public.approval_items(partner_id,client_id,type,title,editable_content,proposed_payload)
values((select id from fixture where key='partner'),(select id from fixture where key='client'),'customer_message','Synthetic approval','Original body','{"channel":"sms","to":"synthetic-recipient"}');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from fixture where key='owner'),true);
do $$ declare blocked boolean:=false; begin
 begin update public.approval_items set proposed_payload='{"channel":"sms","to":"other-recipient"}'; exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'Approval payload tampered'; end if;
 update public.approval_items set status='approved',resolved_by=auth.uid(),resolved_content='forged override';
 blocked:=false;
 begin update public.approval_items set status='rejected',resolved_by=auth.uid(); exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'Resolved approval mutated'; end if;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.action_jobs)<>1 then raise exception 'Atomic approval outbox missing or duplicated'; end if;
 if (select payload->>'body' from public.action_jobs)<>'Original body' then raise exception 'Approval body does not match immutable approved content'; end if;
end $$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
update public.action_jobs set status='uncertain';
do $$ declare job_id uuid; blocked boolean:=false; begin
 select id into job_id from public.action_jobs;
 begin perform public.reconcile_uncertain_action(job_id,(select id from fixture where key='client'),(select id from fixture where key='partner'),(select id from fixture where key='manager'),'succeeded','Synthetic provider delivery evidence confirmed for the test'); exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'Manager reconciled owner-only delivery'; end if;
 blocked:=false;
 begin perform public.reconcile_uncertain_action(job_id,(select id from fixture where key='other-client'),(select id from fixture where key='other-partner'),(select id from fixture where key='owner'),'succeeded','Synthetic cross-tenant evidence for rejected test'); exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'Cross-tenant delivery reconciliation accepted'; end if;
 if not public.reconcile_uncertain_action(job_id,(select id from fixture where key='client'),(select id from fixture where key='partner'),(select id from fixture where key='owner'),'succeeded','Synthetic provider delivery evidence confirmed for the test') then raise exception 'Owner reconciliation failed'; end if;
 if public.reconcile_uncertain_action(job_id,(select id from fixture where key='client'),(select id from fixture where key='partner'),(select id from fixture where key='owner'),'cancelled','Synthetic repeated evidence should not change confirmed result') then raise exception 'Reconciliation changed final result on replay'; end if;
 if (select status from public.action_jobs where id=job_id)<>'succeeded' or (select count(*) from public.audit_events where action='job.reconciled')<>1 then raise exception 'Reconciliation result/audit not atomic'; end if;
 if (select count(*) from public.action_jobs)<>1 then raise exception 'Reconciliation created another action'; end if;
end $$;
do $$ declare first jsonb; repeated jsonb; job public.inbound_event_jobs; worker uuid:=extensions.gen_random_uuid(); blocked boolean:=false; begin
 first:=public.enqueue_inbound_event((select id from fixture where key='partner'),(select id from fixture where key='client'),(select id from fixture where key='connection'),'test.received','synthetic-key','{}','not-real-encryption','workflow');
 repeated:=public.enqueue_inbound_event((select id from fixture where key='partner'),(select id from fixture where key='client'),(select id from fixture where key='connection'),'test.received','synthetic-key','{}','not-real-encryption','workflow');
 if first->>'eventId'<>repeated->>'eventId' or not (repeated->>'duplicate')::boolean then raise exception 'Inbound deduplication failed'; end if;
 begin perform public.enqueue_inbound_event((select id from fixture where key='other-partner'),(select id from fixture where key='client'),(select id from fixture where key='connection'),'test.received','wrong-scope','{}','not-real-encryption','workflow'); exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'Inbound scope mismatch accepted'; end if;
 select * into job from public.claim_inbound_event_job(worker,(first->>'eventId')::uuid);
 if job.id is null then raise exception 'Inbound claim missing'; end if;
 if exists(select 1 from public.claim_inbound_event_job(extensions.gen_random_uuid(),(first->>'eventId')::uuid)) then raise exception 'Inbound job claimed twice'; end if;
 if public.finish_inbound_event_job(job.id,extensions.gen_random_uuid()) then raise exception 'Wrong worker completed inbound job'; end if;
 if not public.finish_inbound_event_job(job.id,worker) then raise exception 'Inbound completion failed'; end if;
 update public.client_businesses set status='active' where id=(select id from fixture where key='client');
 first:=public.enqueue_inbound_event((select id from fixture where key='partner'),(select id from fixture where key='client'),null,'job.completed','native-synthetic','{}','synthetic-ciphertext','workflow');
 repeated:=public.enqueue_inbound_event((select id from fixture where key='partner'),(select id from fixture where key='client'),null,'job.completed','native-synthetic','{}','synthetic-ciphertext','workflow');
 if first->>'eventId'<>repeated->>'eventId' or not (repeated->>'duplicate')::boolean then raise exception 'Native event deduplication failed'; end if;
 update public.client_businesses set status='active' where id=(select id from fixture where key='other-client');
 repeated:=public.enqueue_inbound_event((select id from fixture where key='other-partner'),(select id from fixture where key='other-client'),null,'job.completed','native-synthetic','{}','synthetic-ciphertext','workflow');
 if first->>'eventId'=repeated->>'eventId' or (repeated->>'duplicate')::boolean then raise exception 'Native event key collided between tenants'; end if;

 blocked:=false;
 begin perform public.enqueue_inbound_event((select id from fixture where key='other-partner'),(select id from fixture where key='client'),null,'job.completed','native-wrong-scope','{}','synthetic','workflow'); exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'Native event accepted cross-tenant scope'; end if;
 blocked:=false;
 begin perform public.enqueue_inbound_event((select id from fixture where key='partner'),(select id from fixture where key='client'),null,'job.completed','native-wrong-handler','{}','synthetic','phone'); exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'Native event accepted provider-only handler'; end if;
 select * into job from public.claim_inbound_event_job(worker,(first->>'eventId')::uuid);
 if job.id is null or job.connection_id is not null then raise exception 'Native job could not be claimed without provider connection'; end if;
 if exists(select 1 from public.claim_inbound_event_job(extensions.gen_random_uuid(),(first->>'eventId')::uuid)) then raise exception 'Native job claimed twice'; end if;
 if not public.finish_inbound_event_job(job.id,worker) then raise exception 'Native job could not complete'; end if;

end $$;
reset role;
update auth.users set email_confirmed_at=now() where id=(select id from fixture where key='enrollment-owner');
insert into public.partner_enrollments(owner_id,agency_name) values((select id from fixture where key='enrollment-owner'),'Synthetic Agency');
grant select on fixture to service_role;
set local role service_role;
do $$ declare enrollment public.partner_enrollments; first uuid; repeated uuid; bad record; blocked boolean:=false; begin
 select * into enrollment from public.partner_enrollments;
 first:=public.fulfill_partner_enrollment(enrollment.owner_id,enrollment.checkout_key,'cs_synthetic','cus_synthetic','sub_synthetic');
 repeated:=public.fulfill_partner_enrollment(enrollment.owner_id,enrollment.checkout_key,'cs_synthetic','cus_synthetic','sub_synthetic');
 if first is null or repeated<>first then raise exception 'Enrollment is not idempotent'; end if;
 if not exists(select 1 from public.memberships where user_id=enrollment.owner_id and partner_id=first and role='partner_owner') then raise exception 'Enrollment assigned wrong owner'; end if;
 begin perform public.fulfill_partner_enrollment(enrollment.owner_id,extensions.gen_random_uuid(),'cs_wrong','cus_wrong','sub_wrong'); exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'Enrollment accepted wrong checkout key'; end if;
 for bad in select * from (values
   (null::uuid,'cs_synthetic'::text,'cus_synthetic'::text,'sub_synthetic'::text),
   (enrollment.checkout_key,null,'cus_synthetic','sub_synthetic'),
   (enrollment.checkout_key,'cs_synthetic',null,'sub_synthetic'),
   (enrollment.checkout_key,'cs_synthetic','cus_synthetic',null),
   (enrollment.checkout_key,'cs_other','cus_synthetic','sub_synthetic'),
   (enrollment.checkout_key,'cs_synthetic','cus_other','sub_synthetic'),
   (enrollment.checkout_key,'cs_synthetic','cus_synthetic','sub_other')
 ) as invalid(checkout,session,customer,subscription) loop
   blocked:=false;
   begin perform public.fulfill_partner_enrollment(enrollment.owner_id,bad.checkout,bad.session,bad.customer,bad.subscription);
   exception when raise_exception then blocked:=true; end;
   if not blocked then raise exception 'Enrollment accepted null or mismatched replay identifiers'; end if;
 end loop;
end $$;
reset role;
do $$ declare signature text; begin
 foreach signature in array array['reconcile_uncertain_action(uuid,uuid,uuid,uuid,text,text)','fulfill_partner_enrollment(uuid,uuid,text,text,text)','enqueue_inbound_event(uuid,uuid,uuid,text,text,jsonb,text,text)','claim_inbound_event_job(uuid,uuid)','finish_inbound_event_job(uuid,uuid,uuid)','reserve_ai_call(uuid,uuid,text,text,text,integer,integer)','finish_ai_call(uuid,integer,integer,integer,boolean)','purge_customer_interaction_content(timestamptz)'] loop
 if has_function_privilege('anon','public.'||signature,'execute') or has_function_privilege('authenticated','public.'||signature,'execute') then raise exception 'Public privileged RPC: %',signature; end if;
 end loop;
end $$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare call_id uuid; next_id uuid; blocked boolean:=false; begin
 call_id:=public.reserve_ai_call((select id from fixture where key='partner'),(select id from fixture where key='client'),'test','synthetic-model',repeat('a',64),800,1000);
 if call_id is null then raise exception 'Valid AI budget reservation denied'; end if;
 next_id:=public.reserve_ai_call((select id from fixture where key='partner'),(select id from fixture where key='client'),'test','synthetic-model',repeat('b',64),300,1000);
 if next_id is not null then raise exception 'AI budget overspent'; end if;
 perform public.finish_ai_call(call_id,100,100,50,true);
 perform public.finish_ai_call(call_id,100,100,50,true);
 if (select count(*) from public.usage_events where event_type='ai.model_tokens')<>1 then raise exception 'Usage duplicated'; end if;
 next_id:=public.reserve_ai_call((select id from fixture where key='partner'),(select id from fixture where key='client'),'test','synthetic-model',repeat('c',64),800,1000);
 if next_id is null then raise exception 'Measured AI tokens did not release unused reservation'; end if;
 begin perform public.reserve_ai_call((select id from fixture where key='other-partner'),(select id from fixture where key='client'),'test','synthetic-model',repeat('d',64),10,1000); exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'AI budget accepted crossed tenant context'; end if;
end $$;
reset role;
insert into public.call_sessions(partner_id,client_id,status,ended_at,extracted)
values((select id from fixture where key='partner'),(select id from fixture where key='client'),'completed',now()-interval '100 days','{"customer":"synthetic"}');
insert into public.call_transcript_turns(call_session_id,partner_id,client_id,seq,role,content)
select id,partner_id,client_id,1,'caller','Synthetic old transcript' from public.call_sessions;
insert into public.chat_sessions(partner_id,client_id,connection_id,transcript,created_at,updated_at)
values((select id from fixture where key='partner'),(select id from fixture where key='client'),(select id from fixture where key='connection'),'[{"content":"Synthetic old chat"}]',now()-interval '100 days',now()-interval '100 days');
set local role service_role;
do $$ declare removed jsonb; blocked boolean:=false; begin
 removed:=public.purge_customer_interaction_content(now()-interval '90 days');
 if (removed->>'transcripts')::integer<>1 or (removed->>'chats')::integer<>1 or (removed->>'callExtracts')::integer<>1 then raise exception 'Raw interaction retention failed'; end if;
 if (select count(*) from public.crm_contacts)<>1 or (select count(*) from public.approval_items)<>1 then raise exception 'Retention removed business records/approval evidence'; end if;
 begin perform public.purge_customer_interaction_content(now()); exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'Unsafe retention cutoff accepted'; end if;
end $$;
reset role;
do $$ declare package uuid; blocked boolean:=false; begin
 insert into public.partner_packages(partner_id,name) values((select id from fixture where key='partner'),'Synthetic package') returning id into package;
 update public.client_businesses set package_id=package where id=(select id from fixture where key='client');
 begin update public.integration_connections set runtime_mode='live' where id=(select id from fixture where key='connection'); exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'Live activated without owner acceptance'; end if;
 insert into public.client_beta_acceptances(client_id,partner_id,package_id,accepted_by,provider_test_notes,fallback_contact)
 values((select id from fixture where key='client'),(select id from fixture where key='partner'),package,(select id from fixture where key='owner'),'Synthetic provider verification and recovery plan recorded for the beta test only.','synthetic@example.invalid');
 update public.integration_connections set runtime_mode='live' where id=(select id from fixture where key='connection');
 update public.memberships set status='disabled' where user_id=(select id from fixture where key='owner');
 blocked:=false;
 begin update public.integration_connections set display_name='Changed after acceptance revoked' where id=(select id from fixture where key='connection');
 exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'Existing live connection bypassed revoked acceptance'; end if;
 update public.memberships set status='active' where user_id=(select id from fixture where key='owner');
 update public.client_businesses set is_test_account=true where id=(select id from fixture where key='other-client');
 update public.integration_connections set runtime_mode='live' where id=(select id from fixture where key='other-connection');
end $$;
rollback;
`;

try {
  execFileSync("docker", ["exec", "-i", "supabase_db_partner-platform", "psql", "-U", "supabase_admin", "-d", "beta_security_test", "-v", "ON_ERROR_STOP=1"], { input: sql, stdio: ["pipe", "pipe", "pipe"] });
  console.log("PASS: Auth email immutability, partner self-grant/flags, cross-tenant secrets, employee reads/writes, sibling profiles, legitimate owner edit, atomic outbox, inbound deduplication/claims/scope, enrollment ownership/idempotency, privileged RPC grants, AI budget/usage, raw-content retention, and live acceptance gates.");
} catch (error) {
  console.error(error.stderr?.toString() ?? error.message);
  process.exitCode = 1;
}
