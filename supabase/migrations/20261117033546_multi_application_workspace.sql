-- Owner data connections import facts; they never grant agent authority.
alter table public.business_connection_oauth_attempts add column provider_key text;
update public.business_connection_oauth_attempts a set provider_key=p.provider_key
from public.integration_connections c join public.integration_providers p on p.id=c.provider_id where c.id=a.connection_id;
alter table public.business_connection_oauth_attempts alter column provider_key set not null;
alter table public.business_connection_oauth_attempts add check(provider_key in ('google_workspace','microsoft_365'));

create or replace function public.finish_readonly_workspace_oauth(p_attempt uuid,p_encrypted text,p_last_four text,p_account_id text,p_account_name text)
returns void language plpgsql security invoker set search_path='' as $$
declare a public.business_connection_oauth_attempts; c public.integration_connections; provider text;
begin
 select * into strict a from public.business_connection_oauth_attempts where id=p_attempt;
 perform 1 from public.client_businesses where id=a.client_id and partner_id=a.partner_id and status='active' for update;
 if not found then raise exception 'Business unavailable'; end if;
 select * into strict c from public.integration_connections where id=a.connection_id and partner_id=a.partner_id and client_id=a.client_id for update;
 select * into strict a from public.business_connection_oauth_attempts where id=p_attempt for update;
 select provider_key into provider from public.integration_providers where id=c.provider_id;
 if a.consumed_at is null or a.expires_at<now() or provider<>a.provider_key or provider not in ('google_workspace','microsoft_365') then raise exception 'Authorization expired or provider changed'; end if;
 if c.config->>'workspace_view_only' is distinct from 'true' then raise exception 'Connection changed'; end if;
 if c.external_account_id is not null and c.external_account_id<>p_account_id then raise exception 'Reconnect the same account'; end if;
 if exists(select 1 from public.integration_connections other where other.partner_id=a.partner_id and other.client_id=a.client_id and
  other.provider_id=c.provider_id and other.id<>c.id and other.external_account_id=p_account_id and other.config->>'workspace_view_only'='true' and other.status in ('connected','needs_attention')) then
  raise exception 'This account is already connected. Reconnect its existing connection.';
 end if;
 insert into public.integration_secrets(partner_id,client_id,connection_id,secret_kind,encrypted_value,last_four)
 values(a.partner_id,a.client_id,c.id,'provider_credentials',p_encrypted,p_last_four)
 on conflict(connection_id,secret_kind) do update set encrypted_value=excluded.encrypted_value,last_four=excluded.last_four,updated_at=now();
 update public.integration_connections set status='connected',runtime_mode='dry_run',credential_status='configured',
 external_account_id=p_account_id,external_account_name=p_account_name,health_summary='Read-only email and calendar access verified; import pending.',last_checked_at=now(),last_success_at=now() where id=c.id;
 update public.integration_sync_states set status='idle',last_error=null,lease_owner=null,lease_expires_at=null where connection_id=c.id and partner_id=a.partner_id and client_id=a.client_id;
 delete from public.business_connection_oauth_attempts where id=p_attempt;
end $$;

create or replace function public.manage_readonly_workspace_connection(p_partner uuid,p_client uuid,p_connection uuid,p_action text)
returns void language plpgsql security invoker set search_path='' as $$
declare c public.integration_connections; provider text;
begin
 select * into strict c from public.integration_connections where id=p_connection and partner_id=p_partner and client_id=p_client for update;
 select provider_key into provider from public.integration_providers where id=c.provider_id;
 if provider not in ('google_workspace','microsoft_365','stripe','generic_inbound_webhook') or p_action not in ('pause','resume','disconnect') or
  (provider in ('google_workspace','microsoft_365') and c.config->>'workspace_view_only' is distinct from 'true') then raise exception 'Unsupported owner data connection'; end if;
 if p_action='resume' then
  if c.status not in ('connected','needs_attention') or c.credential_status<>'configured' then raise exception 'Reconnect the account first'; end if;
  update public.integration_connections set runtime_mode=case when c.config->>'workspace_view_only'='true' then 'dry_run'::public.runtime_mode else 'live'::public.runtime_mode end where id=c.id;
  update public.integration_sync_states set status='idle',last_error=null where connection_id=c.id and partner_id=p_partner and client_id=p_client and status='paused';
 else
  update public.integration_connections set runtime_mode='paused',status=case when p_action='disconnect' then 'not_connected'::public.integration_status else status end,
   credential_status=case when p_action='disconnect' then 'missing' else credential_status end where id=c.id;
  delete from public.business_connection_oauth_attempts where connection_id=c.id;
  update public.integration_sync_jobs set status='cancelled',completed_at=now(),locked_at=null,locked_by=null where connection_id=c.id and partner_id=p_partner and client_id=p_client and status in ('queued','running','failed');
  update public.integration_sync_states set status='paused' where connection_id=c.id and partner_id=p_partner and client_id=p_client;
  if p_action='disconnect' then
   -- Retain the bound account ID: reconnect cannot silently replace its identity.
   delete from public.integration_secrets where connection_id=c.id and partner_id=p_partner and client_id=p_client;
   delete from public.integration_canonical_records where connection_id=c.id and partner_id=p_partner and client_id=p_client;
   delete from public.integration_sync_states where connection_id=c.id and partner_id=p_partner and client_id=p_client;
  end if;
 end if;
end $$;

create unique index owner_intake_request_key on public.integration_connections(partner_id,client_id,(config->>'owner_intake_key')) where config ? 'owner_intake_key';
create function public.prepare_owner_intake(p_partner uuid,p_client uuid,p_actor uuid,p_key uuid,p_encrypted text,p_last_four text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare connection uuid; provider uuid;
begin
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner and status='active' for update;
 if not found or p_actor is null or p_key is null or nullif(p_encrypted,'') is null then raise exception 'Business or request unavailable'; end if;
 select id into connection from public.integration_connections where partner_id=p_partner and client_id=p_client and config->>'owner_intake_key'=p_key::text;
 if connection is not null then return connection; end if;
 select id into provider from public.integration_providers where provider_key='generic_inbound_webhook' and is_active and supports_inbound;
 if provider is null then raise exception 'Form intake provider unavailable'; end if;
 insert into public.integration_connections(partner_id,client_id,provider_id,display_name,status,runtime_mode,credential_status,created_by,config,health_summary)
 values(p_partner,p_client,provider,'Website form','needs_attention','dry_run','configured',p_actor,
 jsonb_build_object('owner_workspace_imports',true,'workspace_view_only',true,'conversation_intake_enabled',false,'owner_intake_key',p_key),
 'Endpoint prepared; waiting for an authenticated form submission.') returning id into connection;
 insert into public.integration_secrets(partner_id,client_id,connection_id,secret_kind,encrypted_value,last_four)
 values(p_partner,p_client,connection,'webhook_token',p_encrypted,p_last_four);
 return connection;
end $$;

alter table public.inbound_event_jobs drop constraint inbound_event_jobs_handler_check;
alter table public.inbound_event_jobs add constraint inbound_event_jobs_handler_check check(handler in ('workflow','phone','records'));
alter table public.integration_canonical_records add column source_event_at timestamptz, add column source_event_id text, add column snapshot_observed_at timestamptz;
-- Existing ingestion timestamps are prior snapshot observations, not source edit
-- times. A late event must not overwrite those newer imported facts.
update public.integration_canonical_records r set snapshot_observed_at=r.updated_at
from public.integration_connections c join public.integration_providers p on p.id=c.provider_id
where r.connection_id=c.id and r.partner_id=c.partner_id and r.client_id=c.client_id
 and (c.config->>'workspace_view_only'='true' or p.provider_key='stripe');

create function public.persist_owner_import_record(p_partner uuid,p_client uuid,p_connection uuid,p_type text,p_external text,p_parent text,p_data jsonb,p_source jsonb,p_external_updated timestamptz,p_observed timestamptz,p_event_at timestamptz default null,p_event_id text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare c public.integration_connections; previous public.integration_canonical_records; provider text; facts jsonb:=p_data; refunded bigint; received bigint; linked_native text; linked_count integer;
begin
 select * into strict c from public.integration_connections where id=p_connection and partner_id=p_partner and client_id=p_client for update;
 select provider_key into provider from public.integration_providers where id=c.provider_id;
 if c.status not in ('connected','needs_attention') or c.runtime_mode='paused' or provider not in ('google_workspace','microsoft_365','stripe','generic_inbound_webhook') or
  not (coalesce(c.config->>'workspace_view_only'='true',false) or provider='stripe') then raise exception 'Source is paused, disconnected or not an owner import'; end if;
 if p_type not in ('lead','invoice','payment','message','appointment') or nullif(p_external,'') is null or length(p_external)>500 or jsonb_typeof(p_data)<>'object' or
  p_observed is null or p_observed>now()+interval '5 minutes' or p_event_at>now()+interval '5 minutes' or
  (p_event_at is not null and (nullif(p_event_id,'') is null or length(p_event_id)>500)) or
  (p_event_at is null and p_event_id is not null) then raise exception 'Invalid imported record'; end if;
 if (provider='stripe' and p_type not in ('invoice','payment')) or (provider='generic_inbound_webhook' and p_type<>'lead') or
  (provider in ('google_workspace','microsoft_365') and p_type not in ('message','appointment')) then raise exception 'Unsupported source object'; end if;
 select * into previous from public.integration_canonical_records where connection_id=p_connection and partner_id=p_partner and client_id=p_client and object_type=p_type and external_object_id=p_external for update;
 if provider='generic_inbound_webhook' and p_data->>'deleted' is distinct from 'true' then
  facts:=(coalesce(previous.canonical_data,'{}'::jsonb)-'deleted')||p_data;
  if p_data->>'received_at' is null and previous.canonical_data ? 'received_at' then
   facts:=facts||jsonb_build_object('received_at',previous.canonical_data->'received_at');
  end if;
 end if;
 -- A non-expanded PaymentIntent is not evidence that a known refund vanished.
 if provider='stripe' and p_type='payment' and p_data->>'refunds_known'='false' and previous.canonical_data->>'refunds_known'='true' and
  (nullif(p_data->>'charge_id','') is null or p_data->>'charge_id'=previous.canonical_data->>'charge_id') then
  refunded:=(previous.canonical_data->>'amount_refunded_minor')::bigint;
  received:=coalesce((p_data->>'amount_minor')::bigint,(previous.canonical_data->>'amount_minor')::bigint);
  facts:=facts||jsonb_build_object('amount_refunded_minor',refunded,'amount_refunded',refunded,'refunds_known',true,
   'status',case when refunded>0 and received>0 and refunded>=received then 'refunded' when refunded>0 then 'partially_refunded' else p_data->>'status' end);
 end if;
 if p_event_at is not null then
  if previous.source_event_id=p_event_id or p_event_at<previous.source_event_at or
    p_event_at+interval '1 second'<=previous.snapshot_observed_at then return false; end if;
  if ((p_event_at=previous.source_event_at and previous.source_event_id is distinct from p_event_id) or
      (previous.snapshot_observed_at>=p_event_at and previous.snapshot_observed_at<p_event_at+interval '1 second')) and
      (previous.canonical_data-array['observed_at','source_event_at','source_created_at','source_updated_at']) is distinct from
      (facts-array['observed_at','source_event_at','source_created_at','source_updated_at']) then
   -- Event IDs are not ordered versions. Compare effective business facts, not
   -- ingestion clocks; a true equal-clock conflict requires a fresh snapshot.
   insert into public.integration_sync_states(partner_id,client_id,connection_id,stream_key,status,last_error)
   values(p_partner,p_client,p_connection,p_type,'failing','Source changes share a timestamp. Refresh the account to reconcile current records.')
   on conflict(connection_id,stream_key) do update set status='failing',last_error=excluded.last_error;
   return false;
  end if;
 else
  if p_observed<greatest(previous.source_event_at,previous.snapshot_observed_at) then return false; end if;
 end if;
 if p_type='appointment' then
  -- A read-only import may link an existing booking receipt by the exact event
  -- and authorized provider account. It does not edit or guess a CRM record.
  select min(ap.id::text),count(*) into linked_native,linked_count
  from public.crm_appointments ap join public.approval_items a on a.id=ap.approval_id and a.partner_id=p_partner and a.client_id=p_client
  join public.integration_connections source on source.id::text=a.proposed_payload->>'calendar_connection_id' and source.partner_id=p_partner and source.client_id=p_client
  where ap.partner_id=p_partner and ap.client_id=p_client and ap.external_ref=p_external and source.provider_id=c.provider_id
   and (source.id=c.id or (source.external_account_id is not null and source.external_account_id=c.external_account_id));
  if linked_count<>1 then linked_native:=null; end if;
 end if;
 insert into public.integration_canonical_records(partner_id,client_id,connection_id,object_type,external_object_id,external_parent_id,canonical_data,source_payload,external_updated_at,native_object_id,projection_status,source_event_at,source_event_id,snapshot_observed_at)
 values(p_partner,p_client,p_connection,p_type,p_external,p_parent,facts,p_source,p_external_updated,coalesce(previous.native_object_id,linked_native),'skipped',p_event_at,p_event_id,case when p_event_at is null then p_observed end)
 on conflict(connection_id,object_type,external_object_id) do update set
  external_parent_id=coalesce(excluded.external_parent_id,integration_canonical_records.external_parent_id),canonical_data=excluded.canonical_data,
  source_payload=excluded.source_payload,external_updated_at=excluded.external_updated_at,updated_at=now(),
  native_object_id=coalesce(integration_canonical_records.native_object_id,excluded.native_object_id),
  source_event_at=coalesce(excluded.source_event_at,integration_canonical_records.source_event_at),source_event_id=coalesce(excluded.source_event_id,integration_canonical_records.source_event_id),
  snapshot_observed_at=coalesce(excluded.snapshot_observed_at,integration_canonical_records.snapshot_observed_at);
 if p_event_at is not null then
  insert into public.integration_sync_states(partner_id,client_id,connection_id,stream_key,status,last_completed_at,last_error)
  values(p_partner,p_client,p_connection,p_type,'idle',now(),null)
  on conflict(connection_id,stream_key) do update set last_completed_at=excluded.last_completed_at,
   status=case when integration_sync_states.last_error is not null then integration_sync_states.status else 'idle' end,
   last_error=integration_sync_states.last_error;
 end if;
 update public.integration_connections set status='connected',last_success_at=now(),health_summary='Imported source records received. Agent authority is unchanged.' where id=c.id;
 return true;
end $$;

-- A booking receipt must commit before it can produce an owner decision. Lock
-- the origin approval to serialize retries without replaying the calendar write.
alter table public.action_jobs add column confirmation_due_at timestamptz, add column confirmation_attempts integer not null default 0, add column receipt_recorded_at timestamptz;
create index booking_confirmation_due on public.action_jobs(confirmation_due_at) where kind='calendar.book' and status='succeeded' and confirmation_due_at is not null;
create function public.retry_booking_confirmation(p_partner uuid,p_client uuid,p_job uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 update public.action_jobs set confirmation_attempts=confirmation_attempts+1,
  confirmation_due_at=case when confirmation_attempts>=4 then null else now()+interval '5 minutes' end,
  outcome_detail=coalesce(outcome_detail,'')||' Booking saved; confirmation preparation needs review.'
 where id=p_job and partner_id=p_partner and client_id=p_client and kind='calendar.book' and status='succeeded' and confirmation_due_at is not null;
end $$;
create unique index booking_confirmation_origin on public.approval_items(partner_id,client_id,(proposed_payload->>'booking_approval_id'))
where type='customer_message' and proposed_payload->>'draft_source'='booking_confirmation_template';
create function public.queue_verified_booking_confirmation(p_partner uuid,p_client uuid,p_booking_approval uuid,p_action_job uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.approval_items; j public.action_jobs; result_id uuid; channel text; recipient text; business text; body text; payload jsonb; settings public.agent_team_settings; conversation public.business_conversations;
begin
 select * into a from public.approval_items where id=p_booking_approval and partner_id=p_partner and client_id=p_client and type='appointment_booking' for update;
 select * into j from public.action_jobs where id=p_action_job and partner_id=p_partner and client_id=p_client and approval_id=p_booking_approval and kind='calendar.book';
 if a.id is null or a.status not in ('approved','edited_and_approved') or j.status is distinct from 'succeeded' or nullif(j.external_ref,'') is null then
  return jsonb_build_object('approvalId',null,'state','blocked','reason','No durable successful booking receipt.');
 end if;
 select id into result_id from public.approval_items where partner_id=p_partner and client_id=p_client and type='customer_message' and proposed_payload->>'booking_approval_id'=a.id::text order by created_at limit 1;
 if result_id is not null then return jsonb_build_object('approvalId',result_id,'state','existing'); end if;
 if nullif(a.proposed_payload->'slot'->>'start_iso','') is null or (a.proposed_payload->'slot'->>'start_iso')::timestamptz<=now() then
  return jsonb_build_object('approvalId',null,'state','blocked','reason','The booked time passed or is unavailable.');
 end if;
 select * into settings from public.agent_team_settings where partner_id=p_partner and client_id=p_client;
 if settings.status is distinct from 'active' then return jsonb_build_object('approvalId',null,'state','blocked','reason','The team is paused. Booking remains saved.'); end if;
 if a.proposed_payload ? 'conversation_id' then
  select * into conversation from public.business_conversations where id::text=a.proposed_payload->>'conversation_id' and partner_id=p_partner and client_id=p_client;
  if conversation.id is null or conversation.mode<>'agent' or conversation.opted_out or not public.business_channel_can_draft(p_partner,p_client,conversation.channel,conversation.connection_id) then
   return jsonb_build_object('approvalId',null,'state','blocked','reason','The conversation or its channel is no longer authorized. Booking remains saved.');
  end if;
  -- Reuse the shared conversation/approval/messages path and its source revision.
  perform public.confirm_conversation_booking(a.id);
  select id into result_id from public.approval_items where partner_id=p_partner and client_id=p_client and proposed_payload->>'booking_approval_id'=a.id::text order by created_at limit 1;
  return jsonb_build_object('approvalId',result_id,'state',case when result_id is null then 'blocked' else 'queued' end);
 end if;
 channel:=case when nullif(a.proposed_payload->'contact'->>'phone','') is not null then 'sms' else 'email' end;
 recipient:=case when channel='sms' then a.proposed_payload->'contact'->>'phone' else a.proposed_payload->'contact'->>'email' end;
 if nullif(recipient,'') is null or not public.business_channel_can_draft(p_partner,p_client,channel,null) then
  return jsonb_build_object('approvalId',null,'state','blocked','reason','Review customer contact details, context and channel authority. Booking remains saved.');
 end if;
 select name into business from public.client_businesses where id=p_client and partner_id=p_partner;
 body:='Your appointment with '||coalesce(business,'the business')||' is set for '||coalesce(a.proposed_payload->'slot'->>'label',a.proposed_payload->'slot'->>'start_iso')||'. Reply if you need to change it.';
 payload:=jsonb_build_object('channel',channel,'to',recipient,'subject','Your appointment with '||coalesce(business,'the business'),
  'draft_source','booking_confirmation_template','booking_approval_id',a.id,'booking_action_job_id',j.id,
  'booking_external_ref',j.external_ref,'contact_id',a.proposed_payload->'contact_id');
 insert into public.approval_items(partner_id,client_id,workflow_run_id,type,status,title,summary,risk_level,proposed_payload,editable_content,expires_at)
 values(p_partner,p_client,a.workflow_run_id,'customer_message','pending','Review booking confirmation',
  'Booking receipt saved. Review this message; current calendar, customer and authority are rechecked before delivery.',
  'medium',payload,body,least(now()+interval '1 day',(a.proposed_payload->'slot'->>'start_iso')::timestamptz)) returning id into result_id;
 return jsonb_build_object('approvalId',result_id,'state','queued');
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and
 p.proname in ('finish_readonly_workspace_oauth','manage_readonly_workspace_connection','prepare_owner_intake','persist_owner_import_record','queue_verified_booking_confirmation','retry_booking_confirmation') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
insert into public.platform_schema_state(singleton,current_migration,applied_at) values(true,'20261117033546_multi_application_workspace',now())
on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;
