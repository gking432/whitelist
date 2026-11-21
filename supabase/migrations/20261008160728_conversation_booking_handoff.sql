-- A customer conversation retains its owner while scheduling receives a
-- bounded, durable assignment with the exact offer and customer context.
alter table public.agent_work_items drop constraint agent_work_items_kind_check;
alter table public.agent_work_items add constraint agent_work_items_kind_check
check (kind in ('business_request','sales_review','operations_review','lead_follow_up',
 'replenish_product','owner_briefing','conversation_reply','conversation_review',
 'marketing_campaign','administration_review','booking_request'));

create or replace function public.delegate_conversation_booking(
 p_work uuid, p_claim uuid, p_offer uuid, p_slot_index integer
) returns uuid language plpgsql security invoker set search_path=public as $$
declare w public.agent_work_items; c public.business_conversations;
 offer public.business_conversation_messages; chosen jsonb; child uuid; calendar uuid; provider text;
begin
 -- Match intake's lock order: conversation, then assignments.
 select * into w from public.agent_work_items where id=p_work;
 select * into c from public.business_conversations where id=w.conversation_id for update;
 select * into w from public.agent_work_items where id=p_work for update;
 if w.id is null or c.id is null or w.kind<>'conversation_reply' or
    w.partner_id<>c.partner_id or w.client_id<>c.client_id or
    w.status<>'running' or w.claim_token is distinct from p_claim or w.lease_until<=now() or
    (w.input->>'conversation_revision')::integer<>c.revision then
  raise exception 'Conversation assignment changed';
 end if;
 if not (public.conversation_action_check(c.id,c.revision)->>'allowed')::boolean then
  raise exception 'Conversation is no longer eligible';
 end if;
 if c.identity_status<>'owner_verified' or not exists(select 1 from public.agent_team_settings
    where partner_id=c.partner_id and client_id=c.client_id and scheduling_enabled) then
  raise exception 'Verify the customer and enable scheduling';
 end if;
 select * into offer from public.business_conversation_messages
 where id=p_offer and conversation_id=c.id and client_id=c.client_id and partner_id=c.partner_id
   and direction='outbound' and status='sent' and created_at>now()-interval '1 day'
   and jsonb_typeof(metadata->'slots')='array';
 if not found or p_slot_index is null or p_slot_index<1 or p_slot_index>jsonb_array_length(offer.metadata->'slots') then
  raise exception 'Choose a recently sent appointment option';
 end if;
 if exists(select 1 from public.business_conversation_messages where conversation_id=c.id
   and direction='outbound' and status='sent' and metadata ? 'slots' and created_at>offer.created_at) then
  raise exception 'A newer availability offer superseded these times';
 end if;
 chosen:=offer.metadata->'slots'->(p_slot_index-1);
 if (chosen->>'start_iso')::timestamptz<=now() or
    (chosen->>'end_iso')::timestamptz<=(chosen->>'start_iso')::timestamptz then
  raise exception 'The selected time has passed or is invalid';
 end if;
 provider:=offer.metadata->>'provider';
 calendar:=(offer.metadata->>'calendar_connection_id')::uuid;
 if provider is null or provider not in ('northstar_internal','google_calendar','google_workspace','microsoft_365') then
  raise exception 'Unsupported calendar';
 end if;
 if provider<>'northstar_internal' and (calendar is null or not exists(
   select 1 from public.integration_connections i join public.integration_providers p on p.id=i.provider_id
   where i.id=calendar and i.partner_id=c.partner_id and i.client_id=c.client_id
     and i.status in ('connected','needs_attention') and p.provider_key=provider
 )) then raise exception 'The offered calendar is no longer connected'; end if;
 if exists(select 1 from public.approval_items where client_id=c.client_id and partner_id=c.partner_id
   and status='pending' and proposed_payload->>'conversation_id'=c.id::text) or
   exists(select 1 from public.action_jobs where client_id=c.client_id and partner_id=c.partner_id
   and status in ('pending','processing','uncertain') and payload->>'conversation_id'=c.id::text) then
  raise exception 'Resolve the current action before assigning another booking';
 end if;
 insert into public.agent_work_items(partner_id,client_id,parent_id,kind,agent_key,title,dedupe_key,
   conversation_id,source_lead_id,input,summary)
 values(c.partner_id,c.client_id,w.id,'booking_request','scheduling','Book the customer’s selected appointment',
   'booking-handoff:'||w.id,c.id,c.lead_id,jsonb_build_object(
     'conversation_revision',c.revision,'contact_id',c.contact_id,'originating_agent',w.agent_key,
     'offer_message_id',offer.id,'slot',chosen,'provider',provider,'calendar_connection_id',calendar,
     'timezone',offer.metadata->>'timezone','customer_request',c.summary,
     'service',(select service_type from public.crm_leads where id=c.lead_id)),
   'Received the selected time and customer context from '||replace(w.agent_key,'_',' ')||'.')
 on conflict(client_id,dedupe_key) do nothing returning id into child;
 if child is null then select id into child from public.agent_work_items
   where client_id=c.client_id and parent_id=w.id and dedupe_key='booking-handoff:'||w.id; end if;
 if not public.finish_agent_work(w.id,p_claim,'waiting_children',
   'Scheduling is handling the selected appointment; the conversation stays here.',
   jsonb_build_object('booking_work_id',child,'child_ids',jsonb_build_array(child))) then
  raise exception 'Assignment lease changed';
 end if;
 update public.business_conversations set next_action='Scheduling is checking the selected appointment',updated_at=now() where id=c.id;
 insert into public.business_conversation_events(partner_id,client_id,conversation_id,detail)
 values(c.partner_id,c.client_id,c.id,'Scheduling received a booking assignment from '||replace(w.agent_key,'_',' ')||'. The customer stays in this conversation.');
 return child;
end $$;
revoke all on function public.delegate_conversation_booking(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.delegate_conversation_booking(uuid,uuid,uuid,integer) to service_role;

-- Wake the original conversation promptly when its scheduling specialist changes state.
create or replace function public.wake_booking_conversation() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if new.kind='booking_request' and new.parent_id is not null and new.status is distinct from old.status then
  update public.agent_work_items set next_run_at=now()
  where id=new.parent_id and partner_id=new.partner_id and client_id=new.client_id and status='waiting_children';
 end if;
 return new;
end $$;
revoke all on function public.wake_booking_conversation() from public,anon,authenticated;
grant execute on function public.wake_booking_conversation() to service_role;
drop trigger if exists wake_booking_conversation on public.agent_work_items;
create trigger wake_booking_conversation after update of status on public.agent_work_items
for each row execute function public.wake_booking_conversation();

create or replace function public.claim_agent_work(p_partner uuid default null,p_client uuid default null)
returns setof public.agent_work_items language plpgsql security invoker set search_path=public as $$
declare selected uuid;
begin
 -- This worker only proposes internal effects. Committed proposal links and stable
 -- request keys make recovery safe; external effects stay in the existing outbox.
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
 and (w.kind not in ('conversation_reply','conversation_review','booking_request') or s.conversations_enabled)
 and (w.kind not in ('sales_review','lead_follow_up') or s.sales_enabled)
 and (w.kind not in ('operations_review','replenish_product') or s.operations_enabled)
 order by w.next_run_at,w.created_at for update of w skip locked limit 1;
 if selected is null then return; end if;
 return query update public.agent_work_items set status='running',claim_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',
 attempts=case when status='queued' then attempts+1 else attempts end,revision=revision+1,updated_at=now()
 where id=selected returning *;
end $$;

create or replace function public.propose_conversation_action(p_partner uuid,p_client uuid,p_id uuid,p_revision integer,p_kind text,p_body text,p_metadata jsonb default '{}',p_work uuid default null,p_claim uuid default null,p_actor uuid default null)
returns uuid language plpgsql security invoker set search_path=public as $$
declare c public.business_conversations; w public.agent_work_items; a uuid; safety jsonb; payload jsonb; customer public.crm_contacts;
begin
 select * into c from public.business_conversations where id=p_id and partner_id=p_partner and client_id=p_client for update;
 if not found then raise exception 'Conversation unavailable'; end if;
 if p_kind not in ('reply','booking') or length(btrim(p_body)) not between 1 and 5000 then raise exception 'Invalid action'; end if;
 safety:=public.conversation_action_check(c.id,p_revision,p_actor is not null);
 if not (safety->>'allowed')::boolean then raise exception 'Conversation is no longer eligible'; end if;
 if p_work is not null then
  select * into w from public.agent_work_items where id=p_work and conversation_id=c.id and partner_id=p_partner and client_id=p_client and claim_token=p_claim and status='running' and lease_until>now() for update;
  if not found or (w.input->>'conversation_revision')::integer<>p_revision then raise exception 'Assignment lease or context changed'; end if;
 elsif p_actor is null then raise exception 'An owner or agent assignment is required'; end if;
 if exists(select 1 from public.approval_items where partner_id=p_partner and client_id=p_client and status='pending' and proposed_payload->>'conversation_id'=c.id::text) then raise exception 'Review the existing approval first'; end if;
 if exists(select 1 from public.action_jobs j where j.partner_id=p_partner and j.client_id=p_client and j.payload->>'conversation_id'=c.id::text and j.status in ('pending','processing','uncertain')) then raise exception 'Reconcile the existing action before preparing another'; end if;
 if p_actor is not null then
  perform public.invalidate_conversation_work(c.id);
  update public.business_conversations set mode='human' where id=c.id;
 end if;

 payload:=jsonb_build_object('conversation_id',c.id,'conversation_revision',c.revision,'connection_id',c.connection_id,'channel',c.channel,'to',c.external_thread_id,'agent_work_id',p_work,'human_authored',p_actor is not null,'subject','Regarding your inquiry');
 if p_kind='booking' then
  if p_actor is null and (w.kind<>'booking_request' or w.agent_key<>'scheduling' or w.parent_id is null) then raise exception 'Scheduling must own the booking assignment'; end if;
  if p_actor is null and (w.input->'slot' is distinct from p_metadata->'slot' or w.input->>'provider' is distinct from p_metadata->>'provider' or w.input->>'calendar_connection_id' is distinct from p_metadata->>'calendar_connection_id' or w.input->>'contact_id' is distinct from c.contact_id::text) then raise exception 'Booking handoff context changed'; end if;
  if c.identity_status<>'owner_verified' or not exists(select 1 from public.agent_team_settings where client_id=p_client and scheduling_enabled) then raise exception 'Verify customer identity and enable scheduling first'; end if;
  if not exists(select 1 from public.business_conversation_messages where conversation_id=c.id and direction='outbound' and status='sent' and created_at>now()-interval '1 day' and metadata->'slots' @> jsonb_build_array(p_metadata->'slot')) then raise exception 'Select a recently offered calendar slot'; end if;
  select * into customer from public.crm_contacts where id=c.contact_id;
  payload:=payload || jsonb_build_object('slot',p_metadata->'slot','provider',p_metadata->>'provider','timezone',p_metadata->>'timezone','calendar_connection_id',p_metadata->>'calendar_connection_id','booking_handoff_id',case when p_actor is null then w.id else null end,'contact',jsonb_build_object('name',concat_ws(' ',customer.first_name,customer.last_name),'email',customer.email,'phone',customer.phone),'contact_id',customer.id);
 end if;
 insert into public.approval_items(partner_id,client_id,type,status,title,summary,risk_level,proposed_payload,editable_content,expires_at)
 values(p_partner,p_client,case when p_kind='booking' then 'appointment_booking' else 'customer_message' end,'pending',
 case when p_kind='booking' then 'Book requested appointment' else 'Reply to '||replace(c.channel,'_',' ')||' inquiry' end,
 case when p_kind='booking' then p_body else 'Send this reply on the customer’s original channel. A new reply or owner takeover invalidates this draft.' end,
 case when p_kind='booking' then 'high' else 'medium' end,payload,case when p_kind='reply' then p_body end,now()+interval '1 day') returning id into a;
 if p_kind='reply' then
  insert into public.business_conversation_messages(partner_id,client_id,conversation_id,external_key,direction,body,status,approval_id,metadata)
  values(p_partner,p_client,c.id,'approval:'||a,'outbound',p_body,'draft',a,p_metadata);
  insert into public.crm_communications(partner_id,client_id,contact_id,lead_id,channel,direction,body,status,approval_id,ai_generated,metadata)
  values(p_partner,p_client,c.contact_id,c.lead_id,case when c.channel='instagram' then 'internal_note' else c.channel end,'outbound',p_body,'draft',a,p_actor is null,jsonb_build_object('conversation_id',c.id));
 end if;
 update public.business_conversations set state='waiting_approval',next_action=case when p_kind='booking' then 'Approve the requested booking' else 'Review the prepared reply' end,updated_at=now() where id=c.id;
 if p_work is not null then
  update public.agent_work_items set approval_id=a,status='waiting_approval',summary='Prepared action is awaiting owner approval.',claim_token=null,lease_until=null,next_run_at=now()+interval '30 seconds',revision=revision+1,updated_at=now() where id=p_work;
 end if;
 return a;
end $$;

create or replace function public.confirm_conversation_booking(p_approval uuid) returns void language plpgsql security invoker set search_path=public as $$
declare a public.approval_items; c public.business_conversations; reply uuid; body text; payload jsonb;
begin
 select * into a from public.approval_items where id=p_approval and type='appointment_booking' and status in ('approved','edited_and_approved');
 if not found then raise exception 'Approved booking unavailable'; end if;
 if not exists(select 1 from public.crm_appointments where approval_id=a.id and partner_id=a.partner_id and client_id=a.client_id and status in ('booked','confirmed')) then raise exception 'A completed booking receipt is required before confirmation'; end if;
 select * into c from public.business_conversations where id=(a.proposed_payload->>'conversation_id')::uuid and client_id=a.client_id and partner_id=a.partner_id for update;
 if not found then raise exception 'Conversation unavailable'; end if;
 if exists(select 1 from public.approval_items where client_id=c.client_id and partner_id=c.partner_id and proposed_payload->>'booking_approval_id'=a.id::text) then return; end if;
 if c.revision<>(a.proposed_payload->>'conversation_revision')::integer then
  insert into public.business_conversation_events(partner_id,client_id,conversation_id,detail) values(c.partner_id,c.client_id,c.id,'Booking completed after conversation changed. Owner must review confirmation.');
  return;
 end if;
 body:='Your appointment is confirmed for '||(a.proposed_payload->'slot'->>'label')||'.';
 payload:=a.proposed_payload - 'slot' - 'provider' - 'contact' - 'agent_work_id' || jsonb_build_object('booking_approval_id',a.id,'subject','Appointment confirmation');
 insert into public.approval_items(partner_id,client_id,type,status,title,summary,risk_level,proposed_payload,editable_content,expires_at)
 values(c.partner_id,c.client_id,'customer_message','pending','Confirm completed booking','The calendar booking succeeded. Approve this confirmation on the original channel.','low',payload,body,now()+interval '1 day') returning id into reply;
 insert into public.business_conversation_messages(partner_id,client_id,conversation_id,external_key,direction,body,status,approval_id)
 values(c.partner_id,c.client_id,c.id,'approval:'||reply,'outbound',body,'draft',reply);
 insert into public.crm_communications(partner_id,client_id,contact_id,channel,direction,body,status,approval_id)
 values(c.partner_id,c.client_id,c.contact_id,case when c.channel='instagram' then 'internal_note' else c.channel end,'outbound',body,'draft',reply);
 update public.business_conversations set state='waiting_approval',next_action='Approve the booking confirmation',updated_at=now() where id=c.id;
end $$;

insert into public.platform_schema_state(singleton,current_migration,applied_at)
values(true,'20261008160728_conversation_booking_handoff',now())
on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;
