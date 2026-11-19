-- Real isolated Postgres policy acceptance; never target a hosted business.
-- Synthetic invoice/grant/recipient history is not Stripe, OAuth or delivery proof.
begin;
set local statement_timeout='45s';
set local lock_timeout='5s';
-- __ISOLATION_ASSERTION__
select pg_advisory_xact_lock(1937402189);
do $blank$ begin
 if current_database() !~ '_(test|acceptance)$' or exists(select 1 from public.partners) or exists(select 1 from public.client_businesses) then
  raise exception 'Money acceptance requires an exclusively blank isolated test database'; end if;
end $blank$;
create temporary table mf_fixture(key text primary key,id uuid not null default extensions.gen_random_uuid(),data jsonb);
insert into mf_fixture(key) values('partner-a'),('partner-b'),('package-a'),('package-b'),('client-a'),('client-b'),('owner-a'),('owner-b'),('stripe-a'),('stripe-b'),('stripe-peer'),('email-a'),('email-b'),('contact-a'),('contact-b'),('conversation-a'),('conversation-b');
grant select,insert,update on mf_fixture to service_role,authenticated,anon;
insert into auth.users(id,email) select id,'cj-acceptance-__RUN_ID__-money-'||key||'@synthetic.invalid' from mf_fixture where key in('owner-a','owner-b');
insert into public.profiles(id,email) select id,'cj-acceptance-__RUN_ID__-money-'||key||'@synthetic.invalid' from mf_fixture where key in('owner-a','owner-b') on conflict(id) do nothing;
insert into public.partners(id,name,slug) select id,'Synthetic money acceptance '||key,'cj-acceptance-__RUN_ID__-money-'||key from mf_fixture where key in('partner-a','partner-b');
insert into public.partner_packages(id,partner_id,name) select id,(select id from mf_fixture where key=case when f.key='package-a' then 'partner-a' else 'partner-b' end),'Synthetic money acceptance package' from mf_fixture f where key in('package-a','package-b');
insert into public.client_businesses(id,partner_id,package_id,name,slug,status,client_portal_enabled,crm_operating_mode,default_runtime_mode)
 select id,(select id from mf_fixture where key=case when f.key='client-a' then 'partner-a' else 'partner-b' end),(select id from mf_fixture where key=case when f.key='client-a' then 'package-a' else 'package-b' end),
 'Synthetic money acceptance '||key,'cj-acceptance-__RUN_ID__-money-'||key,'active',true,'primary_crm','sandbox' from mf_fixture f where key in('client-a','client-b');
insert into public.memberships(user_id,partner_id,client_id,role)
 select id,(select id from mf_fixture where key=case when f.key='owner-a' then 'partner-a' else 'partner-b' end),(select id from mf_fixture where key=case when f.key='owner-a' then 'client-a' else 'client-b' end),'client_owner' from mf_fixture f where key in('owner-a','owner-b');
do $live_gate$ declare denied boolean:=false; begin
 begin update public.client_businesses set default_runtime_mode='live' where id=(select id from mf_fixture where key='client-a');
 exception when raise_exception then if sqlerrm not like '%supervised beta launch checklist%' then raise; end if; denied:=true; end;
 if not denied then raise exception 'Money fixture bypassed the owner/package live acceptance'; end if;
end $live_gate$;
insert into public.client_beta_acceptances(client_id,partner_id,package_id,accepted_by,provider_test_notes,fallback_contact)
 select id,(select id from mf_fixture where key=case when f.key='client-a' then 'partner-a' else 'partner-b' end),(select id from mf_fixture where key=case when f.key='client-a' then 'package-a' else 'package-b' end),
 (select id from mf_fixture where key=case when f.key='client-a' then 'owner-a' else 'owner-b' end),'Synthetic isolated database money policy only; no live Stripe, OAuth, payment, charge, customer outreach or provider receipt is established.','synthetic-owner@invalid' from mf_fixture f where key in('client-a','client-b');
update public.client_businesses set default_runtime_mode='live' where id in(select id from mf_fixture where key in('client-a','client-b'));
insert into public.integration_connections(id,partner_id,client_id,provider_id,display_name,status,runtime_mode,credential_status,external_account_id,external_account_name,config)
 select f.id,(select id from mf_fixture where key=case when f.key='stripe-b' then 'partner-b' else 'partner-a' end),(select id from mf_fixture where key=case when f.key='stripe-b' then 'client-b' else 'client-a' end),p.id,
 'Synthetic money source','connected','dry_run','configured','acct_mf_'||replace('__RUN_ID__','-','')||case when f.key='stripe-b' then '_other' else '_own' end,'Synthetic Stripe source account','{"workspace_view_only":true,"owner_workspace_imports":true}'
 from mf_fixture f cross join public.integration_providers p where f.key in('stripe-a','stripe-b','stripe-peer') and p.provider_key='stripe';
insert into public.integration_connections(id,partner_id,client_id,provider_id,display_name,status,runtime_mode,credential_status,external_account_id,external_account_name,config)
 select f.id,(select id from mf_fixture where key=case when f.key='email-a' then 'partner-a' else 'partner-b' end),(select id from mf_fixture where key=case when f.key='email-a' then 'client-a' else 'client-b' end),p.id,
 'Synthetic selected business email','connected','live','configured','mf-google-__RUN_ID__-'||f.key,'synthetic-business-__RUN_ID__@invalid',
 jsonb_build_object('workspace_view_only',true,'activation_managed',true,'activation_selected',true,'conversation_intake_enabled',true,'conversation_intake_enabled_at',now()-interval '1 hour','activation_mail_verified',true,'activation_checked_at',now(),
  'google_action_permissions',jsonb_build_object('calendar_write',false,'email_send',true),'google_verified_scopes',jsonb_build_array('https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/calendar.events.readonly'))
 from mf_fixture f cross join public.integration_providers p where f.key in('email-a','email-b') and p.provider_key='google_workspace';
insert into public.agent_team_settings(partner_id,client_id,status,conversations_enabled,scheduling_enabled,channel_authority)
 values((select id from mf_fixture where key='partner-a'),(select id from mf_fixture where key='client-a'),'active',true,false,'{"email":"off"}');
insert into public.business_workspace_profiles(partner_id,client_id,profile)
 values((select id from mf_fixture where key='partner-a'),(select id from mf_fixture where key='client-a'),'{"description":"Synthetic source-backed money acceptance","services":"Synthetic service"}');
insert into public.business_agent_activation(partner_id,client_id,status,email,website,bookings,workspace_provider,workspace_connection_id)
 values((select id from mf_fixture where key='partner-a'),(select id from mf_fixture where key='client-a'),'active',true,false,false,'google_workspace',(select id from mf_fixture where key='email-a'));
insert into public.crm_contacts(id,partner_id,client_id,first_name,email,preferred_channel,tags)
 select f.id,(select id from mf_fixture where key=case when f.key='contact-a' then 'partner-a' else 'partner-b' end),(select id from mf_fixture where key=case when f.key='contact-a' then 'client-a' else 'client-b' end),
 'Synthetic known invoice customer','synthetic-customer-__RUN_ID__-'||f.key||'@synthetic.invalid','email','{}' from mf_fixture f where key in('contact-a','contact-b');
insert into public.business_conversations(id,partner_id,client_id,connection_id,channel,external_thread_id,contact_id,identity_status,mode,state)
 select f.id,(select id from mf_fixture where key=case when f.key='conversation-a' then 'partner-a' else 'partner-b' end),(select id from mf_fixture where key=case when f.key='conversation-a' then 'client-a' else 'client-b' end),
 (select id from mf_fixture where key=case when f.key='conversation-a' then 'email-a' else 'email-b' end),'email',person.email,person.id,'owner_verified','agent','open'
 from mf_fixture f join public.crm_contacts person on person.id=(select id from mf_fixture where key=case when f.key='conversation-a' then 'contact-a' else 'contact-b' end) where f.key in('conversation-a','conversation-b');
insert into public.business_conversation_messages(partner_id,client_id,conversation_id,external_key,direction,body,status,created_at)
 select partner_id,client_id,id,'mf-__RUN_ID__-historical-recipient','inbound','Synthetic received invoice correspondence; this is not an outreach permission inference.','received',now()-interval '10 minutes'
 from public.business_conversations where id=(select id from mf_fixture where key='conversation-a');
insert into public.integration_sync_states(partner_id,client_id,connection_id,stream_key,status,last_completed_at,cursor_value)
 select partner_id,client_id,id,'invoice','idle',now(),'{}' from public.integration_connections where id in(select id from mf_fixture where key in('stripe-a','stripe-b','stripe-peer'));
set local role service_role;

select set_config('request.jwt.claim.role','service_role',true);
do $review$ declare p uuid:=(select id from mf_fixture where key='partner-a'); c uuid:=(select id from mf_fixture where key='client-a'); actor uuid:=(select id from mf_fixture where key='owner-a'); profile_at timestamptz; authority integer; begin
 select updated_at into profile_at from public.business_workspace_profiles where partner_id=p and client_id=c;
 perform public.apply_business_context_command(p,c,actor,jsonb_build_object('action','review_context','key',extensions.gen_random_uuid(),'expectedContextRevision',profile_at));
 select authority_revision into authority from public.agent_team_settings where partner_id=p and client_id=c;
 perform public.apply_business_context_command(p,c,actor,jsonb_build_object('action','set_authority','key',extensions.gen_random_uuid(),'expectedRevision',authority,'channel','email','mode','require_approval'));
end $review$;
reset role;

create function pg_temp.mf_invoice(p_label text) returns uuid language plpgsql security invoker set search_path='' as $$
declare cn public.integration_connections; record_id uuid; facts jsonb;
begin
 select * into cn from public.integration_connections where id=(select id from pg_temp.mf_fixture where key='stripe-a');
 facts:=jsonb_build_object('provider','stripe','number','MF-'||p_label,'customer_id','cus_mf_'||replace('__RUN_ID__','-','')||'_known','status','open','livemode',true,'collection_method','send_invoice',
  'currency','USD','total_minor',12345,'amount_due_minor',2345,'amount_paid_minor',10000,'due_date',now()-interval '2 days','hosted_url','https://invoice.stripe.com/i/mf-__RUN_ID__-'||p_label);
 perform public.persist_owner_import_record(cn.partner_id,cn.client_id,cn.id,'invoice','in_mf_'||replace('__RUN_ID__','-','')||'_'||replace(p_label,'-','_'),null,facts,'{}',now()-interval '1 hour',now());
 select id into record_id from public.integration_canonical_records where connection_id=cn.id and object_type='invoice' and external_object_id='in_mf_'||replace('__RUN_ID__','-','')||'_'||replace(p_label,'-','_');
 insert into pg_temp.mf_fixture(key,id) values('invoice-'||p_label,record_id);
 return record_id;
end $$;
create function pg_temp.mf_command(p_record uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare sr public.integration_canonical_records; cn public.integration_connections; person public.crm_contacts; cv public.business_conversations; activity_id uuid; activity_at timestamptz; authority integer; pin jsonb; request jsonb;
begin
 select * into sr from public.integration_canonical_records where id=p_record;
 select * into cn from public.integration_connections where id=sr.connection_id;
 select * into cv from public.business_conversations where id=(select id from pg_temp.mf_fixture where key='conversation-a');
 select * into person from public.crm_contacts where id=cv.contact_id;
 select authority_revision into authority from public.agent_team_settings where partner_id=sr.partner_id and client_id=sr.client_id;
 select latest.id,latest.created_at into activity_id,activity_at from (
  select comm.id,comm.created_at from public.crm_communications comm where comm.partner_id=sr.partner_id and comm.client_id=sr.client_id and comm.contact_id=person.id and comm.direction='inbound' and comm.status='received'
  union all select msg.id,msg.created_at from public.business_conversation_messages msg join public.business_conversations thread on thread.id=msg.conversation_id and thread.partner_id=msg.partner_id and thread.client_id=msg.client_id
   where thread.partner_id=sr.partner_id and thread.client_id=sr.client_id and thread.contact_id=person.id and thread.identity_status='owner_verified' and msg.direction='inbound' and msg.status='received'
 ) latest order by latest.created_at desc,latest.id desc limit 1;
 request:=jsonb_build_object('action','prepare_invoice_followup','key',extensions.gen_random_uuid(),'targetId',sr.id,'connectionId',cn.id,'expectedRevision','synthetic-server-reviewed-source',
  'recipientConversationId',cv.id,'expectedRecipientRevision','synthetic-server-reviewed-recipient','identityConfirmed',true,'outreachPermissionConfirmed',true);
 pin:=jsonb_build_object('invoice_followup_version',1,'money_review_id',extensions.gen_random_uuid(),'source_record_id',sr.id,'source_updated_at',sr.updated_at,'source_external_updated_at',sr.external_updated_at,
  'stripe_connection_id',cn.id,'stripe_account_id',cn.external_account_id,'invoice_id',sr.external_object_id,'stripe_customer_id',sr.canonical_data->'customer_id',
  'amount_due_minor',sr.canonical_data->'amount_due_minor','amount_paid_minor',sr.canonical_data->'amount_paid_minor','total_minor',sr.canonical_data->'total_minor','currency',sr.canonical_data->'currency',
  'due_at',sr.canonical_data->'due_date','collection_method',sr.canonical_data->'collection_method','hosted_invoice_url',sr.canonical_data->'hosted_url','invoice_number',sr.canonical_data->'number',
  'contact_id',person.id,'contact_updated_at',person.updated_at,'channel','email','to',cv.external_thread_id,'connection_id',cv.connection_id,'authority_revision',authority,
  'customer_activity_id',activity_id,'customer_activity_at',activity_at,'conversation_id',cv.id,'conversation_revision',cv.revision);
 return jsonb_build_object('owner_request',request,'pin',pin,'subject','Synthetic invoice follow-up','body','Please review synthetic invoice '||(sr.canonical_data->>'number')||' with a remaining balance of USD 23.45. Reply if this record needs review.');
end $$;
create function pg_temp.mf_reject(p_command jsonb,p_label text,p_partner uuid default null,p_client uuid default null,p_actor uuid default null) returns void language plpgsql security invoker set search_path='' as $$
declare denied boolean:=false; old_counts jsonb; new_counts jsonb;
begin
 select jsonb_build_array((select count(*) from public.business_owner_commands),(select count(*) from public.approval_items),(select count(*) from public.crm_tasks),(select count(*) from public.action_jobs),(select count(*) from public.crm_contacts)) into old_counts;
 begin perform public.prepare_invoice_followup(coalesce(p_partner,(select id from pg_temp.mf_fixture where key='partner-a')),coalesce(p_client,(select id from pg_temp.mf_fixture where key='client-a')),coalesce(p_actor,(select id from pg_temp.mf_fixture where key='owner-a')),p_command);
 exception when sqlstate '40001' or sqlstate '22023' then denied:=true; end;
 select jsonb_build_array((select count(*) from public.business_owner_commands),(select count(*) from public.approval_items),(select count(*) from public.crm_tasks),(select count(*) from public.action_jobs),(select count(*) from public.crm_contacts)) into new_counts;
 if not denied or old_counts is distinct from new_counts then raise exception 'Money preparation was not atomically rejected: %',p_label; end if;
end $$;
create function pg_temp.mf_control(p_label text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare command jsonb; receipt jsonb; check_result jsonb;
begin
 command:=pg_temp.mf_command(pg_temp.mf_invoice(p_label));
 receipt:=public.prepare_invoice_followup((select id from pg_temp.mf_fixture where key='partner-a'),(select id from pg_temp.mf_fixture where key='client-a'),(select id from pg_temp.mf_fixture where key='owner-a'),command);
 check_result:=public.invoice_followup_action_check((select id from pg_temp.mf_fixture where key='partner-a'),(select id from pg_temp.mf_fixture where key='client-a'),(receipt->>'approvalId')::uuid,null);
 if check_result->>'allowed' is distinct from 'true' then raise exception 'Money guard positive control failed for %: %',p_label,check_result->>'reason'; end if;
 return jsonb_build_object('command',command,'receipt',receipt);
end $$;
grant execute on function pg_temp.mf_invoice(text),pg_temp.mf_command(uuid),pg_temp.mf_reject(jsonb,text,uuid,uuid,uuid),pg_temp.mf_control(text) to service_role;
set local role service_role;

-- Group 1: the normal accepted owner flow creates one shared task and review,
-- never a customer/deal/invoice/payment projection or an outbound action.
do $prepare$ declare control jsonb; receipt jsonb; command jsonb; p uuid:=(select id from mf_fixture where key='partner-a'); c uuid:=(select id from mf_fixture where key='client-a'); contacts_before jsonb; begin
 select jsonb_agg(to_jsonb(person) order by person.id) into contacts_before from public.crm_contacts person;
 control:=pg_temp.mf_control('positive'); receipt:=control->'receipt'; command:=control->'command';
 insert into mf_fixture(key,id,data) values('positive-review',(receipt->>'approvalId')::uuid,control);
 if receipt->>'id' is distinct from command->'pin'->>'money_review_id' or receipt->>'sourceRecordId' is distinct from command->'pin'->>'source_record_id' or receipt->>'replayed' is distinct from 'false'
  or not exists(select 1 from public.crm_tasks t where t.id=(receipt->>'taskId')::uuid and t.partner_id=p and t.client_id=c and t.source_invoice_record_id=(receipt->>'sourceRecordId')::uuid and t.contact_id=(select id from mf_fixture where key='contact-a') and t.task_type='invoice_followup')
  or not exists(select 1 from public.approval_items a where a.id=(receipt->>'approvalId')::uuid and a.status='pending' and a.type='customer_message' and a.editable_content=command->>'body' and a.proposed_payload->>'connection_id'=(select id::text from mf_fixture where key='email-a'))
  or (select count(*) from public.business_conversation_messages where approval_id=(receipt->>'approvalId')::uuid and direction='outbound' and status='draft')<>1
  or (select count(*) from public.crm_communications where approval_id=(receipt->>'approvalId')::uuid and direction='outbound' and status='draft')<>1
  or exists(select 1 from public.action_jobs) or exists(select 1 from public.agent_work_items) or exists(select 1 from public.business_records) or exists(select 1 from public.crm_leads)
  or exists(select 1 from public.integration_canonical_records where native_object_id is not null)
  or contacts_before is distinct from (select jsonb_agg(to_jsonb(person) order by person.id) from public.crm_contacts person) then raise exception 'Invoice preparation lost exact source/recipient attribution or wrote unrelated CRM/money/outbound state'; end if;
end $prepare$;



-- Group 2: committed response replay precedes freshness. New keys and duplicate
-- source connections cannot create a second pending reminder for one invoice.
do $replay$ declare control jsonb; command jsonb; saved jsonb; replay jsonb; sr public.integration_canonical_records; p uuid:=(select id from mf_fixture where key='partner-a'); c uuid:=(select id from mf_fixture where key='client-a'); actor uuid:=(select id from mf_fixture where key='owner-a'); peer uuid:=(select id from mf_fixture where key='stripe-peer'); peer_source uuid; begin
 select data into control from mf_fixture where key='positive-review'; command:=control->'command'; saved:=control->'receipt';
 select * into sr from public.integration_canonical_records where id=(saved->>'sourceRecordId')::uuid;
 update public.integration_connections set runtime_mode='paused' where id=sr.connection_id;
 update public.crm_contacts set email='changed-after-commit-__RUN_ID__@synthetic.invalid' where id=(select id from mf_fixture where key='contact-a');
 update public.integration_canonical_records set canonical_data=canonical_data||'{"status":"paid","amount_due_minor":0}'::jsonb where id=sr.id;
 replay:=public.prepare_invoice_followup(p,c,actor,command);
 if replay->>'id' is distinct from saved->>'id' or replay->>'approvalId' is distinct from saved->>'approvalId' or replay->>'taskId' is distinct from saved->>'taskId' or replay->>'replayed' is distinct from 'true' then raise exception 'Exact money command did not replay after source/contact/pause changes'; end if;
 perform pg_temp.mf_reject(command,'replay actor mismatch',p,c,(select id from mf_fixture where key='owner-b'));
 perform pg_temp.mf_reject(jsonb_set(command,'{owner_request,outreachPermissionConfirmed}','false'),'replay changed owner decision');
 update public.integration_connections set runtime_mode='dry_run' where id=sr.connection_id;
 update public.crm_contacts set email=(select external_thread_id from public.business_conversations where id=(select id from mf_fixture where key='conversation-a')) where id=(select id from mf_fixture where key='contact-a');
 update public.integration_canonical_records set canonical_data=sr.canonical_data where id=sr.id;
 perform pg_temp.mf_reject(pg_temp.mf_command(sr.id),'second pending request for same invoice');
 perform public.persist_owner_import_record(p,c,peer,'invoice',sr.external_object_id,null,sr.canonical_data,'{}',sr.external_updated_at,now());
 select id into peer_source from public.integration_canonical_records where connection_id=peer and object_type='invoice' and external_object_id=sr.external_object_id;
 perform pg_temp.mf_reject(pg_temp.mf_command(peer_source),'same account/invoice through a second connection');
 if (select count(*) from public.crm_tasks where source_invoice_record_id in(sr.id,peer_source))<>1 or (select count(*) from public.approval_items where proposed_payload->>'invoice_followup_version'='1' and proposed_payload->>'invoice_id'=sr.external_object_id)<>1 then raise exception 'Invoice source duplicates created extra task or approval'; end if;
end $replay$;

-- Group 3: approved financial text is immutable; an ordinary human resolution
-- enqueues exactly one claimed email. Paid source state blocks final execution.
do $approval$ declare control jsonb; v_approval_id uuid; source_id uuid; job_id uuid; check_result jsonb; denied boolean:=false; actor uuid:=(select id from mf_fixture where key='owner-a'); p uuid:=(select id from mf_fixture where key='partner-a'); c uuid:=(select id from mf_fixture where key='client-a'); begin
 select data into control from mf_fixture where key='positive-review'; v_approval_id:=(control->'receipt'->>'approvalId')::uuid; source_id:=(control->'receipt'->>'sourceRecordId')::uuid;
 check_result:=public.invoice_followup_action_check(p,c,v_approval_id,null);
 if check_result->>'allowed' is distinct from 'true' then raise exception 'Restored invoice positive control failed: %',check_result->>'reason'; end if;
 begin update public.approval_items set status='edited_and_approved',resolved_by=actor,resolved_content='Pay an invented balance of USD 999999 now' where id=v_approval_id;
 exception when sqlstate 'PT409' then denied:=true; end;
 if not denied or exists(select 1 from public.action_jobs where approval_id=v_approval_id) then raise exception 'Edited financial prose was approved or enqueued'; end if;
 update public.approval_items set status='approved',resolved_by=actor where id=v_approval_id;
 select j.id into job_id from public.action_jobs j where j.approval_id=v_approval_id and j.kind='email.send';
 if job_id is null or (select count(*) from public.action_jobs j where j.approval_id=v_approval_id)<>1 then raise exception 'Normal invoice approval did not enqueue exactly one email'; end if;
 update public.action_jobs set status='processing',claim_token=extensions.gen_random_uuid(),claimed_at=now() where id=job_id and status='pending';
 check_result:=public.invoice_followup_action_check(p,c,v_approval_id,job_id);
 if check_result->>'allowed' is distinct from 'true' then raise exception 'Exact claimed invoice positive control failed: %',check_result->>'reason'; end if;
 update public.integration_canonical_records set canonical_data=canonical_data||'{"status":"paid","amount_due_minor":0}'::jsonb where id in(select r.id from public.integration_canonical_records r where r.partner_id=p and r.client_id=c and r.object_type='invoice' and r.external_object_id=(control->'command'->'pin'->>'invoice_id'));
 check_result:=public.invoice_followup_action_check(p,c,v_approval_id,job_id);
 if check_result->>'allowed' is distinct from 'false' or not exists(select 1 from public.action_jobs where id=job_id and status='processing' and claim_token is not null) then raise exception 'Paid invoice remained executable or its in-flight history was rewritten'; end if;
 insert into mf_fixture(key,id,data) select 'processing-history',j.id,to_jsonb(j) from public.action_jobs j where j.id=job_id;
end $approval$;

-- Retain the exact processing history above. Later independent controls use
-- another explicitly verified synthetic email thread on the same contact;
-- no recipient identity is inferred from invoice metadata or a matching name.
do $later_thread$ declare thread_id uuid; person uuid:=(select id from mf_fixture where key='contact-a'); begin
 insert into mf_fixture(key,id) select 'conversation-first',id from mf_fixture where key='conversation-a';
 insert into public.business_conversations(partner_id,client_id,connection_id,channel,external_thread_id,contact_id,identity_status,mode,state)
 values((select id from mf_fixture where key='partner-a'),(select id from mf_fixture where key='client-a'),(select id from mf_fixture where key='email-a'),'email','synthetic-later-thread-__RUN_ID__@synthetic.invalid',person,'owner_verified','agent','open') returning id into thread_id;
 update mf_fixture set id=thread_id where key='conversation-a';
 insert into public.business_conversation_messages(partner_id,client_id,conversation_id,external_key,direction,body,status,created_at)
 values((select id from mf_fixture where key='partner-a'),(select id from mf_fixture where key='client-a'),thread_id,'mf-__RUN_ID__-later-thread','inbound','Synthetic distinct verified email correspondence for independent controls.','received',now()-interval '9 minutes');
end $later_thread$;

-- Group 4: real RPC rejection covers missing owner decisions and exact scope,
-- source/contact/thread pins. It cannot silently match a customer identity.
do $scope$ declare command jsonb; target uuid; result jsonb; safety jsonb; begin
 target:=pg_temp.mf_invoice('scope'); command:=pg_temp.mf_command(target);
 perform pg_temp.mf_reject(jsonb_set(command,'{owner_request,identityConfirmed}','false'),'missing identity review');
 perform pg_temp.mf_reject(jsonb_set(command,'{owner_request,outreachPermissionConfirmed}','false'),'missing billing-contact permission');
 perform pg_temp.mf_reject(command,'foreign partner/client pairing',(select id from mf_fixture where key='partner-b'));
 perform pg_temp.mf_reject(jsonb_set(command,'{owner_request,connectionId}',to_jsonb((select id::text from mf_fixture where key='stripe-b'))),'foreign source account');
 perform pg_temp.mf_reject(jsonb_set(command,'{pin,invoice_id}','"in_wrong_exact_source"'),'wrong invoice identity');
 perform pg_temp.mf_reject(jsonb_set(command,'{pin,source_updated_at}',to_jsonb(now()-interval '1 microsecond')),'stale exact source clock');
 perform pg_temp.mf_reject(jsonb_set(command,'{pin,contact_updated_at}',to_jsonb(now()-interval '1 microsecond')),'stale exact contact clock');
 perform pg_temp.mf_reject(jsonb_set(command,'{pin,contact_id}',to_jsonb((select id::text from mf_fixture where key='contact-b'))),'cross-business recipient identity');
 perform pg_temp.mf_reject(jsonb_set(command,'{pin,to}','"unverified-other-__RUN_ID__@invalid"'),'unverified destination');
 perform pg_temp.mf_reject(jsonb_set(command,'{pin,connection_id}',to_jsonb((select id::text from mf_fixture where key='email-b'))),'foreign delivery account');
 result:=public.prepare_invoice_followup((select id from mf_fixture where key='partner-a'),(select id from mf_fixture where key='client-a'),(select id from mf_fixture where key='owner-a'),command);
 safety:=public.invoice_followup_action_check((select id from mf_fixture where key='partner-a'),(select id from mf_fixture where key='client-a'),(result->>'approvalId')::uuid,null);
 if safety->>'allowed' is distinct from 'true' then raise exception 'Scope rejection positive control failed: %',safety->>'reason'; end if;
 update public.approval_items set status='rejected',resolved_by=(select id from mf_fixture where key='owner-a') where id=(result->>'approvalId')::uuid;
end $scope$;

-- Group 5: current balance/collection policy and COMPLETE fresh account import
-- coverage are required, including all duplicate connections to that account.
do $source_policy$ declare target uuid; facts jsonb; patch jsonb; label text; job_id uuid; peer uuid:=(select id from mf_fixture where key='stripe-peer'); p uuid:=(select id from mf_fixture where key='partner-a'); c uuid:=(select id from mf_fixture where key='client-a'); begin
 target:=pg_temp.mf_invoice('source-policy'); select canonical_data into facts from public.integration_canonical_records where id=target;
 for label,patch in select name,value from jsonb_each(jsonb_build_object(
  'paid','{"status":"paid","amount_due_minor":0}'::jsonb,'void','{"status":"void"}'::jsonb,'uncollectible','{"status":"uncollectible"}'::jsonb,'draft','{"status":"draft"}'::jsonb,
  'deleted','{"deleted":true}'::jsonb,'automatic_collection','{"collection_method":"charge_automatically"}'::jsonb,'test_mode','{"livemode":false}'::jsonb,
  'zero_balance','{"amount_due_minor":0}'::jsonb,'fractional_minor','{"amount_due_minor":12.5}'::jsonb,'negative_minor','{"amount_due_minor":-1}'::jsonb,
  'string_minor','{"amount_due_minor":"2345"}'::jsonb,'unknown_currency','{"currency":"ZZZ"}'::jsonb,'future_due',jsonb_build_object('due_date',now()+interval '1 day'))) item(name,value) loop
  update public.integration_canonical_records set canonical_data=facts||patch where id=target;
  perform pg_temp.mf_reject(pg_temp.mf_command(target),'source policy '||label);
 end loop;
 update public.integration_canonical_records set canonical_data=facts,snapshot_observed_at=now()-interval '46 minutes' where id=target;
 perform pg_temp.mf_reject(pg_temp.mf_command(target),'stale exact invoice observation');
 update public.integration_canonical_records set snapshot_observed_at=now() where id=target;
 update public.integration_sync_states set cursor_value='{"has_more":true}' where connection_id=peer and stream_key='invoice';
 perform pg_temp.mf_reject(pg_temp.mf_command(target),'partial same-account peer import');
 update public.integration_sync_states set cursor_value='{}',last_completed_at=now()-interval '46 minutes' where connection_id=peer and stream_key='invoice';
 perform pg_temp.mf_reject(pg_temp.mf_command(target),'stale same-account peer stream');
 update public.integration_sync_states set last_completed_at=now(),status='failing',last_error='Synthetic equal-clock conflict' where connection_id=peer and stream_key='invoice';
 perform pg_temp.mf_reject(pg_temp.mf_command(target),'conflicted same-account peer stream');
 update public.integration_sync_states set status='idle',last_error=null where connection_id=peer and stream_key='invoice';
 insert into public.integration_sync_jobs(partner_id,client_id,connection_id,direction,object_type,operation,status)
 values(p,c,peer,'pull','invoice','pull','queued') returning id into job_id;
 perform pg_temp.mf_reject(pg_temp.mf_command(target),'pending invoice import must finish before follow-up');
 update public.integration_sync_jobs set status='succeeded',completed_at=now() where id=job_id;
 perform public.persist_owner_import_record(p,c,peer,'invoice',(select external_object_id from public.integration_canonical_records where id=target),null,facts||'{"amount_due_minor":100}'::jsonb,'{}',now()-interval '1 hour',now());
 perform pg_temp.mf_reject(pg_temp.mf_command(target),'same-account invoices disagree on balance');
end $source_policy$;

-- Group 6: each interruption starts from its OWN eligible pending approval.
-- Both ordinary approval and the final guard refuse changed source/customer
-- instructions, takeover, opt-out, account permissions and manager authority.
do $interruptions$ declare label text; control jsonb; proposal uuid; source_id uuid; check_result jsonb; denied boolean; authority integer;
 p uuid:=(select id from mf_fixture where key='partner-a'); c uuid:=(select id from mf_fixture where key='client-a'); actor uuid:=(select id from mf_fixture where key='owner-a'); person uuid:=(select id from mf_fixture where key='contact-a'); thread uuid:=(select id from mf_fixture where key='conversation-a'); sender uuid:=(select id from mf_fixture where key='email-a');
begin
 foreach label in array array['paid','suppressed','takeover','opted_out','delivery_paused','grant_removed','manager_paused','new_crm_reply','new_verified_reply'] loop
  control:=pg_temp.mf_control('interrupt-'||label); proposal:=(control->'receipt'->>'approvalId')::uuid; source_id:=(control->'receipt'->>'sourceRecordId')::uuid;
  if label='paid' then update public.integration_canonical_records set canonical_data=canonical_data||'{"status":"paid","amount_due_minor":0}'::jsonb where id=source_id;
  elsif label='suppressed' then update public.crm_contacts set tags=array[' STOP '] where id=person;
  elsif label='takeover' then update public.business_conversations set mode='human' where id=thread;
  elsif label='opted_out' then update public.business_conversations set opted_out=true where id=thread;
  elsif label='delivery_paused' then update public.integration_connections set runtime_mode='paused' where id=sender;
  elsif label='grant_removed' then update public.integration_connections set config=jsonb_set(config,'{google_action_permissions,email_send}','false') where id=sender;
  elsif label='manager_paused' then
   select authority_revision into authority from public.agent_team_settings where partner_id=p and client_id=c;
   perform public.apply_business_context_command(p,c,actor,jsonb_build_object('action','manager_control','key',extensions.gen_random_uuid(),'expectedRevision',authority,'operation','pause'));
  elsif label='new_crm_reply' then insert into public.crm_communications(partner_id,client_id,contact_id,channel,direction,status,body,created_at) values(p,c,person,'email','inbound','received','Synthetic corrected billing instructions received after review',now()-interval '1 minute');
  else insert into public.business_conversation_messages(partner_id,client_id,conversation_id,external_key,direction,status,body) values(p,c,thread,'mf-__RUN_ID__-new-verified-reply','inbound','received','Synthetic verified-channel billing response received after review'); end if;
  check_result:=public.invoice_followup_action_check(p,c,proposal,null);
  if check_result->>'allowed' is distinct from 'false' then raise exception 'Invoice final source/customer guard accepted interruption: %',label; end if;
  denied:=false;
  begin update public.approval_items set status='approved',resolved_by=actor where id=proposal;
  exception when sqlstate 'PT409' then denied:=true; end;
  if not denied or exists(select 1 from public.action_jobs where approval_id=proposal) then raise exception 'Interrupted invoice approval enqueued: %',label; end if;
  -- Ordinary owner rejection retires this unsent decision; no resolved history
  -- is altered to manufacture a new positive control for the next case.
  update public.approval_items set status='rejected',resolved_by=actor where id=proposal and status='pending';
  if label='suppressed' then update public.crm_contacts set tags='{}' where id=person;
  elsif label='takeover' then update public.business_conversations set mode='agent' where id=thread;
  elsif label='opted_out' then update public.business_conversations set opted_out=false where id=thread;
  elsif label='delivery_paused' then update public.integration_connections set runtime_mode='live' where id=sender;
  elsif label='grant_removed' then update public.integration_connections set config=jsonb_set(config,'{google_action_permissions,email_send}','true') where id=sender;
  elsif label='manager_paused' then
   select authority_revision into authority from public.agent_team_settings where partner_id=p and client_id=c;
   perform public.apply_business_context_command(p,c,actor,jsonb_build_object('action','manager_control','key',extensions.gen_random_uuid(),'expectedRevision',authority,'operation','resume'));
  end if;
 end loop;
end $interruptions$;

-- Group 7: uncertain effects block new keys without changing their outcome.
-- A source-only handoff is durable, replayable work with no customer message.
do $outcome_and_handoff$ declare control jsonb; proposal uuid; job_id uuid; command jsonb; result jsonb; again jsonb; before_job jsonb; handoff_source uuid; src public.integration_canonical_records;
 p uuid:=(select id from mf_fixture where key='partner-a'); c uuid:=(select id from mf_fixture where key='client-a'); actor uuid:=(select id from mf_fixture where key='owner-a');
begin
 control:=pg_temp.mf_control('uncertain'); proposal:=(control->'receipt'->>'approvalId')::uuid;
 update public.approval_items set status='approved',resolved_by=actor where id=proposal;
 select id into job_id from public.action_jobs where approval_id=proposal;
 -- A synthetic historical transport result is not a real delivery receipt.
 update public.action_jobs set status='uncertain',last_attempt_at=now(),attempt_count=1,outcome_detail='Synthetic saved transport ambiguity; no provider call made' where id=job_id;
 select to_jsonb(j) into before_job from public.action_jobs j where id=job_id;
 perform pg_temp.mf_reject(pg_temp.mf_command((control->'receipt'->>'sourceRecordId')::uuid),'do not repeat uncertain invoice email');
 again:=public.prepare_invoice_followup(p,c,actor,control->'command');
 if again->>'replayed' is distinct from 'true' or again->>'id' is distinct from control->'receipt'->>'id' or before_job is distinct from (select to_jsonb(j) from public.action_jobs j where id=job_id) then raise exception 'Uncertain invoice history changed or exact request did not replay'; end if;
 -- This helper inserts a fixture. Evaluate it once, outside a row predicate.
 handoff_source:=pg_temp.mf_invoice('handoff');
 select * into src from public.integration_canonical_records where id=handoff_source;
 command:=jsonb_build_object('owner_request',jsonb_build_object('action','handoff_invoice_followup','key',extensions.gen_random_uuid(),'targetId',src.id,'connectionId',src.connection_id,'expectedRevision','synthetic-source-reviewed-for-handoff','note','Owner chose to review identity and balance in Stripe first.'),'expectedSourceUpdatedAt',src.updated_at);
 result:=public.prepare_invoice_followup(p,c,actor,command); again:=public.prepare_invoice_followup(p,c,actor,command);
 if result->>'approvalId' is not null or again->>'id' is distinct from result->>'id' or again->>'replayed' is distinct from 'true'
  or not exists(select 1 from public.crm_tasks where id=(result->>'taskId')::uuid and source_invoice_record_id=src.id and task_type='invoice_followup_review')
  or exists(select 1 from public.approval_items where proposed_payload->>'source_record_id'=src.id::text) then raise exception 'Source-only handoff produced outreach, duplicate work or no exact source task'; end if;
end $outcome_and_handoff$;

-- Group 8: RPC privileges are enforced for actual browser roles, and an owner
-- of another business cannot read these shared tasks/approvals through RLS.
do $task_source_scope$ declare foreign_source uuid; denied boolean:=false; own_task uuid;
 p uuid:=(select id from mf_fixture where key='partner-a'); c uuid:=(select id from mf_fixture where key='client-a');
 other_p uuid:=(select id from mf_fixture where key='partner-b'); other_c uuid:=(select id from mf_fixture where key='client-b'); other_source uuid:=(select id from mf_fixture where key='stripe-b');
begin
 perform public.persist_owner_import_record(other_p,other_c,other_source,'invoice','in_mf_'||replace('__RUN_ID__','-','')||'_foreign',null,'{"status":"open"}','{}',now(),now());
 select id into foreign_source from public.integration_canonical_records where connection_id=other_source and object_type='invoice';
 begin insert into public.crm_tasks(partner_id,client_id,title,source_invoice_record_id) values(p,c,'Synthetic invalid cross-business invoice task',foreign_source);
 exception when raise_exception then if sqlerrm not like '%same business%' then raise; end if; denied:=true; end;
 if not denied then raise exception 'Service invoice task accepted a foreign source record'; end if;
 select id into own_task from public.crm_tasks where source_invoice_record_id=(select id from mf_fixture where key='invoice-positive');
 denied:=false;
 begin update public.crm_tasks set source_invoice_record_id=null where id=own_task;
 exception when raise_exception then if sqlerrm not like '%immutable%' then raise; end if; denied:=true; end;
 if not denied then raise exception 'An existing invoice task lost its immutable source provenance'; end if;
end $task_source_scope$;
do $grants$ declare signature text; begin
 foreach signature in array array['prepare_invoice_followup(uuid,uuid,uuid,jsonb)','invoice_followup_action_check(uuid,uuid,uuid,uuid)','invoice_followup_source_check(uuid,uuid,uuid,uuid)'] loop
  if has_function_privilege('anon','public.'||signature,'EXECUTE') or has_function_privilege('authenticated','public.'||signature,'EXECUTE') or not has_function_privilege('service_role','public.'||signature,'EXECUTE') then raise exception 'Money RPC role grant mismatch: %',signature; end if;
 end loop;
end $grants$;
reset role;
set local role anon;
select set_config('request.jwt.claim.role','anon',true);
do $anon$ declare denied boolean:=false; begin
 begin perform public.prepare_invoice_followup(null,null,null,'{}'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Anonymous caller executed invoice preparation'; end if;
 denied:=false;
 begin perform public.invoice_followup_action_check(null,null,null,null); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Anonymous caller executed privileged invoice policy'; end if;
end $anon$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',(select id::text from mf_fixture where key='owner-b'),true);
do $other_owner$ declare denied boolean:=false; begin
 begin perform public.prepare_invoice_followup(null,null,null,'{}'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Browser owner executed privileged invoice RPC'; end if;
 if exists(select 1 from public.crm_tasks where source_invoice_record_id is not null) or exists(select 1 from public.approval_items where proposed_payload->>'invoice_followup_version'='1') then raise exception 'Another business owner read invoice follow-up work'; end if;
end $other_owner$;
select set_config('request.jwt.claim.sub',(select id::text from mf_fixture where key='owner-a'),true);
do $own_read$ declare ordinary_task uuid; denied boolean:=false; p uuid:=(select id from mf_fixture where key='partner-a'); c uuid:=(select id from mf_fixture where key='client-a'); begin
 if not exists(select 1 from public.crm_tasks where source_invoice_record_id is not null) or not exists(select 1 from public.approval_items where proposed_payload->>'invoice_followup_version'='1') then raise exception 'Actual invoice owner cannot read its shared review work'; end if;
 insert into public.crm_tasks(partner_id,client_id,title) values(p,c,'Synthetic ordinary owner task') returning id into ordinary_task;
 update public.crm_tasks set title='Synthetic ordinary task edit remains allowed' where id=ordinary_task;
 begin update public.crm_tasks set source_invoice_record_id=(select id from mf_fixture where key='invoice-positive') where id=ordinary_task;
 exception when raise_exception then if sqlerrm not like '%Only verified invoice review%' then raise; end if; denied:=true; end;
 if not denied or not exists(select 1 from public.crm_tasks where id=ordinary_task and source_invoice_record_id is null and title='Synthetic ordinary task edit remains allowed') then raise exception 'Browser source binding was allowed or ordinary task editing was broken'; end if;
end $own_read$;
reset role;

-- Group 9: unresolved generic replies serialize outreach on the EXACT verified
-- conversation, even without a money marker. Each status gets a fresh thread
-- and positive control; accepted/uncertain rows and their claims are preserved.
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $unresolved_thread$ declare saved_status text; thread_id uuid; other_thread uuid; other_proposal uuid; other_job uuid; legacy_proposal uuid; legacy_job uuid; money_proposal uuid;
 control jsonb; check_result jsonb; generic_pin jsonb; before_job jsonb; before_proposal jsonb; before_other_job jsonb; denied boolean; authority integer;
 p uuid:=(select id from mf_fixture where key='partner-a'); c uuid:=(select id from mf_fixture where key='client-a'); actor uuid:=(select id from mf_fixture where key='owner-a'); sender uuid:=(select id from mf_fixture where key='email-a'); person uuid:=(select id from mf_fixture where key='contact-a');
 reason text:='Reconcile the existing unresolved message action on this exact customer conversation before preparing another reminder.';
begin
 select authority_revision into authority from public.agent_team_settings where partner_id=p and client_id=c;
 insert into public.business_conversations(partner_id,client_id,connection_id,channel,external_thread_id,contact_id,identity_status,mode,state)
 values(p,c,sender,'email','synthetic-other-thread-__RUN_ID__@synthetic.invalid',person,'owner_verified','agent','open') returning id into other_thread;
 generic_pin:=jsonb_build_object('conversation_id',other_thread,'conversation_revision',1,'connection_id',sender,'channel','email','to','synthetic-other-thread-__RUN_ID__@synthetic.invalid','authority_revision',authority);
 insert into public.approval_items(partner_id,client_id,type,status,title,proposed_payload,editable_content,resolved_content,resolved_by,resolved_at)
 values(p,c,'customer_message','approved','Synthetic other-thread approved reply',generic_pin,'Synthetic historical reply; no provider call made.','Synthetic historical reply; no provider call made.',actor,now()-interval '1 minute') returning id into other_proposal;
 insert into public.action_jobs(partner_id,client_id,connection_id,approval_id,kind,status,payload,claim_token,claimed_at,last_attempt_at,attempt_count)
 select p,c,sender,other_proposal,'email.send','processing',a.proposed_payload||jsonb_build_object('body',a.resolved_content),extensions.gen_random_uuid(),now()-interval '1 minute',now()-interval '1 minute',1 from public.approval_items a where a.id=other_proposal returning id into other_job;
 select to_jsonb(j) into before_other_job from public.action_jobs j where j.id=other_job;
 foreach saved_status in array array['pending','processing','provider_pending','uncertain','failed','succeeded'] loop
  insert into public.business_conversations(partner_id,client_id,connection_id,channel,external_thread_id,contact_id,identity_status,mode,state)
  values(p,c,sender,'email','synthetic-thread-'||saved_status||'-__RUN_ID__@synthetic.invalid',person,'owner_verified','agent','open') returning id into thread_id;
  update mf_fixture set id=thread_id where key='conversation-a';
  -- This succeeds while other_job is still processing on another verified
  -- thread of the same contact, proving the guard uses exact thread identity.
  control:=pg_temp.mf_control('thread-'||saved_status); money_proposal:=(control->'receipt'->>'approvalId')::uuid;
  generic_pin:=jsonb_build_object('conversation_id',thread_id,'conversation_revision',1,'connection_id',sender,'channel','email','to','synthetic-thread-'||saved_status||'-__RUN_ID__@synthetic.invalid','authority_revision',authority);
  insert into public.approval_items(partner_id,client_id,type,status,title,proposed_payload,editable_content,resolved_content,resolved_by,resolved_at)
  values(p,c,'customer_message','approved','Synthetic existing generic reply '||saved_status,generic_pin,'Synthetic historical generic reply; no provider call made.','Synthetic historical generic reply; no provider call made.',actor,now()-interval '1 minute') returning id into legacy_proposal;
  insert into public.action_jobs(partner_id,client_id,connection_id,approval_id,kind,status,payload,claim_token,claimed_at,last_attempt_at,attempt_count,external_ref,receipt_recorded_at)
  select p,c,sender,legacy_proposal,'email.send',saved_status,a.proposed_payload||jsonb_build_object('body',a.resolved_content),
   case when saved_status='processing' then extensions.gen_random_uuid() else null end,
   case when saved_status in ('processing','provider_pending','uncertain') then now()-interval '1 minute' else null end,
   case when saved_status='pending' then null else now()-interval '1 minute' end,case when saved_status='pending' then 0 else 1 end,
   case when saved_status='succeeded' then 'synthetic-recorded-message-__RUN_ID__' else null end,
   case when saved_status='succeeded' then now()-interval '1 minute' else null end
  from public.approval_items a where a.id=legacy_proposal returning id into legacy_job;
  select to_jsonb(j) into before_job from public.action_jobs j where j.id=legacy_job;
  select to_jsonb(a) into before_proposal from public.approval_items a where a.id=legacy_proposal;
  check_result:=public.invoice_followup_action_check(p,c,money_proposal,null);
  if saved_status='succeeded' then
   if check_result->>'allowed' is distinct from 'true' then raise exception 'Completed generic message history permanently blocked a later reviewed invoice: %',check_result->>'reason'; end if;
  else
   if check_result->>'allowed' is distinct from 'false' or check_result->>'reason' is distinct from reason then raise exception 'Unresolved same-thread generic % message did not block the invoice for the exact expected reason: %',saved_status,check_result->>'reason'; end if;
   denied:=false;
   begin update public.approval_items set status='approved',resolved_by=actor where id=money_proposal;
   exception when sqlstate 'PT409' then if sqlerrm is distinct from reason then raise; end if; denied:=true; end;
   if not denied or not exists(select 1 from public.approval_items where id=money_proposal and status='pending') or exists(select 1 from public.action_jobs where approval_id=money_proposal) then raise exception 'Invoice approval queued beside unresolved same-thread message: %',saved_status; end if;
  end if;
  if before_job is distinct from (select to_jsonb(j) from public.action_jobs j where j.id=legacy_job)
   or before_proposal is distinct from (select to_jsonb(a) from public.approval_items a where a.id=legacy_proposal)
   or before_other_job is distinct from (select to_jsonb(j) from public.action_jobs j where j.id=other_job) then raise exception 'Invoice guard rewrote existing generic outcome, claim or immutable approval: %',saved_status; end if;
 end loop;
 if (select data from mf_fixture where key='processing-history') is distinct from (select to_jsonb(j) from public.action_jobs j where j.id=(select id from mf_fixture where key='processing-history')) then raise exception 'Independent conversation controls changed the original processing invoice history'; end if;
end $unresolved_thread$;
reset role;
rollback;
select '__CUSTOMER_JOURNEY_REPORT__'::text||jsonb_build_object('kind','money_followup_acceptance','rolledBack',true,'remainingFixtures',
 (select count(*) from public.partners where slug like 'cj-acceptance-__RUN_ID__-money-%')+(select count(*) from auth.users where email like 'cj-acceptance-__RUN_ID__-money-%@synthetic.invalid'),
 'checks',jsonb_build_array('accepted_owner_prepares_shared_review_without_crm_or_source_writes','receipt_replay_and_same_account_invoice_dedupe','immutable_financial_template_claim_and_paid_execution_guard',
 'exact_source_customer_recipient_scope_and_decision_atomicity','balance_collection_fresh_complete_peer_source_policy','source_activity_suppression_account_and_authority_interruptions','uncertain_outcome_preservation_and_source_handoff','actual_browser_rpc_denial_and_scoped_work_rls','unresolved_exact_thread_generic_message_guard_and_history_preservation'))::text as cj_report;
