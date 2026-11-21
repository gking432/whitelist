-- Reviewed context and direct owner controls share the existing team/outbox.
-- No browser mutation grants; authenticated server APIs supply the scoped actor.
alter table public.agent_team_settings
 add column authority_revision integer not null default 0 check(authority_revision >= 0),
 add column channel_authority jsonb not null default '{}' check(jsonb_typeof(channel_authority)='object');

create table public.business_context_reviews (
 client_id uuid primary key, partner_id uuid not null, profile_revision text not null,
 actor_id uuid not null references auth.users(id), reviewed_at timestamptz not null default now(),
 foreign key(partner_id,client_id) references public.client_businesses(partner_id,id) on delete cascade
);
create table public.business_owner_commands (
 id uuid primary key default gen_random_uuid(), partner_id uuid not null, client_id uuid not null,
 actor_id uuid not null references auth.users(id), request_key uuid not null,
 command jsonb not null check(jsonb_typeof(command)='object'),
 result jsonb not null check(jsonb_typeof(result)='object'), created_at timestamptz not null default now(),
 unique(client_id,request_key),
 foreign key(partner_id,client_id) references public.client_businesses(partner_id,id) on delete cascade
);
create index business_owner_commands_recent on public.business_owner_commands(partner_id,client_id,created_at desc);
alter table public.business_context_reviews enable row level security;
alter table public.business_owner_commands enable row level security;
revoke all on public.business_context_reviews, public.business_owner_commands from public,anon,authenticated;
grant all on public.business_context_reviews, public.business_owner_commands to service_role;

create function public.business_context_has_no_conflicts(p_partner uuid,p_client uuid)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare p public.business_workspace_profiles; k public.client_knowledge_profiles;
begin
 select * into p from public.business_workspace_profiles where partner_id=p_partner and client_id=p_client;
 if p.client_id is null then return false; end if;
 select * into k from public.client_knowledge_profiles where partner_id=p_partner and client_id=p_client;
 return not exists(select 1 from (values
   (p.profile->>'description',k.business_description), (p.profile->>'services',k.services_offered),
   (p.profile->>'hours',k.business_hours), (p.profile->>'policies',k.booking_rules)
  ) as facts(owner_value,assistant_value)
  where nullif(btrim(owner_value),'') is not null and nullif(btrim(assistant_value),'') is not null
   and btrim(owner_value) <> btrim(assistant_value));
end $$;

-- Cancel only work which has no accepted/uncertain provider operation. Inbound
-- collection and connection authorization are deliberately unaffected.
create function public.cancel_business_unsent(p_partner uuid,p_client uuid,p_channel text default null)
returns integer language plpgsql security invoker set search_path='' as $$
declare jobs integer; assignments integer;
begin
 update public.action_jobs j set status='cancelled',outcome_detail='Stopped by current owner authority.',last_error=null
 where j.partner_id=p_partner and j.client_id=p_client
 and j.status in ('pending','failed','dry_run','skipped')
 and not (j.status='failed' and (j.kind='crm.sync' or j.external_ref is not null))
 and (p_channel is null
  or (p_channel='email' and j.kind='email.send')
  or (p_channel='sms' and j.kind='sms.send')
  or (p_channel='calendar' and j.kind='calendar.book')
  or j.payload->>'channel'=p_channel
  or (p_channel='website' and j.payload->>'channel'='website_chat')
  or exists(select 1 from public.business_conversations c where c.partner_id=p_partner and c.client_id=p_client
    and c.id::text=j.payload->>'conversation_id' and (c.channel=p_channel or (p_channel='website' and c.channel='website_chat')))
  or exists(select 1 from public.integration_connections c join public.integration_providers p on p.id=c.provider_id
    where c.id=j.connection_id and c.partner_id=p_partner and c.client_id=p_client
    and ((p_channel='instagram' and p.provider_key='instagram_messaging') or (p_channel='website' and p.provider_key='northstar_web_chat'))));
 get diagnostics jobs = row_count;
 update public.agent_work_items w set status='cancelled',summary='Stopped by current owner authority. Accepted or uncertain provider actions require reconciliation.',
  claim_token=null,lease_until=null,revision=revision+1,updated_at=now()
 where w.partner_id=p_partner and w.client_id=p_client
 and w.status in ('queued','running','waiting_children','waiting_approval','waiting_external','blocked')
 and (p_channel is null or w.input->>'channel'=p_channel
  or (p_channel='calendar' and w.kind='booking_request')
  or exists(select 1 from public.business_conversations c where c.id=w.conversation_id and c.partner_id=p_partner and c.client_id=p_client
    and (c.channel=p_channel or (p_channel='website' and c.channel='website_chat')))
  or exists(select 1 from public.action_jobs j where j.approval_id=w.approval_id and j.partner_id=p_partner and j.client_id=p_client and j.status='cancelled'
    and ((p_channel='email' and j.kind='email.send') or (p_channel='sms' and j.kind='sms.send') or (p_channel='calendar' and j.kind='calendar.book') or j.payload->>'channel'=p_channel)))
 and not exists(select 1 from public.action_jobs j where j.partner_id=p_partner and j.client_id=p_client
   and (j.approval_id=w.approval_id or j.payload->>'agent_work_id'=w.id::text)
   and (j.status in ('processing','provider_pending','uncertain','succeeded') or
     (j.status='failed' and (j.kind='crm.sync' or j.external_ref is not null))));
 get diagnostics assignments = row_count;
 return jobs+assignments;
end $$;

-- All writers (including earlier settings/activation surfaces) invalidate old
-- approvals. A manager stop is retained across setup saves.
create function public.revise_business_authority() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if (to_jsonb(new)-'authority_revision'-'updated_at'-'next_review_at') is distinct from
     (to_jsonb(old)-'authority_revision'-'updated_at'-'next_review_at') then
   new.authority_revision:=old.authority_revision+1;
  elsif new.authority_revision > old.authority_revision then
   new.authority_revision:=old.authority_revision+1;
  else new.authority_revision:=old.authority_revision; end if;
 end if;
 return new;
end $$;
create trigger revise_business_authority before update on public.agent_team_settings
for each row execute function public.revise_business_authority();

create function public.cancel_changed_business_authority() returns trigger
language plpgsql security invoker set search_path='' as $$
declare channel text;
begin
 if new.status='paused' and old.status is distinct from new.status then
  perform public.cancel_business_unsent(new.partner_id,new.client_id,null);
 else
  for channel in select value from jsonb_array_elements_text('["website","email","sms","instagram","calendar"]') loop
   if new.channel_authority->>channel in ('off','observe','draft') and new.channel_authority->>channel is distinct from old.channel_authority->>channel then
    perform public.cancel_business_unsent(new.partner_id,new.client_id,channel);
   end if;
  end loop;
 end if;
 return new;
end $$;
create trigger cancel_changed_business_authority after update on public.agent_team_settings
for each row execute function public.cancel_changed_business_authority();

create function public.invalidate_business_context_authority() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.profile is distinct from old.profile or new.updated_at is distinct from old.updated_at) then
  update public.agent_team_settings set authority_revision=authority_revision+1 where partner_id=new.partner_id and client_id=new.client_id;
  delete from public.business_context_reviews where partner_id=new.partner_id and client_id=new.client_id;
 end if;
 return new;
end $$;
create trigger invalidate_business_context_authority after update on public.business_workspace_profiles
for each row execute function public.invalidate_business_context_authority();

create function public.invalidate_assistant_context_authority() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 -- Assistant knowledge is an independent source; editing it cannot silently
 -- preserve the owner's review or renew previously approved actions.
 update public.agent_team_settings set authority_revision=authority_revision+1 where partner_id=new.partner_id and client_id=new.client_id;
 delete from public.business_context_reviews where partner_id=new.partner_id and client_id=new.client_id;
 return new;
end $$;
create trigger invalidate_assistant_context_authority after insert or update on public.client_knowledge_profiles
for each row execute function public.invalidate_assistant_context_authority();

create function public.revise_activation_authority() returns trigger
language plpgsql security invoker set search_path='' as $$
declare reviewed boolean; modes jsonb;
begin
 select exists(select 1 from public.business_context_reviews r join public.business_workspace_profiles p
  on p.partner_id=r.partner_id and p.client_id=r.client_id
  where r.partner_id=new.partner_id and r.client_id=new.client_id and r.profile_revision::timestamptz=p.updated_at) into reviewed;
 -- New onboarding starts observing; installing an account grants no actions.
 modes:=case when reviewed then '{}'::jsonb else '{"website":"observe","email":"observe","sms":"observe","instagram":"observe","calendar":"observe"}'::jsonb end;
 insert into public.agent_team_settings(partner_id,client_id,channel_authority)
 values(new.partner_id,new.client_id,modes) on conflict(client_id) do update
 set authority_revision=agent_team_settings.authority_revision+1,
     channel_authority=modes||agent_team_settings.channel_authority;
 if tg_op='UPDATE' then
  if old.website and not new.website then perform public.cancel_business_unsent(new.partner_id,new.client_id,'website'); end if;
  if old.email and not new.email then perform public.cancel_business_unsent(new.partner_id,new.client_id,'email'); end if;
  if old.sms and not new.sms then perform public.cancel_business_unsent(new.partner_id,new.client_id,'sms'); end if;
  if old.instagram and not new.instagram then perform public.cancel_business_unsent(new.partner_id,new.client_id,'instagram'); end if;
  if old.bookings and not new.bookings then perform public.cancel_business_unsent(new.partner_id,new.client_id,'calendar'); end if;
 end if;
 return new;
end $$;
create trigger revise_activation_authority after insert or update on public.business_agent_activation
for each row execute function public.revise_activation_authority();

-- Pin authority when a proposal is prepared, never refresh it on Approve.
create function public.stamp_approval_authority() returns trigger
language plpgsql security invoker set search_path='' as $$
declare current_revision integer;
begin
 select authority_revision into current_revision from public.agent_team_settings where partner_id=new.partner_id and client_id=new.client_id;
 if current_revision is not null and new.type in ('customer_message','appointment_booking','external_action') then
  if new.proposed_payload ? 'authority_revision' and (new.proposed_payload->>'authority_revision')::integer<>current_revision then
   raise exception 'Authority changed during preparation' using errcode='40001';
  end if;
  new.proposed_payload:=coalesce(new.proposed_payload,'{}'::jsonb)||jsonb_build_object('authority_revision',current_revision);
 end if;
 return new;
end $$;
create trigger stamp_approval_authority before insert on public.approval_items
for each row execute function public.stamp_approval_authority();

create function public.apply_business_context_command(p_partner uuid,p_client uuid,p_actor uuid,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved public.business_owner_commands; settings public.agent_team_settings; profile public.business_workspace_profiles;
 command_id uuid:=gen_random_uuid(); request_id uuid; action text; channel text; mode text; operation text;
 current_revision integer; message text; cancelled integer:=0; result jsonb;
begin
 -- One business lock makes first-use, concurrent commands and idempotent replay atomic.
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner for update;
 if not found then raise exception 'Business unavailable'; end if;
 if p_actor is null or jsonb_typeof(p_command)<>'object' then raise exception 'Invalid command' using errcode='22023'; end if;
 request_id:=(p_command->>'key')::uuid;
 if request_id is null then raise exception 'Missing request key' using errcode='22023'; end if;
 select * into saved from public.business_owner_commands where partner_id=p_partner and client_id=p_client and request_key=request_id;
 if found then
  if saved.command<>p_command or saved.actor_id<>p_actor then raise exception 'Request key reused with changed command' using errcode='40001'; end if;
  return saved.result||jsonb_build_object('replayed',true);
 end if;
 action:=p_command->>'action';
 -- Profile saves lock profile then settings via the invalidation trigger. Use
 -- the same order for review to avoid a profile/settings lock inversion.
 if action='review_context' then
  select * into profile from public.business_workspace_profiles where partner_id=p_partner and client_id=p_client for update;
  perform 1 from public.client_knowledge_profiles where partner_id=p_partner and client_id=p_client for update;
  if profile.client_id is null or profile.updated_at is distinct from (p_command->>'expectedContextRevision')::timestamptz then
   raise exception 'Business context changed' using errcode='40001';
  end if;
  if not public.business_context_has_no_conflicts(p_partner,p_client) then
   raise exception 'Resolve conflicting business facts before review' using errcode='22023';
  end if;
 end if;
 insert into public.agent_team_settings(partner_id,client_id) values(p_partner,p_client) on conflict(client_id) do nothing;
 select * into strict settings from public.agent_team_settings where partner_id=p_partner and client_id=p_client for update;
 if action='review_context' then
  -- Recheck after waiting on settings, including a first knowledge insertion
  -- which had no row to lock in this transaction's initial SELECT.
  if not public.business_context_has_no_conflicts(p_partner,p_client) then
   raise exception 'Resolve conflicting business facts before review' using errcode='22023';
  end if;
  insert into public.business_context_reviews(partner_id,client_id,profile_revision,actor_id)
  values(p_partner,p_client,p_command->>'expectedContextRevision',p_actor)
  on conflict(client_id) do update set profile_revision=excluded.profile_revision,actor_id=excluded.actor_id,reviewed_at=now();
  message:='Business context review saved. Unknown facts remain explicit; authority is unchanged.';
 else
  if settings.authority_revision is distinct from (p_command->>'expectedRevision')::integer then
   raise exception 'Owner authority changed' using errcode='40001';
  end if;
  if action='set_authority' then
   channel:=p_command->>'channel'; mode:=p_command->>'mode';
  elsif action='manager_control' then
   operation:=p_command->>'operation';
   if operation='pause' then
    cancelled:=public.cancel_business_unsent(p_partner,p_client,null);
    update public.agent_team_settings set status='paused',updated_at=now() where partner_id=p_partner and client_id=p_client;
    message:='Team paused. Unsent work stopped; inbound records continue. Accepted and uncertain actions still require reconciliation.';
   elsif operation='resume' then
    update public.agent_team_settings set status='active',updated_at=now() where partner_id=p_partner and client_id=p_client;
    message:='Team resumed within saved channel and account permissions. Cancelled or stale actions are not replayed.';
   elsif operation='stop' then channel:=p_command->>'channel'; mode:='off';
   else raise exception 'Unsupported control' using errcode='22023'; end if;
  else raise exception 'Unsupported command' using errcode='22023'; end if;
  if channel is not null then
   if channel not in ('website','email','sms','instagram','calendar') or mode is null or mode not in ('off','observe','draft','require_approval') then
    raise exception 'Unsupported authority' using errcode='22023';
   end if;
   if mode in ('draft','require_approval') and (not public.business_context_has_no_conflicts(p_partner,p_client) or not exists(select 1 from public.business_context_reviews r join public.business_workspace_profiles p
    on p.partner_id=r.partner_id and p.client_id=r.client_id where r.partner_id=p_partner and r.client_id=p_client and r.profile_revision::timestamptz=p.updated_at)) then
    raise exception 'Review current business context first' using errcode='22023';
   end if;
   if mode<>'require_approval' then cancelled:=public.cancel_business_unsent(p_partner,p_client,channel); end if;
   update public.agent_team_settings set channel_authority=channel_authority||jsonb_build_object(channel,mode),updated_at=now()
    where partner_id=p_partner and client_id=p_client;
   message:=case when mode='off' then channel||' stopped. Unsent work cancelled; completed or uncertain provider actions are unchanged.'
    else channel||' authority saved as '||mode||'. Team state, activation choices and provider permissions still limit effective authority.' end;
  end if;
 end if;
 select authority_revision into current_revision from public.agent_team_settings where partner_id=p_partner and client_id=p_client;
 result:=jsonb_build_object('id',command_id,'revision',current_revision,'message',message,'cancelledWork',cancelled,'replayed',false);
 insert into public.business_owner_commands(id,partner_id,client_id,actor_id,request_key,command,result)
 values(command_id,p_partner,p_client,p_actor,request_id,p_command,result);
 insert into public.business_workspace_events(partner_id,client_id,actor_id,action,summary)
 values(p_partner,p_client,p_actor,action,message);
 return result;
end $$;

-- Existing unsent proposals enter the same stale-revision protection. Accepted,
-- uncertain and processing provider records remain immutable for reconciliation.
-- A single DO statement holds these DDL changes and backfill atomically, even
-- when a migration runner does not wrap the whole file. Normal immutable-approval
-- guards and enqueue behavior are restored before its transaction can commit.
do $$ begin
alter table public.approval_items disable trigger guard_approval_resolution;
alter table public.approval_items disable trigger enqueue_approved_action;
update public.approval_items a set proposed_payload=coalesce(a.proposed_payload,'{}'::jsonb)||jsonb_build_object('authority_revision',s.authority_revision)
from public.agent_team_settings s where a.partner_id=s.partner_id and a.client_id=s.client_id
 and a.type in ('customer_message','appointment_booking','external_action')
 and a.status in ('pending','approved','edited_and_approved') and not (coalesce(a.proposed_payload,'{}'::jsonb) ? 'authority_revision')
 and not exists(select 1 from public.action_jobs j where j.partner_id=a.partner_id and j.client_id=a.client_id and j.approval_id=a.id
  and (j.status in ('processing','provider_pending','uncertain','succeeded') or
    (j.status='failed' and (j.kind='crm.sync' or j.external_ref is not null))));
update public.action_jobs j set payload=j.payload||jsonb_build_object('authority_revision',(a.proposed_payload->>'authority_revision')::integer)
from public.approval_items a where j.approval_id=a.id and j.partner_id=a.partner_id and j.client_id=a.client_id
 and j.status in ('pending','failed','dry_run','skipped') and a.proposed_payload ? 'authority_revision'
 and not (j.status='failed' and (j.kind='crm.sync' or j.external_ref is not null))
 and not (j.payload ? 'authority_revision');
alter table public.approval_items enable trigger guard_approval_resolution;
alter table public.approval_items enable trigger enqueue_approved_action;
end $$;

-- Policy-suppressed intake still persists its inbound message. No settings row
-- lock is taken here; revision-pinned execution rechecks any concurrent stop.
create function public.business_channel_can_draft(
 p_partner uuid,p_client uuid,p_channel text,p_connection uuid default null
) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare channel_key text:=case when p_channel='website_chat' then 'website' else p_channel end;
 allowed boolean;
begin
 if channel_key not in ('website','email','sms','instagram','calendar') then return false; end if;
 select s.status='active' and b.status='active'
   and case when channel_key='calendar' then s.scheduling_enabled else s.conversations_enabled end
   and coalesce(s.channel_authority->>channel_key,
     case when a.status='active' and case channel_key
       when 'website' then a.website when 'email' then a.email
       when 'sms' then a.sms when 'instagram' then a.instagram
       when 'calendar' then a.bookings else false end
     then 'require_approval' else 'off' end) in ('draft','require_approval')
   and exists(select 1 from public.business_context_reviews r
     join public.business_workspace_profiles p on p.partner_id=r.partner_id and p.client_id=r.client_id
     where r.partner_id=p_partner and r.client_id=p_client and r.profile_revision::timestamptz=p.updated_at)
   and public.business_context_has_no_conflicts(p_partner,p_client)
   and (p_connection is null or exists(select 1 from public.integration_connections i
     where i.id=p_connection and i.partner_id=p_partner and i.client_id=p_client
       and i.status in ('connected','needs_attention')
       and i.config->'workspace_view_only' is distinct from 'true'::jsonb))
 into allowed
 from public.agent_team_settings s
 join public.client_businesses b on b.partner_id=s.partner_id and b.id=s.client_id
 left join public.business_agent_activation a on a.partner_id=s.partner_id and a.client_id=s.client_id
 where s.partner_id=p_partner and s.client_id=p_client;
 return coalesce(allowed,false);
end $$;
revoke all on function public.business_channel_can_draft(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.business_channel_can_draft(uuid,uuid,text,uuid) to service_role;

create or replace function public.queue_conversation_work(p_conversation uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare c public.business_conversations; w uuid;
begin
 select * into c from public.business_conversations where id=p_conversation for update;
 if not found or c.mode<>'agent' or c.opted_out or c.state='closed' then return null; end if;
 insert into public.agent_work_items(partner_id,client_id,kind,agent_key,title,dedupe_key,input,conversation_id,source_lead_id)
 select c.partner_id,c.client_id,'conversation_reply','customer_service',
   'Respond to '||replace(c.channel,'_',' ')||' inquiry','conversation:'||c.id||':'||c.revision,
   jsonb_build_object('conversation_revision',c.revision,
     'channel',case when c.channel='website_chat' then 'website' else c.channel end,
     'authority_revision',s.authority_revision),c.id,c.lead_id
 from public.agent_team_settings s
 where s.partner_id=c.partner_id and s.client_id=c.client_id
   and public.business_channel_can_draft(c.partner_id,c.client_id,c.channel,c.connection_id)
 on conflict(client_id,dedupe_key) do nothing returning id into w;
 return w;
end $$;
-- Existing function ACL is retained by CREATE OR REPLACE; re-state defensively.
revoke all on function public.queue_conversation_work(uuid) from public,anon,authenticated;
grant execute on function public.queue_conversation_work(uuid) to service_role;


create or replace function public.delegate_conversation_booking(
 p_work uuid, p_claim uuid, p_offer uuid, p_slot_index integer
) returns uuid language plpgsql security invoker set search_path=public as $$
declare w public.agent_work_items; c public.business_conversations;
 offer public.business_conversation_messages; chosen jsonb; child uuid; calendar uuid; provider text; authority_revision_at_handoff integer;
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
 select authority_revision into authority_revision_at_handoff from public.agent_team_settings
  where partner_id=c.partner_id and client_id=c.client_id;
 if not public.business_channel_can_draft(c.partner_id,c.client_id,c.channel,c.connection_id)
    or not public.business_channel_can_draft(c.partner_id,c.client_id,'calendar',null)
    or (w.input ? 'authority_revision' and (w.input->>'authority_revision')::integer is distinct from authority_revision_at_handoff) then
  perform public.finish_agent_work(w.id,p_claim,'blocked',
    'Booking handoff stopped by current owner authority or business context. No booking assignment was created.',
    '{}'::jsonb);
  update public.business_conversations set state='needs_attention',
    next_action='Review current business context and booking authority before retrying.',updated_at=now()
   where id=c.id and partner_id=c.partner_id and client_id=c.client_id;
  return null;
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
 if provider<>'northstar_internal' and not public.business_channel_can_draft(
   c.partner_id,c.client_id,'calendar',calendar) then
  perform public.finish_agent_work(w.id,p_claim,'blocked',
    'The offered calendar is paused, read only or no longer authorized for drafting.', '{}'::jsonb);
  update public.business_conversations set state='needs_attention',
    next_action='Review the offered calendar and booking authority.',updated_at=now()
   where id=c.id and partner_id=c.partner_id and client_id=c.client_id;
  return null;
 end if;
 if exists(select 1 from public.approval_items where client_id=c.client_id and partner_id=c.partner_id
   and status='pending' and proposed_payload->>'conversation_id'=c.id::text) or
   exists(select 1 from public.action_jobs where client_id=c.client_id and partner_id=c.partner_id
   and status in ('pending','processing','provider_pending','uncertain') and payload->>'conversation_id'=c.id::text) then
  raise exception 'Resolve the current action before assigning another booking';
 end if;
 insert into public.agent_work_items(partner_id,client_id,parent_id,kind,agent_key,title,dedupe_key,
   conversation_id,source_lead_id,input,summary)
 values(c.partner_id,c.client_id,w.id,'booking_request','scheduling','Book the customer’s selected appointment',
   'booking-handoff:'||w.id,c.id,c.lead_id,jsonb_build_object(
 'channel','calendar',
 'authority_revision',authority_revision_at_handoff,
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

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('business_channel_can_draft','queue_conversation_work','delegate_conversation_booking','business_context_has_no_conflicts','cancel_business_unsent','revise_business_authority','cancel_changed_business_authority','invalidate_business_context_authority','invalidate_assistant_context_authority','revise_activation_authority','stamp_approval_authority','apply_business_context_command') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
insert into public.platform_schema_state(singleton,current_migration,applied_at)
values(true,'20261117030202_reviewed_business_authority',now())
on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;
