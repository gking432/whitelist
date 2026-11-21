-- Customer inquiry progression and receipt-backed booking lifecycle.
-- Pending isolated Postgres/RLS/transaction acceptance; no provider writes in this migration.

-- Source-reviewed, not executed against a database.
-- Service-only owner command + existing work/outbox.
create function public.intake_inquiry_source_check(p_work uuid,p_allow_scheduled boolean default false,p_check_authority boolean default true)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.agent_work_items; r public.integration_canonical_records; c public.integration_connections;
 l public.crm_leads; person public.crm_contacts; link public.integration_object_links; s public.agent_team_settings;
 provider text; task_id uuid; rebooking boolean:=false;
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
   and (ap.status='cancelled' or (ap.status='completed' and to_jsonb(ap)->>'lifecycle_completed_at' is not null))) into rebooking;
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

create function public.intake_scheduling_check(p_work uuid,p_claim uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.agent_work_items;
begin
 select * into w from public.agent_work_items where id=p_work;
 if w.id is null or w.claim_token is distinct from p_claim or p_claim is null or w.status<>'running' or w.lease_until is null or w.lease_until<=now() then
  return jsonb_build_object('allowed',false,'reason','The assignment claim expired or was interrupted.'); end if;
 return public.intake_inquiry_source_check(p_work,false);
end $$;

create function public.intake_booking_action_check(p_work uuid,p_approval uuid,p_allow_completed boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.agent_work_items;
begin
 select * into w from public.agent_work_items where id=p_work;
 if w.id is null or w.approval_id is distinct from p_approval or p_approval is null or w.status='cancelled' then
  return jsonb_build_object('allowed',false,'reason','The booking action does not match its saved assignment.'); end if;
 if w.status='completed' then
  if not p_allow_completed or not exists(select 1 from public.action_jobs j where j.partner_id=w.partner_id and j.client_id=w.client_id and j.approval_id=p_approval and j.kind='calendar.book' and j.status='succeeded' and nullif(j.external_ref,'') is not null) then
   return jsonb_build_object('allowed',false,'reason','A completed booking assignment cannot create another booking.'); end if;
 elsif w.status not in ('running','waiting_approval','waiting_external') then
  return jsonb_build_object('allowed',false,'reason','The original booking assignment is not active.');
 end if;
 return public.intake_inquiry_source_check(p_work,p_allow_completed,not p_allow_completed);
end $$;

create function public.save_intake_scheduling_offer(p_work uuid,p_claim uuid,p_offer jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare w public.agent_work_items; check_result jsonb; s jsonb; checked timestamptz; expires timestamptz; account public.integration_connections; provider text;
begin
 select * into strict w from public.agent_work_items where id=p_work for update;
 check_result:=public.intake_scheduling_check(p_work,p_claim);
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

create function public.propose_intake_booking(p_work uuid,p_claim uuid,p_metadata jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare w public.agent_work_items; check_result jsonb; chosen jsonb; approval uuid; payload jsonb; selection integer; account public.integration_connections; provider text;
begin
 select * into strict w from public.agent_work_items where id=p_work for update;
 check_result:=public.intake_scheduling_check(p_work,p_claim);
 if not coalesce((check_result->>'allowed')::boolean,false) or w.approval_id is not null then raise exception 'Inquiry scheduling changed' using errcode='40001'; end if;
 selection:=(w.input->>'selection_index')::integer;
 if selection not between 1 and 3 or jsonb_typeof(w.result->'offer'->'slots')<>'array' then raise exception 'Choose a saved offered slot first' using errcode='22023'; end if;
 chosen:=w.result->'offer'->'slots'->(selection-1);
 if chosen is null or chosen is distinct from w.input->'slot' or chosen is distinct from p_metadata->'slot' or (chosen->>'start_iso')::timestamptz<=now() or p_metadata->>'provider' is distinct from w.result->'offer'->>'provider' or p_metadata->>'calendar_connection_id' is distinct from w.result->'offer'->>'calendar_connection_id' or p_metadata->>'timezone' is distinct from w.result->'offer'->>'timezone' then raise exception 'The selected slot or calendar changed' using errcode='40001'; end if;
 if (p_metadata->>'authority_revision')::integer is distinct from (w.input->>'authority_revision')::integer or p_metadata->>'intake_work_id' is distinct from w.id::text or p_metadata->>'lead_id' is distinct from w.source_lead_id::text or p_metadata->>'contact_id' is distinct from check_result->'contact'->>'id' then raise exception 'Proposal identity or authority changed' using errcode='40001'; end if;
 if w.result->'offer'->>'provider'='northstar_internal' then
  if w.result->'offer'->>'calendar_connection_id' is not null or not exists(select 1 from public.client_businesses b where b.partner_id=w.partner_id and b.id=w.client_id and b.status='active' and b.default_runtime_mode='live' and b.crm_operating_mode in ('primary_crm','mirror','assist')) then raise exception 'Internal calendar unavailable' using errcode='40001'; end if;
 else
  select * into account from public.integration_connections where id=(w.result->'offer'->>'calendar_connection_id')::uuid and partner_id=w.partner_id and client_id=w.client_id;
  select provider_key into provider from public.integration_providers where id=account.provider_id;
  if account.id is null or provider is distinct from w.result->'offer'->>'provider' or account.status<>'connected' or account.runtime_mode<>'live' or account.config->>'workspace_view_only'='true' then raise exception 'Calendar account changed or is read only' using errcode='40001'; end if;
 end if;
 -- Copy all provenance and identity pins from durable work/checked records,
 -- never from a model or browser-supplied metadata bag.
 payload:=jsonb_build_object('origin','owner_intake','intake_work_id',w.id,'intake_record_id',w.input->'intake_record_id','intake_connection_id',w.input->'intake_connection_id','intake_external_id',w.input->'intake_external_id',
  'source_updated_at',w.input->'source_updated_at','lead_updated_at',w.input->'lead_updated_at','contact_updated_at',w.input->'contact_updated_at','authority_revision',w.input->'authority_revision',
  'lead_id',w.source_lead_id,'contact_id',check_result->'contact'->'id','contact',check_result->'contact','task_id',check_result->'taskId','identity_confirmed',true,'booking_requested',true,'service',w.input->'service',
  'provider',w.result->'offer'->'provider','calendar_connection_id',w.result->'offer'->'calendar_connection_id','timezone',w.result->'offer'->'timezone','slot',chosen);
 insert into public.approval_items(partner_id,client_id,type,status,title,summary,proposed_payload,expires_at)
 values(w.partner_id,w.client_id,'appointment_booking','pending',left('Book appointment: '||coalesce(w.input->>'service','Service'),180),
  'Owner selected '||(chosen->>'label')||'. Availability will be checked again before booking. A form does not provide a confirmation delivery channel.',payload,least(now()+interval '24 hours',(chosen->>'start_iso')::timestamptz)) returning id into approval;
 update public.agent_work_items set approval_id=approval,status='waiting_approval',summary='The selected appointment is awaiting owner approval. Nothing is held or booked.',result=result||jsonb_build_object('phase','booking_approval','booking_approval_id',approval),claim_token=null,lease_until=null,revision=revision+1,updated_at=now() where id=w.id and claim_token=p_claim and status='running' and lease_until>now();
 if not found then raise exception 'Scheduling claim lost' using errcode='40001'; end if;
 insert into public.agent_work_events(partner_id,client_id,work_id,status,summary) values(w.partner_id,w.client_id,w.id,'waiting_approval','Booking proposal saved for owner approval. No provider write occurred.');
 return true;
end $$;

create function public.progress_owner_intake_inquiry(p_partner uuid,p_client uuid,p_actor uuid,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare receipt public.business_owner_commands; c public.integration_connections; r public.integration_canonical_records;
 l public.crm_leads; person public.crm_contacts; link public.integration_object_links; s public.agent_team_settings;
 w public.agent_work_items; old_work public.agent_work_items; provider text; v_request_key uuid; receipt_id uuid:=gen_random_uuid();
 qualification jsonb; missing jsonb:='[]'::jsonb; state text; message text; work_id uuid; review_task uuid; offer jsonb; slot jsonb; selection integer;
 outcome jsonb; check_result jsonb; ready boolean; q_service text; q_preference text;
begin
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner for update;
 if not found or p_actor is null or jsonb_typeof(p_command)<>'object' then raise exception 'Business unavailable' using errcode='22023'; end if;
 v_request_key:=(p_command->>'key')::uuid;
 if v_request_key is null then raise exception 'Missing request key' using errcode='22023'; end if;
 -- Exact replay before any current-source/eligibility check, including after
 -- the source was updated or disconnected following a successful command.
 select b.* into receipt from public.business_owner_commands b where b.partner_id=p_partner and b.client_id=p_client and b.request_key=v_request_key;
 if found then
  if receipt.actor_id<>p_actor or receipt.command<>p_command then raise exception 'Request key reused with changed command' using errcode='40001'; end if;
  return receipt.result||jsonb_build_object('replayed',true);
 end if;
 if p_command->>'action'='select_intake_slot' then
  select * into w from public.agent_work_items where id=(p_command->>'workId')::uuid and partner_id=p_partner and client_id=p_client for update;
  if w.id is null or w.kind<>'booking_request' or w.input->>'origin'<>'owner_intake' or w.approval_id is not null or w.status not in ('waiting_approval','blocked') or w.revision is distinct from (p_command->>'expectedWorkRevision')::integer then
   raise exception 'Scheduling decision changed' using errcode='40001'; end if;
  check_result:=public.intake_inquiry_source_check(w.id,false);
  if not coalesce((check_result->>'allowed')::boolean,false) then raise exception 'Inquiry or authority changed' using errcode='40001'; end if;
  offer:=w.result->'offer'; selection:=(p_command->>'slot')::integer;
  if selection is null or selection not between 1 and 3 or jsonb_typeof(offer->'slots') is distinct from 'array'
   or nullif(offer->>'expires_at','') is null or nullif(offer->>'checked_at','') is null
   or (offer->>'expires_at')::timestamptz<=now() or (offer->>'checked_at')::timestamptz>now()+interval '5 minutes' then raise exception 'Choose fresh saved availability' using errcode='40001'; end if;
  slot:=offer->'slots'->(selection-1);
  if slot is null or (slot->>'start_iso')::timestamptz<=now() then raise exception 'The offered time expired' using errcode='40001'; end if;
  update public.agent_work_items set input=input||jsonb_build_object('slot',slot,'selection_index',selection,'provider',offer->'provider','calendar_connection_id',offer->'calendar_connection_id','timezone',offer->'timezone'),
   result=result||jsonb_build_object('phase','selected_slot'),status='queued',summary='Selected time saved. Scheduling will recheck availability before preparing owner approval.',next_run_at=now(),claim_token=null,lease_until=null,revision=revision+1,updated_at=now()
   where id=w.id and revision=w.revision;
  if not found then raise exception 'Scheduling decision changed' using errcode='40001'; end if;
  work_id:=w.id; r.id:=(w.input->>'intake_record_id')::uuid; l.id:=w.source_lead_id; review_task:=(w.input->>'task_id')::uuid;
  state:='queued'; message:='Selected time saved for a fresh availability check and owner booking approval. Nothing is held or booked.';
 else
  if p_command->>'action'<>'qualify_intake' then raise exception 'Unsupported inquiry command' using errcode='22023'; end if;
  qualification:=p_command->'qualification';
  if jsonb_typeof(qualification) is distinct from 'object' or jsonb_typeof(qualification->'service') is distinct from 'string' or length(qualification->>'service')>200 or jsonb_typeof(qualification->'preference') is distinct from 'string' or length(qualification->>'preference')>500 or jsonb_typeof(qualification->'identityConfirmed') is distinct from 'boolean' or jsonb_typeof(qualification->'bookingRequested') is distinct from 'boolean' then raise exception 'Invalid qualification' using errcode='22023'; end if;
  q_service:=btrim(qualification->>'service'); q_preference:=btrim(qualification->>'preference');
  select * into c from public.integration_connections where id=(p_command->>'connectionId')::uuid and partner_id=p_partner and client_id=p_client for update;
  select provider_key into provider from public.integration_providers where id=c.provider_id;
  if c.id is null or provider<>'generic_inbound_webhook' or c.status<>'connected' or c.runtime_mode='paused' or c.config->>'workspace_view_only' is distinct from 'true' then raise exception 'Restore the intake source first' using errcode='40001'; end if;
  if exists(select 1 from public.integration_sync_states where connection_id=c.id and partner_id=p_partner and client_id=p_client and stream_key='lead' and (status='failing' or nullif(last_error,'') is not null)) then raise exception 'Intake source needs reconciliation' using errcode='40001'; end if;
  select * into r from public.integration_canonical_records where id=(p_command->>'recordId')::uuid and connection_id=c.id and partner_id=p_partner and client_id=p_client and object_type='lead' and external_object_id=p_command->>'externalId' for update;
  if r.id is null or jsonb_typeof(r.canonical_data) is distinct from 'object' or r.canonical_data->>'deleted'='true' or coalesce(r.canonical_data->>'status','') not in ('new','updated') or r.updated_at is distinct from (p_command->>'expectedSourceUpdatedAt')::timestamptz then raise exception 'Inquiry source changed or is deleted' using errcode='40001'; end if;
  select * into l from public.crm_leads where id::text=r.native_object_id and partner_id=p_partner and client_id=p_client for update;
  select * into person from public.crm_contacts where id=l.contact_id and partner_id=p_partner and client_id=p_client for update;
  select * into link from public.integration_object_links where connection_id=c.id and partner_id=p_partner and client_id=p_client and object_type='lead' and external_object_id=r.external_object_id for update;
  review_task:=(link.metadata->>'task_id')::uuid;
  if l.id is null or person.id is null or link.id is null or link.native_object_id is distinct from l.id::text or link.metadata->>'source_record_id' is distinct from r.id::text or link.metadata->>'contact_id' is distinct from person.id::text or review_task is null or
    l.updated_at is distinct from (p_command->>'expectedLeadUpdatedAt')::timestamptz or person.updated_at is distinct from (p_command->>'expectedContactUpdatedAt')::timestamptz then raise exception 'Adopted customer or source identity changed' using errcode='40001'; end if;
  if l.status in ('scheduled','won','lost') then raise exception 'Review the recorded booking or closed lead before requesting more work' using errcode='40001'; end if;
  if exists(select 1 from unnest(person.tags) t where lower(regexp_replace(btrim(t),'[[:space:]-]+','_','g')) in ('do_not_contact','opt_out','opted_out','unsubscribed','stop')) then raise exception 'The customer is suppressed' using errcode='40001'; end if;
  perform 1 from public.crm_tasks where id=review_task and partner_id=p_partner and client_id=p_client and lead_id=l.id and contact_id=person.id for update;
  if not found then raise exception 'The shared review task is unavailable' using errcode='40001'; end if;
  select * into s from public.agent_team_settings where partner_id=p_partner and client_id=p_client for update;
  if coalesce(s.authority_revision,0) is distinct from (p_command->>'expectedAuthorityRevision')::integer then raise exception 'Owner authority changed' using errcode='40001'; end if;
  -- Any new qualification must first account for older work. Never reset or
  -- replace a provider operation already processing, accepted or uncertain.
  for old_work in select * from public.agent_work_items where partner_id=p_partner and client_id=p_client and kind='booking_request' and input->>'origin'='owner_intake' and input->>'intake_record_id'=r.id::text order by created_at desc for update loop
   if old_work.status='completed' or exists(select 1 from public.action_jobs j where j.partner_id=p_partner and j.client_id=p_client and j.approval_id=old_work.approval_id and (j.status in ('processing','provider_pending','uncertain','succeeded') or (j.status='failed' and j.external_ref is not null))) then
    raise exception 'Existing booking action needs its recorded outcome or lifecycle decision; do not duplicate it' using errcode='40001';
   end if;
   if old_work.status<>'cancelled' then
    update public.action_jobs j set status='cancelled',outcome_detail='Superseded by an explicit owner inquiry review.',last_error=null where j.partner_id=p_partner and j.client_id=p_client and j.approval_id=old_work.approval_id
      and (j.status in ('pending','dry_run','skipped') or (j.status='failed' and j.external_ref is null));
    if exists(select 1 from public.action_jobs j where j.partner_id=p_partner and j.client_id=p_client and j.approval_id=old_work.approval_id and j.status not in ('cancelled','pending','failed','dry_run','skipped')) then raise exception 'Existing action cannot be safely replaced' using errcode='40001'; end if;
    update public.approval_items set status='expired',resolved_at=now() where id=old_work.approval_id and partner_id=p_partner and client_id=p_client and status='pending';
    update public.agent_work_items set status='cancelled',summary='Superseded by a fresh explicit owner inquiry review. No accepted provider action was undone.',claim_token=null,lease_until=null,revision=revision+1,updated_at=now() where id=old_work.id;
   end if;
  end loop;
  if exists(select 1 from public.business_conversations cv where cv.partner_id=p_partner and cv.client_id=p_client and cv.contact_id=person.id and cv.identity_status='owner_verified' and (cv.opted_out or (cv.mode='human' and cv.state<>'closed'))) then
   missing:=missing||jsonb_build_array('customer_handling');
  end if;
  if q_service='' then missing:=missing||jsonb_build_array('service'); end if;
  if qualification->>'identityConfirmed'<>'true' then missing:=missing||jsonb_build_array('identity_confirmation'); end if;
  if qualification->>'bookingRequested'<>'true' then missing:=missing||jsonb_build_array('appointment_request'); end if;
  ready:=jsonb_array_length(missing)=0;
  if not ready then state:='needs_details'; message:='Confirm the service, customer identity and appointment request in the shared review task. Nothing was sent.';
  elsif (s.client_id is null or s.status<>'active' or not s.scheduling_enabled or coalesce(s.channel_authority->>'calendar','require_approval') not in ('draft','require_approval') or not public.business_context_has_no_conflicts(p_partner,p_client) or
   not exists(select 1 from public.business_context_reviews review join public.business_workspace_profiles profile on profile.partner_id=review.partner_id and profile.client_id=review.client_id where review.partner_id=p_partner and review.client_id=p_client and review.profile_revision::timestamptz=profile.updated_at) or
   not exists(select 1 from public.business_agent_activation a where a.partner_id=p_partner and a.client_id=p_client and a.status='active' and a.bookings)) then
    state:='needs_setup'; missing:=jsonb_build_array('calendar_authority'); message:='Qualification saved. Review current business context, activate scheduling and authorize the selected calendar before continuing.';
  else state:='queued'; message:='Scheduling queued to check real availability. No appointment is held or booked.';
  end if;
  update public.crm_leads set service_type=nullif(q_service,''),next_action=message where id=l.id and partner_id=p_partner and client_id=p_client returning * into l;
  update public.crm_tasks set title=left(case when state='needs_setup' then 'Set up scheduling: ' when state='needs_details' then 'Complete inquiry details: ' else 'Review scheduling: ' end||coalesce(nullif(l.title,''),'Imported inquiry'),180),
   description=left(coalesce(r.canonical_data->>'description',''),6000)||E'\n\nOwner qualification: '||qualification::text||E'\nNext step: '||message,status='open',completed_at=null where id=review_task and partner_id=p_partner and client_id=p_client;
  -- The lead version is stamped AFTER the deliberate qualification write.
  insert into public.agent_work_items(partner_id,client_id,kind,agent_key,title,status,summary,dedupe_key,source_lead_id,input,result,next_run_at)
  values(p_partner,p_client,'booking_request','scheduling',left('Check appointment times: '||coalesce(nullif(q_service,''),'Inquiry'),180),case when state='queued' then 'queued' else 'blocked' end,message,
   'intake-qualification:'||r.id::text||':'||v_request_key::text,l.id,
   jsonb_build_object('origin','owner_intake','intake_record_id',r.id,'intake_connection_id',c.id,'intake_external_id',r.external_object_id,'source_updated_at',r.updated_at,'lead_updated_at',l.updated_at,'contact_updated_at',person.updated_at,
    'authority_revision',coalesce(s.authority_revision,0),'identity_confirmed',qualification->'identityConfirmed','booking_requested',qualification->'bookingRequested','service',q_service,'preference',q_preference,'task_id',review_task,'qualified_at',now()),
   jsonb_build_object('phase',case when state='queued' then 'checking_availability' else state end,'missing',missing,'qualification',qualification),now()) returning id into work_id;
 end if;
 outcome:=jsonb_build_object('id',receipt_id,'sourceRecordId',r.id,'leadId',l.id,'taskId',review_task,'workId',work_id,'state',state,'missing',missing,'message',message,'replayed',false);
 insert into public.business_owner_commands(id,partner_id,client_id,actor_id,request_key,command,result) values(receipt_id,p_partner,p_client,p_actor,v_request_key,p_command,outcome);
 insert into public.agent_work_events(partner_id,client_id,work_id,status,summary) values(p_partner,p_client,work_id,case when state='queued' then 'queued' else 'blocked' end,message);
 return outcome;
end $$;

-- Revoke every helper from browser roles. Existing scoped authenticated server
-- APIs are the only owner mutation entry point; service workers own leases.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('intake_inquiry_source_check','intake_scheduling_check','intake_booking_action_check','save_intake_scheduling_offer','propose_intake_booking','progress_owner_intake_inquiry') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;


-- Receipt-backed lifecycle; isolated database acceptance remains pending.
-- Marker columns default NULL: repeated recovery must never renew done/stopped.
alter table public.action_jobs add column if not exists booking_followup_due_at timestamptz,
 add column if not exists booking_followup_attempts integer not null default 0,
 add column if not exists booking_followup_phase text,
 add column if not exists booking_followup_reason text;
alter table public.crm_tasks add column if not exists booking_approval_id uuid references public.approval_items(id);
create index if not exists booking_lifecycle_due on public.action_jobs(booking_followup_due_at)
 where kind='calendar.book' and status='succeeded' and booking_followup_phase='reminder';
create unique index if not exists booking_lifecycle_proposal_key on public.approval_items(partner_id,client_id,(proposed_payload->>'booking_followup_key'))
 where type='customer_message' and proposed_payload->>'booking_lifecycle_version'='1';

create function public.schedule_booking_lifecycle(p_partner uuid,p_client uuid,p_booking_approval uuid,p_action_job uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.approval_items; j public.action_jobs; b public.client_businesses; starts timestamptz;
begin
 select * into a from public.approval_items where id=p_booking_approval and partner_id=p_partner and client_id=p_client and type='appointment_booking' for update;
 select * into j from public.action_jobs where id=p_action_job and approval_id=a.id and partner_id=p_partner and client_id=p_client and kind='calendar.book' for update;
 if a.id is null or a.status not in ('approved','edited_and_approved') or j.status is distinct from 'succeeded' or nullif(j.external_ref,'') is null then
  raise exception 'A durable successful booking receipt is required';
 end if;
 if j.booking_followup_phase is not null then return jsonb_build_object('state',j.booking_followup_phase); end if;
 select * into b from public.client_businesses where id=p_client and partner_id=p_partner;
 starts:=(a.proposed_payload->'slot'->>'start_iso')::timestamptz;
 if b.status is distinct from 'active' or b.native_lifecycle_enabled_at is null or j.receipt_recorded_at is null or j.receipt_recorded_at<b.native_lifecycle_enabled_at or starts<=now() or starts is null then
  update public.action_jobs set booking_followup_phase='done',booking_followup_reason='Reminders were not enabled for this new booking.' where id=j.id;
  return jsonb_build_object('state','done');
 end if;
 update public.action_jobs set booking_followup_phase='reminder',booking_followup_due_at=greatest(now(),starts-interval '24 hours'),booking_followup_attempts=0,booking_followup_reason=null where id=j.id;
 return jsonb_build_object('state','reminder','nextDueAt',greatest(now(),starts-interval '24 hours'));
end $$;

create function public.record_booking_followup_retry(p_partner uuid,p_client uuid,p_job uuid,p_reason text,p_next_due timestamptz default null)
returns void language plpgsql security invoker set search_path='' as $$
begin
 update public.action_jobs set
  booking_followup_attempts=case when p_next_due>now() then booking_followup_attempts else booking_followup_attempts+1 end,
  booking_followup_due_at=case when p_next_due>now() then p_next_due when booking_followup_attempts>=4 then null else now()+interval '5 minutes' end,
  booking_followup_phase=case when p_next_due>now() then 'reminder' when booking_followup_attempts>=4 then 'done' else 'reminder' end,
  booking_followup_reason=left(coalesce(nullif(p_reason,''),'The saved booking follow-up needs owner review.'),2000)
 where id=p_job and partner_id=p_partner and client_id=p_client and kind='calendar.book' and status='succeeded' and booking_followup_phase='reminder';
end $$;

create function public.prepare_booking_lifecycle_followup(p_partner uuid,p_client uuid,p_booking_approval uuid,p_action_job uuid,p_kind text,p_pin jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.approval_items; j public.action_jobs; n public.crm_appointments; customer public.crm_contacts;
 b public.client_businesses; settings public.agent_team_settings; source public.integration_canonical_records;
 account public.integration_connections; conversation public.business_conversations; incoming public.crm_communications;
 result_id uuid; result_state text:='existing'; version_key text; body text; recipient text; channel text; source_provider text; desired_start timestamptz; desired_end timestamptz;
begin
 if p_kind is null or p_kind not in ('confirmation','reminder') or jsonb_typeof(p_pin) is distinct from 'object' or p_pin->>'booking_lifecycle_version' is distinct from '1' or p_pin->>'booking_followup_kind' is distinct from p_kind then
  raise exception 'Invalid booking follow-up proposal' using errcode='22023';
 end if;
 select * into a from public.approval_items where id=p_booking_approval and partner_id=p_partner and client_id=p_client and type='appointment_booking' for update;
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
  and exists(select 1 from public.action_jobs child where child.partner_id=p_partner and child.client_id=p_client and child.approval_id=proposal.id
    and (child.status in ('processing','provider_pending','uncertain','succeeded') or nullif(child.external_ref,'') is not null))
 order by proposal.created_at,proposal.id limit 1;
 if result_id is not null then
  if p_kind='reminder' then update public.action_jobs set booking_followup_due_at=null,booking_followup_phase=case when booking_followup_phase='stopped' then 'stopped' else 'done' end where id=j.id; end if;
  return jsonb_build_object('state','existing','approvalId',result_id,'reason','An existing provider outcome must be reconciled; no duplicate message was created.');
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
 desired_start:=(a.proposed_payload->'slot'->>'start_iso')::timestamptz; desired_end:=(a.proposed_payload->'slot'->>'end_iso')::timestamptz;
 if n.status<>'booked' or n.start_at is distinct from desired_start or n.end_at is distinct from desired_end or n.start_at<=now()
  or n.start_at is distinct from (p_pin->'booking_slot'->>'start_iso')::timestamptz or n.end_at is distinct from (p_pin->'booking_slot'->>'end_iso')::timestamptz then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The booked appointment was cancelled, rescheduled or has passed.');
 end if;
 select * into b from public.client_businesses where id=p_client and partner_id=p_partner;
 if p_kind='reminder' then
  if b.native_lifecycle_enabled_at is null or j.receipt_recorded_at is null or j.receipt_recorded_at<b.native_lifecycle_enabled_at then
   return jsonb_build_object('state','blocked','approvalId',null,'reason','Reminders were not enabled for this booking.');
  end if;
  if now()<n.start_at-interval '24 hours' then
   update public.action_jobs set booking_followup_due_at=n.start_at-interval '24 hours',booking_followup_phase='reminder' where id=j.id and booking_followup_phase is distinct from 'stopped';
   return jsonb_build_object('state','not_due','approvalId',null,'reason','Reminder preparation is scheduled for the day before the appointment.','nextDueAt',n.start_at-interval '24 hours');
  end if;
 end if;
 if exists(select 1 from unnest(customer.tags) tag where lower(regexp_replace(btrim(tag),'[[:space:]-]+','_','g')) in ('do_not_contact','opt_out','opted_out','unsubscribed','stop')) then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The customer opted out.');
 end if;
 select * into incoming from public.crm_communications where partner_id=p_partner and client_id=p_client and contact_id=customer.id and direction='inbound' order by created_at desc,id desc limit 1;
 if incoming.created_at>j.receipt_recorded_at then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The customer replied after booking. Review their current request before another follow-up.');
 end if;
 if incoming.id::text is distinct from p_pin->>'customer_activity_id' or incoming.created_at is distinct from (p_pin->>'customer_activity_at')::timestamptz then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','New customer activity needs review before follow-up.');
 end if;
 if exists(select 1 from public.business_conversations where partner_id=p_partner and client_id=p_client and contact_id=customer.id and identity_status='owner_verified' and mode='human' and state<>'closed') then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','An owner is handling the customer.');
 end if;
 if a.proposed_payload->>'origin'='owner_intake' and not coalesce((public.intake_booking_action_check((a.proposed_payload->>'intake_work_id')::uuid,a.id,true)->>'allowed')::boolean,false) then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The reviewed intake or customer request changed.');
 end if;
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
   or source.snapshot_observed_at is null or source.snapshot_observed_at<j.receipt_recorded_at or source.snapshot_observed_at<now()-interval '45 minutes' or source.snapshot_observed_at>now() then
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
    and proposal.status='pending';
  result_state:='queued';
  body:=case when p_kind='reminder' then 'A reminder: your appointment with ' else 'Your appointment with ' end||coalesce(b.name,'the business')||' is set for '||coalesce(a.proposed_payload->'slot'->>'label',n.start_at::text)||'. Reply if you need to change it.';
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
 if p_kind='reminder' then update public.action_jobs set booking_followup_due_at=null,booking_followup_phase='done',booking_followup_reason=null where id=j.id; end if;
 return jsonb_build_object('state',result_state,'approvalId',result_id);
end $$;

create function public.reconcile_source_booking_cancellation(p_partner uuid,p_client uuid,p_booking uuid,p_actor uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare a public.approval_items; n public.crm_appointments; j public.action_jobs; account public.integration_connections;
 source_count integer; all_cancelled boolean; all_after_receipt boolean; fresh boolean; has_native_link boolean; native_links_consistent boolean;
begin
 select * into a from public.approval_items where id=p_booking and partner_id=p_partner and client_id=p_client and type='appointment_booking' for update;
 select * into n from public.crm_appointments where approval_id=a.id and partner_id=p_partner and client_id=p_client for update;
 select * into j from public.action_jobs where approval_id=a.id and partner_id=p_partner and client_id=p_client and kind='calendar.book' and status='succeeded';
 if p_actor is null or a.id is null or n.id is null or n.status<>'booked' or j.id is null or j.receipt_recorded_at is null or nullif(j.external_ref,'') is null
  or a.proposed_payload->>'provider'='northstar_internal' then return false; end if;
 select c.* into account from public.integration_connections c join public.integration_providers p on p.id=c.provider_id
  where c.id::text=a.proposed_payload->>'calendar_connection_id' and c.partner_id=p_partner and c.client_id=p_client
   and p.provider_key=a.proposed_payload->>'provider' for update of c;
 if account.id is null then return false; end if;
 -- Owner imports serialize on their connection before changing canonical rows.
 perform 1 from public.integration_connections peer where peer.partner_id=p_partner and peer.client_id=p_client and peer.provider_id=account.provider_id
  and (peer.id=account.id or (account.external_account_id is not null and peer.external_account_id=account.external_account_id)) order by peer.id for update;
 select count(*),bool_and(coalesce(r.canonical_data->>'deleted'='true',false) or coalesce(r.canonical_data->>'status','') in ('cancelled','canceled')),
  bool_and(coalesce(r.snapshot_observed_at>=j.receipt_recorded_at and r.snapshot_observed_at<=now(),false)),
  bool_or(r.snapshot_observed_at>=now()-interval '45 minutes' and r.snapshot_observed_at<=now()),
  bool_or(r.native_object_id=n.id::text),bool_and(r.native_object_id is null or r.native_object_id=n.id::text)
 into source_count,all_cancelled,all_after_receipt,fresh,has_native_link,native_links_consistent
 from public.integration_canonical_records r join public.integration_connections peer on peer.id=r.connection_id
  and peer.partner_id=r.partner_id and peer.client_id=r.client_id
 where r.partner_id=p_partner and r.client_id=p_client and r.object_type='appointment' and r.external_object_id=j.external_ref
  and peer.provider_id=account.provider_id and (peer.id=account.id or (account.external_account_id is not null and peer.external_account_id=account.external_account_id))
  and peer.status in ('connected','needs_attention') and peer.runtime_mode<>'paused';
 if source_count=0 or all_cancelled is distinct from true or all_after_receipt is distinct from true or fresh is distinct from true
  or has_native_link is distinct from true or native_links_consistent is distinct from true then return false; end if;
 if exists(select 1 from public.integration_sync_states stream join public.integration_connections peer on peer.id=stream.connection_id
  and peer.partner_id=stream.partner_id and peer.client_id=stream.client_id where stream.partner_id=p_partner and stream.client_id=p_client and stream.stream_key='appointment'
  and peer.provider_id=account.provider_id and (peer.id=account.id or (account.external_account_id is not null and peer.external_account_id=account.external_account_id))
  and (nullif(stream.last_error,'') is not null or stream.status in ('failing','paused'))) then return false; end if;
 update public.crm_appointments set status='cancelled' where id=n.id and partner_id=p_partner and client_id=p_client and status='booked';
 if not found then return false; end if;
 update public.action_jobs set booking_followup_phase='stopped',booking_followup_due_at=null,confirmation_due_at=null,
  booking_followup_reason='Cancellation verified from the exact source calendar.' where id=j.id;
 update public.action_jobs set status='cancelled',outcome_detail='The exact source calendar cancellation was verified before this message was sent.'
  where partner_id=p_partner and client_id=p_client and payload->>'booking_approval_id'=a.id::text
   and status in ('pending','failed','dry_run','skipped') and external_ref is null;
 update public.crm_tasks set status='done',completed_at=now() where partner_id=p_partner and client_id=p_client and booking_approval_id=a.id and task_type='booking_cancellation_request' and status='open';
 insert into public.crm_timeline_entries(partner_id,client_id,contact_id,lead_id,kind,actor_type,actor_user_id,title,body,ref_approval_id)
 values(p_partner,p_client,n.contact_id,n.lead_id,'appointment','user',p_actor,'Source calendar cancellation verified',
  'An explicit owner rebooking decision verified matching, fresh cancellation records for the exact calendar account and booking receipt. No provider cancellation was performed by this command.',a.id);
 return true;
end $$;

-- Owner control remains independent from paused agent work. No external
-- cancel/reschedule adapter is invoked by this explicit command path.
create function public.apply_booking_lifecycle_command(p_partner uuid,p_client uuid,p_actor uuid,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.approval_items; n public.crm_appointments; j public.action_jobs; prior public.business_owner_commands;
 original_work public.agent_work_items; r public.integration_canonical_records; lead public.crm_leads; customer public.crm_contacts;
 source_connection public.integration_connections; settings public.agent_team_settings; source_check jsonb; linked_lead uuid;
 action text:=p_command->>'action'; request_id uuid:=(p_command->>'key')::uuid; receipt_id uuid:=extensions.gen_random_uuid();
 task_id uuid; work_id uuid; result jsonb; message text; state text;
begin
 if p_actor is null or request_id is null or jsonb_typeof(p_command) is distinct from 'object' or
  p_command-array['action','key','targetId','expectedRevision']<>'{}'::jsonb or action is null or action not in ('recover_confirmation','prepare_reminder','prepare_rebooking','request_cancellation') then
  raise exception 'Invalid booking lifecycle command' using errcode='22023';
 end if;
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner for update;
 if not found then raise exception 'Business unavailable'; end if;
 select * into prior from public.business_owner_commands commands where commands.partner_id=p_partner and commands.client_id=p_client and commands.request_key=request_id;
 if prior.id is not null then
  if prior.actor_id is distinct from p_actor or prior.command is distinct from p_command then raise exception 'Request key changed' using errcode='40001'; end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 select * into a from public.approval_items where id::text=p_command->>'targetId' and partner_id=p_partner and client_id=p_client and type='appointment_booking' for update;
 select * into j from public.action_jobs where approval_id=a.id and partner_id=p_partner and client_id=p_client and kind='calendar.book' and status='succeeded' for update;
 select * into n from public.crm_appointments where approval_id=a.id and partner_id=p_partner and client_id=p_client for update;
 if a.id is null or j.id is null or n.id is null or n.updated_at is distinct from (p_command->>'expectedRevision')::timestamptz then
  raise exception 'The saved booking changed; review its current source' using errcode='40001';
 end if;
 -- Historical appointment mirrors may not carry lead_id. Use only the exact
 -- original approval lead when that scoped lead still belongs to this customer.
 select l.id into linked_lead from public.crm_leads l where l.id=coalesce(n.lead_id,(a.proposed_payload->>'lead_id')::uuid)
  and l.partner_id=p_partner and l.client_id=p_client and l.contact_id=n.contact_id;
 if action='request_cancellation' then
  if n.status not in ('booked','proposed') then raise exception 'This appointment is no longer eligible for cancellation' using errcode='40001'; end if;
  update public.action_jobs set booking_followup_phase='stopped',booking_followup_due_at=null,confirmation_due_at=null,booking_followup_reason='An owner requested cancellation.' where id=j.id;
  update public.action_jobs set status='cancelled',outcome_detail='Owner requested booking cancellation before this message was sent.'
   where partner_id=p_partner and client_id=p_client and payload->>'booking_approval_id'=a.id::text and status in ('pending','failed','dry_run','skipped') and external_ref is null;
  if a.proposed_payload->>'provider'='northstar_internal' then
   update public.crm_appointments set status='cancelled',updated_at=now() where id=n.id;
   message:='Appointment cancelled in the internal business calendar. Previously sent messages and external actions are unchanged.'; state:='cancelled';
  else
   select id into task_id from public.crm_tasks where partner_id=p_partner and client_id=p_client and booking_approval_id=a.id and task_type='booking_cancellation_request' and status='open' limit 1;
   if task_id is null then
    insert into public.crm_tasks(partner_id,client_id,contact_id,lead_id,booking_approval_id,title,description,status,priority,task_type,created_by)
    values(p_partner,p_client,n.contact_id,linked_lead,a.id,'Cancel appointment in the source calendar',
     'The owner requested cancellation. Open the original calendar and verify its result. No external cancellation has been performed. Old follow-ups are stopped.',
     'open','high','booking_cancellation_request',p_actor) returning id into task_id;
   end if;
   message:='Cancellation request saved for the source calendar. Old follow-ups are stopped; the external appointment has not been cancelled.'; state:='requested';
  end if;
 elsif action='recover_confirmation' then
  if n.status<>'booked' or n.start_at<=now() or j.booking_followup_phase='stopped' then raise exception 'Review the stopped or changed booking before confirming' using errcode='40001'; end if;
  update public.action_jobs set confirmation_due_at=now(),confirmation_attempts=0 where id=j.id;
  message:='Confirmation recovery saved. A current source-backed proposal will be prepared for your review; nothing was sent.'; state:='waiting';
 elsif action='prepare_reminder' then
  if n.status<>'booked' or n.start_at<=now() or j.booking_followup_phase='stopped' then raise exception 'Review the stopped or changed booking before a reminder' using errcode='40001'; end if;
  if j.receipt_recorded_at is null or not exists(select 1 from public.client_businesses b where b.id=p_client and b.partner_id=p_partner
   and b.native_lifecycle_enabled_at is not null and b.native_lifecycle_enabled_at<=j.receipt_recorded_at) then
   raise exception 'Reminders were not enabled for this booking; review lifecycle setup for future bookings' using errcode='22023';
  end if;
  update public.action_jobs set booking_followup_due_at=greatest(now(),n.start_at-interval '24 hours'),booking_followup_attempts=0,booking_followup_phase='reminder',booking_followup_reason=null where id=j.id;
  message:='Reminder preparation scheduled. It will need current source evidence and your approval when due; nothing was sent.'; state:='waiting';
 else
  -- An explicit rebooking decision may reconcile an imported cancellation.
  -- This records proved source state locally; it never cancels a provider event.
  if n.status='booked' and a.proposed_payload->>'provider'<>'northstar_internal'
   and public.reconcile_source_booking_cancellation(p_partner,p_client,a.id,p_actor) then
   select * into n from public.crm_appointments where id=n.id and partner_id=p_partner and client_id=p_client;
  end if;
  if n.status not in ('completed','cancelled') or (n.status='completed' and (n.lifecycle_completed_at is null or n.lifecycle_completed_at>now() or n.end_at>now())) then
   raise exception 'A recorded cancelled or completed appointment is required for rebooking' using errcode='40001';
  end if;
  if a.proposed_payload->>'origin'='owner_intake' then
   select * into original_work from public.agent_work_items where id::text=a.proposed_payload->>'intake_work_id' and partner_id=p_partner and client_id=p_client and kind='booking_request';
   select * into source_connection from public.integration_connections where id::text=original_work.input->>'intake_connection_id' and partner_id=p_partner and client_id=p_client for update;
   select * into r from public.integration_canonical_records where id::text=original_work.input->>'intake_record_id' and partner_id=p_partner and client_id=p_client and connection_id=source_connection.id
    and external_object_id=original_work.input->>'intake_external_id' and object_type='lead' for update;
   select * into lead from public.crm_leads where id=original_work.source_lead_id and partner_id=p_partner and client_id=p_client for update;
   select * into customer from public.crm_contacts where id=lead.contact_id and partner_id=p_partner and client_id=p_client for update;
   if original_work.id is null or r.id is null or lead.id is null or customer.id is null or customer.id<>n.contact_id
    or r.native_object_id is distinct from lead.id::text or r.canonical_data->>'deleted'='true'
    or r.updated_at is distinct from (original_work.input->>'source_updated_at')::timestamptz
    or customer.updated_at is distinct from (original_work.input->>'contact_updated_at')::timestamptz
    or lead.updated_at is distinct from (original_work.input->>'lead_updated_at')::timestamptz
    or original_work.input->>'identity_confirmed' is distinct from 'true' or original_work.input->>'booking_requested' is distinct from 'true' then
    raise exception 'Review current source identity and qualification before rebooking' using errcode='40001';
   end if;
   source_check:=public.intake_inquiry_source_check(original_work.id,true,false);
   if source_check->>'allowed' is distinct from 'true' then raise exception 'The adopted inquiry needs current owner review: %',coalesce(source_check->>'reason','Source eligibility unavailable') using errcode='40001'; end if;
   select * into settings from public.agent_team_settings where partner_id=p_partner and client_id=p_client;
   if not public.business_channel_can_draft(p_partner,p_client,'calendar',null) or not exists(select 1 from public.business_agent_activation activation where activation.partner_id=p_partner and activation.client_id=p_client and activation.status='active' and activation.bookings) then
    raise exception 'Current reviewed context and enabled scheduling authority are required for new rebooking work' using errcode='40001';
   end if;
   if exists(select 1 from public.crm_appointments where partner_id=p_partner and client_id=p_client and contact_id=customer.id and id<>n.id and status in ('booked','proposed') and end_at>now()) then
    raise exception 'Another active appointment exists; review it before rebooking' using errcode='40001';
   end if;
   insert into public.agent_work_items(partner_id,client_id,parent_id,kind,agent_key,title,dedupe_key,source_lead_id,input,summary)
   values(p_partner,p_client,original_work.id,'booking_request','scheduling','Review fresh appointment options','rebooking:'||a.id,lead.id,
    (original_work.input-array['slot','selected_slot','selection_index','offer','offered_slots','offer_expires_at'])||jsonb_build_object('rebooking_origin_approval_id',a.id,'authority_revision',settings.authority_revision),
    'The owner requested new availability after the prior recorded booking ended or was cancelled. No new appointment is booked.')
   on conflict(client_id,dedupe_key) do nothing returning id into work_id;
   if work_id is null then select id into work_id from public.agent_work_items where partner_id=p_partner and client_id=p_client and dedupe_key='rebooking:'||a.id; end if;
   message:='Rebooking assignment saved. Scheduling will offer fresh times for your review; no new appointment is booked.'; state:='assigned';
  else
   insert into public.crm_tasks(partner_id,client_id,contact_id,lead_id,booking_approval_id,title,description,status,priority,task_type,created_by)
   values(p_partner,p_client,n.contact_id,linked_lead,a.id,'Review rebooking with the customer',
    'The owner requested rebooking after the recorded prior appointment. Review the original customer conversation and current availability; no new appointment or outreach was created.',
    'open','medium','booking_rebooking_review',p_actor) returning id into task_id;
   message:='Rebooking review task saved. Continue in the original conversation and choose new availability; nothing was booked or sent.'; state:='requested';
  end if;
 end if;
 result:=jsonb_build_object('id',receipt_id,'bookingApprovalId',a.id,'message',message,'state',state,'taskId',task_id,'workId',work_id,'replayed',false);
 insert into public.business_owner_commands(id,partner_id,client_id,actor_id,request_key,command,result) values(receipt_id,p_partner,p_client,p_actor,request_id,p_command,result);
 return result;
end $$;

-- The candidate override below excludes managed appointment reminders while
-- preserving the estimate follow-up and job.completed branches.
-- Native reschedule safeguard for a future explicit command: updated_at CAS,
-- future start/end, active business windows + exact duration + existing overlap
-- exclusion constraint, native receipt/provider check; invalidate all old pinned
-- follow-ups. External reschedule remains a concrete source-app owner task.

-- Role revokes/grants are applied for every privileged function below.


-- Managed booking reminders belong to the pinned lifecycle above.
create or replace function public.native_crm_lifecycle_candidates(p_limit integer default 50)
returns table(partner_id uuid,client_id uuid,event_type text,idempotency_key text,payload jsonb)
language sql security invoker set search_path=public,pg_temp as $$
  with candidates as (
    select a.partner_id,a.client_id,a.id as record_id,'appointment.reminder_due'::text as event_type,
      a.start_at as due_at,a.contact_id,
      jsonb_build_object('appointment_id',a.id,'appointment_time',to_char(a.start_at at time zone coalesce(c.timezone,'America/New_York'),'YYYY-MM-DD HH24:MI')||' '||coalesce(c.timezone,'America/New_York'),
        'start_at',a.start_at,'end_at',a.end_at,'service_type',a.title) as details
    from public.crm_appointments a join public.client_businesses c on c.id=a.client_id and c.partner_id=a.partner_id
    where c.native_lifecycle_enabled_at is not null and c.status='active' and c.default_runtime_mode='live'
      and c.crm_operating_mode in ('primary_crm','mirror','assist') and a.created_at>=c.native_lifecycle_enabled_at
      and a.approval_id is null and a.status='booked' and a.start_at>now() and a.start_at<=now()+interval '24 hours'
    union all
    select q.partner_id,q.client_id,q.id,'estimate.follow_up_due',q.lifecycle_sent_at,q.contact_id,
      jsonb_build_object('estimate_id',q.id,'service_type',q.service_type,'low_amount',q.low_amount,'high_amount',q.high_amount)
    from public.crm_quotes q join public.client_businesses c on c.id=q.client_id and c.partner_id=q.partner_id
    where c.native_lifecycle_enabled_at is not null and c.status='active' and c.default_runtime_mode='live'
      and c.crm_operating_mode in ('primary_crm','mirror','assist') and q.created_at>=c.native_lifecycle_enabled_at
      and q.status='sent' and q.lifecycle_sent_at>=c.native_lifecycle_enabled_at and q.lifecycle_sent_at<=now()-interval '3 days'
    union all
    select a.partner_id,a.client_id,a.id,'job.completed',a.lifecycle_completed_at,a.contact_id,
      jsonb_build_object('appointment_id',a.id,'job_id',a.id,'service_type',a.title,'completed_at',a.lifecycle_completed_at)
    from public.crm_appointments a join public.client_businesses c on c.id=a.client_id and c.partner_id=a.partner_id
    where c.native_lifecycle_enabled_at is not null and c.status='active' and c.default_runtime_mode='live'
      and c.crm_operating_mode in ('primary_crm','mirror','assist') and a.created_at>=c.native_lifecycle_enabled_at
      and a.status='completed' and a.lifecycle_completed_at>=c.native_lifecycle_enabled_at
  )
  select x.partner_id,x.client_id,x.event_type,'native-crm:'||x.event_type||':'||x.record_id,
    x.details||jsonb_build_object('source','native_crm','contact_id',k.id,'name',trim(concat_ws(' ',k.first_name,k.last_name)),
      'phone',k.phone,'email',k.email)
  from candidates x join public.crm_contacts k on k.id=x.contact_id and k.client_id=x.client_id and k.partner_id=x.partner_id
  where (nullif(k.phone,'') is not null or nullif(k.email,'') is not null)
    and exists(select 1 from public.client_workflow_instances w join public.workflow_templates t on t.id=w.template_id
      where w.client_id=x.client_id and w.partner_id=x.partner_id and w.status='active' and w.runtime_mode='live'
      and x.event_type=any(t.trigger_events))
    and not exists(select 1 from public.integration_events e where e.partner_id=x.partner_id and e.client_id=x.client_id
      and e.connection_id is null and e.direction='inbound' and e.idempotency_key='native-crm:'||x.event_type||':'||x.record_id)
  order by x.due_at,x.record_id limit greatest(1,least(p_limit,100));
$$;

-- A native/provider mirror inherits only the exact approved lead/contact link.
-- Neither names nor claimed form addresses participate in this relationship.
create function public.bind_customer_journey_appointment()
returns trigger language plpgsql security invoker set search_path='' as $$
declare linked_lead uuid;
begin
 if new.approval_id is null or new.contact_id is null then return new; end if;
 select l.id into linked_lead from public.approval_items a join public.crm_leads l
  on l.id::text=a.proposed_payload->>'lead_id' and l.partner_id=a.partner_id and l.client_id=a.client_id
  where a.id=new.approval_id and a.partner_id=new.partner_id and a.client_id=new.client_id
   and a.type='appointment_booking' and l.contact_id=new.contact_id;
 if linked_lead is null then
  select c.lead_id into linked_lead from public.approval_items a join public.business_conversations c
   on c.id::text=a.proposed_payload->>'conversation_id' and c.partner_id=a.partner_id and c.client_id=a.client_id
   join public.crm_leads l on l.id=c.lead_id and l.partner_id=c.partner_id and l.client_id=c.client_id
   where a.id=new.approval_id and a.partner_id=new.partner_id and a.client_id=new.client_id
    and a.type='appointment_booking' and c.contact_id=new.contact_id and l.contact_id=new.contact_id;
 end if;
 if linked_lead is not null then
  if new.lead_id is not null and new.lead_id<>linked_lead then raise exception 'Approved lead identity changed'; end if;
  new.lead_id:=linked_lead;
 end if;
 return new;
end $$;
create trigger bind_customer_journey_appointment before insert or update of approval_id,contact_id,lead_id on public.crm_appointments
 for each row execute function public.bind_customer_journey_appointment();



-- Form scheduling uses the same leased coordinator without requiring an
-- unrelated customer conversation channel to be enabled.
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
 and (w.kind<>'booking_request' or (s.scheduling_enabled and (w.input->>'origin'='owner_intake' or s.conversations_enabled)))
 and (w.kind not in ('sales_review','lead_follow_up') or s.sales_enabled)
 and (w.kind not in ('operations_review','replenish_product') or s.operations_enabled)
 order by w.next_run_at,w.created_at for update of w skip locked limit 1;
 if selected is null then return; end if;
 return query update public.agent_work_items set status='running',claim_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',
  attempts=case when status='queued' then attempts+1 else attempts end,revision=revision+1,updated_at=now()
 where id=selected returning *;
end $$;

-- Retiring a stale pending proposal is distinct from changing a resolved human
-- decision. Keep every resolved approval immutable, including approved ones
-- whose never-sent child action was subsequently cancelled.
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
   or (old.type='appointment_booking' and old.proposed_payload->>'origin'='owner_intake' and old.proposed_payload ? 'intake_work_id')
   or (old.type='customer_message' and old.proposed_payload ? 'booking_approval_id' and
    (old.proposed_payload->>'booking_lifecycle_version'='1' or old.proposed_payload->>'draft_source'='booking_confirmation_template'))) then
  new.resolved_at:=now(); return new;
 end if;
 if new.status not in ('approved','edited_and_approved','rejected') or new.resolved_by is null then raise exception 'A human resolution is required'; end if;
 if current_user<>'service_role' and new.resolved_by is distinct from auth.uid() then raise exception 'Resolution actor does not match authenticated user'; end if;
 if new.status='approved' then new.resolved_content:=old.editable_content; end if;
 if new.status='edited_and_approved' and nullif(btrim(new.resolved_content),'') is null then raise exception 'Edited content is required'; end if;
 new.resolved_at:=now(); return new;
end $$;
alter table public.action_jobs add constraint booking_followup_phase_allowed
 check(booking_followup_phase is null or booking_followup_phase in ('reminder','done','stopped'));

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('schedule_booking_lifecycle','record_booking_followup_retry',
 'prepare_booking_lifecycle_followup','apply_booking_lifecycle_command','reconcile_source_booking_cancellation','bind_customer_journey_appointment','claim_agent_work','guard_approval_resolution','native_crm_lifecycle_candidates') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
insert into public.platform_schema_state(singleton,current_migration,applied_at)
 values(true,'20261117133444_customer_journey_lifecycle',now())
on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;
