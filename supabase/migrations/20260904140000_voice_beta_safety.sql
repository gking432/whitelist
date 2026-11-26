-- Durable call finalization, transcript ordering and staff ownership.
alter table public.call_sessions
  add column if not exists assigned_user_id uuid references auth.users(id) on delete set null,
  add column if not exists staff_analysis_claim uuid,
  add column if not exists staff_analysis_lease_until timestamptz,
  add column if not exists staff_analysis_started_at timestamptz;

create unique index voice_pending_booking_per_call
  on public.approval_items ((proposed_payload->>'call_session_id'))
  where type = 'appointment_booking' and status = 'pending'
    and proposed_payload->>'call_session_id' is not null;

create table public.voice_finalization_jobs (
  call_session_id uuid primary key references public.call_sessions(id) on delete cascade,
  partner_id uuid not null references public.partners(id) on delete cascade,
  client_id uuid not null references public.client_businesses(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','processing','succeeded','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null,
  lease_until timestamptz,
  lease_token uuid,
  last_error text,
  completed_at timestamptz
);
alter table public.voice_finalization_jobs enable row level security;
revoke all on public.voice_finalization_jobs from anon, authenticated;
grant all on public.voice_finalization_jobs to service_role;

create table public.voice_usage_events (
  call_session_id uuid not null references public.call_sessions(id) on delete cascade,
  response_id text not null,
  partner_id uuid not null references public.partners(id) on delete cascade,
  client_id uuid not null references public.client_businesses(id) on delete cascade,
  model text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  total_tokens bigint not null default 0,
  created_at timestamptz not null default now(),
  primary key(call_session_id,response_id)
);
alter table public.voice_usage_events enable row level security;
revoke all on public.voice_usage_events from anon,authenticated;
grant all on public.voice_usage_events to service_role;

create or replace function public.enqueue_voice_finalization(p_session_id uuid, p_delay_seconds integer default 90)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.voice_finalization_jobs(call_session_id,partner_id,client_id,available_at)
    select id,partner_id,client_id,now() + make_interval(secs => greatest(5,least(p_delay_seconds,3600)))
    from public.call_sessions where id=p_session_id and status='in_progress'
  on conflict(call_session_id) do update set
    available_at=least(voice_finalization_jobs.available_at,excluded.available_at);
end;
$$;

create or replace function public.claim_voice_finalization_jobs(p_limit integer default 10)
returns setof public.voice_finalization_jobs language sql security definer set search_path = public, pg_temp as $$
  update public.voice_finalization_jobs j set status='processing', attempts=attempts+1,
    lease_token=extensions.gen_random_uuid(), lease_until=now()+interval '5 minutes'
  where call_session_id in (
    select call_session_id from public.voice_finalization_jobs
    where (status='pending' and available_at<=now())
      or (status='processing' and lease_until<now())
    order by available_at for update skip locked limit greatest(1,least(p_limit,25))
  ) returning j.*;
$$;

create or replace function public.merge_voice_session_extracted(p_session_id uuid,p_patch jsonb)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.call_sessions set extracted=extracted||p_patch where id=p_session_id;
$$;

create or replace function public.append_voice_transcript(p_session_id uuid,p_role text,p_content text,p_occurred_at timestamptz,p_source_event_id text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.call_sessions; next_seq integer;
begin
  select * into s from public.call_sessions where id=p_session_id for update;
  if not found then raise exception 'Active call not found'; end if;
  if p_source_event_id is not null and exists(select 1 from public.call_transcript_turns where call_session_id=p_session_id and source_event_id=p_source_event_id) then return false; end if;
  if s.status<>'in_progress' then raise exception 'Active call not found'; end if;
  select coalesce(max(seq),0)+1 into next_seq from public.call_transcript_turns where call_session_id=p_session_id;
  insert into public.call_transcript_turns(call_session_id,partner_id,client_id,seq,role,content,occurred_at,source_event_id)
  values(s.id,s.partner_id,s.client_id,next_seq,p_role,p_content,p_occurred_at,p_source_event_id);
  insert into public.assistant_events(partner_id,client_id,event_type,call_session_id,payload)
  values(s.partner_id,s.client_id,'transcript_turn_added',s.id,jsonb_build_object('role',p_role,'seq',next_seq));
  return true;
end;
$$;

create or replace function public.claim_staff_voice_analysis(p_session_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare token uuid;
begin
  update public.call_sessions set staff_analysis_claim=extensions.gen_random_uuid(),
    staff_analysis_lease_until=now()+interval '90 seconds', staff_analysis_started_at=now()
  where id=p_session_id and status='in_progress'
    and (staff_analysis_lease_until is null or staff_analysis_lease_until<now())
    and (staff_analysis_started_at is null or staff_analysis_started_at<now()-interval '10 seconds')
  returning staff_analysis_claim into token;
  return token;
end;
$$;

create or replace function public.finish_voice_call(p_session_id uuid,p_summary text,p_note text,p_extracted jsonb,p_ai_status text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.call_sessions;
begin
  select * into s from public.call_sessions where id=p_session_id for update;
  if not found or s.status<>'in_progress' then return; end if;
  update public.call_sessions set status='completed', ended_at=coalesce(ended_at,now()),
    summary=p_summary,crm_note=p_note,extracted=extracted||p_extracted where id=p_session_id;
  if s.matched_contact_id is not null then
    insert into public.crm_timeline_entries(partner_id,client_id,contact_id,kind,actor_type,title,body)
    values(s.partner_id,s.client_id,s.matched_contact_id,'note','ai_assistant','AI Assistant summarized a call',p_note);
  end if;
  insert into public.assistant_events(partner_id,client_id,event_type,call_session_id,payload)
  values(s.partner_id,s.client_id,'call_completed',s.id,jsonb_build_object('ai_status',p_ai_status,'direction',s.direction));
end;
$$;

revoke all on function public.enqueue_voice_finalization(uuid,integer), public.claim_voice_finalization_jobs(integer), public.merge_voice_session_extracted(uuid,jsonb), public.append_voice_transcript(uuid,text,text,timestamptz,text), public.claim_staff_voice_analysis(uuid), public.finish_voice_call(uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.enqueue_voice_finalization(uuid,integer), public.claim_voice_finalization_jobs(integer), public.merge_voice_session_extracted(uuid,jsonb), public.append_voice_transcript(uuid,text,text,timestamptz,text), public.claim_staff_voice_analysis(uuid), public.finish_voice_call(uuid,text,text,jsonb,text) to service_role;
