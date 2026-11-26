-- One scoped conversation ledger, shared by departments and channel adapters.
-- Public callers never query these tables; widget reads expose sent messages only.
alter table public.agent_team_settings add column marketing_enabled boolean not null default false;
alter table public.agent_team_settings add column administration_enabled boolean not null default false;
alter table public.agent_team_settings add column conversations_enabled boolean not null default false;
alter table public.agent_team_settings add column scheduling_enabled boolean not null default false;
alter table public.agent_work_items drop constraint agent_work_items_kind_check;
alter table public.agent_work_items add constraint agent_work_items_kind_check check(kind in ('business_request','sales_review','operations_review','lead_follow_up','replenish_product','owner_briefing','conversation_reply','conversation_review','marketing_campaign','administration_review'));

create table public.business_conversations (
 id uuid primary key default gen_random_uuid(), partner_id uuid not null, client_id uuid not null,
 connection_id uuid not null references public.integration_connections(id),
 channel text not null check(channel in ('website_chat','sms','email','instagram')),
 external_thread_id text not null check(length(external_thread_id) between 1 and 500),
 contact_id uuid not null references public.crm_contacts(id), lead_id uuid references public.crm_leads(id),
 identity_status text not null default 'unverified' check(identity_status in ('unverified','owner_verified')),
 mode text not null default 'agent' check(mode in ('agent','human')),
 state text not null default 'open' check(state in ('open','waiting_approval','needs_attention','closed')),
 agent_key text not null default 'customer_service',
 summary text not null default '', next_action text not null default 'Review the customer message',
 opted_out boolean not null default false, revision integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,partner_id,client_id), unique(connection_id,channel,external_thread_id),
 foreign key(partner_id,client_id) references public.client_businesses(partner_id,id) on delete cascade
);
create index business_conversations_customer on public.business_conversations(client_id,contact_id);
create index business_conversations_attention on public.business_conversations(client_id,state,updated_at desc);
create table public.business_conversation_messages (
 id uuid primary key default gen_random_uuid(), partner_id uuid not null, client_id uuid not null,
 conversation_id uuid not null, external_key text not null check(length(external_key) between 1 and 600),
 direction text not null check(direction in ('inbound','outbound')),
 body text not null check(length(body) between 1 and 6000),
 status text not null check(status in ('received','draft','sent','failed','uncertain','dry_run','skipped')),
 approval_id uuid references public.approval_items(id), provider_ref text,
 metadata jsonb not null default '{}' check(jsonb_typeof(metadata)='object'),
 created_at timestamptz not null default now(),
 unique(conversation_id,external_key), unique(approval_id),
 foreign key(conversation_id,partner_id,client_id) references public.business_conversations(id,partner_id,client_id) on delete cascade
);
create index business_conversation_messages_date on public.business_conversation_messages(conversation_id,created_at desc);
create table public.business_conversation_events (
 id uuid primary key default gen_random_uuid(), partner_id uuid not null, client_id uuid not null,
 conversation_id uuid not null, actor_id uuid references auth.users(id), detail text not null,
 created_at timestamptz not null default now(),
 foreign key(conversation_id,partner_id,client_id) references public.business_conversations(id,partner_id,client_id) on delete cascade
);
create index business_conversation_events_date on public.business_conversation_events(conversation_id,created_at desc);
alter table public.agent_work_items add column conversation_id uuid;
alter table public.agent_work_items add constraint agent_conversation_scope foreign key(conversation_id,partner_id,client_id) references public.business_conversations(id,partner_id,client_id);
create index agent_conversation_work on public.agent_work_items(conversation_id);

do $$ declare tab text; begin
 foreach tab in array array['business_conversations','business_conversation_messages','business_conversation_events'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from anon,authenticated',tab);
  execute format('grant select on public.%I to authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
  execute format('create policy conversation_owner_read on public.%I for select to authenticated using (public.current_user_has_platform_role() or public.current_user_has_client_role(client_id,array[''client_owner'']::public.membership_role[]) or (public.current_user_has_client_role(client_id,array[''client_manager'']::public.membership_role[]) and public.current_user_client_sections(client_id,array[''settings'']) and public.current_user_client_sections(client_id,array[''marketing'']) and public.current_user_client_sections(client_id,array[''tasks'']) and public.current_user_client_sections(client_id,array[''contacts'']) and public.current_user_client_sections(client_id,array[''automations'']) and public.current_user_client_sections(client_id,array[''action-center''])))',tab);
 end loop;
end $$;

create function public.validate_business_conversation() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if not exists(select 1 from public.integration_connections where id=new.connection_id and partner_id=new.partner_id and client_id=new.client_id) then raise exception 'Connection scope mismatch'; end if;
 if not exists(select 1 from public.crm_contacts where id=new.contact_id and partner_id=new.partner_id and client_id=new.client_id) then raise exception 'Contact scope mismatch'; end if;
 if new.lead_id is not null and not exists(select 1 from public.crm_leads where id=new.lead_id and contact_id=new.contact_id and partner_id=new.partner_id and client_id=new.client_id) then raise exception 'Lead scope mismatch'; end if;
 return new;
end $$;
create trigger validate_business_conversation before insert or update on public.business_conversations for each row execute function public.validate_business_conversation();

create or replace function public.guard_approval_resolution()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status <> 'pending' then
    raise exception 'Resolved approvals are immutable';
  end if;
  if (to_jsonb(new) - array['status','resolved_by','resolved_at','resolved_content','resolution_note','updated_at'])
     is distinct from (to_jsonb(old) - array['status','resolved_by','resolved_at','resolved_content','resolution_note','updated_at']) then
    raise exception 'Only approval resolution fields may change';
  end if;
  if new.status='expired' and auth.role()='service_role' and old.proposed_payload ? 'conversation_id' and new.resolved_by is null and new.resolved_content is null then
    new.resolved_at:=now();
    return new;
  end if;
  if new.status not in ('approved','edited_and_approved','rejected') or new.resolved_by is null then
    raise exception 'A human resolution is required';
  end if;
  if auth.role() <> 'service_role' and new.resolved_by is distinct from auth.uid() then
    raise exception 'Resolution actor does not match authenticated user';
  end if;
  if new.status = 'approved' then new.resolved_content := old.editable_content; end if;
  if new.status = 'edited_and_approved' and nullif(btrim(new.resolved_content),'') is null then
    raise exception 'Edited content is required';
  end if;
  new.resolved_at := now();
  return new;
end $$;

-- Called in the same transaction as new activity or an owner control change.
create function public.invalidate_conversation_work(p_conversation uuid) returns void language plpgsql security invoker set search_path=public as $$
begin
 update public.approval_items set status='expired',resolution_note='Conversation changed. Review its current context.'
 where status='pending' and proposed_payload->>'conversation_id'=p_conversation::text;
 update public.action_jobs set status='cancelled',outcome_detail='Conversation changed before dispatch.'
 where status in ('pending','failed') and payload->>'conversation_id'=p_conversation::text;
 update public.agent_work_items set status='cancelled',summary='New activity or owner control superseded this assignment.',claim_token=null,lease_until=null,revision=revision+1,updated_at=now()
 where conversation_id=p_conversation and status not in ('completed','cancelled');
end $$;

create function public.queue_conversation_work(p_conversation uuid) returns uuid language plpgsql security invoker set search_path=public as $$
declare c public.business_conversations; w uuid;
begin
 select * into c from public.business_conversations where id=p_conversation for update;
 if not found or c.mode<>'agent' or c.opted_out or c.state='closed' then return null; end if;
 if not exists(select 1 from public.agent_team_settings s join public.client_businesses b on b.id=s.client_id and b.partner_id=s.partner_id where s.client_id=c.client_id and s.partner_id=c.partner_id and s.status='active' and s.conversations_enabled and b.status='active') then return null; end if;
 insert into public.agent_work_items(partner_id,client_id,kind,agent_key,title,dedupe_key,input,conversation_id,source_lead_id)
 values(c.partner_id,c.client_id,'conversation_reply','customer_service','Respond to '||replace(c.channel,'_',' ')||' inquiry','conversation:'||c.id||':'||c.revision,
 jsonb_build_object('conversation_revision',c.revision),c.id,c.lead_id)
 on conflict(client_id,dedupe_key) do nothing returning id into w;
 return w;
end $$;

create function public.ingest_business_message(p_partner uuid,p_client uuid,p_connection uuid,p_channel text,p_thread text,p_key text,p_body text,p_occurred_at timestamptz default now())
returns jsonb language plpgsql security invoker set search_path=public as $$
declare c public.business_conversations; customer uuid; lead uuid; mid uuid; wid uuid; other uuid;
begin
 if p_occurred_at>now()+interval '5 minutes' then raise exception 'Invalid message timestamp'; end if;
 if p_channel not in ('website_chat','sms','email','instagram') or length(btrim(p_body)) not between 1 and 6000 then raise exception 'Invalid message'; end if;
 perform 1 from public.integration_connections i join public.client_businesses b on b.id=i.client_id and b.partner_id=i.partner_id where i.id=p_connection and i.partner_id=p_partner and i.client_id=p_client and i.status in ('connected','needs_attention') and b.status='active';
 if not found then raise exception 'Connection unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_connection::text||':'||p_channel||':'||p_thread,0));
 select * into c from public.business_conversations where connection_id=p_connection and channel=p_channel and external_thread_id=p_thread for update;
 if not found then
  -- A claimed name/email must never unlock an existing customer's records.
  insert into public.crm_contacts(partner_id,client_id,first_name,phone,email,source)
  values(p_partner,p_client,case when p_channel='website_chat' then 'Website visitor' else 'New inquiry' end,case when p_channel='sms' then p_thread end,case when p_channel='email' then p_thread end,'agent_conversation') returning id into customer;
  insert into public.crm_leads(partner_id,client_id,contact_id,title,summary,next_action,source_event_type)
  values(p_partner,p_client,customer,'New '||replace(p_channel,'_',' ')||' inquiry',left(p_body,1000),'Respond to customer','conversation.received') returning id into lead;
  insert into public.business_conversations(partner_id,client_id,connection_id,channel,external_thread_id,contact_id,lead_id)
  values(p_partner,p_client,p_connection,p_channel,p_thread,customer,lead) returning * into c;
 end if;
 if exists(select 1 from public.business_conversation_messages where conversation_id=c.id and external_key=p_key) then return jsonb_build_object('id',c.id,'duplicate',true,'revision',c.revision); end if;
 if p_channel='website_chat' and (select count(*) from public.business_conversation_messages where conversation_id=c.id and direction='inbound')>=40 then raise exception 'Conversation message limit reached'; end if;
 perform public.invalidate_conversation_work(c.id);
 -- A newly arrived reply also supersedes drafts on owner-linked channels.
 if c.identity_status='owner_verified' then
  for other in select id from public.business_conversations where contact_id=c.contact_id and client_id=p_client and partner_id=p_partner and identity_status='owner_verified' and id<>c.id order by id loop
   perform public.invalidate_conversation_work(other);
   update public.business_conversations set revision=revision+1,updated_at=now() where id=other;
  end loop;
 end if;
 update public.business_conversations set revision=revision+1,state=case when mode='human' then 'needs_attention' else 'open' end,
 opted_out=opted_out or upper(btrim(p_body)) in ('STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT','DO NOT CONTACT ME'),updated_at=now() where id=c.id returning * into c;
 if c.opted_out then
  update public.crm_contacts set tags=array_append(tags,'do_not_contact'),updated_at=now() where id=c.contact_id and not ('do_not_contact'=any(tags));
  update public.business_conversations set state='needs_attention',next_action='Customer opted out. Do not send.' where id=c.id;
 end if;
 insert into public.business_conversation_messages(partner_id,client_id,conversation_id,external_key,direction,body,status,created_at)
 values(p_partner,p_client,c.id,p_key,'inbound',btrim(p_body),'received',p_occurred_at) returning id into mid;
 insert into public.crm_communications(partner_id,client_id,contact_id,lead_id,channel,direction,body,status,metadata)
 values(p_partner,p_client,c.contact_id,c.lead_id,case when p_channel='instagram' then 'internal_note' else p_channel end,'inbound',btrim(p_body),'received',jsonb_build_object('conversation_id',c.id,'conversation_message_id',mid,'source_channel',p_channel));
 update public.crm_leads set last_contact_at=now(),next_action='Review latest customer message',updated_at=now() where id=c.lead_id;
 wid:=public.queue_conversation_work(c.id);
 return jsonb_build_object('id',c.id,'duplicate',false,'revision',c.revision,'workId',wid);
end $$;

create function public.conversation_action_check(p_conversation uuid,p_revision integer,p_human boolean default false)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare c public.business_conversations;
begin
 select * into c from public.business_conversations where id=p_conversation;
 if not found or c.revision<>p_revision or c.state='closed' then return jsonb_build_object('allowed',false,'reason','Conversation changed; prepare a fresh action.'); end if;
 if c.opted_out or exists(select 1 from public.crm_contacts where id=c.contact_id and exists(select 1 from unnest(tags) tag where lower(regexp_replace(tag,'[ -]','_','g')) in ('do_not_contact','opt_out','opted_out','unsubscribed','stop'))) then return jsonb_build_object('allowed',false,'reason','Customer opted out.'); end if;
 if not p_human and (c.mode<>'agent' or not exists(select 1 from public.agent_team_settings s where s.client_id=c.client_id and s.partner_id=c.partner_id and s.status='active' and s.conversations_enabled)) then return jsonb_build_object('allowed',false,'reason','Agent responses are paused.'); end if;
 if not exists(select 1 from public.integration_connections i join public.client_businesses b on b.id=i.client_id and b.partner_id=i.partner_id where i.id=c.connection_id and i.partner_id=c.partner_id and i.client_id=c.client_id and i.status in ('connected','needs_attention') and b.status='active') then return jsonb_build_object('allowed',false,'reason','Connection or business is inactive.'); end if;
 return jsonb_build_object('allowed',true);
end $$;

create function public.control_business_conversation(p_partner uuid,p_client uuid,p_id uuid,p_revision integer,p_action text,p_actor uuid,p_contact uuid default null,p_reason text default '')
returns void language plpgsql security invoker set search_path=public as $$
declare c public.business_conversations;
begin
 select * into c from public.business_conversations where id=p_id and partner_id=p_partner and client_id=p_client for update;
 if not found or c.revision<>p_revision then raise exception 'Conversation changed; refresh first'; end if;
 if p_action not in ('takeover','resume','close','link','retry') then raise exception 'Unsupported action'; end if;
 if p_action='link' and (length(btrim(p_reason))<8 or not exists(select 1 from public.crm_contacts where id=p_contact and partner_id=p_partner and client_id=p_client)) then raise exception 'Verify a contact and record how you verified it'; end if;
 perform public.invalidate_conversation_work(c.id);
 if p_action='link' then
  update public.crm_leads set contact_id=p_contact,updated_at=now() where id=c.lead_id and partner_id=p_partner and client_id=p_client;
  update public.crm_communications set contact_id=p_contact where partner_id=p_partner and client_id=p_client and metadata->>'conversation_id'=c.id::text;
 end if;
 update public.business_conversations set revision=revision+1,updated_at=now(),
 mode=case when p_action='takeover' then 'human' when p_action='resume' then 'agent' else mode end,
 state=case when p_action='close' then 'closed' when p_action='takeover' then 'needs_attention' else 'open' end,
 contact_id=case when p_action='link' then p_contact else contact_id end,
 lead_id=lead_id,
 identity_status=case when p_action='link' then 'owner_verified' else identity_status end
 where id=c.id;
 insert into public.business_conversation_events(partner_id,client_id,conversation_id,actor_id,detail) values(p_partner,p_client,c.id,p_actor,p_action||case when p_action='link' then ': '||p_reason else '' end);
 if p_action in ('resume','retry','link') then perform public.queue_conversation_work(c.id); end if;
end $$;

create function public.propose_conversation_action(p_partner uuid,p_client uuid,p_id uuid,p_revision integer,p_kind text,p_body text,p_metadata jsonb default '{}',p_work uuid default null,p_claim uuid default null,p_actor uuid default null)
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
  if c.identity_status<>'owner_verified' or not exists(select 1 from public.agent_team_settings where client_id=p_client and scheduling_enabled) then raise exception 'Verify customer identity and enable scheduling first'; end if;
  if not exists(select 1 from public.business_conversation_messages where conversation_id=c.id and direction='outbound' and status='sent' and created_at>now()-interval '1 day' and metadata->'slots' @> jsonb_build_array(p_metadata->'slot')) then raise exception 'Select a recently offered calendar slot'; end if;
  select * into customer from public.crm_contacts where id=c.contact_id;
  payload:=payload || jsonb_build_object('slot',p_metadata->'slot','provider',p_metadata->>'provider','timezone',p_metadata->>'timezone','contact',jsonb_build_object('name',concat_ws(' ',customer.first_name,customer.last_name),'email',customer.email,'phone',customer.phone),'contact_id',customer.id);
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

-- Local website delivery uses the SAME approval outbox as external channels.
alter table public.action_jobs drop constraint action_jobs_kind_check;
alter table public.action_jobs add constraint action_jobs_kind_check check(kind in ('sms.send','email.send','calendar.book','crm.sync','external.action','conversation.send'));
create function public.complete_conversation_message(p_approval uuid,p_status text,p_body text,p_ref text default null)
returns void language plpgsql security invoker set search_path=public as $$
declare a public.approval_items; c public.business_conversations; safety jsonb;
begin
 select * into a from public.approval_items where id=p_approval;
 select * into c from public.business_conversations where id=(a.proposed_payload->>'conversation_id')::uuid and partner_id=a.partner_id and client_id=a.client_id for update;
 if not found or a.status not in ('approved','edited_and_approved') or a.type<>'customer_message' then raise exception 'Approved conversation message unavailable'; end if;
 if p_status not in ('sent','failed','uncertain','dry_run','skipped') then raise exception 'Invalid outcome'; end if;
 if c.channel='website_chat' and p_status='sent' then
  safety:=public.conversation_action_check(c.id,(a.proposed_payload->>'conversation_revision')::integer,coalesce((a.proposed_payload->>'human_authored')::boolean,false));
  if not (safety->>'allowed')::boolean then raise exception 'Conversation changed before delivery'; end if;
 end if;
 update public.business_conversation_messages set status=p_status,body=a.resolved_content,provider_ref=p_ref,metadata=case when a.status='edited_and_approved' then metadata-'slots' else metadata end where approval_id=a.id and partner_id=c.partner_id and client_id=c.client_id and status<>'sent';
 update public.crm_communications set status=case when p_status='sent' then 'sent' when p_status in ('failed','uncertain') then 'failed' else 'approved' end,body=a.resolved_content,human_approved=true,provider_ref=p_ref where approval_id=a.id and client_id=c.client_id and partner_id=c.partner_id;
 if not exists(select 1 from public.crm_timeline_entries where ref_approval_id=a.id and partner_id=c.partner_id and client_id=c.client_id and kind='message') then
  insert into public.crm_timeline_entries(partner_id,client_id,contact_id,lead_id,kind,actor_type,title,body,ref_approval_id)
  values(c.partner_id,c.client_id,c.contact_id,c.lead_id,'message',case when coalesce((a.proposed_payload->>'human_authored')::boolean,false) then 'user' else 'ai_assistant' end,'Approved '||replace(c.channel,'_',' ')||' reply: '||p_status,a.resolved_content,a.id);
 end if;
 if p_status='sent' then update public.crm_leads set last_contact_at=now(),next_action='Waiting for customer response',updated_at=now() where id=c.lead_id and partner_id=c.partner_id and client_id=c.client_id; end if;
 update public.business_conversations set state=case when p_status='sent' then 'open' else 'needs_attention' end,
 next_action=case when p_status='sent' then 'Waiting for customer response' else 'Review delivery outcome: '||p_status end,updated_at=now()
 where id=c.id and revision=(a.proposed_payload->>'conversation_revision')::integer;
end $$;

create function public.confirm_conversation_booking(p_approval uuid) returns void language plpgsql security invoker set search_path=public as $$
declare a public.approval_items; c public.business_conversations; reply uuid; body text; payload jsonb;
begin
 select * into a from public.approval_items where id=p_approval and type='appointment_booking' and status in ('approved','edited_and_approved');
 if not found then raise exception 'Approved booking unavailable'; end if;
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

create function public.save_agent_business_output(p_work uuid,p_claim uuid,p_title text,p_body text,p_data jsonb) returns uuid language plpgsql security invoker set search_path=public as $$
declare w public.agent_work_items; r uuid; marketing boolean;
begin
 select * into w from public.agent_work_items where id=p_work and claim_token=p_claim and status='running' and lease_until>now() for update;
 if not found or w.kind not in ('marketing_campaign','administration_review') then raise exception 'Assignment unavailable'; end if;
 marketing:=w.kind='marketing_campaign';
 if not exists(select 1 from public.agent_team_settings where client_id=w.client_id and partner_id=w.partner_id and status='active' and case when marketing then marketing_enabled else administration_enabled end) then raise exception 'Department paused'; end if;
 r:=public.create_business_record(w.partner_id,w.client_id,null,case when marketing then 'campaign' else 'brief' end,p_title,p_body,p_data,'agent-output:'||w.id,null);
 if marketing then update public.business_records set status='needs_approval',revision=revision+1 where id=r and status='draft'; end if;
 update public.agent_work_items set result_record_id=r,status=case when marketing then 'waiting_approval' else 'completed' end,summary=case when marketing then 'Campaign prepared for owner approval and publishing handoff.' else 'Reviewed open jobs, tasks, and upcoming appointments. See the saved operations brief.' end,claim_token=null,lease_until=null,revision=revision+1,next_run_at=now()+interval '1 minute',updated_at=now() where id=w.id;
 return r;
end $$;
revoke all on function public.save_agent_business_output(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_agent_business_output(uuid,uuid,text,text,jsonb) to service_role;

create or replace function public.create_agent_work(p_partner uuid,p_client uuid,p_kind text,p_title text,p_key text,p_input jsonb default '{}',p_parent uuid default null,p_lead uuid default null,p_record uuid default null)
returns uuid language plpgsql security invoker set search_path=public as $$
declare result_id uuid; assigned text;
begin
 if not exists(select 1 from public.agent_team_settings where partner_id=p_partner and client_id=p_client and status='active') then raise exception 'Activate the agent team first'; end if;
 if p_parent is not null then
  perform 1 from public.agent_work_items where id=p_parent and partner_id=p_partner and client_id=p_client and status='running' for update;
  if not found then raise exception 'Parent assignment is no longer running'; end if;
 end if;
 assigned:=case p_kind when 'marketing_campaign' then 'marketing' when 'administration_review' then 'administration' when 'conversation_review' then 'executive' when 'business_request' then 'executive' when 'owner_briefing' then 'executive' when 'sales_review' then 'sales_manager' when 'lead_follow_up' then 'sales_followup' when 'operations_review' then 'operations_manager' when 'replenish_product' then 'purchasing' end;
 if assigned is null then raise exception 'Unsupported agent task'; end if;
 insert into public.agent_work_items(partner_id,client_id,parent_id,kind,agent_key,title,dedupe_key,input,source_lead_id,source_record_id)
 values(p_partner,p_client,p_parent,p_kind,assigned,p_title,p_key,p_input,p_lead,p_record)
 on conflict(client_id,dedupe_key) do nothing returning id into result_id;
 if result_id is null then select id into result_id from public.agent_work_items where client_id=p_client and partner_id=p_partner and dedupe_key=p_key; end if;
 return result_id;
end $$;

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
 and (w.kind not in ('conversation_reply','conversation_review') or s.conversations_enabled)
 and (w.kind not in ('sales_review','lead_follow_up') or s.sales_enabled)
 and (w.kind not in ('operations_review','replenish_product') or s.operations_enabled)
 order by w.next_run_at,w.created_at for update of w skip locked limit 1;
 if selected is null then return; end if;
 return query update public.agent_work_items set status='running',claim_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',
 attempts=case when status='queued' then attempts+1 else attempts end,revision=revision+1,updated_at=now()
 where id=selected returning *;
end $$;

create or replace function public.delegate_agent_work(p_work uuid,p_claim uuid,p_children jsonb,p_summary text,p_result jsonb default '{}')
returns boolean language plpgsql security invoker set search_path=public as $$
declare w public.agent_work_items; child jsonb; child_id uuid; ids jsonb := '[]';
begin
 select * into w from public.agent_work_items where id=p_work for update;
 if not found or w.status<>'running' or w.claim_token is distinct from p_claim or w.lease_until<now() then raise exception 'Assignment lease expired'; end if;
 if jsonb_typeof(p_children)<>'array' or jsonb_array_length(p_children)>20 then raise exception 'Invalid delegation'; end if;
 for child in select value from jsonb_array_elements(p_children) loop
  if not ((w.kind='business_request' and child->>'kind' in ('sales_review','operations_review','owner_briefing','conversation_review','marketing_campaign','administration_review')) or (w.kind='sales_review' and child->>'kind'='lead_follow_up') or (w.kind='operations_review' and child->>'kind'='replenish_product')) then raise exception 'Unsupported delegation'; end if;
  child_id:=public.create_agent_work(w.partner_id,w.client_id,child->>'kind',child->>'title',child->>'key',coalesce(child->'input','{}'),w.id,(child->>'leadId')::uuid,(child->>'recordId')::uuid);
  ids:=ids||jsonb_build_array(child_id);
 end loop;
 if not public.finish_agent_work(w.id,p_claim,case when jsonb_array_length(ids)>0 then 'waiting_children' else 'completed' end,p_summary,p_result||jsonb_build_object('child_ids',ids)) then raise exception 'Delegation lost its lease'; end if;
 return true;
end $$;

create or replace function public.enqueue_approved_action()
returns trigger language plpgsql security definer set search_path = public as $$
declare action_kind text; action_payload jsonb;
begin
  if new.status not in ('approved','edited_and_approved') then return new; end if;
  if new.type = 'customer_message' and nullif(btrim(new.resolved_content),'') is not null
     and new.proposed_payload->>'channel' in ('sms','email','website_chat','instagram') then
    action_kind := case when new.proposed_payload->>'channel' in ('website_chat','instagram') then 'conversation.send' when new.proposed_payload->>'channel' = 'email' then 'email.send' else 'sms.send' end;
    action_payload := coalesce(new.proposed_payload,'{}'::jsonb) || jsonb_build_object('body',new.resolved_content);
  elsif new.type = 'appointment_booking' then
    action_kind := 'calendar.book'; action_payload := coalesce(new.proposed_payload,'{}'::jsonb);
  elsif new.type = 'external_action' and new.embedded_binding_id is not null then
    action_kind := 'external.action'; action_payload := coalesce(new.proposed_payload,'{}'::jsonb);
  else return new; end if;
  insert into public.action_jobs(partner_id,client_id,approval_id,workflow_run_id,kind,payload,status,execution_key)
  values(new.partner_id,new.client_id,new.id,new.workflow_run_id,action_kind,action_payload,'pending','approval:'||new.id)
  on conflict(execution_key) do nothing;
  return new;
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('validate_business_conversation','invalidate_conversation_work','queue_conversation_work','ingest_business_message','conversation_action_check','control_business_conversation','propose_conversation_action','complete_conversation_message','confirm_conversation_booking') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
insert into public.platform_schema_state(singleton,current_migration,applied_at)
values(true,'20261008131741_shared_customer_team',now())
on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;

insert into public.integration_providers(provider_key,display_name,category,supports_inbound,supports_outbound,supports_api_key,auth_strategy,capabilities,connector_status,description,is_requestable)
values('instagram_messaging','Instagram messages','messaging',true,true,true,'api_key',array['message.create','message.webhook'],'restricted','Signed DMs and approved replies. Meta permission and live verification required.',false)
on conflict(provider_key) do nothing;

create or replace function public.book_internal_approved_appointment(p_approval_id uuid)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.approval_items; result_id uuid; contact_id uuid; slot_start timestamptz; slot_end timestamptz; business_tz text;
begin
  select * into a from public.approval_items where id=p_approval_id for update;
  if not found or a.type<>'appointment_booking' or a.status not in ('approved','edited_and_approved')
    or a.proposed_payload->>'provider' is distinct from 'northstar_internal' or coalesce((a.proposed_payload->>'scenario_lab')::boolean,false) then
    raise exception 'A human-approved internal booking is required';
  end if;
  select id into result_id from public.crm_appointments where approval_id=a.id;
  if result_id is not null then return result_id; end if;
  if not exists(select 1 from public.client_businesses where id=a.client_id and partner_id=a.partner_id
    and crm_operating_mode in ('primary_crm','mirror','assist')) then raise exception 'The internal business calendar is not enabled'; end if;
  slot_start=(a.proposed_payload->'slot'->>'start_iso')::timestamptz;
  slot_end=(a.proposed_payload->'slot'->>'end_iso')::timestamptz;
  if slot_start is null or slot_end is null or slot_start<=now() or slot_end<=slot_start then raise exception 'The approved appointment time is invalid or has passed'; end if;
  select timezone into business_tz from public.client_businesses where id=a.client_id;
  if exists(select 1 from public.crm_availability_windows where client_id=a.client_id and active) and not exists(
    select 1 from public.crm_availability_windows where client_id=a.client_id and active
      and weekday=extract(dow from slot_start at time zone coalesce(business_tz,'America/New_York'))
      and (slot_start at time zone coalesce(business_tz,'America/New_York'))::date=(slot_end at time zone coalesce(business_tz,'America/New_York'))::date
      and (slot_start at time zone coalesce(business_tz,'America/New_York'))::time>=start_time
      and (slot_end at time zone coalesce(business_tz,'America/New_York'))::time<=end_time
      and extract(epoch from slot_end-slot_start)/60=appointment_minutes
  ) then raise exception 'The approved time no longer fits business availability'; end if;
  if a.proposed_payload ? 'contact_id' then
    select id into contact_id from public.crm_contacts where id=(a.proposed_payload->>'contact_id')::uuid and partner_id=a.partner_id and client_id=a.client_id;
    if not found then raise exception 'Approved customer record is unavailable'; end if;
  else
  select id into contact_id from public.crm_contacts where client_id=a.client_id and partner_id=a.partner_id
    and ((email is not null and lower(email)=lower(a.proposed_payload->'contact'->>'email'))
      or (phone is not null and phone=a.proposed_payload->'contact'->>'phone')) limit 1;
  end if;
  insert into public.crm_appointments(partner_id,client_id,contact_id,title,start_at,end_at,status,external_ref,approval_id)
    values(a.partner_id,a.client_id,contact_id,'Appointment',slot_start,slot_end,'booked','northstar-'||a.id,a.id) returning id into result_id;
  insert into public.crm_timeline_entries(partner_id,client_id,contact_id,kind,actor_type,title,ref_run_id,ref_approval_id)
    values(a.partner_id,a.client_id,contact_id,'appointment','ai_assistant','Appointment booked after human approval',a.workflow_run_id,a.id);
  return result_id;
end;
$$;


create function public.apply_conversation_decision(p_work uuid,p_claim uuid,p_revision integer,p_department text,p_summary text,p_next text,p_claims jsonb)
returns void language plpgsql security invoker set search_path=public as $$
declare w public.agent_work_items; c public.business_conversations;
begin
 select * into w from public.agent_work_items where id=p_work;
 if not found then raise exception 'Assignment unavailable'; end if;
 select * into c from public.business_conversations where id=w.conversation_id and partner_id=w.partner_id and client_id=w.client_id for update;
 perform 1 from public.agent_work_items where id=p_work and claim_token=p_claim and status='running' and lease_until>now() for update;
 if not found or c.revision<>p_revision or c.mode<>'agent' then raise exception 'Conversation changed'; end if;
 if p_department not in ('sales_assistant','customer_service','scheduling') then raise exception 'Unsupported department'; end if;
 update public.business_conversations set agent_key=p_department,summary=left(p_summary,1000),next_action=left(p_next,500) where id=c.id;
 update public.agent_work_items set agent_key=p_department where id=w.id;
 -- Claims enrich this new contact only. They never match or unlock an existing
 -- identity. Owner-verified contacts are not overwritten by customer text.
 if c.identity_status='unverified' then
  update public.crm_contacts set first_name=coalesce(nullif(btrim(p_claims->>'name'),''),first_name),
    email=case when c.channel='website_chat' then coalesce(nullif(btrim(p_claims->>'email'),''),email) else email end,
    phone=case when c.channel='website_chat' then coalesce(nullif(btrim(p_claims->>'phone'),''),phone) else phone end,updated_at=now()
  where id=c.contact_id and partner_id=c.partner_id and client_id=c.client_id and source='agent_conversation';
 end if;
 update public.crm_leads set summary=left(p_summary,1000),next_action=left(p_next,500),updated_at=now() where id=c.lead_id and partner_id=c.partner_id and client_id=c.client_id;
end $$;
revoke all on function public.apply_conversation_decision(uuid,uuid,integer,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.apply_conversation_decision(uuid,uuid,integer,text,text,text,jsonb) to service_role;
