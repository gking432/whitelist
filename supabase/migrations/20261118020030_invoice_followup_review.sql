-- One deliberately reviewed invoice email through the existing approval/outbox.
-- Stripe remains a read-only source. No invoice/customer/payment mutation is authorized.
alter table public.crm_tasks add column source_invoice_record_id uuid references public.integration_canonical_records(id);
create unique index crm_tasks_invoice_followup_source on public.crm_tasks(partner_id,client_id,source_invoice_record_id) where source_invoice_record_id is not null;

create function public.guard_invoice_task_source() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and old.source_invoice_record_id is not null and new.source_invoice_record_id is distinct from old.source_invoice_record_id then raise exception 'Invoice task source provenance is immutable'; end if;
 if new.source_invoice_record_id is null then return new; end if;
 if tg_op='UPDATE' and new.source_invoice_record_id is not distinct from old.source_invoice_record_id and new.partner_id is not distinct from old.partner_id and new.client_id is not distinct from old.client_id then return new; end if;
 if current_user not in ('service_role','postgres','supabase_admin') then raise exception 'Only verified invoice review may bind a task source'; end if;
 if not exists(select 1 from public.integration_canonical_records r join public.integration_connections c on c.id=r.connection_id and c.partner_id=r.partner_id and c.client_id=r.client_id join public.integration_providers p on p.id=c.provider_id where r.id=new.source_invoice_record_id and r.partner_id=new.partner_id and r.client_id=new.client_id and r.object_type='invoice' and p.provider_key='stripe') then raise exception 'Invoice task source must belong to the same business'; end if;
 return new;
end $$;
create trigger guard_invoice_task_source before insert or update of source_invoice_record_id,partner_id,client_id on public.crm_tasks for each row execute function public.guard_invoice_task_source();

create function public.invoice_followup_source_check(p_partner uuid,p_client uuid,p_source uuid,p_connection uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare src public.integration_canonical_records; account public.integration_connections; facts jsonb; peers uuid[]; n integer;
begin
 select * into account from public.integration_connections where id=p_connection and partner_id=p_partner and client_id=p_client;
 select * into src from public.integration_canonical_records where id=p_source and connection_id=p_connection and partner_id=p_partner and client_id=p_client and object_type='invoice'; facts:=src.canonical_data;
 if src.id is null or account.id is null or account.status<>'connected' or account.runtime_mode='paused' or account.credential_status<>'configured'
  or coalesce(account.external_account_id,'') !~ '^acct_[A-Za-z0-9_]{1,250}$' or coalesce(src.external_object_id,'') !~ '^in_[A-Za-z0-9_]{1,250}$' or not exists(select 1 from public.integration_providers where id=account.provider_id and provider_key='stripe') then return jsonb_build_object('allowed',false,'reason','Verify and resume the exact Stripe invoice source.'); end if;
 if jsonb_typeof(facts->'amount_due_minor') is distinct from 'number' or jsonb_typeof(facts->'amount_paid_minor') is distinct from 'number' or jsonb_typeof(facts->'total_minor') is distinct from 'number' or facts->'deleted'='true'::jsonb or facts->>'status' is distinct from 'open' or facts->'livemode' is distinct from 'true'::jsonb or facts->>'collection_method' is distinct from 'send_invoice'
  or coalesce(facts->>'amount_due_minor','') !~ '^[0-9]+$' or (facts->>'amount_due_minor')::numeric not between 1 and 9007199254740991
  or coalesce(facts->>'amount_paid_minor','') !~ '^[0-9]+$' or (facts->>'amount_paid_minor')::numeric>9007199254740991
  or coalesce(facts->>'total_minor','') !~ '^[0-9]+$' or (facts->>'total_minor')::numeric>9007199254740991
  or coalesce(facts->>'currency','') not in ('USD','CAD','EUR','GBP','AUD','NZD','JPY','CHF','SEK','NOK','DKK','SGD','HKD','KWD','BHD','OMR','ISK','UGX') or coalesce(facts->>'customer_id','') !~ '^cus_[A-Za-z0-9_]{1,250}$' or (facts->>'number' is not null and length(facts->>'number') not between 1 and 500) or (facts->>'hosted_url' is not null and (length(facts->>'hosted_url')>3000 or facts->>'hosted_url' !~ '^https://invoice\.stripe\.com/[^[:space:]]*$'))
  or coalesce(facts->>'due_date','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or (facts->>'due_date')::timestamptz>now() then return jsonb_build_object('allowed',false,'reason','Only an overdue open live invoice with a known positive balance and manual collection can have this reminder. Review other invoices in Stripe.'); end if;
 if src.snapshot_observed_at is null or src.snapshot_observed_at<now()-interval '45 minutes' or src.snapshot_observed_at>now() then return jsonb_build_object('allowed',false,'reason','Refresh the exact invoice before preparing a reminder.'); end if;
 select array_agg(i.id) into peers from public.integration_connections i where i.partner_id=p_partner and i.client_id=p_client and i.provider_id=account.provider_id and i.external_account_id=account.external_account_id;
 if coalesce(cardinality(peers),0)>100 then return jsonb_build_object('allowed',false,'reason','Invoice account coverage is incomplete.'); end if;
 select count(*) into n from public.integration_canonical_records r where r.partner_id=p_partner and r.client_id=p_client and r.connection_id=any(peers) and r.object_type='invoice' and r.external_object_id=src.external_object_id;
 if n>100 or exists(select 1 from public.integration_canonical_records r where r.partner_id=p_partner and r.client_id=p_client and r.connection_id=any(peers) and r.object_type='invoice' and r.external_object_id=src.external_object_id and
  ((r.canonical_data-array['observed_at','source_event_at','source_updated_at','source_created_at']) is distinct from (facts-array['observed_at','source_event_at','source_updated_at','source_created_at']) or r.snapshot_observed_at is null or r.snapshot_observed_at<now()-interval '45 minutes' or r.snapshot_observed_at>now())) then return jsonb_build_object('allowed',false,'reason','Exact invoice sources disagree or are stale. Reconcile the Stripe imports first.'); end if;
 if exists(select 1 from unnest(peers) peer where not exists(select 1 from public.integration_sync_states s where s.partner_id=p_partner and s.client_id=p_client and s.connection_id=peer and s.stream_key='invoice' and s.status not in ('paused','failing') and nullif(s.last_error,'') is null and s.last_completed_at between now()-interval '45 minutes' and now() and coalesce(s.cursor_value->>'has_more','false')<>'true' and nullif(s.cursor_value->>'after','') is null and nullif(s.cursor_value->>'starting_after','') is null and nullif(s.cursor_value->>'pageToken','') is null and nullif(s.cursor_value->>'nextLink','') is null))
  or exists(select 1 from public.integration_sync_jobs q where q.partner_id=p_partner and q.client_id=p_client and q.connection_id=any(peers) and q.object_type='invoice' and q.direction='pull' and q.status in ('queued','running','failed','dead_letter')) then return jsonb_build_object('allowed',false,'reason','The invoice import is incomplete or needs attention. Refresh before following up.'); end if;
 return jsonb_build_object('allowed',true,'reason','Current exact invoice source is eligible.');
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return jsonb_build_object('allowed',false,'reason','Invoice facts are incomplete or invalid.');
end $$;

create function public.invoice_followup_action_check(p_partner uuid,p_client uuid,p_approval uuid,p_job uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare proposal public.approval_items; pin jsonb; src public.integration_canonical_records; stripe public.integration_connections; sender public.integration_connections;
 customer public.crm_contacts; thread public.business_conversations; settings public.agent_team_settings; owner_receipt public.business_owner_commands; current_job public.action_jobs; facts jsonb; check_result jsonb; activity jsonb;
begin
 select * into proposal from public.approval_items where id=p_approval and partner_id=p_partner and client_id=p_client; pin:=proposal.proposed_payload;
 if proposal.id is null or proposal.type<>'customer_message' or proposal.status not in ('pending','approved','edited_and_approved') or pin->'invoice_followup_version' is distinct from '1'::jsonb or proposal.expires_at is null or proposal.expires_at<=now() then return jsonb_build_object('allowed',false,'reason','The exact current invoice approval is unavailable or expired.'); end if;
 select * into owner_receipt from public.business_owner_commands where id=(pin->>'money_review_id')::uuid and partner_id=p_partner and client_id=p_client;
 if owner_receipt.id is null or owner_receipt.command->'owner_request'->>'action' is distinct from 'prepare_invoice_followup' or owner_receipt.command->'owner_request'->'identityConfirmed' is distinct from 'true'::jsonb or owner_receipt.command->'owner_request'->'outreachPermissionConfirmed' is distinct from 'true'::jsonb or owner_receipt.result->>'approvalId' is distinct from proposal.id::text or owner_receipt.command->'pin' is distinct from pin-'subject'-'human_authored' then return jsonb_build_object('allowed',false,'reason','The explicit invoice identity and billing-contact permission review is unavailable.'); end if;
 select * into src from public.integration_canonical_records where id=(pin->>'source_record_id')::uuid and partner_id=p_partner and client_id=p_client and connection_id=(pin->>'stripe_connection_id')::uuid and object_type='invoice'; facts:=src.canonical_data;
 select * into stripe from public.integration_connections where id=src.connection_id and partner_id=p_partner and client_id=p_client;
 check_result:=public.invoice_followup_source_check(p_partner,p_client,src.id,stripe.id);
 if check_result->>'allowed' is distinct from 'true' then return check_result; end if;
 if src.updated_at is distinct from (pin->>'source_updated_at')::timestamptz or src.external_updated_at is distinct from (pin->>'source_external_updated_at')::timestamptz or src.external_object_id is distinct from pin->>'invoice_id' or stripe.external_account_id is distinct from pin->>'stripe_account_id'
  or facts->>'customer_id' is distinct from pin->>'stripe_customer_id' or facts->'amount_due_minor' is distinct from pin->'amount_due_minor' or facts->'amount_paid_minor' is distinct from pin->'amount_paid_minor' or facts->'total_minor' is distinct from pin->'total_minor' or facts->>'currency' is distinct from pin->>'currency' or facts->>'collection_method' is distinct from pin->>'collection_method'
  or (facts->>'due_date')::timestamptz is distinct from (pin->>'due_at')::timestamptz or facts->>'hosted_url' is distinct from pin->>'hosted_invoice_url' or facts->>'number' is distinct from pin->>'invoice_number' then return jsonb_build_object('allowed',false,'reason','The invoice balance, status, account or source version changed. Prepare a fresh review.'); end if;
 select * into customer from public.crm_contacts where id=(pin->>'contact_id')::uuid and partner_id=p_partner and client_id=p_client;
 select * into thread from public.business_conversations where id=(pin->>'conversation_id')::uuid and partner_id=p_partner and client_id=p_client;
 select * into sender from public.integration_connections where id=(pin->>'connection_id')::uuid and partner_id=p_partner and client_id=p_client;
 select * into settings from public.agent_team_settings where partner_id=p_partner and client_id=p_client;
 if customer.id is null or customer.updated_at is distinct from (pin->>'contact_updated_at')::timestamptz or customer.tags is null or exists(select 1 from unnest(customer.tags) tag where lower(regexp_replace(btrim(tag),'[[:space:]-]+','_','g')) in ('do_not_contact','opt_out','opted_out','unsubscribed','stop'))
  or thread.id is null or thread.contact_id is distinct from customer.id or thread.identity_status<>'owner_verified' or thread.channel<>'email' or thread.connection_id is distinct from sender.id or thread.external_thread_id is distinct from pin->>'to' or thread.revision is distinct from (pin->>'conversation_revision')::integer or thread.mode<>'agent' or thread.opted_out or thread.state='closed'
  or pin->>'channel' is distinct from 'email' or sender.id is null or sender.status<>'connected' or sender.runtime_mode<>'live' or sender.credential_status<>'configured'
  or settings.authority_revision is distinct from (pin->>'authority_revision')::integer or settings.channel_authority->>'email' is distinct from 'require_approval' or not public.business_channel_can_draft(p_partner,p_client,'email',sender.id)
  or not exists(select 1 from public.integration_providers provider where provider.id=sender.provider_id and provider.provider_key in ('google_workspace','microsoft_365','resend')) then return jsonb_build_object('allowed',false,'reason','Current verified customer, recipient, account or reviewed email authority no longer permits this reminder.'); end if;
 if sender.config->>'workspace_view_only'='true' and (sender.config->>'activation_mail_verified' is distinct from 'true' or nullif(sender.config->>'activation_checked_at','') is null or (sender.config->>'activation_checked_at')::timestamptz not between now()-interval '24 hours' and now()+interval '1 minute') then return jsonb_build_object('allowed',false,'reason','Recheck the exact selected email permission before following up.'); end if;
 if exists(select 1 from public.business_conversations c where c.partner_id=p_partner and c.client_id=p_client and c.contact_id=customer.id and c.identity_status='owner_verified' and (c.opted_out or (c.mode='human' and c.state<>'closed'))) then return jsonb_build_object('allowed',false,'reason','Customer opt-out or owner takeover stops this reminder.'); end if;
 activity:=public.calendar_mutation_latest_activity(p_partner,p_client,customer.id);
 if activity->>'id' is distinct from pin->>'customer_activity_id' or (activity->>'at')::timestamptz is distinct from (pin->>'customer_activity_at')::timestamptz then return jsonb_build_object('allowed',false,'reason','The customer replied or current instructions changed. Review the invoice again.'); end if;
 if exists(select 1 from public.approval_items a where a.partner_id=p_partner and a.client_id=p_client and a.id<>proposal.id and a.type='customer_message' and a.status='pending' and a.proposed_payload->>'conversation_id'=thread.id::text) then return jsonb_build_object('allowed',false,'reason','Review the other pending customer message before sending an invoice reminder.'); end if;
 if exists(select 1 from public.action_jobs j where j.partner_id=p_partner and j.client_id=p_client and j.approval_id is distinct from proposal.id and j.kind in ('email.send','sms.send','conversation.send') and j.payload->>'conversation_id'=thread.id::text and j.status in ('pending','processing','provider_pending','uncertain','failed')) then return jsonb_build_object('allowed',false,'reason','Reconcile the existing unresolved message action on this exact customer conversation before preparing another reminder.'); end if;
 if exists(select 1 from public.action_jobs j join public.approval_items a on a.id=j.approval_id where j.partner_id=p_partner and j.client_id=p_client and a.partner_id=p_partner and a.client_id=p_client and a.id<>proposal.id and a.proposed_payload->>'invoice_followup_version'='1' and a.proposed_payload->>'stripe_account_id'=stripe.external_account_id and a.proposed_payload->>'invoice_id'=src.external_object_id and j.status not in ('cancelled','skipped','dry_run')) then return jsonb_build_object('allowed',false,'reason','An invoice reminder already has an action outcome. Reconcile it without repeating the send.'); end if;
 if p_job is not null then
  select * into current_job from public.action_jobs where id=p_job and approval_id=proposal.id and partner_id=p_partner and client_id=p_client;
  if proposal.status not in ('approved','edited_and_approved') or current_job.id is null or current_job.kind<>'email.send' or current_job.status<>'processing' or current_job.payload-'body' is distinct from pin then return jsonb_build_object('allowed',false,'reason','The exact claimed invoice reminder is unavailable.'); end if;
 end if;
 return jsonb_build_object('allowed',true,'reason','Current invoice, explicit identity, permission and source pins agree.');
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return jsonb_build_object('allowed',false,'reason','Invoice follow-up pins are invalid.');
end $$;

create function public.prepare_invoice_followup(p_partner uuid,p_client uuid,p_actor uuid,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare public_request jsonb:=p_command->'owner_request'; pin jsonb:=p_command->'pin'; prior public.business_owner_commands; src public.integration_canonical_records; account public.integration_connections; customer public.crm_contacts; thread public.business_conversations;
 request_id uuid; receipt_id uuid; proposal_id uuid; task_id uuid; result jsonb; check_result jsonb; body_text text:=p_command->>'body'; subject_text text:=p_command->>'subject';
begin
 if p_actor is null or jsonb_typeof(public_request) is distinct from 'object' or public_request->>'action' not in ('prepare_invoice_followup','handoff_invoice_followup') or public_request-array['action','key','targetId','connectionId','expectedRevision','recipientConversationId','expectedRecipientRevision','identityConfirmed','outreachPermissionConfirmed','note']<>'{}'::jsonb or nullif(public_request->>'expectedRevision','') is null or length(coalesce(public_request->>'note',''))>2000 then raise exception 'Invalid invoice review command' using errcode='22023'; end if;
 request_id:=(public_request->>'key')::uuid;
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner and status='active' for update;
 if not found or request_id is null then raise exception 'Business or request unavailable' using errcode='40001'; end if;
 select * into prior from public.business_owner_commands c where c.partner_id=p_partner and c.client_id=p_client and c.request_key=request_id;
 if prior.id is not null then
  if prior.actor_id is distinct from p_actor or prior.command->'owner_request' is distinct from public_request then raise exception 'This key belongs to a different invoice decision' using errcode='40001'; end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 select * into account from public.integration_connections where id=(public_request->>'connectionId')::uuid and partner_id=p_partner and client_id=p_client for update;
 select * into src from public.integration_canonical_records where id=(public_request->>'targetId')::uuid and connection_id=account.id and partner_id=p_partner and client_id=p_client and object_type='invoice' for update;
 if src.id is null or not exists(select 1 from public.integration_providers where id=account.provider_id and provider_key='stripe') then raise exception 'Exact Stripe invoice unavailable' using errcode='40001'; end if;
 select t.id into task_id from public.crm_tasks t where t.partner_id=p_partner and t.client_id=p_client and t.source_invoice_record_id=src.id for update;
 if public_request->>'action'='handoff_invoice_followup' then
  if src.updated_at is distinct from (p_command->>'expectedSourceUpdatedAt')::timestamptz or public_request ?| array['recipientConversationId','expectedRecipientRevision','identityConfirmed','outreachPermissionConfirmed'] then raise exception 'The exact source review changed' using errcode='40001'; end if;
  if task_id is null then insert into public.crm_tasks(partner_id,client_id,title,description,status,priority,task_type,source_invoice_record_id,created_by)
   values(p_partner,p_client,'Review invoice follow-up in source app','Invoice '||coalesce(src.canonical_data->>'number',src.external_object_id)||'. Check the actual source balance, customer identity and permission before contacting anyone. '||coalesce(public_request->>'note',''),'open','medium','invoice_followup_review',src.id,p_actor) returning id into task_id; end if;
  receipt_id:=extensions.gen_random_uuid();
 else
  if public_request->'identityConfirmed' is distinct from 'true'::jsonb or public_request->'outreachPermissionConfirmed' is distinct from 'true'::jsonb or jsonb_typeof(pin) is distinct from 'object' or pin->'invoice_followup_version' is distinct from '1'::jsonb or pin->>'source_record_id' is distinct from src.id::text or pin->>'stripe_connection_id' is distinct from account.id::text or public_request->>'recipientConversationId' is distinct from pin->>'conversation_id' or length(btrim(coalesce(body_text,''))) not between 1 and 5000 or length(coalesce(subject_text,'')) not between 1 and 300 then raise exception 'Explicit reviewed invoice identity and billing-contact permission are required' using errcode='22023'; end if;
  receipt_id:=(pin->>'money_review_id')::uuid;
  perform 1 from public.integration_connections where id=(pin->>'connection_id')::uuid and partner_id=p_partner and client_id=p_client for update;
  select * into thread from public.business_conversations where id=(pin->>'conversation_id')::uuid and partner_id=p_partner and client_id=p_client for update;
  select * into customer from public.crm_contacts where id=(pin->>'contact_id')::uuid and partner_id=p_partner and client_id=p_client for update;
  if exists(select 1 from public.approval_items a where a.partner_id=p_partner and a.client_id=p_client and a.proposed_payload->>'invoice_followup_version'='1' and a.proposed_payload->>'stripe_account_id'=account.external_account_id and a.proposed_payload->>'invoice_id'=src.external_object_id and
   (a.status not in ('rejected','expired') or exists(select 1 from public.action_jobs j where j.approval_id=a.id and j.partner_id=p_partner and j.client_id=p_client and (j.status in ('processing','provider_pending','uncertain','succeeded','failed','pending') or j.external_ref is not null)))) then raise exception 'Review the existing invoice reminder and its action outcome. Do not prepare a duplicate send' using errcode='40001'; end if;
  if task_id is null then insert into public.crm_tasks(partner_id,client_id,contact_id,lead_id,title,description,status,priority,task_type,source_invoice_record_id,created_by)
   values(p_partner,p_client,customer.id,thread.lead_id,'Review invoice payment reminder','One source-backed billing follow-up is prepared for explicit owner approval. No payment or Stripe change is authorized.','open','medium','invoice_followup',src.id,p_actor) returning id into task_id; end if;
  insert into public.approval_items(partner_id,client_id,type,status,title,summary,risk_level,proposed_payload,editable_content,expires_at)
   values(p_partner,p_client,'customer_message','pending','Review invoice payment reminder','One email to the explicitly verified billing contact. Balance, source, customer, permission and account are rechecked before delivery. No Stripe changes.','medium',pin||jsonb_build_object('subject',subject_text,'human_authored',false),body_text,now()+interval '30 minutes') returning id into proposal_id;
 end if;
 result:=jsonb_build_object('id',receipt_id,'sourceRecordId',src.id,'taskId',task_id,'approvalId',proposal_id,'replayed',false,'message',case when proposal_id is null then 'Source-linked invoice review task saved. No customer message was prepared or sent.' else 'Invoice email prepared in Approvals for your review. Nothing was sent.' end);
 insert into public.business_owner_commands(id,partner_id,client_id,actor_id,request_key,command,result) values(receipt_id,p_partner,p_client,p_actor,request_id,p_command,result);
 if proposal_id is not null then
  check_result:=public.invoice_followup_action_check(p_partner,p_client,proposal_id);
  if check_result->>'allowed' is distinct from 'true' then raise exception '%',check_result->>'reason' using errcode='40001'; end if;
  insert into public.business_conversation_messages(partner_id,client_id,conversation_id,external_key,direction,body,status,approval_id) values(p_partner,p_client,thread.id,'approval:'||proposal_id,'outbound',body_text,'draft',proposal_id);
  insert into public.crm_communications(partner_id,client_id,contact_id,lead_id,channel,direction,body,status,approval_id,ai_generated,metadata) values(p_partner,p_client,customer.id,thread.lead_id,'email','outbound',body_text,'draft',proposal_id,false,jsonb_build_object('conversation_id',thread.id,'source_invoice_record_id',src.id));
 end if;
 return result;
end $$;

create function public.guard_invoice_followup_approval() returns trigger language plpgsql security invoker set search_path='' as $$
declare safety jsonb;
begin
 if old.proposed_payload->'invoice_followup_version'='1'::jsonb and new.status in ('approved','edited_and_approved') and old.status='pending' then
  if new.resolved_content is distinct from old.editable_content then raise exception 'Review the exact source-backed invoice template; its financial content cannot be edited' using errcode='40001'; end if;
  -- The existing internal definer enqueue trigger performs the privileged source check.
  -- This invoker trigger enforces immutable financial text without privileged reads.
 end if;
 return new;
end $$;
create trigger guard_invoice_followup_approval before update of status on public.approval_items for each row execute function public.guard_invoice_followup_approval();

create function public.stop_stale_invoice_followups() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.object_type='invoice' and ((new.canonical_data-array['observed_at','source_event_at']) is distinct from (old.canonical_data-array['observed_at','source_event_at']) or new.external_updated_at is distinct from old.external_updated_at) then
  update public.action_jobs j set status='cancelled',outcome_detail='Invoice source changed. Review the current balance before preparing another reminder.'
   where j.partner_id=new.partner_id and j.client_id=new.client_id and j.payload->>'invoice_followup_version'='1' and j.payload->>'source_record_id'=new.id::text and j.status in ('pending','failed','dry_run','skipped') and j.external_ref is null;
 end if;
 return new;
end $$;
create trigger stop_stale_invoice_followups after update on public.integration_canonical_records for each row execute function public.stop_stale_invoice_followups();

-- Reuse the existing RLS-authorized internal enqueue trigger; do not expose a new definer RPC.
create or replace function public.enqueue_approved_action()
returns trigger language plpgsql security definer set search_path='' as $$
declare action_kind text; action_payload jsonb; bound_appointment uuid; check_result jsonb;
begin
 if new.status not in ('approved','edited_and_approved') then return new; end if;
 if new.proposed_payload ? 'invoice_followup_version' then
  if new.resolved_content is distinct from new.editable_content then raise exception 'The reviewed invoice financial template cannot be edited' using errcode='40001'; end if;
  check_result:=public.invoice_followup_action_check(new.partner_id,new.client_id,new.id);
  if check_result->>'allowed' is distinct from 'true' then raise exception '%',check_result->>'reason' using errcode='40001'; end if;
 end if;
 if new.type='customer_message' and nullif(btrim(new.resolved_content),'') is not null
  and new.proposed_payload->>'channel' in ('sms','email','website_chat','instagram') then
  action_kind:=case when new.proposed_payload->>'channel' in ('website_chat','instagram') then 'conversation.send' when new.proposed_payload->>'channel'='email' then 'email.send' else 'sms.send' end;
  action_payload:=coalesce(new.proposed_payload,'{}'::jsonb)||jsonb_build_object('body',new.resolved_content);
 elsif new.type='appointment_booking' then
  action_kind:='calendar.book'; action_payload:=coalesce(new.proposed_payload,'{}'::jsonb);
 elsif new.type='appointment_change' and new.proposed_payload->'calendar_mutation_version'='1'::jsonb and new.proposed_payload->>'mutation' in ('cancel','reschedule') then
  -- Serialize with source-pinned follow-up preparation without taking a
  -- conversation lock after this approval row. Final send checks independently
  -- reject approved outstanding changes; do not lock sibling proposals here.
  select n.id into bound_appointment from public.crm_appointments n where n.id::text=new.proposed_payload->>'appointment_id'
   and n.partner_id=new.partner_id and n.client_id=new.client_id and n.approval_id::text=new.proposed_payload->>'booking_approval_id' for update;
  if bound_appointment is null then raise exception 'The exact appointment is unavailable' using errcode='40001'; end if;
  if new.expires_at is null or new.expires_at<=now() then raise exception 'The appointment change expired; prepare a fresh review' using errcode='40001'; end if;
  check_result:=public.calendar_mutation_source_check(new.partner_id,new.client_id,new.proposed_payload,true);
  if check_result->>'allowed' is distinct from 'true' then raise exception '%',check_result->>'reason' using errcode='40001'; end if;
  action_kind:='calendar.'||(new.proposed_payload->>'mutation'); action_payload:=new.proposed_payload;
  -- Freeze future preparation while preserving a separate explicit stop.
  -- Completion may initialize the new effective time after its receipt commits.
  update public.action_jobs set confirmation_due_at=null,booking_followup_due_at=null,
   booking_followup_reason='An approved appointment change is awaiting a verified result.'
   where id::text=new.proposed_payload->>'booking_action_job_id' and approval_id::text=new.proposed_payload->>'booking_approval_id'
    and partner_id=new.partner_id and client_id=new.client_id and kind='calendar.book' and status='succeeded';
 elsif new.type='external_action' and new.embedded_binding_id is not null then
  action_kind:='external.action'; action_payload:=coalesce(new.proposed_payload,'{}'::jsonb);
 else return new; end if;
 insert into public.action_jobs(partner_id,client_id,approval_id,workflow_run_id,kind,payload,status,execution_key)
 values(new.partner_id,new.client_id,new.id,new.workflow_run_id,action_kind,action_payload,'pending','approval:'||new.id)
 on conflict(execution_key) do nothing;
 return new;
end $$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('guard_invoice_task_source','invoice_followup_source_check','invoice_followup_action_check','prepare_invoice_followup','guard_invoice_followup_approval','stop_stale_invoice_followups') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
insert into public.platform_schema_state(singleton,current_migration,applied_at) values(true,'20261118020030_invoice_followup_review',now()) on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;
