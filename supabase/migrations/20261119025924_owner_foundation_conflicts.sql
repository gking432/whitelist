-- Deliberate context/authority and shared approval conflicts are HTTP409.
-- Replace only reviewed semantic RAISE literals; never translate backend
-- serialization_failure (40001) or deadlock_detected (40P01).
-- Existing function owners, ACLs and invoker/definer modes are retained by
-- CREATE OR REPLACE. The new private trigger only locks/reads exact OLD scope;
-- the original invoker resolution guard and UPDATE RLS still authorize writes.
-- Lock order: business KEY SHARE NOWAIT, then settings SHARE NOWAIT. A blocking
-- settings lookup after the approval row would invert owner-control/FK locks.
-- https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b

-- supabase/migrations/20261118030334_hubspot_customer_system.sql:316; literals=7
create or replace function public.enqueue_approved_action()
returns trigger language plpgsql security definer set search_path='' as $$
declare action_kind text; action_payload jsonb; bound_appointment uuid; check_result jsonb;
begin
 if new.status not in ('approved','edited_and_approved') then return new; end if;
 if new.proposed_payload ? 'invoice_followup_version' then
  if new.resolved_content is distinct from new.editable_content then raise exception 'The reviewed invoice financial template cannot be edited' using errcode='PT409'; end if;
  check_result:=public.invoice_followup_action_check(new.partner_id,new.client_id,new.id);
  if check_result->>'allowed' is distinct from 'true' then raise exception '%',check_result->>'reason' using errcode='PT409'; end if;
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
  if bound_appointment is null then raise exception 'The exact appointment is unavailable' using errcode='PT409'; end if;
  if new.expires_at is null or new.expires_at<=now() then raise exception 'The appointment change expired; prepare a fresh review' using errcode='PT409'; end if;
  check_result:=public.calendar_mutation_source_check(new.partner_id,new.client_id,new.proposed_payload,true);
  if check_result->>'allowed' is distinct from 'true' then raise exception '%',check_result->>'reason' using errcode='PT409'; end if;
  action_kind:='calendar.'||(new.proposed_payload->>'mutation'); action_payload:=new.proposed_payload;
  -- Freeze future preparation while preserving a separate explicit stop.
  -- Completion may initialize the new effective time after its receipt commits.
  update public.action_jobs set confirmation_due_at=null,booking_followup_due_at=null,
   booking_followup_reason='An approved appointment change is awaiting a verified result.'
   where id::text=new.proposed_payload->>'booking_action_job_id' and approval_id::text=new.proposed_payload->>'booking_approval_id'
    and partner_id=new.partner_id and client_id=new.client_id and kind='calendar.book' and status='succeeded';
 elsif new.type='crm_change' and new.proposed_payload->'crm_gateway_version'='1'::jsonb then
  if new.expires_at is null or new.expires_at<=now() or not exists(select 1 from public.business_owner_commands receipt where receipt.id::text=new.proposed_payload->>'owner_command_id' and receipt.partner_id=new.partner_id and receipt.client_id=new.client_id and receipt.command->'pin'=new.proposed_payload and receipt.result->>'approvalId'=new.id::text) then raise exception 'The saved owner CRM review is unavailable or expired' using errcode='PT409'; end if;
  check_result:=public.crm_gateway_source_check(new.partner_id,new.client_id,new.proposed_payload);
  if check_result->>'allowed' is distinct from 'true' then raise exception '%',check_result->>'reason' using errcode='PT409'; end if;
  action_kind:='crm.sync'; action_payload:=new.proposed_payload;
 elsif new.type='external_action' and new.embedded_binding_id is not null then
  action_kind:='external.action'; action_payload:=coalesce(new.proposed_payload,'{}'::jsonb);
 else return new; end if;
 insert into public.action_jobs(partner_id,client_id,approval_id,workflow_run_id,kind,payload,status,execution_key)
 values(new.partner_id,new.client_id,new.id,new.workflow_run_id,action_kind,action_payload,'pending','approval:'||new.id)
 on conflict(execution_key) do nothing;
 return new;
end $$;

-- supabase/migrations/20261117214644_approved_calendar_changes.sql:1343; literals=1
create or replace function public.stamp_approval_authority() returns trigger
language plpgsql security invoker set search_path='' as $$
declare current_revision integer;
begin
 select authority_revision into current_revision from public.agent_team_settings where partner_id=new.partner_id and client_id=new.client_id;
 if current_revision is not null and new.type in ('customer_message','appointment_booking','appointment_change','external_action') then
  if new.proposed_payload ? 'authority_revision' and (new.proposed_payload->>'authority_revision')::integer<>current_revision then
   raise exception 'Authority changed during preparation' using errcode='PT409';
  end if;
  new.proposed_payload:=coalesce(new.proposed_payload,'{}'::jsonb)||jsonb_build_object('authority_revision',current_revision);
 end if;
 return new;
end $$;

-- supabase/migrations/20261117030202_reviewed_business_authority.sql:183; literals=3
create or replace function public.apply_business_context_command(p_partner uuid,p_client uuid,p_actor uuid,p_command jsonb)
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
  if saved.command<>p_command or saved.actor_id<>p_actor then raise exception 'Request key reused with changed command' using errcode='PT409'; end if;
  return saved.result||jsonb_build_object('replayed',true);
 end if;
 action:=p_command->>'action';
 -- Profile saves lock profile then settings via the invalidation trigger. Use
 -- the same order for review to avoid a profile/settings lock inversion.
 if action='review_context' then
  select * into profile from public.business_workspace_profiles where partner_id=p_partner and client_id=p_client for update;
  perform 1 from public.client_knowledge_profiles where partner_id=p_partner and client_id=p_client for update;
  if profile.client_id is null or profile.updated_at is distinct from (p_command->>'expectedContextRevision')::timestamptz then
   raise exception 'Business context changed' using errcode='PT409';
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
   raise exception 'Owner authority changed' using errcode='PT409';
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

-- supabase/migrations/20261118020030_invoice_followup_review.sql:130; literals=1
create or replace function public.guard_invoice_followup_approval() returns trigger language plpgsql security invoker set search_path='' as $$
declare safety jsonb;
begin
 if old.proposed_payload->'invoice_followup_version'='1'::jsonb and new.status in ('approved','edited_and_approved') and old.status='pending' then
  if new.resolved_content is distinct from old.editable_content then raise exception 'Review the exact source-backed invoice template; its financial content cannot be edited' using errcode='PT409'; end if;
  -- The existing internal definer enqueue trigger performs the privileged source check.
  -- This invoker trigger enforces immutable financial text without privileged reads.
 end if;
 return new;
end $$;

-- Existing history guard: only the deliberate resolved-history conflict changes.
create or replace function public.guard_approval_resolution()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.status<>'pending' then raise exception 'Resolved approvals are immutable' using errcode='PT409'; end if;
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

-- Private internal trigger only. No generic RPC/direct authenticated EXECUTE.
create function owner_onboarding.guard_approval_authority_decision()
returns trigger language plpgsql security definer set search_path='' as $$
declare revision integer;
begin
 if old.status<>'pending' or new.status not in ('approved','edited_and_approved')
  or old.type not in ('customer_message','appointment_booking','appointment_change','external_action') then return new; end if;
 -- Explicit actor binding supplements, and does not replace, the invoker guard.
 if auth.jwt()->>'role'='authenticated' and (auth.uid() is null or new.resolved_by is distinct from auth.uid()) then
  raise exception 'Resolution actor does not match authenticated user' using errcode='42501';
 end if;
 begin
  perform 1 from public.client_businesses b
   where b.id=old.client_id and b.partner_id=old.partner_id for key share nowait;
  if not found then raise exception 'Business authority is unavailable; refresh and prepare a new review' using errcode='PT409'; end if;
  select s.authority_revision into revision from public.agent_team_settings s
   where s.client_id=old.client_id and s.partner_id=old.partner_id for share nowait;
  if not found then raise exception 'Business authority is unavailable; refresh and prepare a new review' using errcode='PT409'; end if;
 exception when lock_not_available then
  raise exception 'Business authority is changing; refresh before deciding' using errcode='PT409';
 end;
 if jsonb_typeof(old.proposed_payload->'authority_revision') is distinct from 'number'
  or old.proposed_payload->>'authority_revision' is distinct from revision::text then
  raise exception 'Business authority changed; refresh and prepare a new review' using errcode='PT409';
 end if;
 return new;
end $$;
revoke all on function owner_onboarding.guard_approval_authority_decision() from public,anon,authenticated;
grant execute on function owner_onboarding.guard_approval_authority_decision() to service_role;
create trigger guard_approval_authority_decision before update on public.approval_items
 for each row execute function owner_onboarding.guard_approval_authority_decision();

insert into public.platform_schema_state(singleton,current_migration,applied_at)
values(true,'20261119025924_owner_foundation_conflicts',now())
on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;
