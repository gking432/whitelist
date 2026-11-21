-- Approved, verified calendar changes and freshly reviewed customer scheduling.
-- Written for isolated PostgreSQL acceptance; no migration execution claimed.
-- REVIEW DRAFT ONLY. Root owns generated migration/integration. Never executed.
-- All RPC callers are authenticated/scoped server paths using service_role.
-- No provider calls occur in these functions. External truth comes exclusively
-- from the driver's conditional HTTP write + exact GET verification receipt.

alter table public.action_jobs add column if not exists provider_receipt jsonb,
 add column if not exists calendar_reconcile_due_at timestamptz,
 add column if not exists calendar_reconcile_reason text;
alter table public.crm_appointments add column if not exists calendar_state_job_id uuid references public.action_jobs(id);
-- Exact idempotency for a review task, including multiple changes to one booking.
alter table public.crm_tasks add column if not exists calendar_action_job_id uuid references public.action_jobs(id);
create unique index if not exists calendar_change_review_job on public.crm_tasks(partner_id,client_id,calendar_action_job_id)
 where task_type='calendar_change_reconciliation' and calendar_action_job_id is not null;
create index if not exists calendar_change_reconcile_due on public.action_jobs(calendar_reconcile_due_at)
 where kind in ('calendar.cancel','calendar.reschedule') and status='succeeded' and calendar_reconcile_due_at is not null;
create table public.booking_change_offers (
 id uuid primary key,partner_id uuid not null,client_id uuid not null,
 actor_id uuid not null references auth.users(id),booking_approval_id uuid not null references public.approval_items(id),
 revision text not null check(length(revision) between 1 and 1500),
 slots jsonb not null check(jsonb_typeof(slots)='array' and jsonb_array_length(slots) between 1 and 3),
 payload jsonb not null check(jsonb_typeof(payload)='object'),expires_at timestamptz not null,
 consumed_by_approval uuid references public.approval_items(id),created_at timestamptz not null default now(),
 foreign key(partner_id,client_id) references public.client_businesses(partner_id,id)
);
alter table public.booking_change_offers enable row level security;
revoke all on public.booking_change_offers from public,anon,authenticated;
grant all on public.booking_change_offers to service_role;
create index booking_change_offer_actor on public.booking_change_offers(partner_id,client_id,actor_id,expires_at);

create function public.guard_calendar_state_marker() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if ((tg_op='INSERT' and new.calendar_state_job_id is not null) or (tg_op='UPDATE' and new.calendar_state_job_id is distinct from old.calendar_state_job_id)) and current_user not in ('service_role','postgres','supabase_admin') then
  raise exception 'Only verified calendar execution may change the calendar state marker';
 end if;
 return new;
end $$;
create trigger guard_calendar_state_marker before insert or update of calendar_state_job_id on public.crm_appointments
 for each row execute function public.guard_calendar_state_marker();

create function public.guard_calendar_reconciliation_task() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if ((tg_op='INSERT' and new.calendar_action_job_id is not null) or (tg_op='UPDATE' and new.calendar_action_job_id is distinct from old.calendar_action_job_id))
  and current_user not in ('service_role','postgres','supabase_admin') then raise exception 'Only verified calendar execution may link a reconciliation task'; end if;
 if new.calendar_action_job_id is not null and not exists(select 1 from public.action_jobs j where j.id=new.calendar_action_job_id and j.partner_id=new.partner_id and j.client_id=new.client_id) then
  raise exception 'Calendar reconciliation task scope changed'; end if;
 return new;
end $$;
create trigger guard_calendar_reconciliation_task before insert or update on public.crm_tasks for each row execute function public.guard_calendar_reconciliation_task();

create function public.calendar_mutation_latest_activity(p_partner uuid,p_client uuid,p_contact uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',activity.id,'at',activity.created_at) from (
  select m.id,m.created_at from public.crm_communications m
   where m.partner_id=p_partner and m.client_id=p_client and m.contact_id=p_contact and m.direction='inbound' and m.status='received'
  union all
  select m.id,m.created_at from public.business_conversation_messages m join public.business_conversations c
   on c.id=m.conversation_id and c.partner_id=m.partner_id and c.client_id=m.client_id
   where c.partner_id=p_partner and c.client_id=p_client and c.contact_id=p_contact and c.identity_status='owner_verified'
    and m.direction='inbound' and m.status='received'
 ) activity order by activity.created_at desc,activity.id desc limit 1;
$$;

-- Common exact source/current policy gate. SQL callers take business/identity
-- locks before mutating state; the provider driver calls this again after all
-- token/source/availability awaits, immediately before its conditional effect.
create function public.calendar_mutation_source_check(p_partner uuid,p_client uuid,p_payload jsonb,p_execute boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare origin public.approval_items; receipt public.action_jobs; native public.crm_appointments; customer public.crm_contacts;
 business public.client_businesses; settings public.agent_team_settings; activation public.business_agent_activation;
 account public.integration_connections; source public.integration_canonical_records; thread public.business_conversations;
 state_job public.action_jobs; provider text; latest jsonb; desired_start timestamptz; desired_end timestamptz;
 original_start timestamptz; original_end timestamptz; effective_clock timestamptz; peer_ids uuid[]; count_sources integer; zone text;
 local_start timestamp; local_end timestamp; effective jsonb;
begin
 if jsonb_typeof(p_payload) is distinct from 'object' or p_payload->'calendar_mutation_version' is distinct from '1'::jsonb
  or coalesce(p_payload->>'mutation','') not in ('cancel','reschedule') or coalesce(p_payload->>'provider','') not in ('northstar_internal','google_workspace','google_calendar')
  or not (p_payload ?& array['booking_approval_id','booking_action_job_id','appointment_id','appointment_updated_at','contact_id','contact_updated_at','provider','calendar_connection_id','calendar_account_id','calendar_id','external_ref','source_record_id','source_updated_at','source_etag','old_slot','authority_revision','customer_activity_id','customer_activity_at','conversation_id','conversation_revision'])
  or p_payload->>'scenario_lab'='true' then
  return jsonb_build_object('allowed',false,'reason','The exact supported calendar mutation payload is required.'); end if;
 select * into origin from public.approval_items where id=(p_payload->>'booking_approval_id')::uuid and partner_id=p_partner and client_id=p_client and type='appointment_booking';
 select * into receipt from public.action_jobs where id=(p_payload->>'booking_action_job_id')::uuid and partner_id=p_partner and client_id=p_client and approval_id=origin.id and kind='calendar.book';
 select * into native from public.crm_appointments where id=(p_payload->>'appointment_id')::uuid and partner_id=p_partner and client_id=p_client and approval_id=origin.id;
 select * into customer from public.crm_contacts where id=(p_payload->>'contact_id')::uuid and partner_id=p_partner and client_id=p_client;
 if origin.id is null or origin.status not in ('approved','edited_and_approved') or receipt.status is distinct from 'succeeded' or receipt.receipt_recorded_at is null
  or nullif(receipt.external_ref,'') is null or receipt.external_ref is distinct from p_payload->>'external_ref'
  or native.id is null or native.contact_id is distinct from customer.id or customer.id is null or native.status is distinct from 'booked'
  or native.external_ref is distinct from receipt.external_ref or native.updated_at is distinct from (p_payload->>'appointment_updated_at')::timestamptz
  or customer.updated_at is distinct from (p_payload->>'contact_updated_at')::timestamptz
  or origin.proposed_payload->>'provider' is distinct from p_payload->>'provider' then
  return jsonb_build_object('allowed',false,'reason','The original successful booking, exact appointment or customer changed.'); end if;
 original_start:=(p_payload->'old_slot'->>'start_iso')::timestamptz; original_end:=(p_payload->'old_slot'->>'end_iso')::timestamptz;
 if original_start is null or original_end is null or original_start<=now() or original_end<=original_start
  or native.start_at is distinct from original_start or native.end_at is distinct from original_end then
  return jsonb_build_object('allowed',false,'reason','The original appointment time changed or has started.'); end if;
 if customer.tags is null or exists(select 1 from unnest(customer.tags) tag where lower(regexp_replace(btrim(tag),'[[:space:]-]+','_','g')) in ('do_not_contact','opt_out','opted_out','unsubscribed','stop'))
  or exists(select 1 from public.business_conversations c where c.partner_id=p_partner and c.client_id=p_client and c.contact_id=customer.id and c.identity_status='owner_verified'
    and (c.opted_out or (c.mode='human' and c.state<>'closed'))) then
  return jsonb_build_object('allowed',false,'reason','Customer suppression or human handling requires review before another action.'); end if;
 latest:=public.calendar_mutation_latest_activity(p_partner,p_client,customer.id);
 if latest->>'id' is distinct from p_payload->>'customer_activity_id' or (latest->>'at')::timestamptz is distinct from (p_payload->>'customer_activity_at')::timestamptz then
  return jsonb_build_object('allowed',false,'reason','The customer instructions changed. Review the latest received response.'); end if;
 if (p_payload->>'customer_activity_id' is null) is distinct from (p_payload->>'customer_activity_at' is null) then
  return jsonb_build_object('allowed',false,'reason','The customer activity identity and version must be pinned together.'); end if;
 if nullif(origin.proposed_payload->>'conversation_id','') is not null then
  select * into thread from public.business_conversations where id=(origin.proposed_payload->>'conversation_id')::uuid and partner_id=p_partner and client_id=p_client;
  if thread.id is null or thread.id::text is distinct from p_payload->>'conversation_id' or thread.contact_id is distinct from customer.id or thread.identity_status is distinct from 'owner_verified'
   or thread.mode is distinct from 'agent' or thread.opted_out or thread.state='closed' or thread.revision is distinct from (p_payload->>'conversation_revision')::integer then
   return jsonb_build_object('allowed',false,'reason','The original verified conversation changed or is under human handling.'); end if;
 elsif p_payload->>'conversation_id' is not null or p_payload->>'conversation_revision' is not null then
  return jsonb_build_object('allowed',false,'reason','An unrelated conversation cannot authorize this appointment change.'); end if;
 select * into business from public.client_businesses where id=p_client and partner_id=p_partner;
 select * into settings from public.agent_team_settings where partner_id=p_partner and client_id=p_client;
 select * into activation from public.business_agent_activation where partner_id=p_partner and client_id=p_client;
 if business.status is distinct from 'active' or settings.status is distinct from 'active' or not coalesce(settings.scheduling_enabled,false)
  or settings.authority_revision is distinct from (p_payload->>'authority_revision')::integer
  or activation.status is distinct from 'active' or not coalesce(activation.bookings,false)
  or not public.business_channel_can_draft(p_partner,p_client,'calendar',null)
  or (p_execute and coalesce(settings.channel_authority->>'calendar','require_approval')<>'require_approval') then
  return jsonb_build_object('allowed',false,'reason','Current reviewed business context and selected calendar authority do not permit this step.'); end if;
 effective:=public.booking_effective_calendar_state(p_partner,p_client,origin.id,receipt.id,native.id);
 if effective->>'allowed' is distinct from 'true' then return jsonb_build_object('allowed',false,'reason',coalesce(effective->>'reason','The effective calendar state is unverified.')); end if;
 effective_clock:=(effective->>'receiptAt')::timestamptz;
 provider:=p_payload->>'provider';
 if provider='northstar_internal' then
  if business.crm_operating_mode not in ('primary_crm','mirror','assist') or business.default_runtime_mode is distinct from 'live'
   or p_payload->>'calendar_connection_id' is not null or p_payload->>'calendar_account_id' is not null or p_payload->>'calendar_id' is not null
   or p_payload->>'source_record_id' is not null or p_payload->>'source_etag' is not null or (p_payload->>'source_updated_at')::timestamptz is distinct from native.updated_at then
   return jsonb_build_object('allowed',false,'reason','The exact active internal calendar version is required.'); end if;
 else
  select c.* into account from public.integration_connections c join public.integration_providers p on p.id=c.provider_id
   where c.id=(p_payload->>'calendar_connection_id')::uuid and c.partner_id=p_partner and c.client_id=p_client and p.provider_key=provider;
  if account.id is null or origin.proposed_payload->>'calendar_connection_id' is distinct from account.id::text or account.status is distinct from 'connected' or account.runtime_mode is distinct from 'live'
   or account.config->>'workspace_view_only'='true' or nullif(account.external_account_id,'') is null or account.external_account_id is distinct from p_payload->>'calendar_account_id'
   or coalesce(nullif(account.config->>'calendar_id',''),'primary') is distinct from p_payload->>'calendar_id' then
   return jsonb_build_object('allowed',false,'reason','The exact calendar account is paused, read only, disconnected or changed.'); end if;
  select array_agg(c.id order by c.id) into peer_ids from public.integration_connections c where c.partner_id=p_partner and c.client_id=p_client and c.provider_id=account.provider_id
   and (c.id=account.id or c.external_account_id=account.external_account_id);
  if coalesce(cardinality(peer_ids),0)>100 then return jsonb_build_object('allowed',false,'reason','Calendar account coverage is incomplete.'); end if;
  select * into source from public.integration_canonical_records r where r.id=(p_payload->>'source_record_id')::uuid and r.partner_id=p_partner and r.client_id=p_client
   and r.connection_id=any(peer_ids) and r.object_type='appointment' and r.external_object_id=receipt.external_ref;
  if source.id is null or (source.native_object_id is not null and source.native_object_id is distinct from native.id::text)
   or source.external_updated_at is distinct from (p_payload->>'source_updated_at')::timestamptz
   or coalesce(source.source_payload->>'etag',source.source_payload->>'@odata.etag') is distinct from p_payload->>'source_etag'
   or coalesce(p_payload->>'source_etag','') !~ '^"[^"\r\n]+"$'
   or source.snapshot_observed_at is null or source.snapshot_observed_at<effective_clock or source.snapshot_observed_at<now()-interval '45 minutes' or source.snapshot_observed_at>now()
   or source.source_payload->'organizer'->>'self' is distinct from 'true'
   or source.source_payload ? 'recurringEventId' or source.source_payload ? 'recurrence'
   or (jsonb_typeof(source.source_payload->'attendees')='array' and jsonb_array_length(source.source_payload->'attendees')>0)
   or coalesce(source.source_payload->>'eventType','default')<>'default' then
   return jsonb_build_object('allowed',false,'reason','Refresh the exact owned single-event source version before changing this appointment.'); end if;
  select count(*) into count_sources from public.integration_canonical_records r where r.partner_id=p_partner and r.client_id=p_client and r.connection_id=any(peer_ids) and r.object_type='appointment' and r.external_object_id=receipt.external_ref;
  if count_sources>100 or exists(select 1 from public.integration_canonical_records r where r.partner_id=p_partner and r.client_id=p_client and r.connection_id=any(peer_ids) and r.object_type='appointment' and r.external_object_id=receipt.external_ref
    and ((r.native_object_id is not null and r.native_object_id is distinct from native.id::text) or coalesce(r.canonical_data->>'deleted','false')='true'
     or coalesce(r.canonical_data->>'status','') not in ('confirmed','booked')
     or (r.canonical_data->>'start_at')::timestamptz is distinct from native.start_at or (r.canonical_data->>'end_at')::timestamptz is distinct from native.end_at
     or coalesce(r.source_payload->>'etag',r.source_payload->>'@odata.etag') is distinct from p_payload->>'source_etag'))
   or exists(select 1 from public.integration_sync_states s where s.partner_id=p_partner and s.client_id=p_client and s.connection_id=any(peer_ids) and s.stream_key='appointment'
    and (nullif(s.last_error,'') is not null or s.status in ('paused','failing') or nullif(s.cursor_value->>'pageToken','') is not null or nullif(s.cursor_value->>'nextLink','') is not null or s.cursor_value->>'has_more'='true')) then
   return jsonb_build_object('allowed',false,'reason','Exact calendar sources conflict or an import is incomplete. Reconcile the account first.'); end if;
 end if;
 if p_payload->>'mutation'='cancel' then
  if p_payload ? 'new_slot' and p_payload->'new_slot'<>'null'::jsonb then return jsonb_build_object('allowed',false,'reason','Cancellation cannot include a replacement time.'); end if;
 else
  desired_start:=(p_payload->'new_slot'->>'start_iso')::timestamptz; desired_end:=(p_payload->'new_slot'->>'end_iso')::timestamptz;
  if desired_start is null or desired_end is null or desired_start<=now() or desired_end<=desired_start or desired_end-desired_start<>original_end-original_start
   or (desired_start=original_start and desired_end=original_end) then return jsonb_build_object('allowed',false,'reason','Choose a different future time with the same service duration.'); end if;
  if receipt.booking_followup_phase='stopped' or exists(select 1 from public.crm_tasks t where t.partner_id=p_partner and t.client_id=p_client and t.booking_approval_id=origin.id and t.task_type='booking_cancellation_request' and t.status='open') then
   return jsonb_build_object('allowed',false,'reason','A cancellation request stopped this booking. Review that decision before a time change.'); end if;
  zone:=activation.timezone;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then return jsonb_build_object('allowed',false,'reason','The current business timezone is unavailable.'); end if;
  local_start:=desired_start at time zone zone; local_end:=desired_end at time zone zone;
  if not (extract(dow from local_start)::integer=any(activation.booking_weekdays)) or local_start::date<>local_end::date
   or extract(epoch from local_start::time)/3600<activation.booking_start_hour or extract(epoch from local_end::time)/3600>activation.booking_end_hour then
   return jsonb_build_object('allowed',false,'reason','The replacement time no longer fits the selected business hours.'); end if;
  if provider='northstar_internal' and exists(select 1 from public.crm_availability_windows w where w.partner_id=p_partner and w.client_id=p_client and w.active) and not exists(
   select 1 from public.crm_availability_windows w where w.partner_id=p_partner and w.client_id=p_client and w.active and w.weekday=extract(dow from local_start)
    and local_start::time>=w.start_time and local_end::time<=w.end_time and extract(epoch from desired_end-desired_start)/60=w.appointment_minutes) then
   return jsonb_build_object('allowed',false,'reason','The replacement time no longer fits current native availability windows.'); end if;
  if exists(select 1 from public.crm_appointments n where n.partner_id=p_partner and n.client_id=p_client and n.id<>native.id and n.status in ('proposed','booked') and n.start_at<desired_end and n.end_at>desired_start) then
   return jsonb_build_object('allowed',false,'reason','The shared business calendar replacement time is already occupied.'); end if;
 end if;
 return jsonb_build_object('allowed',true,'reason','Current exact source, customer, context and calendar authority permit this step.');
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
 return jsonb_build_object('allowed',false,'reason','The appointment change contains an invalid identity or source version.');
end $$;

create function public.stop_booking_change_followups(p_partner uuid,p_client uuid,p_origin uuid,p_reason text)
returns void language plpgsql security invoker set search_path='' as $$
begin
 -- Callers hold the originating conversation (when present), then proposal/job
 -- locks in the same order as inbound invalidation. Accepted writes are kept.
 perform 1 from public.approval_items a where a.partner_id=p_partner and a.client_id=p_client and a.type='customer_message' and a.proposed_payload->>'booking_approval_id'=p_origin::text order by a.id for update;
 update public.action_jobs j set status='cancelled',outcome_detail=left(p_reason,2000) where j.partner_id=p_partner and j.client_id=p_client
  and j.kind in ('sms.send','email.send','conversation.send') and j.payload->>'booking_approval_id'=p_origin::text
  and j.status in ('pending','failed','dry_run','skipped') and nullif(j.external_ref,'') is null;
 update public.approval_items a set status='expired',resolution_note=left(p_reason,2000) where a.partner_id=p_partner and a.client_id=p_client
  and a.type='customer_message' and a.proposed_payload->>'booking_approval_id'=p_origin::text and a.status='pending'
  and not exists(select 1 from public.action_jobs accepted where accepted.approval_id=a.id and accepted.partner_id=p_partner and accepted.client_id=p_client
   and (accepted.status<>'cancelled' or nullif(accepted.external_ref,'') is not null));
end $$;

create function public.calendar_mutation_receipt_valid(p_payload jsonb,p_receipt jsonb)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare op text:=p_payload->>'mutation'; provider text:=p_payload->>'provider';
begin
 if jsonb_typeof(p_receipt) is distinct from 'object' or not (p_receipt ?& array['provider','operation','event_id','http_status','request_id','event_etag','event_updated_at','verified_at','verified_absent','old_slot','new_slot'])
  or jsonb_typeof(p_receipt->'http_status') is distinct from 'number' or jsonb_typeof(p_receipt->'verified_absent') is distinct from 'boolean'
  or jsonb_typeof(p_receipt->'old_slot') is distinct from 'object' or jsonb_typeof(p_receipt->'new_slot') not in ('object','null')
  or jsonb_typeof(p_receipt->'request_id') not in ('string','null') or length(p_receipt->>'request_id')>1000
  or jsonb_typeof(p_receipt->'event_etag') not in ('string','null') or length(p_receipt->>'event_etag')>1100
  or jsonb_typeof(p_receipt->'event_updated_at') not in ('string','null')
  or coalesce(p_receipt->>'verified_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or p_receipt->>'provider' is distinct from provider or p_receipt->>'operation' is distinct from op or p_receipt->>'event_id' is distinct from p_payload->>'external_ref'
  or (p_receipt->>'verified_at')::timestamptz is null or (p_receipt->>'verified_at')::timestamptz>now()
  or (p_receipt->'old_slot'->>'start_iso')::timestamptz is distinct from (p_payload->'old_slot'->>'start_iso')::timestamptz
  or (p_receipt->'old_slot'->>'end_iso')::timestamptz is distinct from (p_payload->'old_slot'->>'end_iso')::timestamptz then return false; end if;
 -- Missing clocks must fail even when both JSON objects omit the same field.
 if jsonb_typeof(p_payload->'old_slot') is distinct from 'object'
  or coalesce(p_payload->'old_slot'->>'start_iso','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or coalesce(p_payload->'old_slot'->>'end_iso','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or coalesce(p_receipt->'old_slot'->>'start_iso','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or coalesce(p_receipt->'old_slot'->>'end_iso','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or (p_payload->'old_slot'->>'end_iso')::timestamptz <= (p_payload->'old_slot'->>'start_iso')::timestamptz
  or (nullif(p_receipt->>'event_updated_at','') is not null and p_receipt->>'event_updated_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$') then return false; end if;
 if op='reschedule' and (jsonb_typeof(p_payload->'new_slot') is distinct from 'object'
  or coalesce(p_payload->'new_slot'->>'start_iso','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or coalesce(p_payload->'new_slot'->>'end_iso','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or coalesce(p_receipt->'new_slot'->>'start_iso','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or coalesce(p_receipt->'new_slot'->>'end_iso','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or (p_payload->'new_slot'->>'end_iso')::timestamptz <= (p_payload->'new_slot'->>'start_iso')::timestamptz) then return false; end if;
 if provider='northstar_internal' then
  if p_receipt->>'http_status' is distinct from '0' or p_receipt->>'event_etag' is not null or (p_receipt->>'event_updated_at')::timestamptz is null then return false; end if;
 elsif provider in ('google_workspace','google_calendar') then
  if p_receipt->>'http_status' is distinct from (case when op='cancel' then '204' else '200' end) then return false; end if;
  if op='reschedule' and (coalesce(p_receipt->>'event_etag','') !~ '^"[^"\r\n]+"$' or p_receipt->>'event_etag' is not distinct from p_payload->>'source_etag' or (p_receipt->>'event_updated_at')::timestamptz is null) then return false; end if;
 else return false;
 end if;
 if op='reschedule' then
  if p_receipt->>'verified_absent' is distinct from 'false' or (p_receipt->'new_slot'->>'start_iso')::timestamptz is distinct from (p_payload->'new_slot'->>'start_iso')::timestamptz
   or (p_receipt->'new_slot'->>'end_iso')::timestamptz is distinct from (p_payload->'new_slot'->>'end_iso')::timestamptz then return false; end if;
 elsif op='cancel' then
  if p_receipt->'new_slot' is distinct from 'null'::jsonb or (provider<>'northstar_internal' and p_receipt->>'verified_absent' is distinct from 'true') or (provider='northstar_internal' and p_receipt->>'verified_absent' is distinct from 'false') then return false; end if;
 else return false;
 end if;
 return true;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return false;
end $$;

create function public.save_calendar_mutation_offer(p_partner uuid,p_client uuid,p_actor uuid,p_offer jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare offer_id uuid; origin public.approval_items; selected jsonb; verdict jsonb; current_payload jsonb;
begin
 if p_actor is null or jsonb_typeof(p_offer) is distinct from 'object' or p_offer-array['id','bookingApprovalId','revision','expiresAt','slots','payload']<>'{}'::jsonb then raise exception 'Invalid calendar offer' using errcode='22023'; end if;
 offer_id:=(p_offer->>'id')::uuid;
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner for update;
 if not found then raise exception 'Business unavailable'; end if;
 select * into origin from public.approval_items where id=(p_offer->>'bookingApprovalId')::uuid and partner_id=p_partner and client_id=p_client and type='appointment_booking' for update;
 if origin.id is null or offer_id is null or nullif(p_offer->>'revision','') is null or length(p_offer->>'revision')>1500
  or (p_offer->>'expiresAt')::timestamptz<=now() or (p_offer->>'expiresAt')::timestamptz>now()+interval '15 minutes'
  or jsonb_typeof(p_offer->'slots') is distinct from 'array' or jsonb_array_length(p_offer->'slots') not between 1 and 3
  or p_offer->'payload'->>'booking_approval_id' is distinct from origin.id::text then raise exception 'The calendar offer is expired or unbound' using errcode='22023'; end if;
 verdict:=public.calendar_mutation_source_check(p_partner,p_client,p_offer->'payload',false);
 if verdict->>'allowed' is distinct from 'true' then raise exception '%',verdict->>'reason' using errcode='40001'; end if;
 for selected in select value from jsonb_array_elements(p_offer->'slots') loop
  if jsonb_typeof(selected) is distinct from 'object' or selected-array['start_iso','end_iso','label']<>'{}'::jsonb or nullif(selected->>'label','') is null or length(selected->>'label')>500 then raise exception 'Invalid replacement slot' using errcode='22023'; end if;
  current_payload:=((p_offer->'payload')-'new_slot')||jsonb_build_object('mutation','reschedule','new_slot',selected-'label');
  verdict:=public.calendar_mutation_source_check(p_partner,p_client,current_payload,false);
  if verdict->>'allowed' is distinct from 'true' then raise exception '%',verdict->>'reason' using errcode='40001'; end if;
 end loop;
 if exists(select 1 from public.booking_change_offers o where o.id=offer_id) then
  if not exists(select 1 from public.booking_change_offers o where o.id=offer_id and o.partner_id=p_partner and o.client_id=p_client and o.actor_id=p_actor and o.booking_approval_id=origin.id and o.revision=p_offer->>'revision' and o.slots=p_offer->'slots' and o.payload=p_offer->'payload' and o.expires_at=(p_offer->>'expiresAt')::timestamptz) then raise exception 'Offer key changed' using errcode='40001'; end if;
  return offer_id;
 end if;
 insert into public.booking_change_offers(id,partner_id,client_id,actor_id,booking_approval_id,revision,slots,payload,expires_at)
 values(offer_id,p_partner,p_client,p_actor,origin.id,p_offer->>'revision',p_offer->'slots',p_offer->'payload',(p_offer->>'expiresAt')::timestamptz);
 return offer_id;
end $$;

create function public.prepare_calendar_mutation(p_partner uuid,p_client uuid,p_actor uuid,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior public.business_owner_commands; origin public.approval_items; native public.crm_appointments; customer public.crm_contacts;
 offer public.booking_change_offers; request_id uuid; proposal_id uuid; receipt_id uuid:=extensions.gen_random_uuid(); public_request jsonb; payload jsonb; verdict jsonb; result jsonb; action text;
begin
 public_request:=p_command-array['payload','owner_request']; action:=p_command->>'action'; request_id:=(p_command->>'key')::uuid; payload:=p_command->'payload';
 if p_actor is null or request_id is null or jsonb_typeof(p_command) is distinct from 'object' or p_command->'owner_request' is distinct from public_request
  or public_request-array['action','key','targetId','expectedRevision','offerId','slot']<>'{}'::jsonb or coalesce(action,'') not in ('prepare_cancellation','prepare_time_change') then raise exception 'Invalid calendar decision' using errcode='22023'; end if;
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner for update;
 if not found then raise exception 'Business unavailable'; end if;
 select * into prior from public.business_owner_commands c where c.partner_id=p_partner and c.client_id=p_client and c.request_key=request_id;
 if prior.id is not null then
  if prior.actor_id is distinct from p_actor or coalesce(prior.command->'owner_request',prior.command) is distinct from public_request then raise exception 'Request key changed' using errcode='40001'; end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 select * into origin from public.approval_items where id=(p_command->>'targetId')::uuid and partner_id=p_partner and client_id=p_client and type='appointment_booking' for update;
 if origin.id is null or payload->>'booking_approval_id' is distinct from origin.id::text or nullif(p_command->>'expectedRevision','') is null then raise exception 'The exact original booking is unavailable' using errcode='40001'; end if;
 -- Acquire conversation before mutable customer/proposal rows, matching intake.
 if nullif(origin.proposed_payload->>'conversation_id','') is not null then perform 1 from public.business_conversations c where c.id=(origin.proposed_payload->>'conversation_id')::uuid and c.partner_id=p_partner and c.client_id=p_client for update; end if;
 select * into native from public.crm_appointments where approval_id=origin.id and partner_id=p_partner and client_id=p_client for update;
 select * into customer from public.crm_contacts where id=native.contact_id and partner_id=p_partner and client_id=p_client for update;
 if action='prepare_cancellation' and (payload->>'mutation' is distinct from 'cancel' or p_command ? 'offerId' or p_command ? 'slot') then raise exception 'Invalid cancellation decision' using errcode='22023'; end if;
 if action='prepare_time_change' then
  select * into offer from public.booking_change_offers o where o.id=(p_command->>'offerId')::uuid and o.partner_id=p_partner and o.client_id=p_client and o.actor_id=p_actor and o.booking_approval_id=origin.id for update;
  if offer.id is null or offer.expires_at<=now() or offer.consumed_by_approval is not null or offer.revision is distinct from p_command->>'expectedRevision'
   or payload->>'mutation' is distinct from 'reschedule' or (offer.payload-array['mutation','new_slot']) is distinct from (payload-array['mutation','new_slot'])
   or not exists(select 1 from jsonb_array_elements(offer.slots) selected where selected=p_command->'slot')
   or payload->'new_slot' is distinct from ((p_command->'slot')-'label') then raise exception 'Choose an exact current actor-bound replacement offer' using errcode='40001'; end if;
 end if;
 verdict:=public.calendar_mutation_source_check(p_partner,p_client,payload,false);
 if verdict->>'allowed' is distinct from 'true' then raise exception '%',verdict->>'reason' using errcode='40001'; end if;
 -- Retire expired review and definitely unsent failed/dry-run attempts before
 -- preparing a replacement. A formerly approved action remains immutable history.
 update public.approval_items a set status='expired',resolution_note='Expired calendar decision; a fresh exact review is required.'
  where a.partner_id=p_partner and a.client_id=p_client and a.type='appointment_change' and a.proposed_payload->>'booking_approval_id'=origin.id::text
   and a.status='pending' and a.expires_at<=now();
 update public.action_jobs j set status='cancelled',outcome_detail='Superseded by a fresh owner-reviewed calendar decision; no provider effect was established.'
  from public.approval_items a where j.approval_id=a.id and a.partner_id=p_partner and a.client_id=p_client and a.type='appointment_change'
   and a.proposed_payload->>'booking_approval_id'=origin.id::text and j.partner_id=p_partner and j.client_id=p_client
   and j.status in ('failed','dry_run','skipped') and nullif(j.external_ref,'') is null;
 if exists(select 1 from public.approval_items a where a.partner_id=p_partner and a.client_id=p_client and a.type='appointment_change'
  and a.proposed_payload->>'booking_approval_id'=origin.id::text and (
   (a.status='pending' and a.expires_at>now() and (a.proposed_payload->>'appointment_updated_at')::timestamptz=native.updated_at)
   or exists(select 1 from public.action_jobs j where j.partner_id=p_partner and j.client_id=p_client and j.approval_id=a.id and (
    j.status in ('processing','provider_pending','uncertain') or (j.status='failed' and nullif(j.external_ref,'') is not null)
    or ((a.proposed_payload->>'appointment_updated_at')::timestamptz=native.updated_at and j.status in ('pending','succeeded')))))) then
  raise exception 'Review the existing or uncertain calendar decision first' using errcode='40001'; end if;
 insert into public.approval_items(partner_id,client_id,workflow_run_id,type,status,title,summary,risk_level,proposed_payload,expires_at)
 values(p_partner,p_client,origin.workflow_run_id,'appointment_change','pending',case when action='prepare_cancellation' then 'Review appointment cancellation' else 'Review appointment time change' end,
  'The exact current event, customer, policy and replacement availability are checked again after approval. No calendar change has occurred.',
  'medium',payload,least(now()+interval '15 minutes',native.start_at)) returning id into proposal_id;
 if offer.id is not null then update public.booking_change_offers set consumed_by_approval=proposal_id where id=offer.id; end if;
 result:=jsonb_build_object('id',receipt_id,'bookingApprovalId',origin.id,'approvalId',proposal_id,'message','Calendar proposal saved for owner approval. No appointment was changed.','replayed',false);
 insert into public.business_owner_commands(id,partner_id,client_id,actor_id,request_key,command,result) values(receipt_id,p_partner,p_client,p_actor,request_id,p_command,result);
 return result;
end $$;

create function public.calendar_mutation_action_check(p_partner uuid,p_client uuid,p_approval uuid,p_job uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.approval_items; j public.action_jobs;
begin
 select * into a from public.approval_items where id=p_approval and partner_id=p_partner and client_id=p_client and type='appointment_change';
 select * into j from public.action_jobs where id=p_job and partner_id=p_partner and client_id=p_client and approval_id=a.id;
 if a.id is null or a.status not in ('approved','edited_and_approved') or a.expires_at is null or a.expires_at<=now()
  or j.id is null or j.kind is distinct from 'calendar.'||(a.proposed_payload->>'mutation') or j.payload is distinct from a.proposed_payload
  or j.status is distinct from 'processing' or j.claim_token is null or j.claimed_at is null or j.claimed_at<now()-interval '10 minutes'
  or j.claimed_at>now() or j.provider_receipt is not null then return jsonb_build_object('allowed',false,'reason','The exact approved action/claim expired or already has a result. Reconcile before repeating it.'); end if;
 return public.calendar_mutation_source_check(p_partner,p_client,a.proposed_payload,true);
end $$;

create function public.apply_internal_calendar_mutation(p_partner uuid,p_client uuid,p_approval uuid,p_job uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.approval_items; origin public.approval_items; j public.action_jobs; native public.crm_appointments; verdict jsonb; proof jsonb;
begin
 select * into a from public.approval_items where id=p_approval and partner_id=p_partner and client_id=p_client and type='appointment_change';
 if a.id is null or a.proposed_payload->>'provider' is distinct from 'northstar_internal' then return jsonb_build_object('state','blocked','reason','A matching approved internal appointment change is required.'); end if;
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner for update;
 select * into origin from public.approval_items where id=(a.proposed_payload->>'booking_approval_id')::uuid and partner_id=p_partner and client_id=p_client for update;
 if nullif(origin.proposed_payload->>'conversation_id','') is not null then perform 1 from public.business_conversations c where c.id=(origin.proposed_payload->>'conversation_id')::uuid and c.partner_id=p_partner and c.client_id=p_client for update; end if;
 select * into native from public.crm_appointments where id=(a.proposed_payload->>'appointment_id')::uuid and approval_id=origin.id and partner_id=p_partner and client_id=p_client for update;
 perform 1 from public.crm_contacts c where c.id=native.contact_id and c.partner_id=p_partner and c.client_id=p_client for update;
 select * into a from public.approval_items where id=p_approval and partner_id=p_partner and client_id=p_client for update;
 select * into j from public.action_jobs where id=p_job and approval_id=a.id and partner_id=p_partner and client_id=p_client for update;
 if j.provider_receipt is not null and native.calendar_state_job_id=j.id and j.status='processing' and public.calendar_mutation_receipt_valid(a.proposed_payload,j.provider_receipt) then
  return jsonb_build_object('state','succeeded','externalRef',native.external_ref,'receipt',j.provider_receipt);
 end if;
 verdict:=public.calendar_mutation_action_check(p_partner,p_client,a.id,j.id);
 if verdict->>'allowed' is distinct from 'true' then return jsonb_build_object('state','blocked','reason',verdict->>'reason'); end if;
 if a.proposed_payload->>'mutation'='cancel' then
  update public.crm_appointments set status='cancelled',calendar_state_job_id=j.id where id=native.id returning * into native;
 else
  update public.crm_appointments set start_at=(a.proposed_payload->'new_slot'->>'start_iso')::timestamptz,end_at=(a.proposed_payload->'new_slot'->>'end_iso')::timestamptz,calendar_state_job_id=j.id where id=native.id returning * into native;
 end if;
 proof:=jsonb_build_object('provider','northstar_internal','operation',a.proposed_payload->>'mutation','event_id',native.external_ref,'http_status',0,'request_id',null,'event_etag',null,
  'event_updated_at',native.updated_at,'verified_at',now(),'verified_absent',false,'old_slot',a.proposed_payload->'old_slot','new_slot',case when a.proposed_payload->>'mutation'='reschedule' then a.proposed_payload->'new_slot' else 'null'::jsonb end);
 update public.action_jobs set provider_receipt=proof,external_ref=native.external_ref where id=j.id and status='processing';
 return jsonb_build_object('state','succeeded','externalRef',native.external_ref,'receipt',proof);
end $$;

create function public.recover_internal_calendar_mutations(p_limit integer default 3)
returns integer language plpgsql security invoker set search_path='' as $$
declare candidate record; j public.action_jobs; a public.approval_items; origin public.approval_items; native public.crm_appointments; original_receipt public.action_jobs; recovered integer:=0;
begin
 for candidate in select q.id,q.partner_id,q.client_id from public.action_jobs q
  where q.kind in ('calendar.cancel','calendar.reschedule') and q.provider_receipt->>'provider'='northstar_internal'
   and (q.status='uncertain' or (q.status='processing' and q.claimed_at<now()-interval '10 minutes'))
  order by q.claimed_at nulls last,q.id limit greatest(1,least(coalesce(p_limit,3),10)) loop
  perform 1 from public.client_businesses b where b.id=candidate.client_id and b.partner_id=candidate.partner_id for update skip locked;
  if not found then continue; end if;
  select * into j from public.action_jobs where id=candidate.id and partner_id=candidate.partner_id and client_id=candidate.client_id;
  select * into a from public.approval_items where id=j.approval_id and partner_id=j.partner_id and client_id=j.client_id and type='appointment_change' and status in ('approved','edited_and_approved');
  if a.id is null or a.proposed_payload->>'provider' is distinct from 'northstar_internal' then continue; end if;
  select * into origin from public.approval_items where id=(a.proposed_payload->>'booking_approval_id')::uuid and partner_id=j.partner_id and client_id=j.client_id and type='appointment_booking' for update;
  if nullif(origin.proposed_payload->>'conversation_id','') is not null then perform 1 from public.business_conversations c where c.id=(origin.proposed_payload->>'conversation_id')::uuid and c.partner_id=j.partner_id and c.client_id=j.client_id for update; end if;
  select * into native from public.crm_appointments where id=(a.proposed_payload->>'appointment_id')::uuid and approval_id=origin.id and partner_id=j.partner_id and client_id=j.client_id for update;
  select * into j from public.action_jobs where id=candidate.id and partner_id=candidate.partner_id and client_id=candidate.client_id for update;
  select * into original_receipt from public.action_jobs where id=(a.proposed_payload->>'booking_action_job_id')::uuid and approval_id=origin.id and partner_id=j.partner_id and client_id=j.client_id and kind='calendar.book' and status='succeeded';
  if not (j.status='uncertain' or (j.status='processing' and j.claimed_at<now()-interval '10 minutes')) or j.kind is distinct from 'calendar.'||(a.proposed_payload->>'mutation')
   or j.payload is distinct from a.proposed_payload or not public.calendar_mutation_receipt_valid(a.proposed_payload,j.provider_receipt)
   or origin.id is null or origin.proposed_payload->>'provider' is distinct from 'northstar_internal' or original_receipt.id is null or original_receipt.receipt_recorded_at is null
   or (j.provider_receipt->>'verified_at')::timestamptz<original_receipt.receipt_recorded_at or native.id is null or native.calendar_state_job_id is distinct from j.id
   or native.contact_id::text is distinct from a.proposed_payload->>'contact_id' or native.external_ref is distinct from original_receipt.external_ref
   or j.external_ref is distinct from native.external_ref or (j.provider_receipt->>'event_updated_at')::timestamptz is distinct from native.updated_at
   or (a.proposed_payload->>'mutation'='cancel' and native.status is distinct from 'cancelled')
   or (a.proposed_payload->>'mutation'='reschedule' and (native.status is distinct from 'booked' or native.start_at is distinct from (a.proposed_payload->'new_slot'->>'start_iso')::timestamptz or native.end_at is distinct from (a.proposed_payload->'new_slot'->>'end_iso')::timestamptz)) then continue; end if;
  update public.action_jobs set status='succeeded',claim_token=null,receipt_recorded_at=coalesce(receipt_recorded_at,(provider_receipt->>'verified_at')::timestamptz),calendar_reconcile_due_at=now(),
   calendar_reconcile_reason=null,last_error=null,outcome_detail='Recovered the exact committed internal calendar change. Its mutation was not repeated.' where id=j.id;
  recovered:=recovered+1;
 end loop;
 return recovered;
end $$;

create function public.complete_calendar_mutation(p_partner uuid,p_client uuid,p_job uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.approval_items; origin public.approval_items; j public.action_jobs; booking_job public.action_jobs; native public.crm_appointments; business public.client_businesses;
 review_reason text; review_task uuid; verified_contact uuid; verified_lead uuid; desired_start timestamptz; desired_end timestamptz; internal boolean; already_applied boolean; current_matches boolean;
begin
 select * into j from public.action_jobs where id=p_job and partner_id=p_partner and client_id=p_client;
 select * into a from public.approval_items where id=j.approval_id and partner_id=p_partner and client_id=p_client and type='appointment_change';
 if j.id is null or j.status is distinct from 'succeeded' or j.kind not in ('calendar.cancel','calendar.reschedule') or a.id is null then return jsonb_build_object('state','blocked','jobId',p_job,'reason','A durable succeeded approved calendar mutation is required.'); end if;
 select * into business from public.client_businesses where id=p_client and partner_id=p_partner for update;
 select * into origin from public.approval_items where id=(a.proposed_payload->>'booking_approval_id')::uuid and partner_id=p_partner and client_id=p_client and type='appointment_booking' for update;
 if nullif(origin.proposed_payload->>'conversation_id','') is not null then perform 1 from public.business_conversations c where c.id=(origin.proposed_payload->>'conversation_id')::uuid and c.partner_id=p_partner and c.client_id=p_client for update; end if;
 select * into native from public.crm_appointments where id=(a.proposed_payload->>'appointment_id')::uuid and approval_id=origin.id and partner_id=p_partner and client_id=p_client for update;
 select * into a from public.approval_items where id=j.approval_id and partner_id=p_partner and client_id=p_client for update;
 select * into j from public.action_jobs where id=p_job and partner_id=p_partner and client_id=p_client for update;
 select * into booking_job from public.action_jobs where id=(a.proposed_payload->>'booking_action_job_id')::uuid and approval_id=origin.id and partner_id=p_partner and client_id=p_client and kind='calendar.book' for update;
 internal:=a.proposed_payload->>'provider'='northstar_internal';
 desired_start:=(a.proposed_payload->'new_slot'->>'start_iso')::timestamptz; desired_end:=(a.proposed_payload->'new_slot'->>'end_iso')::timestamptz;
 current_matches:=native.id is not null and native.contact_id::text=a.proposed_payload->>'contact_id' and native.external_ref=a.proposed_payload->>'external_ref'
  and case when a.proposed_payload->>'mutation'='cancel' then native.status='cancelled' else native.status='booked' and native.start_at=desired_start and native.end_at=desired_end end;
 already_applied:=coalesce(native.calendar_state_job_id=j.id and current_matches,false);
 if a.status not in ('approved','edited_and_approved') or j.payload is distinct from a.proposed_payload or j.kind is distinct from 'calendar.'||(a.proposed_payload->>'mutation')
  or not public.calendar_mutation_receipt_valid(a.proposed_payload,j.provider_receipt) or booking_job.status is distinct from 'succeeded' or booking_job.receipt_recorded_at is null
  or (j.provider_receipt->>'verified_at')::timestamptz<booking_job.receipt_recorded_at or j.external_ref is distinct from a.proposed_payload->>'external_ref'
  or native.id is null or native.contact_id::text is distinct from a.proposed_payload->>'contact_id' or native.external_ref is distinct from a.proposed_payload->>'external_ref' then review_reason:='The verified provider receipt and exact saved appointment need local reconciliation.';
 elsif not already_applied and (internal or native.updated_at is distinct from (a.proposed_payload->>'appointment_updated_at')::timestamptz
   or native.start_at is distinct from (a.proposed_payload->'old_slot'->>'start_iso')::timestamptz or native.end_at is distinct from (a.proposed_payload->'old_slot'->>'end_iso')::timestamptz or native.status is distinct from 'booked') then
  review_reason:='The provider result is saved, but the native appointment was edited. Review the exact source before changing local facts.';
 elsif not already_applied and a.proposed_payload->>'mutation'='reschedule' and exists(select 1 from public.crm_appointments other
  where other.partner_id=p_partner and other.client_id=p_client and other.id<>native.id and other.status in ('booked','proposed') and other.start_at<desired_end and other.end_at>desired_start) then
  review_reason:='The provider result is saved, but the replacement time conflicts with another native appointment. Review the source before changing local facts.';
 end if;
 if review_reason is not null then
  -- A durable review task ends automatic local retries without losing the
  -- verified provider outcome or overwriting a concurrent owner's edit.
  select c.id into verified_contact from public.crm_contacts c where c.id=(a.proposed_payload->>'contact_id')::uuid and c.partner_id=p_partner and c.client_id=p_client;
  select l.id into verified_lead from public.crm_leads l where l.id=coalesce(native.lead_id,(origin.proposed_payload->>'lead_id')::uuid) and l.partner_id=p_partner and l.client_id=p_client and l.contact_id=verified_contact;
  select t.id into review_task from public.crm_tasks t where t.partner_id=p_partner and t.client_id=p_client and t.calendar_action_job_id=j.id and t.task_type='calendar_change_reconciliation';
  if review_task is null then
   insert into public.crm_tasks(partner_id,client_id,contact_id,lead_id,booking_approval_id,calendar_action_job_id,title,description,status,priority,task_type)
   values(p_partner,p_client,verified_contact,verified_lead,origin.id,j.id,'Review verified calendar change',review_reason||' No provider action will be retried. Open the source calendar and compare its current appointment with the saved receipt.','open','high','calendar_change_reconciliation') returning id into review_task;
  end if;
  update public.action_jobs set calendar_reconcile_due_at=null,calendar_reconcile_reason=review_reason where id=j.id;
  return jsonb_build_object('state','review','jobId',j.id,'bookingApprovalId',origin.id,'taskId',review_task,'reason',review_reason);
 end if;
 if j.calendar_reconcile_due_at is null and already_applied then return jsonb_build_object('state','completed','jobId',j.id,'bookingApprovalId',origin.id,'appointmentId',native.id,'replayed',true); end if;
 if not already_applied then
  if a.proposed_payload->>'mutation'='cancel' then update public.crm_appointments set status='cancelled',calendar_state_job_id=j.id where id=native.id returning * into native;
  else update public.crm_appointments set start_at=desired_start,end_at=desired_end,calendar_state_job_id=j.id where id=native.id returning * into native; end if;
 end if;
 perform public.stop_booking_change_followups(p_partner,p_client,origin.id,'The verified calendar change superseded the old appointment version.');
 if a.proposed_payload->>'mutation'='cancel' then
  update public.action_jobs set confirmation_due_at=null,booking_followup_due_at=null,booking_followup_phase='stopped',booking_followup_reason='A verified approved cancellation stopped old follow-ups.' where id=booking_job.id;
  update public.crm_tasks set status='done',completed_at=now() where partner_id=p_partner and client_id=p_client and booking_approval_id=origin.id and task_type='booking_cancellation_request' and status='open';
 elsif booking_job.booking_followup_phase is distinct from 'stopped' and not exists(select 1 from public.crm_tasks t where t.partner_id=p_partner and t.client_id=p_client and t.booking_approval_id=origin.id and t.task_type='booking_cancellation_request' and t.status='open') then
  update public.action_jobs set confirmation_due_at=now(),confirmation_attempts=0,booking_followup_attempts=0,
   booking_followup_phase=case when business.native_lifecycle_enabled_at is not null and business.native_lifecycle_enabled_at<=(j.provider_receipt->>'verified_at')::timestamptz and desired_start>now() then 'reminder' else 'done' end,
   booking_followup_due_at=case when business.native_lifecycle_enabled_at is not null and business.native_lifecycle_enabled_at<=(j.provider_receipt->>'verified_at')::timestamptz and desired_start>now() then greatest(now(),desired_start-interval '24 hours') else null end,
   booking_followup_reason=null where id=booking_job.id;
 end if;
 if not exists(select 1 from public.crm_timeline_entries t where t.partner_id=p_partner and t.client_id=p_client and t.ref_approval_id=a.id and t.kind='appointment') then
  insert into public.crm_timeline_entries(partner_id,client_id,contact_id,lead_id,kind,actor_type,actor_user_id,title,body,ref_approval_id)
  values(p_partner,p_client,native.contact_id,native.lead_id,'appointment','user',a.resolved_by,case when a.proposed_payload->>'mutation'='cancel' then 'Approved cancellation verified' else 'Approved replacement time verified' end,
   case when internal then 'The internal calendar change and immutable action receipt committed together.' else 'The provider result was verified by an exact source readback and mirrored without repeating its provider write.' end,a.id);
 end if;
 update public.action_jobs set calendar_reconcile_due_at=null,calendar_reconcile_reason=null where id=j.id;
 return jsonb_build_object('state','completed','jobId',j.id,'bookingApprovalId',origin.id,'appointmentId',native.id);
end $$;

create function public.save_calendar_change_handoff(p_partner uuid,p_client uuid,p_actor uuid,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior public.business_owner_commands; origin public.approval_items; native public.crm_appointments; receipt public.action_jobs;
 request_id uuid:=(p_command->>'key')::uuid; receipt_id uuid:=extensions.gen_random_uuid(); task_id uuid; verified_lead uuid; public_request jsonb; result jsonb;
begin
 public_request:=coalesce(p_command->'owner_request',p_command);
 if p_actor is null or request_id is null or jsonb_typeof(p_command) is distinct from 'object' or p_command-array['action','key','targetId','expectedRevision','owner_request']<>'{}'::jsonb
  or p_command->>'action' is distinct from 'request_cancellation' or (public_request-'expectedRevision') is distinct from ((p_command-'owner_request')-'expectedRevision') then raise exception 'Invalid calendar source-app handoff' using errcode='22023'; end if;
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner for update;
 if not found then raise exception 'Business unavailable'; end if;
 select * into prior from public.business_owner_commands c where c.partner_id=p_partner and c.client_id=p_client and c.request_key=request_id;
 if prior.id is not null then
  if prior.actor_id is distinct from p_actor or coalesce(prior.command->'owner_request',prior.command) is distinct from public_request then raise exception 'Request key changed' using errcode='40001'; end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 select * into origin from public.approval_items where id=(p_command->>'targetId')::uuid and partner_id=p_partner and client_id=p_client and type='appointment_booking' for update;
 if nullif(origin.proposed_payload->>'conversation_id','') is not null then perform 1 from public.business_conversations c where c.id=(origin.proposed_payload->>'conversation_id')::uuid and c.partner_id=p_partner and c.client_id=p_client for update; end if;
 select * into native from public.crm_appointments where approval_id=origin.id and partner_id=p_partner and client_id=p_client for update;
 select * into receipt from public.action_jobs where approval_id=origin.id and partner_id=p_partner and client_id=p_client and kind='calendar.book' and status='succeeded' for update;
 if origin.id is null or native.id is null or receipt.id is null or nullif(receipt.external_ref,'') is null or native.updated_at is distinct from (p_command->>'expectedRevision')::timestamptz
  or native.status not in ('proposed','booked') then raise exception 'The exact saved appointment changed; review it before requesting source-app cancellation' using errcode='40001'; end if;
 select l.id into verified_lead from public.crm_leads l where l.id=coalesce(native.lead_id,(origin.proposed_payload->>'lead_id')::uuid) and l.partner_id=p_partner and l.client_id=p_client and l.contact_id=native.contact_id;
 select t.id into task_id from public.crm_tasks t where t.partner_id=p_partner and t.client_id=p_client and t.booking_approval_id=origin.id and t.task_type='booking_cancellation_request' and t.status='open';
 if task_id is null then
  insert into public.crm_tasks(partner_id,client_id,contact_id,lead_id,booking_approval_id,title,description,status,priority,task_type,created_by)
  values(p_partner,p_client,native.contact_id,verified_lead,origin.id,'Review cancellation in the source calendar','An owner requested cancellation review. Old follow-ups are stopped. No provider or internal appointment change has occurred.','open','high','booking_cancellation_request',p_actor) returning id into task_id;
 end if;
 perform public.stop_booking_change_followups(p_partner,p_client,origin.id,'Owner requested cancellation review. No provider calendar change occurred.');
 update public.action_jobs set confirmation_due_at=null,booking_followup_due_at=null,booking_followup_phase='stopped',booking_followup_reason='An owner requested source-app cancellation review.' where id=receipt.id;
 result:=jsonb_build_object('id',receipt_id,'bookingApprovalId',origin.id,'taskId',task_id,'message','Source-calendar cancellation review saved. Old follow-ups are stopped; no appointment was cancelled.','replayed',false);
 insert into public.business_owner_commands(id,partner_id,client_id,actor_id,request_key,command,result) values(receipt_id,p_partner,p_client,p_actor,request_id,p_command,result);
 return result;
end $$;

-- Root owns action kind constraints, enqueue/stamp guards and dispatch CAS.
-- Pending lifecycle expiry must continue allowing standalone/legacy bound
-- confirmation drafts; resolved approvals remain immutable.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('guard_calendar_state_marker','guard_calendar_reconciliation_task','calendar_mutation_latest_activity','calendar_mutation_source_check','stop_booking_change_followups','calendar_mutation_receipt_valid','save_calendar_mutation_offer',
  'prepare_calendar_mutation','calendar_mutation_action_check','apply_internal_calendar_mutation','recover_internal_calendar_mutations','complete_calendar_mutation','save_calendar_change_handoff') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

-- DRAFT for root integration/review only. No database execution.
-- Current owner review reuses booking_request, CRM task, approvals and action_jobs.

create function public.customer_rebooking_scheduling_check(p_work uuid,p_claim uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.agent_work_items;
begin
 select * into w from public.agent_work_items where id=p_work;
 if p_claim is null or w.id is null or w.claim_token is distinct from p_claim or w.status<>'running' or w.lease_until is null or w.lease_until<=now() then return jsonb_build_object('allowed',false,'reason','The scheduling claim expired or was interrupted.'); end if;
 return public.customer_rebooking_source_check(p_work,false,true);
end $$;

create function public.customer_rebooking_action_check(p_work uuid,p_approval uuid,p_allow_completed boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.agent_work_items;
begin
 select * into w from public.agent_work_items where id=p_work;
 if w.id is null or p_approval is null or w.approval_id is distinct from p_approval or w.status='cancelled' then return jsonb_build_object('allowed',false,'reason','The booking action does not match its reviewed assignment.'); end if;
 if w.status='completed' then
  if not p_allow_completed or not exists(select 1 from public.action_jobs j where j.approval_id=p_approval and j.partner_id=w.partner_id and j.client_id=w.client_id and j.kind='calendar.book' and j.status='succeeded' and nullif(j.external_ref,'') is not null) then return jsonb_build_object('allowed',false,'reason','Completed work cannot create another booking.'); end if;
 elsif w.status not in ('running','waiting_approval','waiting_external') then return jsonb_build_object('allowed',false,'reason','The booking assignment is no longer active.'); end if;
 return public.customer_rebooking_source_check(p_work,p_allow_completed,not p_allow_completed);
end $$;

create function public.save_customer_rebooking_offer(p_work uuid,p_claim uuid,p_offer jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare w public.agent_work_items; check_result jsonb; s jsonb; checked timestamptz; expires timestamptz; account public.integration_connections; provider text;
begin
 select * into strict w from public.agent_work_items where id=p_work for update;
 check_result:=public.customer_rebooking_scheduling_check(p_work,p_claim);
 if not coalesce((check_result->>'allowed')::boolean,false) or w.approval_id is not null then raise exception 'Inquiry scheduling changed' using errcode='40001'; end if;
 if jsonb_typeof(p_offer) is distinct from 'object' or jsonb_typeof(p_offer->'slots') is distinct from 'array' or jsonb_array_length(p_offer->'slots') not between 1 and 3 or nullif(p_offer->>'timezone','') is null or length(p_offer->>'timezone')>100 or p_offer->>'provider' not in ('northstar_internal','google_calendar','google_workspace','microsoft_365') then raise exception 'Invalid availability offer' using errcode='22023'; end if;
 checked:=(p_offer->>'checked_at')::timestamptz; expires:=(p_offer->>'expires_at')::timestamptz;
 if checked is null or expires is null or checked>now()+interval '5 minutes' or expires<=now() or expires<=checked or expires>checked+interval '15 minutes' then raise exception 'Availability expired' using errcode='40001'; end if;
 for s in select value from jsonb_array_elements(p_offer->'slots') loop
  if nullif(s->>'start_iso','') is null or nullif(s->>'end_iso','') is null or (s->>'start_iso')::timestamptz<=now() or (s->>'end_iso')::timestamptz<=(s->>'start_iso')::timestamptz or nullif(s->>'label','') is null or length(s->>'label')>300 then raise exception 'Invalid offered slot' using errcode='22023'; end if;
 end loop;
 if p_offer->>'provider'='northstar_internal' then
  if p_offer->>'calendar_connection_id' is not null or not exists(select 1 from public.client_businesses b where b.partner_id=w.partner_id and b.id=w.client_id and b.status='active' and b.default_runtime_mode='live' and b.crm_operating_mode in ('primary_crm','mirror','assist')) then raise exception 'Internal calendar unavailable' using errcode='22023'; end if;
 else
  select * into account from public.integration_connections where id=(p_offer->>'calendar_connection_id')::uuid and partner_id=w.partner_id and client_id=w.client_id;
  select provider_key into provider from public.integration_providers where id=account.provider_id;
  if account.id is null or provider is distinct from p_offer->>'provider' or account.status<>'connected' or account.runtime_mode<>'live' or account.config->>'workspace_view_only'='true' then raise exception 'Calendar account unavailable or read only' using errcode='22023'; end if;
 end if;
 update public.agent_work_items set status='waiting_approval',summary='Choose an offered appointment time. Nothing is held or booked.',result=result||jsonb_build_object('phase','choose_slot','offer',p_offer),claim_token=null,lease_until=null,revision=revision+1,next_run_at=expires,updated_at=now() where id=w.id and claim_token=p_claim and status='running' and lease_until>now();
 if not found then raise exception 'Scheduling claim lost' using errcode='40001'; end if;
 insert into public.agent_work_events(partner_id,client_id,work_id,status,summary) values(w.partner_id,w.client_id,w.id,'waiting_approval','Real availability saved for an explicit owner choice. No booking was made.');
 return true;
end $$;

create function public.propose_customer_rebooking(p_work uuid,p_claim uuid,p_metadata jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare w public.agent_work_items; check_result jsonb; chosen jsonb; approval uuid; payload jsonb; selection integer; account public.integration_connections; provider text;
begin
 select * into strict w from public.agent_work_items where id=p_work for update;
 check_result:=public.customer_rebooking_scheduling_check(p_work,p_claim);
 if not coalesce((check_result->>'allowed')::boolean,false) or w.approval_id is not null then raise exception 'Inquiry scheduling changed' using errcode='40001'; end if;
 selection:=(w.input->>'selection_index')::integer;
 if selection not between 1 and 3 or jsonb_typeof(w.result->'offer'->'slots')<>'array' then raise exception 'Choose a saved offered slot first' using errcode='22023'; end if;
 chosen:=w.result->'offer'->'slots'->(selection-1);
 if chosen is null or chosen is distinct from w.input->'slot' or chosen is distinct from p_metadata->'slot' or (chosen->>'start_iso')::timestamptz<=now() or p_metadata->>'provider' is distinct from w.result->'offer'->>'provider' or p_metadata->>'calendar_connection_id' is distinct from w.result->'offer'->>'calendar_connection_id' or p_metadata->>'timezone' is distinct from w.result->'offer'->>'timezone' then raise exception 'The selected slot or calendar changed' using errcode='40001'; end if;
 if (p_metadata->>'authority_revision')::integer is distinct from (w.input->>'authority_revision')::integer or p_metadata->>'customer_rebooking_work_id' is distinct from w.id::text or p_metadata->>'lead_id' is distinct from w.source_lead_id::text or p_metadata->>'contact_id' is distinct from check_result->'contact'->>'id' then raise exception 'Proposal identity or authority changed' using errcode='40001'; end if;
 if w.result->'offer'->>'provider'='northstar_internal' then
  if w.result->'offer'->>'calendar_connection_id' is not null or not exists(select 1 from public.client_businesses b where b.partner_id=w.partner_id and b.id=w.client_id and b.status='active' and b.default_runtime_mode='live' and b.crm_operating_mode in ('primary_crm','mirror','assist')) then raise exception 'Internal calendar unavailable' using errcode='40001'; end if;
 else
  select * into account from public.integration_connections where id=(w.result->'offer'->>'calendar_connection_id')::uuid and partner_id=w.partner_id and client_id=w.client_id;
  select provider_key into provider from public.integration_providers where id=account.provider_id;
  if account.id is null or provider is distinct from w.result->'offer'->>'provider' or account.status<>'connected' or account.runtime_mode<>'live' or account.config->>'workspace_view_only'='true' then raise exception 'Calendar account changed or is read only' using errcode='40001'; end if;
 end if;
 -- Copy all provenance and identity pins from durable work/checked records,
 -- never from a model or browser-supplied metadata bag.
 payload:=jsonb_build_object('origin','owner_conversation','customer_rebooking_work_id',w.id,'conversation_id',w.conversation_id,'conversation_revision',w.input->'conversation_revision','source_connection_id',w.input->'source_connection_id',
  'activity_id',w.input->'activity_id','activity_at',w.input->'activity_at','qualified_at',w.input->'qualified_at','rebooking_origin_approval_id',w.input->'rebooking_origin_approval_id',
  'lead_updated_at',w.input->'lead_updated_at','contact_updated_at',w.input->'contact_updated_at','authority_revision',w.input->'authority_revision',
  'lead_id',w.source_lead_id,'contact_id',check_result->'contact'->'id','contact',check_result->'contact','task_id',check_result->'taskId','identity_confirmed',true,'booking_requested',true,'instructions_reviewed',true,'service',w.input->'service',
  'provider',w.result->'offer'->'provider','calendar_connection_id',w.result->'offer'->'calendar_connection_id','timezone',w.result->'offer'->'timezone','slot',chosen);
 insert into public.approval_items(partner_id,client_id,type,status,title,summary,proposed_payload,expires_at)
 values(w.partner_id,w.client_id,'appointment_booking','pending',left('Book appointment: '||coalesce(w.input->>'service','Service'),180),
  'Owner selected '||(chosen->>'label')||'. Availability will be checked again before booking. This owner selection was not sent to the customer. Confirmation requires a separate reviewed action in the original thread.',payload,least(now()+interval '24 hours',(chosen->>'start_iso')::timestamptz)) returning id into approval;
 update public.agent_work_items set approval_id=approval,status='waiting_approval',summary='The selected appointment is awaiting owner approval. Nothing is held or booked.',result=result||jsonb_build_object('phase','booking_approval','booking_approval_id',approval),claim_token=null,lease_until=null,revision=revision+1,updated_at=now() where id=w.id and claim_token=p_claim and status='running' and lease_until>now();
 if not found then raise exception 'Scheduling claim lost' using errcode='40001'; end if;
 insert into public.agent_work_events(partner_id,client_id,work_id,status,summary) values(w.partner_id,w.client_id,w.id,'waiting_approval','Booking proposal saved for owner approval. No provider write occurred.');
 return true;
end $$;



create function public.select_customer_rebooking_slot(p_partner uuid,p_client uuid,p_actor uuid,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior public.business_owner_commands; w public.agent_work_items; request_id uuid; receipt_id uuid:=gen_random_uuid(); offer jsonb; slot jsonb; selection integer; check_result jsonb; outcome jsonb;
begin
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner for update;
 if not found or p_actor is null or jsonb_typeof(p_command) is distinct from 'object' then raise exception 'Business unavailable' using errcode='22023'; end if;
 request_id:=(p_command->>'key')::uuid;
 if request_id is null then raise exception 'Missing request key' using errcode='22023'; end if;
 select commands.* into prior from public.business_owner_commands commands where commands.partner_id=p_partner and commands.client_id=p_client and commands.request_key=request_id;
 if prior.id is not null then
  if prior.actor_id is distinct from p_actor or prior.command is distinct from p_command then raise exception 'Request key changed' using errcode='40001'; end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 if p_command->>'action' is distinct from 'select_intake_slot' or p_command-array['action','key','workId','expectedWorkRevision','slot','owner_request']<>'{}'::jsonb then raise exception 'Invalid selected-slot command' using errcode='22023'; end if;
 select * into w from public.agent_work_items where id=(p_command->>'workId')::uuid and partner_id=p_partner and client_id=p_client for update;
 if w.id is null or w.input->>'origin'<>'owner_conversation' or w.approval_id is not null or w.status not in ('waiting_approval','blocked') or w.revision is distinct from (p_command->>'expectedWorkRevision')::integer then raise exception 'The scheduling decision changed' using errcode='40001'; end if;
 check_result:=public.customer_rebooking_source_check(w.id,false,true);
 if check_result->>'allowed' is distinct from 'true' then raise exception 'Customer source or authority changed' using errcode='40001'; end if;
 offer:=w.result->'offer'; selection:=(p_command->>'slot')::integer;
 if selection is null or selection not between 1 and 3 or jsonb_typeof(offer->'slots') is distinct from 'array' or (offer->>'expires_at')::timestamptz is null or (offer->>'expires_at')::timestamptz<=now() or (offer->>'checked_at')::timestamptz>now()+interval '5 minutes' then raise exception 'Choose fresh saved availability' using errcode='40001'; end if;
 slot:=offer->'slots'->(selection-1);
 if slot is null or (slot->>'start_iso')::timestamptz<=now() then raise exception 'The offered time expired' using errcode='40001'; end if;
 update public.agent_work_items set input=input||jsonb_build_object('slot',slot,'selection_index',selection,'provider',offer->'provider','calendar_connection_id',offer->'calendar_connection_id','timezone',offer->'timezone'),result=result||jsonb_build_object('phase','selected_slot'),status='queued',summary='Owner selected a saved time. Scheduling will recheck before booking approval; nothing was sent or booked.',next_run_at=now(),claim_token=null,lease_until=null,revision=revision+1,updated_at=now() where id=w.id and revision=w.revision;
 if not found then raise exception 'Scheduling decision changed' using errcode='40001'; end if;
 outcome:=jsonb_build_object('id',receipt_id,'bookingApprovalId',w.input->'rebooking_origin_approval_id','leadId',w.source_lead_id,'taskId',w.input->'task_id','workId',w.id,'state','queued','missing','[]'::jsonb,'message','Selected time saved for a fresh availability check and owner approval. Nothing is held, booked or sent.','replayed',false);
 insert into public.business_owner_commands(id,partner_id,client_id,actor_id,request_key,command,result) values(receipt_id,p_partner,p_client,p_actor,request_id,p_command,outcome);
 return outcome;
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('customer_rebooking_source_check','customer_rebooking_scheduling_check','customer_rebooking_action_check','save_customer_rebooking_offer','propose_customer_rebooking','review_customer_rebooking','select_customer_rebooking_slot') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

-- Shared intake guard: fresh review pins exact cross-channel activity too.


-- DRAFT ONLY for root review/integration. No database/provider execution.
-- Requires action_jobs.provider_receipt and crm_appointments.calendar_state_job_id.
-- Original booking approvals/jobs/receipts remain immutable provenance.
create function public.booking_effective_calendar_state(p_partner uuid,p_client uuid,p_booking_approval uuid,p_action_job uuid,p_appointment uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare a public.approval_items; j public.action_jobs; n public.crm_appointments; state_job public.action_jobs; change public.approval_items;
 mutation jsonb; proof jsonb; calendar_account text; starts timestamptz; ends timestamptz; receipt_at timestamptz;
begin
 select * into a from public.approval_items where id=p_booking_approval and partner_id=p_partner and client_id=p_client and type='appointment_booking';
 select * into j from public.action_jobs where id=p_action_job and approval_id=a.id and partner_id=p_partner and client_id=p_client and kind='calendar.book';
 select * into n from public.crm_appointments where id=p_appointment and approval_id=a.id and partner_id=p_partner and client_id=p_client;
 if a.id is null or a.status not in ('approved','edited_and_approved') or j.id is null or j.status<>'succeeded' or nullif(j.external_ref,'') is null or j.receipt_recorded_at is null or n.id is null or n.external_ref is distinct from j.external_ref then
  return jsonb_build_object('allowed',false,'reason','The exact original booking and immutable receipt are unavailable.'); end if;
 starts:=(a.proposed_payload->'slot'->>'start_iso')::timestamptz; ends:=(a.proposed_payload->'slot'->>'end_iso')::timestamptz; receipt_at:=j.receipt_recorded_at;
 if n.calendar_state_job_id is null then
  if starts is null or ends is null or ends<=starts or n.start_at is distinct from starts or n.end_at is distinct from ends then
   return jsonb_build_object('allowed',false,'reason','The appointment time has no linked verified change receipt.'); end if;
 else
  select * into state_job from public.action_jobs where id=n.calendar_state_job_id and partner_id=p_partner and client_id=p_client and kind='calendar.reschedule' and status='succeeded';
  select * into change from public.approval_items where id=state_job.approval_id and partner_id=p_partner and client_id=p_client and type='appointment_change' and status in ('approved','edited_and_approved');
  mutation:=change.proposed_payload; proof:=state_job.provider_receipt;
  if state_job.id is null or change.id is null or state_job.external_ref is distinct from j.external_ref or jsonb_typeof(mutation) is distinct from 'object' or jsonb_typeof(proof) is distinct from 'object' or
   not (proof ?& array['provider','operation','event_id','http_status','request_id','event_etag','event_updated_at','verified_at','verified_absent','old_slot','new_slot']) or
   jsonb_typeof(proof->'request_id') not in ('string','null') or length(proof->>'request_id')>1000 or jsonb_typeof(proof->'event_etag') not in ('string','null') or length(proof->>'event_etag')>1100 or jsonb_typeof(proof->'event_updated_at') not in ('string','null') or
   coalesce(proof->>'verified_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or
   mutation->'calendar_mutation_version' is distinct from '1'::jsonb or mutation->>'mutation' is distinct from 'reschedule' or mutation->>'booking_approval_id' is distinct from a.id::text or mutation->>'booking_action_job_id' is distinct from j.id::text or mutation->>'appointment_id' is distinct from n.id::text or mutation->>'contact_id' is distinct from n.contact_id::text or
   mutation->>'provider' is distinct from a.proposed_payload->>'provider' or mutation->>'calendar_connection_id' is distinct from a.proposed_payload->>'calendar_connection_id' or mutation->>'external_ref' is distinct from j.external_ref or
   proof->>'provider' is distinct from mutation->>'provider' or proof->>'operation' is distinct from 'reschedule' or proof->>'event_id' is distinct from j.external_ref or proof->'verified_absent' is distinct from 'false'::jsonb or
   jsonb_typeof(mutation->'old_slot') is distinct from 'object' or jsonb_typeof(mutation->'new_slot') is distinct from 'object' or jsonb_typeof(proof->'old_slot') is distinct from 'object' or jsonb_typeof(proof->'new_slot') is distinct from 'object' then
   return jsonb_build_object('allowed',false,'reason','The current time change lacks an exact approved provider receipt.'); end if;
  starts:=(mutation->'new_slot'->>'start_iso')::timestamptz; ends:=(mutation->'new_slot'->>'end_iso')::timestamptz; receipt_at:=(proof->>'verified_at')::timestamptz;
  if starts is null or ends is null or ends<=starts or n.start_at is distinct from starts or n.end_at is distinct from ends or
   (proof->'new_slot'->>'start_iso')::timestamptz is distinct from starts or (proof->'new_slot'->>'end_iso')::timestamptz is distinct from ends or
   nullif(mutation->'old_slot'->>'start_iso','') is null or nullif(mutation->'old_slot'->>'end_iso','') is null or
   (proof->'old_slot'->>'start_iso')::timestamptz is distinct from (mutation->'old_slot'->>'start_iso')::timestamptz or (proof->'old_slot'->>'end_iso')::timestamptz is distinct from (mutation->'old_slot'->>'end_iso')::timestamptz or
   receipt_at is null or receipt_at>now() or receipt_at<j.receipt_recorded_at then
   return jsonb_build_object('allowed',false,'reason','The proved replacement slot or immutable verification clock is invalid.'); end if;
  if mutation->>'provider'='northstar_internal' then
   if proof->'http_status' is distinct from '0'::jsonb or proof->>'event_etag' is not null or mutation->>'calendar_connection_id' is not null or mutation->>'calendar_account_id' is not null or mutation->>'calendar_id' is not null or mutation->>'source_record_id' is not null or mutation->>'source_etag' is not null then
    return jsonb_build_object('allowed',false,'reason','The internal time-change receipt has an invalid source binding.'); end if;
  elsif mutation->>'provider' in ('google_calendar','google_workspace') then
   select c.external_account_id into calendar_account from public.integration_connections c join public.integration_providers provider on provider.id=c.provider_id where c.id::text=mutation->>'calendar_connection_id' and c.partner_id=p_partner and c.client_id=p_client and provider.provider_key=mutation->>'provider';
   if calendar_account is null or calendar_account is distinct from mutation->>'calendar_account_id' then return jsonb_build_object('allowed',false,'reason','The proved reschedule belongs to a different calendar account.'); end if;
   if proof->'http_status' is distinct from '200'::jsonb or nullif(proof->>'event_etag','') is null or proof->>'event_etag' !~ '^"[!#-~]+"$' or proof->>'event_etag' is not distinct from mutation->>'source_etag' or nullif(proof->>'event_updated_at','') is null or
    nullif(mutation->>'calendar_connection_id','') is null or nullif(mutation->>'calendar_account_id','') is null or nullif(mutation->>'calendar_id','') is null or nullif(mutation->>'source_record_id','') is null or nullif(mutation->>'source_etag','') is null then
    return jsonb_build_object('allowed',false,'reason','The external time-change receipt lacks conditional-write proof.'); end if;
   -- Validate this timestamp even though its role is provider evidence, not
   -- the immutable local receipt clock used to schedule follow-ups.
   perform (proof->>'event_updated_at')::timestamptz;
  else return jsonb_build_object('allowed',false,'reason','This calendar provider has no verified reschedule receipt support.'); end if;
 end if;
 return jsonb_build_object('allowed',true,'reason','The current appointment time has exact receipt-backed provenance.','stateJobId',n.calendar_state_job_id,'startAt',starts,'endAt',ends,'receiptAt',receipt_at);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
 return jsonb_build_object('allowed',false,'reason','The current calendar mutation proof contains invalid identity or time values.');
end $$;

create or replace function public.prepare_booking_lifecycle_followup(p_partner uuid,p_client uuid,p_booking_approval uuid,p_action_job uuid,p_kind text,p_pin jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.approval_items; j public.action_jobs; n public.crm_appointments; customer public.crm_contacts;
 b public.client_businesses; settings public.agent_team_settings; source public.integration_canonical_records;
 account public.integration_connections; conversation public.business_conversations; effective jsonb; activity_id uuid; activity_at timestamptz; effective_receipt_at timestamptz;
 result_id uuid; result_state text:='existing'; version_key text; body text; recipient text; channel text; source_provider text; desired_start timestamptz; desired_end timestamptz;
begin
 if p_kind is null or p_kind not in ('confirmation','reminder') or jsonb_typeof(p_pin) is distinct from 'object' or p_pin->>'booking_lifecycle_version' is distinct from '1' or p_pin->>'booking_followup_kind' is distinct from p_kind then
  raise exception 'Invalid booking follow-up proposal' using errcode='22023';
 end if;
 select * into a from public.approval_items where id=p_booking_approval and partner_id=p_partner and client_id=p_client and type='appointment_booking';
 select * into j from public.action_jobs where id=p_action_job and approval_id=a.id and partner_id=p_partner and client_id=p_client and kind='calendar.book';
 if a.id is null or a.status not in ('approved','edited_and_approved') or j.status is distinct from 'succeeded' or nullif(j.external_ref,'') is null then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The original durable successful booking receipt is unavailable.');
 end if;
 -- Ingestion takes conversation -> proposal -> outbox locks. Match that order
 -- before supersession so approval cannot append a child after our snapshot.
 if nullif(a.proposed_payload->>'conversation_id','') is not null then
  select * into conversation from public.business_conversations where id::text=a.proposed_payload->>'conversation_id'
   and partner_id=p_partner and client_id=p_client for update;
  if conversation.id is null then return jsonb_build_object('state','blocked','approvalId',null,'reason','The originating conversation is unavailable.'); end if;
 end if;
 if j.receipt_recorded_at is null then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The booking has no immutable receipt time. Review this historical booking before preparing follow-ups.');
 end if;
 if j.booking_followup_phase='stopped' or exists(select 1 from public.crm_tasks where partner_id=p_partner and client_id=p_client and booking_approval_id=a.id and task_type='booking_cancellation_request' and status='open') then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','An owner stopped booking follow-ups or requested cancellation.');
 end if;
 select * into n from public.crm_appointments where approval_id=a.id and partner_id=p_partner and client_id=p_client for update;
 select * into customer from public.crm_contacts where id=n.contact_id and partner_id=p_partner and client_id=p_client for update;
 if n.id is null or customer.id is null or n.id::text is distinct from p_pin->>'appointment_id' or n.updated_at is distinct from (p_pin->>'appointment_updated_at')::timestamptz
  or customer.id::text is distinct from p_pin->>'contact_id' or customer.updated_at is distinct from (p_pin->>'contact_updated_at')::timestamptz
  or a.id::text is distinct from p_pin->>'booking_approval_id' or j.id::text is distinct from p_pin->>'booking_action_job_id' then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The appointment, customer or receipt changed before preparation.');
 end if;
 if exists(select 1 from public.approval_items changing join public.action_jobs mutation_job on mutation_job.approval_id=changing.id and mutation_job.partner_id=changing.partner_id and mutation_job.client_id=changing.client_id
  where changing.partner_id=p_partner and changing.client_id=p_client and changing.type='appointment_change' and changing.status in ('approved','edited_and_approved') and changing.proposed_payload->>'booking_approval_id'=a.id::text and changing.proposed_payload->>'appointment_id'=n.id::text and
   mutation_job.kind in ('calendar.cancel','calendar.reschedule') and
   (mutation_job.status in ('processing','provider_pending','uncertain') or (mutation_job.status='failed' and nullif(mutation_job.external_ref,'') is not null)
    or ((changing.proposed_payload->>'appointment_updated_at')::timestamptz=n.updated_at and mutation_job.status in ('pending','succeeded')))) then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','An approved current appointment change is pending or needs receipt reconciliation. No old-state follow-up was prepared.'); end if;
 effective:=public.booking_effective_calendar_state(p_partner,p_client,a.id,j.id,n.id);
 if effective->>'allowed' is distinct from 'true' then
  return jsonb_build_object('state','blocked','approvalId',null,'reason',coalesce(effective->>'reason','The current time-change proof is unavailable.')); end if;
 if n.calendar_state_job_id::text is distinct from p_pin->>'booking_state_job_id' then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The effective booking state changed before preparation.'); end if;
 effective_receipt_at:=(effective->>'receiptAt')::timestamptz; desired_start:=(effective->>'startAt')::timestamptz; desired_end:=(effective->>'endAt')::timestamptz;
 if n.status<>'booked' or n.start_at is distinct from desired_start or n.end_at is distinct from desired_end or n.start_at<=now()
  or n.start_at is distinct from (p_pin->'booking_slot'->>'start_iso')::timestamptz or n.end_at is distinct from (p_pin->'booking_slot'->>'end_iso')::timestamptz then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The effective booked appointment was cancelled, changed or has passed.');
 end if;
 perform 1 from public.approval_items proposal where proposal.partner_id=p_partner and proposal.client_id=p_client
  and proposal.type='customer_message' and proposal.proposed_payload->>'booking_approval_id'=a.id::text
  and coalesce(proposal.proposed_payload->>'booking_followup_kind','confirmation')=p_kind for update;
 -- Lock every existing same-origin/kind outbox row before deciding whether
 -- an unsent proposal may be superseded. Never duplicate an accepted, in-flight
 -- or uncertain provider message, including the pre-versioned confirmation.
 perform 1 from public.action_jobs child join public.approval_items proposal on proposal.id=child.approval_id
 where child.partner_id=p_partner and child.client_id=p_client and proposal.partner_id=p_partner and proposal.client_id=p_client
  and proposal.type='customer_message' and proposal.proposed_payload->>'booking_approval_id'=a.id::text
  and coalesce(proposal.proposed_payload->>'booking_followup_kind','confirmation')=p_kind for update of child;
 select proposal.id into result_id from public.approval_items proposal
 where proposal.partner_id=p_partner and proposal.client_id=p_client and proposal.type='customer_message'
  and proposal.proposed_payload->>'booking_approval_id'=a.id::text
  and coalesce(proposal.proposed_payload->>'booking_followup_kind','confirmation')=p_kind
  and proposal.proposed_payload->>'booking_state_job_id' is not distinct from n.calendar_state_job_id::text
  and exists(select 1 from public.action_jobs child where child.partner_id=p_partner and child.client_id=p_client and child.approval_id=proposal.id
    and (child.status in ('processing','provider_pending','uncertain','succeeded') or nullif(child.external_ref,'') is not null))
 order by proposal.created_at,proposal.id limit 1;
 if result_id is not null then
  if p_kind='reminder' then update public.action_jobs set booking_followup_due_at=null,booking_followup_phase=case when booking_followup_phase='stopped' then 'stopped' else 'done' end where id=j.id; end if;
  return jsonb_build_object('state','existing','approvalId',result_id,'reason','An existing provider outcome must be reconciled; no duplicate message was created.');
 end if;
 select * into b from public.client_businesses where id=p_client and partner_id=p_partner;
 if p_kind='reminder' then
  if b.native_lifecycle_enabled_at is null or effective_receipt_at is null or effective_receipt_at<b.native_lifecycle_enabled_at then
   return jsonb_build_object('state','blocked','approvalId',null,'reason','Reminders were not enabled for this booking.');
  end if;
  if now()<n.start_at-interval '24 hours' then
   update public.action_jobs set booking_followup_due_at=n.start_at-interval '24 hours',booking_followup_phase='reminder' where id=j.id and booking_followup_phase='reminder';
   return jsonb_build_object('state','not_due','approvalId',null,'reason','Reminder preparation is scheduled for the day before the appointment.','nextDueAt',n.start_at-interval '24 hours');
  end if;
 end if;
 if exists(select 1 from unnest(customer.tags) tag where lower(regexp_replace(btrim(tag),'[[:space:]-]+','_','g')) in ('do_not_contact','opt_out','opted_out','unsubscribed','stop')) then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The customer opted out.');
 end if;
 select activity.id,activity.created_at into activity_id,activity_at from (
  select comm.id,comm.created_at from public.crm_communications comm where comm.partner_id=p_partner and comm.client_id=p_client and comm.contact_id=customer.id and comm.direction='inbound' and comm.status='received'
  union all select msg.id,msg.created_at from public.business_conversation_messages msg join public.business_conversations cv on cv.id=msg.conversation_id and cv.partner_id=msg.partner_id and cv.client_id=msg.client_id where cv.partner_id=p_partner and cv.client_id=p_client and cv.contact_id=customer.id and cv.identity_status='owner_verified' and msg.direction='inbound' and msg.status='received'
 ) activity order by activity.created_at desc,activity.id desc limit 1;
 if activity_at>effective_receipt_at then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The customer replied after the current booking state was recorded. Review their current request before another follow-up.');
 end if;
 if activity_id::text is distinct from p_pin->>'customer_activity_id' or activity_at is distinct from (p_pin->>'customer_activity_at')::timestamptz then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','New customer activity needs review before follow-up.');
 end if;
 if exists(select 1 from public.business_conversations where partner_id=p_partner and client_id=p_client and contact_id=customer.id and identity_status='owner_verified' and mode='human' and state<>'closed') then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','An owner is handling the customer.');
 end if;
 effective:=public.booking_lifecycle_source_check(case when a.proposed_payload->>'origin'='owner_intake' then (a.proposed_payload->>'intake_work_id')::uuid when a.proposed_payload->>'origin'='owner_conversation' then (a.proposed_payload->>'customer_rebooking_work_id')::uuid else null end,a.id,n.calendar_state_job_id);
 if effective->>'allowed' is distinct from 'true' then
  return jsonb_build_object('state','blocked','approvalId',null,'reason',coalesce(effective->>'reason','The current customer source review changed.')); end if;
 channel:=p_pin->>'channel'; recipient:=p_pin->>'to';
 if nullif(a.proposed_payload->>'conversation_id','') is not null then
  if conversation.id is null or conversation.contact_id<>customer.id or conversation.identity_status<>'owner_verified' or conversation.mode<>'agent' or conversation.opted_out or conversation.state='closed'
   or conversation.id::text is distinct from p_pin->>'conversation_id' or conversation.revision is distinct from (p_pin->>'conversation_revision')::integer
   or conversation.channel is distinct from channel or conversation.external_thread_id is distinct from recipient then
   return jsonb_build_object('state','blocked','approvalId',null,'reason','The originating customer conversation changed.');
  end if;
 elsif (channel='sms' and recipient is distinct from customer.phone) or (channel='email' and recipient is distinct from customer.email) or channel not in ('sms','email') or nullif(recipient,'') is null then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The approved customer destination changed.');
 end if;
 select * into settings from public.agent_team_settings where partner_id=p_partner and client_id=p_client;
 if b.status is distinct from 'active' or settings.authority_revision is distinct from (p_pin->>'authority_revision')::integer or not public.business_channel_can_draft(p_partner,p_client,channel,case when conversation.id is null then null else conversation.connection_id end) then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','Current owner context or channel authority does not permit the follow-up.');
 end if;
 if a.proposed_payload->>'provider' is distinct from p_pin->'booking_source'->>'provider' or j.external_ref is distinct from p_pin->'booking_source'->>'external_ref' then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The booking source identity changed.');
 end if;
 if a.proposed_payload->>'provider'<>'northstar_internal' then
  select * into account from public.integration_connections where id::text=a.proposed_payload->>'calendar_connection_id' and partner_id=p_partner and client_id=p_client;
  select * into source from public.integration_canonical_records where id::text=p_pin->'booking_source'->>'canonical_record_id' and partner_id=p_partner and client_id=p_client and object_type='appointment';
  select p.provider_key into source_provider from public.integration_connections c join public.integration_providers p on p.id=c.provider_id where c.id=source.connection_id and c.partner_id=p_partner and c.client_id=p_client
   and c.provider_id=account.provider_id and (c.id=account.id or (c.external_account_id is not null and c.external_account_id=account.external_account_id));
  if account.id is null or account.status not in ('connected','needs_attention') or account.runtime_mode='paused'
   or account.id::text is distinct from p_pin->'booking_source'->>'connection_id' or account.external_account_id is distinct from p_pin->'booking_source'->>'external_account_id'
   or (source.native_object_id is not null and source.native_object_id is distinct from n.id::text) or source.id is null or source_provider is distinct from a.proposed_payload->>'provider' or source.external_object_id is distinct from j.external_ref
   or source.external_updated_at is distinct from (p_pin->'booking_source'->>'source_updated_at')::timestamptz or source.source_event_at is distinct from (p_pin->'booking_source'->>'source_event_at')::timestamptz
   or exists(select 1 from public.integration_sync_states stream where stream.partner_id=p_partner and stream.client_id=p_client and stream.connection_id=source.connection_id
    and stream.stream_key='appointment' and (nullif(stream.last_error,'') is not null or stream.status in ('failing','paused')
     or nullif(stream.cursor_value->>'pageToken','') is not null or nullif(stream.cursor_value->>'nextLink','') is not null or stream.cursor_value->>'has_more'='true'))
   or (source.external_updated_at is null and source.source_event_at is null)
   or source.canonical_data->>'deleted'='true' or coalesce(source.canonical_data->>'status','') not in ('booked','confirmed')
   or (source.canonical_data->>'start_at')::timestamptz is distinct from n.start_at or (source.canonical_data->>'end_at')::timestamptz is distinct from n.end_at
   or source.snapshot_observed_at is null or source.snapshot_observed_at<effective_receipt_at or source.snapshot_observed_at<now()-interval '45 minutes' or source.snapshot_observed_at>now() then
   return jsonb_build_object('state','waiting','approvalId',null,'reason','A current exact calendar source version is required before follow-up.');
  end if;
 else
  if n.updated_at is distinct from (p_pin->'booking_source'->>'source_updated_at')::timestamptz then
   return jsonb_build_object('state','blocked','approvalId',null,'reason','The native calendar version changed.');
  end if;
 end if;
 version_key:=md5(p_pin::text);
 select id into result_id from public.approval_items where partner_id=p_partner and client_id=p_client and type='customer_message' and proposed_payload->>'booking_followup_key'=version_key;
 if result_id is not null and exists(select 1 from public.approval_items where id=result_id and status in ('rejected','expired','cancelled')) then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','This exact source proposal was already declined or retired. Review the booking before preparing another.');
 end if;
 if result_id is null then
  -- Supersede only messages that have never reached a provider; a second check
  -- above holds their outbox locks through this transaction.
  update public.action_jobs child set status='cancelled',outcome_detail='Superseded by a current source-pinned booking follow-up.'
   from public.approval_items proposal where child.approval_id=proposal.id and child.partner_id=p_partner and child.client_id=p_client
    and proposal.partner_id=p_partner and proposal.client_id=p_client and proposal.type='customer_message'
    and proposal.proposed_payload->>'booking_approval_id'=a.id::text and coalesce(proposal.proposed_payload->>'booking_followup_kind','confirmation')=p_kind
    and child.status in ('pending','failed','dry_run','skipped') and nullif(child.external_ref,'') is null;
  update public.approval_items proposal set status='expired',resolution_note='Superseded by a current source-pinned booking follow-up.',updated_at=now()
   where proposal.partner_id=p_partner and proposal.client_id=p_client and proposal.type='customer_message'
    and proposal.proposed_payload->>'booking_approval_id'=a.id::text and coalesce(proposal.proposed_payload->>'booking_followup_kind','confirmation')=p_kind
    and proposal.status='pending'
    and not exists(select 1 from public.action_jobs child where child.approval_id=proposal.id and child.partner_id=p_partner and child.client_id=p_client
     and (child.status<>'cancelled' or nullif(child.external_ref,'') is not null));
  result_state:='queued';
  body:=case when p_kind='reminder' then 'A reminder: your appointment with ' else 'Your appointment with ' end||coalesce(b.name,'the business')||' is set for '||case when n.calendar_state_job_id is null then coalesce(a.proposed_payload->'slot'->>'label',n.start_at::text) else to_char(n.start_at at time zone coalesce(b.timezone,'UTC'),'YYYY-MM-DD HH24:MI')||' '||coalesce(b.timezone,'UTC') end||'. Reply if you need to change it.';
  insert into public.approval_items(partner_id,client_id,workflow_run_id,type,status,title,summary,risk_level,proposed_payload,editable_content,expires_at)
  values(p_partner,p_client,a.workflow_run_id,'customer_message','pending',case when p_kind='reminder' then 'Review appointment reminder' else 'Review booking confirmation' end,
   'The saved booking and exact customer/source version are rechecked again before sending.','medium',
   p_pin||jsonb_build_object('booking_followup_key',version_key,'draft_source','booking_lifecycle_template','subject','Your appointment with '||coalesce(b.name,'the business'))||
    case when conversation.id is null then '{}'::jsonb else jsonb_build_object('connection_id',conversation.connection_id) end,
   body,n.start_at) returning id into result_id;
  if conversation.id is not null then
   insert into public.business_conversation_messages(partner_id,client_id,conversation_id,external_key,direction,body,status,approval_id)
   values(p_partner,p_client,conversation.id,'approval:'||result_id,'outbound',body,'draft',result_id);
  end if;
 end if;
 if p_kind='reminder' then update public.action_jobs set booking_followup_due_at=null,booking_followup_phase='done',booking_followup_reason=null where id=j.id and booking_followup_phase='reminder'; end if;
 return jsonb_build_object('state',result_state,'approvalId',result_id);
end $$;


-- Recovery is an initializer only: a repeated scan must never renew done or
-- stopped reminders. A proved reschedule explicitly sets its new due marker
-- in the mutation receipt transaction; this helper never guesses a renewal.
create or replace function public.schedule_booking_lifecycle(p_partner uuid,p_client uuid,p_booking_approval uuid,p_action_job uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.approval_items; j public.action_jobs; n public.crm_appointments; b public.client_businesses; effective jsonb; starts timestamptz; receipt_at timestamptz;
begin
 select * into a from public.approval_items where id=p_booking_approval and partner_id=p_partner and client_id=p_client and type='appointment_booking' for update;
 select * into n from public.crm_appointments where approval_id=a.id and partner_id=p_partner and client_id=p_client for update;
 select * into j from public.action_jobs where id=p_action_job and approval_id=a.id and partner_id=p_partner and client_id=p_client and kind='calendar.book' for update;
 if a.id is null or a.status not in ('approved','edited_and_approved') or j.status is distinct from 'succeeded' or nullif(j.external_ref,'') is null then raise exception 'A durable successful booking receipt is required'; end if;
 if j.booking_followup_phase is not null then return jsonb_build_object('state',j.booking_followup_phase); end if;
 effective:=public.booking_effective_calendar_state(p_partner,p_client,a.id,j.id,n.id);
 if effective->>'allowed' is distinct from 'true' then return jsonb_build_object('state','blocked','reason',effective->>'reason'); end if;
 select * into b from public.client_businesses where id=p_client and partner_id=p_partner;
 starts:=(effective->>'startAt')::timestamptz; receipt_at:=(effective->>'receiptAt')::timestamptz;
 if b.status is distinct from 'active' or n.status<>'booked' or b.native_lifecycle_enabled_at is null or receipt_at is null or receipt_at<b.native_lifecycle_enabled_at or starts<=now() or starts is null then
  update public.action_jobs set booking_followup_phase='done',booking_followup_reason='Reminders were not enabled for this receipt-backed appointment state.' where id=j.id and booking_followup_phase is null;
  return jsonb_build_object('state','done');
 end if;
 update public.action_jobs set booking_followup_phase='reminder',booking_followup_due_at=greatest(now(),starts-interval '24 hours'),booking_followup_attempts=0,booking_followup_reason=null where id=j.id and booking_followup_phase is null;
 return jsonb_build_object('state','reminder','nextDueAt',greatest(now(),starts-interval '24 hours'));
end $$;

-- An owner-review state alone does not prove an external event was cancelled.
-- This read-only guard accepts an exact verified cancellation mutation receipt
-- or consistent fresh cancellation evidence for the original account/event.
create function public.booking_terminal_rebooking_proof(p_partner uuid,p_client uuid,p_booking_approval uuid,p_appointment uuid)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare a public.approval_items; j public.action_jobs; n public.crm_appointments; state_job public.action_jobs; change public.approval_items; account public.integration_connections;
 mutation jsonb; proof jsonb; effective jsonb; receipt_at timestamptz; source_count integer; all_cancelled boolean; post_receipt boolean; fresh boolean; native_link boolean; consistent_link boolean;
begin
 select * into a from public.approval_items where id=p_booking_approval and partner_id=p_partner and client_id=p_client and type='appointment_booking' and status in ('approved','edited_and_approved');
 select * into j from public.action_jobs where approval_id=a.id and partner_id=p_partner and client_id=p_client and kind='calendar.book' and status='succeeded' and nullif(external_ref,'') is not null;
 select * into n from public.crm_appointments where id=p_appointment and approval_id=a.id and partner_id=p_partner and client_id=p_client;
 if a.id is null or j.id is null or j.receipt_recorded_at is null or n.id is null or n.external_ref is distinct from j.external_ref then return false; end if;
 if n.status='completed' then return n.lifecycle_completed_at is not null and n.lifecycle_completed_at<=now() and n.end_at<=now(); end if;
 if n.status<>'cancelled' then return false; end if;
 if a.proposed_payload->>'provider'='northstar_internal' then return true; end if;
 select c.* into account from public.integration_connections c join public.integration_providers provider on provider.id=c.provider_id where c.id::text=a.proposed_payload->>'calendar_connection_id' and c.partner_id=p_partner and c.client_id=p_client and provider.provider_key=a.proposed_payload->>'provider';
 if account.id is null or account.external_account_id is null then return false; end if;
 if n.calendar_state_job_id is not null then
  select * into state_job from public.action_jobs where id=n.calendar_state_job_id and partner_id=p_partner and client_id=p_client and kind='calendar.cancel' and status='succeeded';
  select * into change from public.approval_items where id=state_job.approval_id and partner_id=p_partner and client_id=p_client and type='appointment_change' and status in ('approved','edited_and_approved');
  mutation:=change.proposed_payload; proof:=state_job.provider_receipt;
  if state_job.id is not null and change.id is not null and state_job.external_ref=j.external_ref and jsonb_typeof(mutation)='object' and jsonb_typeof(proof)='object' and
   proof ?& array['provider','operation','event_id','http_status','request_id','event_etag','event_updated_at','verified_at','verified_absent','old_slot','new_slot'] and
   jsonb_typeof(proof->'request_id') in ('string','null') and coalesce(length(proof->>'request_id'),0)<=1000 and jsonb_typeof(proof->'event_etag') in ('string','null') and coalesce(length(proof->>'event_etag'),0)<=1100 and jsonb_typeof(proof->'event_updated_at') in ('string','null') and
   coalesce(proof->>'verified_at','') ~ '(Z|[+-][0-9]{2}:[0-9]{2})$' and
   mutation->'calendar_mutation_version'='1'::jsonb and mutation->>'mutation'='cancel' and mutation->>'booking_approval_id'=a.id::text and mutation->>'booking_action_job_id'=j.id::text and mutation->>'appointment_id'=n.id::text and mutation->>'contact_id'=n.contact_id::text and
   mutation->>'provider'=a.proposed_payload->>'provider' and mutation->>'provider' in ('google_calendar','google_workspace') and mutation->>'calendar_connection_id'=account.id::text and mutation->>'calendar_account_id'=account.external_account_id and mutation->>'external_ref'=j.external_ref and
   nullif(mutation->>'calendar_id','') is not null and nullif(mutation->>'source_record_id','') is not null and nullif(mutation->>'source_etag','') is not null and mutation->>'new_slot' is null and
   proof->>'provider'=mutation->>'provider' and proof->>'operation'='cancel' and proof->>'event_id'=j.external_ref and proof->'http_status'='204'::jsonb and proof->>'new_slot' is null and jsonb_typeof(proof->'verified_absent')='boolean' and
   (proof->>'verified_at')::timestamptz between j.receipt_recorded_at and now() and
   (proof->'old_slot'->>'start_iso')::timestamptz=(mutation->'old_slot'->>'start_iso')::timestamptz and (proof->'old_slot'->>'end_iso')::timestamptz=(mutation->'old_slot'->>'end_iso')::timestamptz and
   (mutation->'old_slot'->>'start_iso')::timestamptz=n.start_at and (mutation->'old_slot'->>'end_iso')::timestamptz=n.end_at and
   (proof->'verified_absent'='true'::jsonb or (coalesce(proof->>'event_etag','') ~ '^"[!#-~]+"$' and nullif(proof->>'event_updated_at','') is not null)) then
   if nullif(proof->>'event_updated_at','') is not null then perform (proof->>'event_updated_at')::timestamptz; end if;
   if proof->'verified_absent'='true'::jsonb then return true; end if;
   receipt_at:=(proof->>'verified_at')::timestamptz;
  end if;
 end if;
 -- A previous verified reschedule moves the minimum source observation clock.
 -- An unknown state pointer never falls back to the original receipt.
 if receipt_at is null then
  effective:=public.booking_effective_calendar_state(p_partner,p_client,a.id,j.id,n.id);
  if effective->>'allowed' is distinct from 'true' then return false; end if;
  receipt_at:=(effective->>'receiptAt')::timestamptz;
 end if;
 if account.status not in ('connected','needs_attention') or account.runtime_mode='paused' then return false; end if;
 select count(*),bool_and(coalesce(r.canonical_data->>'deleted'='true',false) or coalesce(r.canonical_data->>'status','') in ('cancelled','canceled')),
  bool_and(coalesce(r.snapshot_observed_at>=receipt_at and r.snapshot_observed_at<=now(),false)),bool_or(r.snapshot_observed_at>=now()-interval '45 minutes' and r.snapshot_observed_at<=now()),
  bool_or(r.native_object_id=n.id::text),bool_and(r.native_object_id is null or r.native_object_id=n.id::text)
 into source_count,all_cancelled,post_receipt,fresh,native_link,consistent_link
 from public.integration_canonical_records r join public.integration_connections peer on peer.id=r.connection_id and peer.partner_id=r.partner_id and peer.client_id=r.client_id
 where r.partner_id=p_partner and r.client_id=p_client and r.object_type='appointment' and r.external_object_id=j.external_ref and peer.provider_id=account.provider_id and
  (peer.id=account.id or peer.external_account_id=account.external_account_id) and peer.status in ('connected','needs_attention') and peer.runtime_mode<>'paused';
 if source_count=0 or all_cancelled is distinct from true or post_receipt is distinct from true or fresh is distinct from true or native_link is distinct from true or consistent_link is distinct from true then return false; end if;
 if exists(select 1 from public.integration_sync_states stream join public.integration_connections peer on peer.id=stream.connection_id and peer.partner_id=stream.partner_id and peer.client_id=stream.client_id where stream.partner_id=p_partner and stream.client_id=p_client and stream.stream_key='appointment' and peer.provider_id=account.provider_id and (peer.id=account.id or peer.external_account_id=account.external_account_id) and
  (nullif(stream.last_error,'') is not null or stream.status in ('failing','paused') or nullif(stream.cursor_value->>'pageToken','') is not null or nullif(stream.cursor_value->>'nextLink','') is not null or stream.cursor_value->>'has_more'='true')) then return false; end if;
 return true;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return false;
end $$;

-- Rebooking source/final guards enforce terminal source proof too.
create or replace function public.customer_rebooking_source_check(p_work uuid,p_allow_completed boolean default false,p_check_authority boolean default true)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.agent_work_items; cv public.business_conversations; l public.crm_leads; person public.crm_contacts;
 original public.approval_items; n public.crm_appointments; s public.agent_team_settings; account public.integration_connections;
 activity_id uuid; activity_at timestamptz; task_id uuid;
begin
 select * into w from public.agent_work_items where id=p_work;
 if w.id is null or w.kind<>'booking_request' or w.input->>'origin'<>'owner_conversation' or w.conversation_id is null or w.input->>'conversation_id' is distinct from w.conversation_id::text then
  return jsonb_build_object('allowed',false,'reason','The reviewed conversation assignment is unavailable.'); end if;
 select * into cv from public.business_conversations where id=w.conversation_id and partner_id=w.partner_id and client_id=w.client_id;
 select * into l from public.crm_leads where id=w.source_lead_id and partner_id=w.partner_id and client_id=w.client_id;
 select * into person from public.crm_contacts where id=l.contact_id and partner_id=w.partner_id and client_id=w.client_id;
 if cv.id is null or l.id is null or person.id is null or cv.contact_id is distinct from person.id or (cv.lead_id is not null and cv.lead_id<>l.id) or cv.identity_status<>'owner_verified' or cv.mode<>'agent' or cv.opted_out or cv.state='closed' then
  return jsonb_build_object('allowed',false,'reason','Resume and review the exact verified customer thread before scheduling.'); end if;
 if cv.revision is distinct from (w.input->>'conversation_revision')::integer or l.updated_at is distinct from (w.input->>'lead_updated_at')::timestamptz or person.updated_at is distinct from (w.input->>'contact_updated_at')::timestamptz or cv.connection_id::text is distinct from w.input->>'source_connection_id' then
  return jsonb_build_object('allowed',false,'reason','The customer or source thread changed. Review current instructions.'); end if;
 if cv.connection_id is not null then
  select * into account from public.integration_connections where id=cv.connection_id and partner_id=w.partner_id and client_id=w.client_id;
  if account.id is null or account.status<>'connected' or account.runtime_mode='paused' then return jsonb_build_object('allowed',false,'reason','The original customer source is paused or disconnected.'); end if;
 end if;
 if l.status in ('won','lost') or exists(select 1 from unnest(person.tags) t where lower(regexp_replace(btrim(t),'[[:space:]-]+','_','g')) in ('do_not_contact','opt_out','opted_out','unsubscribed','stop')) then
  return jsonb_build_object('allowed',false,'reason','The customer is suppressed or the lead is closed.'); end if;
 if exists(select 1 from public.business_conversations linked where linked.partner_id=w.partner_id and linked.client_id=w.client_id and linked.contact_id=person.id and linked.identity_status='owner_verified' and (linked.opted_out or (linked.mode='human' and linked.state<>'closed'))) then
  return jsonb_build_object('allowed',false,'reason','A verified customer thread is opted out or under human handling.'); end if;
 select activity.id,activity.created_at into activity_id,activity_at from (
  select comm.id,comm.created_at from public.crm_communications comm where comm.partner_id=w.partner_id and comm.client_id=w.client_id and comm.contact_id=person.id and comm.direction='inbound' and comm.status='received'
  union all select msg.id,msg.created_at from public.business_conversation_messages msg join public.business_conversations linked on linked.id=msg.conversation_id and linked.partner_id=msg.partner_id and linked.client_id=msg.client_id where linked.partner_id=w.partner_id and linked.client_id=w.client_id and linked.contact_id=person.id and linked.identity_status='owner_verified' and msg.direction='inbound' and msg.status='received'
 ) activity order by activity.created_at desc,activity.id desc limit 1;
 if activity_id::text is distinct from w.input->>'activity_id' or activity_at is distinct from (w.input->>'activity_at')::timestamptz then
  return jsonb_build_object('allowed',false,'reason','The customer replied or source activity changed. Review the current response.'); end if;
 select * into original from public.approval_items where id=(w.input->>'rebooking_origin_approval_id')::uuid and partner_id=w.partner_id and client_id=w.client_id and type='appointment_booking';
 select * into n from public.crm_appointments where approval_id=original.id and partner_id=w.partner_id and client_id=w.client_id and contact_id=person.id and (lead_id is null or lead_id=l.id);
 if original.id is null or original.proposed_payload->>'conversation_id' is distinct from w.conversation_id::text or n.id is null or n.status not in ('completed','cancelled') or (n.status='completed' and (n.lifecycle_completed_at is null or n.lifecycle_completed_at>now() or n.end_at>now())) or not exists(select 1 from public.action_jobs j where j.approval_id=original.id and j.partner_id=w.partner_id and j.client_id=w.client_id and j.kind='calendar.book' and j.status='succeeded' and nullif(j.external_ref,'') is not null) then
  return jsonb_build_object('allowed',false,'reason','The prior booking needs a recorded terminal outcome before rebooking.'); end if;
 if not public.booking_terminal_rebooking_proof(w.partner_id,w.client_id,original.id,n.id) then
  return jsonb_build_object('allowed',false,'reason','The external cancellation or recorded service completion has no current exact proof.'); end if;
 if not p_allow_completed and exists(select 1 from public.crm_appointments ap where ap.partner_id=w.partner_id and ap.client_id=w.client_id and ap.id<>n.id and ap.contact_id=person.id and ap.status in ('booked','proposed','confirmed')) then
  return jsonb_build_object('allowed',false,'reason','Another active appointment needs review before rebooking.'); end if;
 if w.input->>'identity_confirmed' is distinct from 'true' or w.input->>'booking_requested' is distinct from 'true' or w.input->>'instructions_reviewed' is distinct from 'true' or nullif(btrim(w.input->>'service'),'') is null then
  return jsonb_build_object('allowed',false,'reason','Fresh identity, appointment request and instructions review are required.'); end if;
 select * into s from public.agent_team_settings where partner_id=w.partner_id and client_id=w.client_id;
 if p_check_authority and (s.authority_revision is distinct from (w.input->>'authority_revision')::integer or not public.business_channel_can_draft(w.partner_id,w.client_id,'calendar',null) or not exists(select 1 from public.business_agent_activation a where a.partner_id=w.partner_id and a.client_id=w.client_id and a.status='active' and a.bookings)) then
  return jsonb_build_object('allowed',false,'reason','Scheduling authority or current reviewed business context changed.'); end if;
 task_id:=(w.input->>'task_id')::uuid;
 if task_id is null or not exists(select 1 from public.crm_tasks t where t.id=task_id and t.partner_id=w.partner_id and t.client_id=w.client_id and t.lead_id=l.id and t.contact_id=person.id and t.booking_approval_id=original.id) then
  return jsonb_build_object('allowed',false,'reason','The shared rebooking review task is unavailable.'); end if;
 return jsonb_build_object('allowed',true,'reason','Fresh owner review and the current verified thread permit scheduling.','contact',jsonb_build_object('id',person.id,'name',btrim(coalesce(person.first_name,'')||' '||coalesce(person.last_name,'')),'email',person.email,'phone',person.phone),'leadId',l.id,'taskId',task_id);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
 return jsonb_build_object('allowed',false,'reason','Customer scheduling version pins are invalid.');
end $$;


create or replace function public.review_customer_rebooking(p_partner uuid,p_client uuid,p_actor uuid,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior public.business_owner_commands; a public.approval_items; n public.crm_appointments; original_work public.agent_work_items;
 w public.agent_work_items; l public.crm_leads; person public.crm_contacts; cv public.business_conversations; c public.integration_connections;
 r public.integration_canonical_records; link public.integration_object_links; s public.agent_team_settings;
 request_id uuid; receipt_id uuid:=gen_random_uuid(); work_id uuid; review_task uuid; activity_id uuid; activity_at timestamptz;
 q jsonb; pins jsonb; outcome jsonb; origin text; provider text; state text; message text; missing jsonb:='[]'::jsonb; qualified_at timestamptz;
begin
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner for update;
 if not found or p_actor is null or jsonb_typeof(p_command) is distinct from 'object' then raise exception 'Business unavailable' using errcode='22023'; end if;
 request_id:=(p_command->>'key')::uuid;
 if request_id is null then raise exception 'Missing request key' using errcode='22023'; end if;
 select commands.* into prior from public.business_owner_commands commands where commands.partner_id=p_partner and commands.client_id=p_client and commands.request_key=request_id;
 if prior.id is not null then
  if prior.actor_id is distinct from p_actor or prior.command is distinct from p_command then raise exception 'Request key changed' using errcode='40001'; end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 if p_command->>'action' is distinct from 'qualify_rebooking' or p_command-array['action','key','bookingApprovalId','expectedAppointmentUpdatedAt','expectedLeadUpdatedAt','expectedContactUpdatedAt','sourceRecordId','sourceConnectionId','externalId','expectedSourceUpdatedAt','conversationId','expectedConversationRevision','expectedActivityId','expectedActivityAt','expectedAuthorityRevision','qualification','owner_request']<>'{}'::jsonb then raise exception 'Invalid review command' using errcode='22023'; end if;
 q:=p_command->'qualification';
 if jsonb_typeof(q) is distinct from 'object' or q-array['service','preference','identityConfirmed','bookingRequested','instructionsReviewed']<>'{}'::jsonb or jsonb_typeof(q->'service') is distinct from 'string' or length(btrim(q->>'service')) not between 1 and 200 or jsonb_typeof(q->'preference') is distinct from 'string' or length(q->>'preference')>500 or q->'identityConfirmed' is distinct from 'true'::jsonb or q->'bookingRequested' is distinct from 'true'::jsonb or q->'instructionsReviewed' is distinct from 'true'::jsonb then raise exception 'Fresh explicit qualification is required' using errcode='22023'; end if;
 select * into a from public.approval_items where id=(p_command->>'bookingApprovalId')::uuid and partner_id=p_partner and client_id=p_client and type='appointment_booking' for update;
 select * into n from public.crm_appointments where approval_id=a.id and partner_id=p_partner and client_id=p_client for update;
 if a.id is null or n.id is null or n.updated_at is distinct from (p_command->>'expectedAppointmentUpdatedAt')::timestamptz or not exists(select 1 from public.action_jobs j where j.approval_id=a.id and j.partner_id=p_partner and j.client_id=p_client and j.kind='calendar.book' and j.status='succeeded' and nullif(j.external_ref,'') is not null) then
  raise exception 'Review the recorded terminal booking and receipt' using errcode='40001'; end if;
 -- Compare the owner's viewed native version BEFORE recording a source
 -- cancellation reconciliation. This performs no source-calendar mutation.
 if n.status='booked' and a.proposed_payload->>'provider'<>'northstar_internal' and public.reconcile_source_booking_cancellation(p_partner,p_client,a.id,p_actor) then
  select * into n from public.crm_appointments where id=n.id and approval_id=a.id and partner_id=p_partner and client_id=p_client;
 end if;
 if not public.booking_terminal_rebooking_proof(p_partner,p_client,a.id,n.id) then raise exception 'A recorded completed service or exactly proved external cancellation is required before rebooking' using errcode='40001'; end if;
 if a.proposed_payload->>'origin'='owner_intake' then
  origin:='owner_intake';
  select * into original_work from public.agent_work_items where id=(a.proposed_payload->>'intake_work_id')::uuid and partner_id=p_partner and client_id=p_client and kind='booking_request' and approval_id=a.id;
  -- Lock the source account before canonical evidence, as in the import writer.
  select * into c from public.integration_connections where id=(original_work.input->>'intake_connection_id')::uuid and partner_id=p_partner and client_id=p_client for update;
  select provider_key into provider from public.integration_providers where id=c.provider_id;
  select * into r from public.integration_canonical_records where id=(original_work.input->>'intake_record_id')::uuid and connection_id=c.id and partner_id=p_partner and client_id=p_client and object_type='lead' and external_object_id=original_work.input->>'intake_external_id' for update;
  if original_work.id is null or original_work.input->>'origin' is distinct from 'owner_intake' or c.id is null or provider is distinct from 'generic_inbound_webhook' or c.status<>'connected' or c.runtime_mode='paused' or c.config->>'workspace_view_only' is distinct from 'true' or r.id is null or r.id::text is distinct from p_command->>'sourceRecordId' or c.id::text is distinct from p_command->>'sourceConnectionId' or r.external_object_id is distinct from p_command->>'externalId' or r.updated_at is distinct from (p_command->>'expectedSourceUpdatedAt')::timestamptz or p_command->>'conversationId' is not null or p_command->>'expectedConversationRevision' is not null then
   raise exception 'The original adopted source identity changed or is unavailable' using errcode='40001'; end if;
  if jsonb_typeof(r.canonical_data) is distinct from 'object' or (r.canonical_data ? 'provider' and r.canonical_data->>'provider' is distinct from 'generic_inbound_webhook') or r.canonical_data->>'deleted'='true' or coalesce(r.canonical_data->>'status','') not in ('new','updated') or exists(select 1 from public.integration_sync_states sync where sync.connection_id=c.id and sync.partner_id=p_partner and sync.client_id=p_client and sync.stream_key='lead' and (sync.status='failing' or nullif(sync.last_error,'') is not null)) then raise exception 'Reconcile the current source inquiry before rebooking' using errcode='40001'; end if;
  select * into l from public.crm_leads where id=original_work.source_lead_id and partner_id=p_partner and client_id=p_client for update;
  select * into person from public.crm_contacts where id=l.contact_id and partner_id=p_partner and client_id=p_client for update;
  select * into link from public.integration_object_links where connection_id=c.id and partner_id=p_partner and client_id=p_client and object_type='lead' and external_object_id=r.external_object_id for update;
  if link.id is null or r.native_object_id is distinct from l.id::text or link.native_object_id is distinct from l.id::text or link.metadata->>'source_record_id' is distinct from r.id::text or link.metadata->>'contact_id' is distinct from person.id::text then raise exception 'The adopted source and exact customer link changed' using errcode='40001'; end if;
  review_task:=(link.metadata->>'task_id')::uuid;
  pins:=jsonb_build_object('origin',origin,'intake_record_id',r.id,'intake_connection_id',c.id,'intake_external_id',r.external_object_id,'source_updated_at',r.updated_at);
 else
  origin:='owner_conversation';
  select * into original_work from public.agent_work_items where id=(a.proposed_payload->>'customer_rebooking_work_id')::uuid and partner_id=p_partner and client_id=p_client and approval_id=a.id and kind='booking_request';
  select * into cv from public.business_conversations where id=coalesce((a.proposed_payload->>'conversation_id')::uuid,original_work.conversation_id) and partner_id=p_partner and client_id=p_client for update;
  select * into l from public.crm_leads where id=coalesce(n.lead_id,(a.proposed_payload->>'lead_id')::uuid,original_work.source_lead_id,cv.lead_id) and partner_id=p_partner and client_id=p_client for update;
  select * into person from public.crm_contacts where id=l.contact_id and partner_id=p_partner and client_id=p_client for update;
  if cv.id is null or cv.id::text is distinct from p_command->>'conversationId' or cv.revision is distinct from (p_command->>'expectedConversationRevision')::integer or cv.contact_id is distinct from person.id or (cv.lead_id is not null and cv.lead_id<>l.id) or cv.identity_status<>'owner_verified' or cv.mode<>'agent' or cv.opted_out or cv.state='closed' or p_command->>'sourceRecordId' is not null or p_command->>'sourceConnectionId' is not null or p_command->>'externalId' is not null or p_command->>'expectedSourceUpdatedAt' is not null then
   raise exception 'Resume and review the exact verified customer thread' using errcode='40001'; end if;
  if cv.connection_id is not null and not exists(select 1 from public.integration_connections account where account.id=cv.connection_id and account.partner_id=p_partner and account.client_id=p_client and account.status='connected' and account.runtime_mode<>'paused') then raise exception 'Restore the original customer source first' using errcode='40001'; end if;
  pins:=jsonb_build_object('origin',origin,'conversation_id',cv.id,'conversation_revision',cv.revision,'source_connection_id',cv.connection_id);
 end if;
 if l.id is null or person.id is null or person.id is distinct from n.contact_id or (n.lead_id is not null and n.lead_id<>l.id) or (a.proposed_payload->>'contact_id' is not null and a.proposed_payload->>'contact_id'<>person.id::text) or (a.proposed_payload->>'lead_id' is not null and a.proposed_payload->>'lead_id'<>l.id::text) or l.updated_at is distinct from (p_command->>'expectedLeadUpdatedAt')::timestamptz or person.updated_at is distinct from (p_command->>'expectedContactUpdatedAt')::timestamptz or l.status in ('won','lost') then raise exception 'The current exact lead or customer changed' using errcode='40001'; end if;
 if exists(select 1 from unnest(person.tags) t where lower(regexp_replace(btrim(t),'[[:space:]-]+','_','g')) in ('do_not_contact','opt_out','opted_out','unsubscribed','stop')) or exists(select 1 from public.business_conversations linked where linked.partner_id=p_partner and linked.client_id=p_client and linked.contact_id=person.id and linked.identity_status='owner_verified' and (linked.opted_out or (linked.mode='human' and linked.state<>'closed'))) then raise exception 'Customer suppression or human handling needs review' using errcode='40001'; end if;
 select activity.id,activity.created_at into activity_id,activity_at from (
  select comm.id,comm.created_at from public.crm_communications comm where comm.partner_id=p_partner and comm.client_id=p_client and comm.contact_id=person.id and comm.direction='inbound' and comm.status='received'
  union all select msg.id,msg.created_at from public.business_conversation_messages msg join public.business_conversations linked on linked.id=msg.conversation_id and linked.partner_id=msg.partner_id and linked.client_id=msg.client_id where linked.partner_id=p_partner and linked.client_id=p_client and linked.contact_id=person.id and linked.identity_status='owner_verified' and msg.direction='inbound' and msg.status='received'
 ) activity order by activity.created_at desc,activity.id desc limit 1;
 if activity_id::text is distinct from p_command->>'expectedActivityId' or activity_at is distinct from (p_command->>'expectedActivityAt')::timestamptz then raise exception 'The customer activity changed during review' using errcode='40001'; end if;
 if exists(select 1 from public.crm_appointments other where other.partner_id=p_partner and other.client_id=p_client and other.contact_id=person.id and other.id<>n.id and other.status in ('booked','proposed','confirmed')) then raise exception 'Another active booking needs review' using errcode='40001'; end if;
 select * into s from public.agent_team_settings where partner_id=p_partner and client_id=p_client for update;
 if coalesce(s.authority_revision,0) is distinct from (p_command->>'expectedAuthorityRevision')::integer then raise exception 'Authority changed during review' using errcode='40001'; end if;
 -- Retire only unsent attempts for this exact prior booking. Original success
 -- and every accepted/uncertain provider action retain their history.
 for w in select * from public.agent_work_items work where work.partner_id=p_partner and work.client_id=p_client and work.kind='booking_request' and work.input->>'rebooking_origin_approval_id'=a.id::text order by work.created_at for update loop
  if w.status='completed' or exists(select 1 from public.action_jobs j where j.approval_id=w.approval_id and j.partner_id=p_partner and j.client_id=p_client and (j.status in ('processing','provider_pending','uncertain','succeeded') or nullif(j.external_ref,'') is not null)) then raise exception 'Existing rebooking action must be reconciled before replacement' using errcode='40001'; end if;
  update public.action_jobs j set status='cancelled',outcome_detail='Superseded by a fresh explicit owner instruction review.',last_error=null where j.approval_id=w.approval_id and j.partner_id=p_partner and j.client_id=p_client and (j.status in ('pending','dry_run','skipped') or (j.status='failed' and j.external_ref is null));
  if exists(select 1 from public.action_jobs j where j.approval_id=w.approval_id and j.partner_id=p_partner and j.client_id=p_client and j.status<>'cancelled') then raise exception 'The previous action cannot be safely replaced' using errcode='40001'; end if;
  update public.approval_items set status='expired',resolved_at=now() where id=w.approval_id and partner_id=p_partner and client_id=p_client and status='pending';
  update public.agent_work_items set status='cancelled',claim_token=null,lease_until=null,summary='Superseded by fresh owner review; no accepted provider effect was undone.',revision=revision+1,updated_at=now() where id=w.id and status<>'cancelled';
 end loop;
 if origin='owner_intake' then
  perform 1 from public.crm_tasks where id=review_task and partner_id=p_partner and client_id=p_client and lead_id=l.id and contact_id=person.id for update;
  if not found then raise exception 'Shared inquiry review task unavailable' using errcode='40001'; end if;
 else
  insert into public.crm_tasks(partner_id,client_id,contact_id,lead_id,booking_approval_id,title,description,status,priority,task_type,created_by)
  values(p_partner,p_client,person.id,l.id,a.id,'Review fresh appointment options','Explicit owner review of current customer instructions. Nothing was sent or booked.','open','medium','booking_rebooking_review',p_actor) returning id into review_task;
 end if;
 if public.business_channel_can_draft(p_partner,p_client,'calendar',null) and exists(select 1 from public.business_agent_activation activation where activation.partner_id=p_partner and activation.client_id=p_client and activation.status='active' and activation.bookings) then
  state:='queued'; message:='Scheduling queued to check fresh available times. No appointment is held, booked or messaged.';
 else state:='needs_setup'; missing:=jsonb_build_array('calendar_authority'); message:='Current qualification saved. Review business context, activate scheduling and authorize a calendar before checking times.'; end if;
 update public.crm_leads set service_type=btrim(q->>'service'),next_action=message where id=l.id and partner_id=p_partner and client_id=p_client returning * into l;
 update public.crm_tasks set title='Review fresh appointment options',description='Owner reviewed the current exact customer source.'||E'\nQualification: '||q::text||E'\nNext step: '||message,status='open',completed_at=null where id=review_task and partner_id=p_partner and client_id=p_client;
 qualified_at:=clock_timestamp();
 insert into public.agent_work_items(partner_id,client_id,parent_id,kind,agent_key,title,status,summary,dedupe_key,conversation_id,source_lead_id,input,result,next_run_at)
 values(p_partner,p_client,original_work.id,'booking_request','scheduling',left('Check fresh times: '||btrim(q->>'service'),180),case when state='queued' then 'queued' else 'blocked' end,message,'rebooking-review:'||a.id::text||':'||request_id::text,case when origin='owner_conversation' then cv.id else null end,l.id,
  pins||jsonb_build_object('rebooking_origin_approval_id',a.id,'lead_updated_at',l.updated_at,'contact_updated_at',person.updated_at,'activity_id',activity_id,'activity_at',activity_at,'authority_revision',coalesce(s.authority_revision,0),'identity_confirmed',true,'booking_requested',true,'instructions_reviewed',true,'service',btrim(q->>'service'),'preference',btrim(q->>'preference'),'task_id',review_task,'qualified_at',qualified_at),
  jsonb_build_object('phase',case when state='queued' then 'checking_availability' else 'needs_setup' end,'missing',missing,'qualification',q),now()) returning id into work_id;
 outcome:=jsonb_build_object('id',receipt_id,'bookingApprovalId',a.id,'leadId',l.id,'taskId',review_task,'workId',work_id,'state',state,'missing',missing,'message',message,'replayed',false);
 insert into public.business_owner_commands(id,partner_id,client_id,actor_id,request_key,command,result) values(receipt_id,p_partner,p_client,p_actor,request_id,p_command,outcome);
 insert into public.agent_work_events(partner_id,client_id,work_id,status,summary) values(p_partner,p_client,work_id,case when state='queued' then 'queued' else 'blocked' end,message);
 return outcome;
end $$;


create or replace function public.intake_inquiry_source_check(p_work uuid,p_allow_scheduled boolean default false,p_check_authority boolean default true)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.agent_work_items; r public.integration_canonical_records; c public.integration_connections;
 l public.crm_leads; person public.crm_contacts; link public.integration_object_links; s public.agent_team_settings;
 provider text; task_id uuid; rebooking boolean:=false; activity_id uuid; activity_at timestamptz;
begin
 select * into w from public.agent_work_items where id=p_work;
 if w.id is null or w.kind<>'booking_request' or w.conversation_id is not null or w.input->>'origin'<>'owner_intake' then
  return jsonb_build_object('allowed',false,'reason','Inquiry scheduling assignment unavailable.'); end if;
 select * into c from public.integration_connections where id=(w.input->>'intake_connection_id')::uuid and partner_id=w.partner_id and client_id=w.client_id;
 select provider_key into provider from public.integration_providers where id=c.provider_id;
 if c.id is null or provider<>'generic_inbound_webhook' or c.status<>'connected' or c.runtime_mode='paused' or c.config->>'workspace_view_only' is distinct from 'true' then
  return jsonb_build_object('allowed',false,'reason','The inquiry source is paused, disconnected or unavailable.'); end if;
 if exists(select 1 from public.integration_sync_states where connection_id=c.id and partner_id=w.partner_id and client_id=w.client_id and stream_key='lead' and (status='failing' or nullif(last_error,'') is not null)) then
  return jsonb_build_object('allowed',false,'reason','The inquiry source needs reconciliation.'); end if;
 select * into r from public.integration_canonical_records where id=(w.input->>'intake_record_id')::uuid and connection_id=c.id and partner_id=w.partner_id and client_id=w.client_id and object_type='lead' and external_object_id=w.input->>'intake_external_id';
 select * into l from public.crm_leads where id=w.source_lead_id and partner_id=w.partner_id and client_id=w.client_id;
 select * into person from public.crm_contacts where id=l.contact_id and partner_id=w.partner_id and client_id=w.client_id;
 select * into link from public.integration_object_links where connection_id=c.id and partner_id=w.partner_id and client_id=w.client_id and object_type='lead' and external_object_id=r.external_object_id;
 if r.id is null or l.id is null or person.id is null or link.id is null or r.native_object_id is distinct from l.id::text or link.native_object_id is distinct from l.id::text or link.metadata->>'source_record_id' is distinct from r.id::text or link.metadata->>'contact_id' is distinct from person.id::text then
  return jsonb_build_object('allowed',false,'reason','The adopted source and customer no longer share the same recorded identity.'); end if;
 if jsonb_typeof(r.canonical_data) is distinct from 'object' or (r.canonical_data ? 'provider' and r.canonical_data->>'provider' is distinct from 'generic_inbound_webhook') or r.canonical_data->>'deleted'='true' or coalesce(r.canonical_data->>'status','') not in ('new','updated') then
  return jsonb_build_object('allowed',false,'reason','The source inquiry is deleted or no longer eligible.'); end if;
 if r.updated_at is distinct from (w.input->>'source_updated_at')::timestamptz or l.updated_at is distinct from (w.input->>'lead_updated_at')::timestamptz or person.updated_at is distinct from (w.input->>'contact_updated_at')::timestamptz then
  return jsonb_build_object('allowed',false,'reason','The inquiry or customer changed. Review current records before continuing.'); end if;
 if w.input ? 'rebooking_origin_approval_id' then
  select exists(select 1 from public.crm_appointments ap where ap.approval_id=(w.input->>'rebooking_origin_approval_id')::uuid and ap.partner_id=w.partner_id and ap.client_id=w.client_id and ap.contact_id=person.id and (ap.lead_id is null or ap.lead_id=l.id)
   and (ap.status='cancelled' or (ap.status='completed' and to_jsonb(ap)->>'lifecycle_completed_at' is not null)) and public.booking_terminal_rebooking_proof(w.partner_id,w.client_id,ap.approval_id,ap.id)) into rebooking;
  if not rebooking or (p_check_authority and exists(select 1 from public.crm_appointments ap where ap.partner_id=w.partner_id and ap.client_id=w.client_id and ap.status in ('booked','proposed','confirmed') and (ap.lead_id=l.id or (ap.lead_id is null and ap.contact_id=person.id)))) then
   return jsonb_build_object('allowed',false,'reason','The previous booking is not terminal or another appointment already needs review.'); end if;
 end if;
 if l.status in ('won','lost') or (l.status='scheduled' and not (p_allow_scheduled or rebooking)) then
  return jsonb_build_object('allowed',false,'reason','The lead is already scheduled or closed.'); end if;
 if exists(select 1 from unnest(person.tags) t where lower(regexp_replace(btrim(t),'[[:space:]-]+','_','g')) in ('do_not_contact','opt_out','opted_out','unsubscribed','stop')) then
  return jsonb_build_object('allowed',false,'reason','The customer is suppressed. Review their instructions.'); end if;
 -- Only exact owner-verified contact links establish cross-channel identity.
 if exists(select 1 from public.business_conversations cv where cv.partner_id=w.partner_id and cv.client_id=w.client_id and cv.contact_id=person.id and cv.identity_status='owner_verified' and (cv.opted_out or (cv.mode='human' and cv.state<>'closed'))) then
  return jsonb_build_object('allowed',false,'reason','A linked customer conversation is opted out or under human handling.'); end if;
 if exists(select 1 from public.business_conversation_messages msg join public.business_conversations cv on cv.id=msg.conversation_id and cv.partner_id=msg.partner_id and cv.client_id=msg.client_id
  where cv.partner_id=w.partner_id and cv.client_id=w.client_id and cv.contact_id=person.id and cv.identity_status='owner_verified' and msg.direction='inbound' and msg.status='received' and msg.created_at>coalesce((w.input->>'qualified_at')::timestamptz,w.created_at)) then
  return jsonb_build_object('allowed',false,'reason','The customer replied after qualification. Review that response before continuing.'); end if;
 if w.input->>'instructions_reviewed'='true' then
  select activity.id,activity.created_at into activity_id,activity_at from (
   select comm.id,comm.created_at from public.crm_communications comm where comm.partner_id=w.partner_id and comm.client_id=w.client_id and comm.contact_id=person.id and comm.direction='inbound' and comm.status='received'
   union all select msg.id,msg.created_at from public.business_conversation_messages msg join public.business_conversations linked on linked.id=msg.conversation_id and linked.partner_id=msg.partner_id and linked.client_id=msg.client_id where linked.partner_id=w.partner_id and linked.client_id=w.client_id and linked.contact_id=person.id and linked.identity_status='owner_verified' and msg.direction='inbound' and msg.status='received'
  ) activity order by activity.created_at desc,activity.id desc limit 1;
  if activity_id::text is distinct from w.input->>'activity_id' or activity_at is distinct from (w.input->>'activity_at')::timestamptz then return jsonb_build_object('allowed',false,'reason','Current customer activity changed after owner review.'); end if;
 end if;
 select * into s from public.agent_team_settings where partner_id=w.partner_id and client_id=w.client_id;
 if p_check_authority and (s.client_id is null or s.status<>'active' or not s.scheduling_enabled or s.authority_revision is distinct from (w.input->>'authority_revision')::integer or coalesce(s.channel_authority->>'calendar','require_approval') not in ('draft','require_approval')) then
  return jsonb_build_object('allowed',false,'reason','Scheduling authority changed or is paused.'); end if;
 if p_check_authority and (not public.business_context_has_no_conflicts(w.partner_id,w.client_id) or not exists(select 1 from public.business_context_reviews review join public.business_workspace_profiles profile on profile.partner_id=review.partner_id and profile.client_id=review.client_id where review.partner_id=w.partner_id and review.client_id=w.client_id and review.profile_revision::timestamptz=profile.updated_at)) then
  return jsonb_build_object('allowed',false,'reason','Current business context needs owner review.'); end if;
 if (p_check_authority and not exists(select 1 from public.business_agent_activation a where a.partner_id=w.partner_id and a.client_id=w.client_id and a.status='active' and a.bookings)) or w.input->>'identity_confirmed' is distinct from 'true' or w.input->>'booking_requested' is distinct from 'true' or nullif(btrim(w.input->>'service'),'') is null then
  return jsonb_build_object('allowed',false,'reason','Confirm the customer, service and appointment request before scheduling.'); end if;
 task_id:=(link.metadata->>'task_id')::uuid;
 if task_id is null or task_id is distinct from (w.input->>'task_id')::uuid or not exists(select 1 from public.crm_tasks t where t.id=task_id and t.partner_id=w.partner_id and t.client_id=w.client_id and t.lead_id=l.id and t.contact_id=person.id) then
  return jsonb_build_object('allowed',false,'reason','The linked human review task is unavailable.'); end if;
 return jsonb_build_object('allowed',true,'reason','Current source, customer and owner authority permit scheduling.','contact',jsonb_build_object('id',person.id,'name',btrim(coalesce(person.first_name,'')||' '||coalesce(person.last_name,'')),'email',person.email,'phone',person.phone),'leadId',l.id,'taskId',task_id);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
 return jsonb_build_object('allowed',false,'reason','Inquiry version or identity pins are invalid.');
end $$;


create or replace function public.claim_agent_work(p_partner uuid default null,p_client uuid default null)
returns setof public.agent_work_items language plpgsql security invoker set search_path='' as $$
declare selected uuid;
begin
 update public.agent_work_items set status=case when attempts>=3 then 'blocked' else 'queued' end,
  summary='Interrupted internal work; '||case when attempts>=3 then 'review before retrying.' else 'resuming saved assignment.' end,
  claim_token=null,lease_until=null,revision=revision+1,updated_at=now()
 where status='running' and lease_until<now() and (p_client is null or client_id=p_client) and (p_partner is null or partner_id=p_partner);
 select w.id into selected from public.agent_work_items w join public.agent_team_settings s on s.client_id=w.client_id and s.partner_id=w.partner_id
 join public.client_businesses c on c.id=w.client_id and c.partner_id=w.partner_id
 where s.status='active' and c.status='active' and w.status in ('queued','waiting_children','waiting_approval','waiting_external')
 and w.next_run_at<=now() and (p_client is null or w.client_id=p_client) and (p_partner is null or w.partner_id=p_partner)
 and (w.kind<>'marketing_campaign' or s.marketing_enabled)
 and (w.kind<>'administration_review' or s.administration_enabled)
 and (w.kind not in ('conversation_reply','conversation_review') or s.conversations_enabled)
 and (w.kind<>'booking_request' or (s.scheduling_enabled and (w.input->>'origin' in ('owner_intake','owner_conversation') or s.conversations_enabled)))
 and (w.kind not in ('sales_review','lead_follow_up') or s.sales_enabled)
 and (w.kind not in ('operations_review','replenish_product') or s.operations_enabled)
 order by w.next_run_at,w.created_at for update of w skip locked limit 1;
 if selected is null then return; end if;
 return query update public.agent_work_items set status='running',claim_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',
  attempts=case when status='queued' then attempts+1 else attempts end,revision=revision+1,updated_at=now()
 where id=selected returning *;
end $$;


do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('booking_effective_calendar_state','booking_terminal_rebooking_proof','prepare_booking_lifecycle_followup','schedule_booking_lifecycle','customer_rebooking_source_check','review_customer_rebooking','intake_inquiry_source_check','claim_agent_work') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

-- A completed reschedule is a new reviewed customer decision, not a new
-- booking identity. Only its immutable, independently proved pins may refresh
-- customer/contact/thread review; original source identity/version is retained.
create function public.booking_lifecycle_source_check(p_work uuid,p_approval uuid,p_state_job uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.agent_work_items; a public.approval_items; booking_job public.action_jobs; n public.crm_appointments;
 state_job public.action_jobs; change public.approval_items; effective jsonb; mutation jsonb;
 l public.crm_leads; person public.crm_contacts; cv public.business_conversations; c public.integration_connections;
 r public.integration_canonical_records; link public.integration_object_links; provider text; task_id uuid; activity_id uuid; activity_at timestamptz;
begin
 select * into a from public.approval_items where id=p_approval and type='appointment_booking';
 select * into booking_job from public.action_jobs where approval_id=a.id and partner_id=a.partner_id and client_id=a.client_id and kind='calendar.book' and status='succeeded' and nullif(external_ref,'') is not null;
 select * into n from public.crm_appointments where approval_id=a.id and partner_id=a.partner_id and client_id=a.client_id;
 if a.id is null or booking_job.id is null or n.id is null or n.status<>'booked' or n.calendar_state_job_id is distinct from p_state_job then
  return jsonb_build_object('allowed',false,'reason','The exact current receipt-backed appointment state changed.'); end if;
 if exists(select 1 from public.approval_items changing join public.action_jobs mutation_job on mutation_job.approval_id=changing.id and mutation_job.partner_id=changing.partner_id and mutation_job.client_id=changing.client_id
  where changing.partner_id=a.partner_id and changing.client_id=a.client_id and changing.type='appointment_change' and changing.status in ('approved','edited_and_approved') and changing.proposed_payload->>'booking_approval_id'=a.id::text and changing.proposed_payload->>'appointment_id'=n.id::text and
   mutation_job.kind in ('calendar.cancel','calendar.reschedule') and
   (mutation_job.status in ('processing','provider_pending','uncertain') or (mutation_job.status='failed' and nullif(mutation_job.external_ref,'') is not null)
    or ((changing.proposed_payload->>'appointment_updated_at')::timestamptz=n.updated_at and mutation_job.status in ('pending','succeeded')))) then
  return jsonb_build_object('allowed',false,'reason','An approved current appointment change is pending or awaiting reconciliation.'); end if;
 effective:=public.booking_effective_calendar_state(a.partner_id,a.client_id,a.id,booking_job.id,n.id);
 if effective->>'allowed' is distinct from 'true' or effective->>'stateJobId' is distinct from p_state_job::text then
  return jsonb_build_object('allowed',false,'reason','The current calendar state lacks an exact approved successful receipt.'); end if;
 if a.proposed_payload->>'origin' not in ('owner_intake','owner_conversation') or a.proposed_payload->>'origin' is null then
  -- Ordinary original-thread bookings still require the current lifecycle's
  -- exact conversation/delivery/authority pins; no intake work is invented.
  if p_work is not null then return jsonb_build_object('allowed',false,'reason','An unrelated source assignment was supplied.'); end if;
  return jsonb_build_object('allowed',true,'reason','The current booking state is proved and no accepted current mutation is outstanding.');
 end if;
 select * into w from public.agent_work_items where id=p_work and partner_id=a.partner_id and client_id=a.client_id;
 if w.id is null or w.kind<>'booking_request' or w.approval_id is distinct from a.id or w.status='cancelled' or w.input->>'origin' is distinct from a.proposed_payload->>'origin' or
  (w.input->>'origin'='owner_intake' and w.id::text is distinct from a.proposed_payload->>'intake_work_id') or (w.input->>'origin'='owner_conversation' and w.id::text is distinct from a.proposed_payload->>'customer_rebooking_work_id') then
  return jsonb_build_object('allowed',false,'reason','The exact completed source-linked booking assignment is unavailable.'); end if;
 if p_state_job is null then
  if w.input->>'origin'='owner_conversation' then return public.customer_rebooking_action_check(p_work,p_approval,true); end if;
  return public.intake_booking_action_check(p_work,p_approval,true);
 end if;
 select * into state_job from public.action_jobs where id=p_state_job and partner_id=w.partner_id and client_id=w.client_id and kind='calendar.reschedule' and status='succeeded';
 select * into change from public.approval_items where id=state_job.approval_id and partner_id=w.partner_id and client_id=w.client_id and type='appointment_change' and status in ('approved','edited_and_approved');
 mutation:=change.proposed_payload;
 select * into l from public.crm_leads where id=w.source_lead_id and partner_id=w.partner_id and client_id=w.client_id;
 select * into person from public.crm_contacts where id=l.contact_id and partner_id=w.partner_id and client_id=w.client_id;
 if l.id is null or person.id is null or person.id is distinct from n.contact_id or (n.lead_id is not null and n.lead_id<>l.id) or person.id::text is distinct from mutation->>'contact_id' or person.updated_at is distinct from (mutation->>'contact_updated_at')::timestamptz or l.status in ('won','lost') then
  return jsonb_build_object('allowed',false,'reason','The exact lead, customer or freshly reviewed customer version changed.'); end if;
 -- Lead timestamps can advance during successful native receipt reconciliation.
 -- Exact lead/contact/source linkage remains mandatory; no inferred merge.
 if w.input->>'origin'='owner_intake' then
  if w.conversation_id is not null then return jsonb_build_object('allowed',false,'reason','The inquiry assignment changed source identity.'); end if;
  select * into c from public.integration_connections where id=(w.input->>'intake_connection_id')::uuid and partner_id=w.partner_id and client_id=w.client_id;
  select provider_key into provider from public.integration_providers where id=c.provider_id;
  select * into r from public.integration_canonical_records where id=(w.input->>'intake_record_id')::uuid and connection_id=c.id and partner_id=w.partner_id and client_id=w.client_id and object_type='lead' and external_object_id=w.input->>'intake_external_id';
  select * into link from public.integration_object_links where connection_id=c.id and partner_id=w.partner_id and client_id=w.client_id and object_type='lead' and external_object_id=r.external_object_id;
  if c.id is null or provider is distinct from 'generic_inbound_webhook' or c.status<>'connected' or c.runtime_mode='paused' or c.config->>'workspace_view_only' is distinct from 'true' or r.id is null or link.id is null or
   r.native_object_id is distinct from l.id::text or link.native_object_id is distinct from l.id::text or link.metadata->>'source_record_id' is distinct from r.id::text or link.metadata->>'contact_id' is distinct from person.id::text or r.updated_at is distinct from (w.input->>'source_updated_at')::timestamptz or
   jsonb_typeof(r.canonical_data) is distinct from 'object' or (r.canonical_data ? 'provider' and r.canonical_data->>'provider' is distinct from 'generic_inbound_webhook') or r.canonical_data->>'deleted'='true' or coalesce(r.canonical_data->>'status','') not in ('new','updated') then
   return jsonb_build_object('allowed',false,'reason','The original adopted inquiry source identity or source version changed.'); end if;
  if exists(select 1 from public.integration_sync_states stream where stream.connection_id=c.id and stream.partner_id=w.partner_id and stream.client_id=w.client_id and stream.stream_key='lead' and (stream.status in ('failing','paused') or nullif(stream.last_error,'') is not null)) then
   return jsonb_build_object('allowed',false,'reason','Reconcile the original inquiry source before follow-up.'); end if;
  task_id:=(link.metadata->>'task_id')::uuid;
 else
  select * into cv from public.business_conversations where id=w.conversation_id and partner_id=w.partner_id and client_id=w.client_id;
  if cv.id is null or cv.id::text is distinct from w.input->>'conversation_id' or cv.id::text is distinct from a.proposed_payload->>'conversation_id' or cv.contact_id is distinct from person.id or (cv.lead_id is not null and cv.lead_id<>l.id) or cv.identity_status<>'owner_verified' or cv.mode<>'agent' or cv.opted_out or cv.state='closed' or cv.connection_id::text is distinct from w.input->>'source_connection_id' then
   return jsonb_build_object('allowed',false,'reason','The original verified customer conversation or exact source binding changed.'); end if;
  if cv.connection_id is not null and not exists(select 1 from public.integration_connections account where account.id=cv.connection_id and account.partner_id=w.partner_id and account.client_id=w.client_id and account.status='connected' and account.runtime_mode<>'paused') then
   return jsonb_build_object('allowed',false,'reason','The original customer conversation source is paused or disconnected.'); end if;
  task_id:=(w.input->>'task_id')::uuid;
 end if;
 if task_id is null or task_id is distinct from (w.input->>'task_id')::uuid or not exists(select 1 from public.crm_tasks t where t.id=task_id and t.partner_id=w.partner_id and t.client_id=w.client_id and t.lead_id=l.id and t.contact_id=person.id and (w.input->>'origin'='owner_intake' or t.booking_approval_id::text=w.input->>'rebooking_origin_approval_id')) then
  return jsonb_build_object('allowed',false,'reason','The exact shared source review task is unavailable.'); end if;
 if w.input->>'identity_confirmed' is distinct from 'true' or w.input->>'booking_requested' is distinct from 'true' or nullif(btrim(w.input->>'service'),'') is null or (w.input->>'origin'='owner_conversation' and w.input->>'instructions_reviewed' is distinct from 'true') then
  return jsonb_build_object('allowed',false,'reason','The original explicit owner qualification is unavailable.'); end if;
 if exists(select 1 from unnest(person.tags) tag where lower(regexp_replace(btrim(tag),'[[:space:]-]+','_','g')) in ('do_not_contact','opt_out','opted_out','unsubscribed','stop')) or
  exists(select 1 from public.business_conversations linked where linked.partner_id=w.partner_id and linked.client_id=w.client_id and linked.contact_id=person.id and linked.identity_status='owner_verified' and (linked.opted_out or (linked.mode='human' and linked.state<>'closed'))) then
  return jsonb_build_object('allowed',false,'reason','Current customer suppression or human handling prevents follow-up.'); end if;
 select activity.id,activity.created_at into activity_id,activity_at from (
  select comm.id,comm.created_at from public.crm_communications comm where comm.partner_id=w.partner_id and comm.client_id=w.client_id and comm.contact_id=person.id and comm.direction='inbound' and comm.status='received'
  union all select msg.id,msg.created_at from public.business_conversation_messages msg join public.business_conversations linked on linked.id=msg.conversation_id and linked.partner_id=msg.partner_id and linked.client_id=msg.client_id where linked.partner_id=w.partner_id and linked.client_id=w.client_id and linked.contact_id=person.id and linked.identity_status='owner_verified' and msg.direction='inbound' and msg.status='received'
 ) activity order by activity.created_at desc,activity.id desc limit 1;
 if activity_id::text is distinct from mutation->>'customer_activity_id' or activity_at is distinct from (mutation->>'customer_activity_at')::timestamptz or activity_at>(effective->>'receiptAt')::timestamptz then
  return jsonb_build_object('allowed',false,'reason','The customer replied after the approved current calendar decision. Review that response.'); end if;
 if a.proposed_payload->>'conversation_id' is not null then
  select * into cv from public.business_conversations where id=(a.proposed_payload->>'conversation_id')::uuid and partner_id=w.partner_id and client_id=w.client_id;
  if cv.id is null or cv.id::text is distinct from mutation->>'conversation_id' or cv.revision is distinct from (mutation->>'conversation_revision')::integer or cv.contact_id is distinct from person.id or cv.identity_status<>'owner_verified' or cv.mode<>'agent' or cv.opted_out or cv.state='closed' then
   return jsonb_build_object('allowed',false,'reason','The exact freshly reviewed customer conversation changed.'); end if;
 elsif mutation->>'conversation_id' is not null or mutation->>'conversation_revision' is not null then
  return jsonb_build_object('allowed',false,'reason','The calendar change introduced an unrelated customer conversation.'); end if;
 -- Current follow-up authority is checked separately by its own current pin;
 -- original calendar approval/work authority is intentionally not renewed here.
 return jsonb_build_object('allowed',true,'reason','Current source identity and immutable reviewed reschedule customer pins permit a new follow-up.');
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
 return jsonb_build_object('allowed',false,'reason','The source review or current calendar mutation pins are invalid.');
end $$;
revoke all on function public.booking_lifecycle_source_check(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.booking_lifecycle_source_check(uuid,uuid,uuid) to service_role;

-- Received customer instructions are append-only evidence. Identity linking
-- remains supported; correcting instructions requires a newly received record.
create function public.guard_received_customer_evidence() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.direction='inbound' and old.status='received' and
  (new.body is distinct from old.body or new.direction is distinct from old.direction
   or new.status is distinct from old.status or new.created_at is distinct from old.created_at) then
  raise exception 'Received customer instructions are immutable; record a new correction';
 end if;
 return new;
end $$;
create trigger guard_received_customer_evidence before update on public.crm_communications
 for each row execute function public.guard_received_customer_evidence();
create trigger guard_received_customer_evidence before update on public.business_conversation_messages
 for each row execute function public.guard_received_customer_evidence();
revoke all on function public.guard_received_customer_evidence() from public,anon,authenticated;
grant execute on function public.guard_received_customer_evidence() to service_role;

-- Preserve existing outbox kinds and add structured, immutable calendar decisions.
alter table public.action_jobs drop constraint action_jobs_kind_check;
alter table public.action_jobs add constraint action_jobs_kind_check check(kind in
 ('sms.send','email.send','calendar.book','calendar.cancel','calendar.reschedule','crm.sync','external.action','conversation.send'));

create or replace function public.stamp_approval_authority() returns trigger
language plpgsql security invoker set search_path='' as $$
declare current_revision integer;
begin
 select authority_revision into current_revision from public.agent_team_settings where partner_id=new.partner_id and client_id=new.client_id;
 if current_revision is not null and new.type in ('customer_message','appointment_booking','appointment_change','external_action') then
  if new.proposed_payload ? 'authority_revision' and (new.proposed_payload->>'authority_revision')::integer<>current_revision then
   raise exception 'Authority changed during preparation' using errcode='40001';
  end if;
  new.proposed_payload:=coalesce(new.proposed_payload,'{}'::jsonb)||jsonb_build_object('authority_revision',current_revision);
 end if;
 return new;
end $$;

create or replace function public.guard_approval_resolution()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.status<>'pending' then raise exception 'Resolved approvals are immutable'; end if;
 if (to_jsonb(new)-array['status','resolved_by','resolved_at','resolved_content','resolution_note','updated_at'])
  is distinct from (to_jsonb(old)-array['status','resolved_by','resolved_at','resolved_content','resolution_note','updated_at']) then
  raise exception 'Only approval resolution fields may change';
 end if;
 if new.status='expired' and current_user='service_role' and new.resolved_by is null and new.resolved_content is null and
  (old.proposed_payload ? 'conversation_id'
   or (old.type='appointment_booking' and old.proposed_payload->>'origin' in ('owner_intake','owner_conversation') and (old.proposed_payload ? 'intake_work_id' or old.proposed_payload ? 'customer_rebooking_work_id'))
   or (old.type='appointment_change' and old.proposed_payload->'calendar_mutation_version'='1'::jsonb)
   or (old.type='customer_message' and old.proposed_payload ? 'booking_approval_id' and
    (old.proposed_payload->>'booking_lifecycle_version'='1' or old.proposed_payload->>'draft_source'='booking_confirmation_template'))) then
  new.resolved_at:=now(); return new;
 end if;
 if new.status not in ('approved','edited_and_approved','rejected') or new.resolved_by is null then raise exception 'A human resolution is required'; end if;
 if current_user<>'service_role' and new.resolved_by is distinct from auth.uid() then raise exception 'Resolution actor does not match authenticated user'; end if;
 if old.type='appointment_change' and new.status='edited_and_approved' then raise exception 'Reject and prepare a fresh exact appointment change instead'; end if;
 if new.status='approved' then new.resolved_content:=old.editable_content; end if;
 if new.status='edited_and_approved' and nullif(btrim(new.resolved_content),'') is null then raise exception 'Edited content is required'; end if;
 new.resolved_at:=now(); return new;
end $$;

create or replace function public.enqueue_approved_action()
returns trigger language plpgsql security definer set search_path='' as $$
declare action_kind text; action_payload jsonb; bound_appointment uuid; check_result jsonb;
begin
 if new.status not in ('approved','edited_and_approved') then return new; end if;
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
-- The definer remains an internal trigger only, never an exposed RPC.
revoke all on function public.enqueue_approved_action() from public,anon,authenticated;
grant execute on function public.enqueue_approved_action() to service_role;

insert into public.platform_schema_state(singleton,current_migration,applied_at)
values(true,'20261117214644_approved_calendar_changes',now())
on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;
