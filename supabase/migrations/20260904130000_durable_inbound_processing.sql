-- Authenticated provider intake commits the event and replay payload together.
-- Payloads contain customer data and are encrypted by the trusted server.
create table public.inbound_event_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  event_id uuid not null unique references public.integration_events(id) on delete cascade,
  partner_id uuid not null references public.partners(id) on delete cascade,
  client_id uuid not null references public.client_businesses(id) on delete cascade,
  connection_id uuid not null,
  handler text not null check (handler in ('workflow', 'phone')),
  encrypted_payload text,
  status text not null default 'queued' check (status in ('queued','running','failed','succeeded','dead_letter','cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  worker_id uuid,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (partner_id, client_id, connection_id)
    references public.integration_connections(partner_id, client_id, id) on delete cascade
);
create index inbound_event_jobs_pending on public.inbound_event_jobs(available_at,created_at) where status in ('queued','failed');
alter table public.inbound_event_jobs enable row level security;
create policy inbound_event_jobs_scoped_read on public.inbound_event_jobs for select to authenticated using (
  public.current_user_has_platform_role() or public.current_user_has_partner_role(partner_id) or
  public.current_user_has_client_role(client_id,array['client_owner','client_manager']::public.membership_role[])
);
revoke all on public.inbound_event_jobs from public,anon,authenticated;
grant select (id,event_id,partner_id,client_id,connection_id,handler,status,attempts,max_attempts,available_at,locked_at,last_error,created_at,completed_at) on public.inbound_event_jobs to authenticated;
grant all on public.inbound_event_jobs to service_role;

create or replace function public.enqueue_inbound_event(
  p_partner_id uuid,p_client_id uuid,p_connection_id uuid,p_event_type text,
  p_idempotency_key text,p_redacted_payload jsonb,p_encrypted_payload text,p_handler text default 'workflow'
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event public.integration_events; v_status text; v_duplicate boolean := false;
begin
  -- Lock the connection to serialize concurrent duplicate submissions; scope is
  -- asserted inside the same transaction even for service-role callers.
  perform 1 from public.integration_connections where id=p_connection_id
    and partner_id=p_partner_id and client_id=p_client_id for update;
  if not found then raise exception 'Invalid inbound connection scope'; end if;
  if p_idempotency_key is null or length(p_idempotency_key)=0 or length(p_idempotency_key)>255 then
    raise exception 'A bounded idempotency key is required';
  end if;
  select * into v_event from public.integration_events where connection_id=p_connection_id
    and direction='inbound' and idempotency_key=p_idempotency_key;
  v_duplicate := found;
  if not v_duplicate then
    insert into public.integration_events(partner_id,client_id,connection_id,direction,event_type,status,idempotency_key,request_payload,redacted)
    values(p_partner_id,p_client_id,p_connection_id,'inbound',p_event_type,'received',p_idempotency_key,p_redacted_payload,true)
    returning * into v_event;
  end if;
  if v_event.event_type <> p_event_type then raise exception 'Idempotency key already belongs to another event type'; end if;
  if v_event.status <> 'processed' then
    insert into public.inbound_event_jobs(event_id,partner_id,client_id,connection_id,handler,encrypted_payload)
      values(v_event.id,p_partner_id,p_client_id,p_connection_id,p_handler,p_encrypted_payload)
      on conflict (event_id) do nothing;
  end if;
  select status into v_status from public.inbound_event_jobs where event_id=v_event.id;
  return jsonb_build_object('eventId',v_event.id,'duplicate',v_duplicate,'status',coalesce(v_status,'succeeded'));
end $$;

create or replace function public.claim_inbound_event_job(p_worker_id uuid,p_event_id uuid default null)
returns setof public.inbound_event_jobs language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  -- A dead worker leaves an auditable retry; the workflow engine independently
  -- quarantines runs which might already have produced external effects.
  update public.inbound_event_jobs set status=case when attempts >= max_attempts then 'dead_letter' else 'failed' end,
    locked_at=null,worker_id=null,available_at=now(),completed_at=case when attempts>=max_attempts then now() else null end,last_error='Worker lease expired; replay will reconcile existing workflow runs.'
    where status='running' and locked_at < now()-interval '10 minutes';
  select j.id into v_id from public.inbound_event_jobs j
    where j.status in ('queued','failed') and j.available_at<=now() and j.attempts<j.max_attempts
      and (p_event_id is null or j.event_id=p_event_id)
      and not exists(select 1 from public.inbound_event_jobs active where active.connection_id=j.connection_id and active.status='running')
    order by j.created_at for update skip locked limit 1;
  if v_id is null then return; end if;
  -- Serialize claims per connection as well as per row.
  perform pg_advisory_xact_lock(hashtextextended((select connection_id::text from public.inbound_event_jobs where id=v_id),0));
  if exists(select 1 from public.inbound_event_jobs active where active.connection_id=(select connection_id from public.inbound_event_jobs where id=v_id) and active.status='running') then return; end if;
  return query update public.inbound_event_jobs set status='running',attempts=attempts+1,worker_id=p_worker_id,locked_at=now()
    where id=v_id returning *;
end $$;

create or replace function public.finish_inbound_event_job(p_job_id uuid,p_worker_id uuid,p_workflow_run_id uuid default null)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event_id uuid;
begin
  update public.inbound_event_jobs set status='succeeded',completed_at=now(),encrypted_payload=null,
    locked_at=null,worker_id=null,last_error=null
    where id=p_job_id and status='running' and worker_id=p_worker_id returning event_id into v_event_id;
  if v_event_id is null then return false; end if;
  update public.integration_events set status='processed',workflow_run_id=coalesce(p_workflow_run_id,workflow_run_id),error_code=null,error_message=null where id=v_event_id;
  return true;
end $$;

revoke all on function public.enqueue_inbound_event(uuid,uuid,uuid,text,text,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.claim_inbound_event_job(uuid,uuid) from public,anon,authenticated;
revoke all on function public.finish_inbound_event_job(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.enqueue_inbound_event(uuid,uuid,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.claim_inbound_event_job(uuid,uuid) to service_role;
grant execute on function public.finish_inbound_event_job(uuid,uuid,uuid) to service_role;
