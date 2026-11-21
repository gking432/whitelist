-- Trusted native events share the durable workflow queue without fabricating a provider connection.
alter table public.inbound_event_jobs alter column connection_id drop not null;

create or replace function public.enqueue_inbound_event(
  p_partner_id uuid,p_client_id uuid,p_connection_id uuid,p_event_type text,
  p_idempotency_key text,p_redacted_payload jsonb,p_encrypted_payload text,p_handler text default 'workflow'
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event public.integration_events; v_status text; v_duplicate boolean := false;
begin
  -- Lock the connection to serialize concurrent duplicate submissions; scope is
  -- asserted inside the same transaction even for service-role callers.
  if p_connection_id is null then
    if p_handler <> 'workflow' then raise exception 'Native events require the workflow handler'; end if;
    perform 1 from public.client_businesses where id=p_client_id and partner_id=p_partner_id and status='active' for update;
    if not found then raise exception 'Invalid native event client scope'; end if;
  else
    perform 1 from public.integration_connections where id=p_connection_id
      and partner_id=p_partner_id and client_id=p_client_id for update;
    if not found then raise exception 'Invalid inbound connection scope'; end if;
  end if;
  if p_idempotency_key is null or length(p_idempotency_key)=0 or length(p_idempotency_key)>255 then
    raise exception 'A bounded idempotency key is required';
  end if;
  select * into v_event from public.integration_events where connection_id is not distinct from p_connection_id
    and partner_id=p_partner_id and client_id=p_client_id and direction='inbound' and idempotency_key=p_idempotency_key;
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
      and not exists(select 1 from public.inbound_event_jobs active where coalesce(active.connection_id,active.client_id)=coalesce(j.connection_id,j.client_id) and active.status='running')
    order by j.created_at for update skip locked limit 1;
  if v_id is null then return; end if;
  -- Serialize claims per connection as well as per row.
  perform pg_advisory_xact_lock(hashtextextended((select coalesce(connection_id,client_id)::text from public.inbound_event_jobs where id=v_id),0));
  if exists(select 1 from public.inbound_event_jobs active where coalesce(active.connection_id,active.client_id)=(select coalesce(connection_id,client_id) from public.inbound_event_jobs where id=v_id) and active.status='running') then return; end if;
  return query update public.inbound_event_jobs set status='running',attempts=attempts+1,worker_id=p_worker_id,locked_at=now()
    where id=v_id returning *;
end $$;

