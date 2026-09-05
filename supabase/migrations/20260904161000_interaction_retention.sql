-- Expire raw interaction material while retaining business CRM records and
-- approval/action evidence. Provider-hosted recordings require provider policy.
create or replace function public.purge_customer_interaction_content(p_cutoff timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare transcripts integer; chats integer; calls integer; events integer;
begin
  if p_cutoff is null or p_cutoff>now()-interval '30 days' then raise exception 'Retention cutoff must be at least 30 days old'; end if;
  delete from public.call_transcript_turns t using public.call_sessions s
    where t.call_session_id=s.id and s.status<>'in_progress' and coalesce(s.ended_at,s.updated_at)<p_cutoff;
  get diagnostics transcripts=row_count;
  update public.call_sessions set extracted='{}'::jsonb
    where status<>'in_progress' and coalesce(ended_at,updated_at)<p_cutoff and extracted<>'{}'::jsonb;
  get diagnostics calls=row_count;
  delete from public.chat_sessions where updated_at<p_cutoff;
  get diagnostics chats=row_count;
  update public.integration_events e set request_payload=null,response_payload=null
    where e.created_at<p_cutoff and e.status in ('processed','sent','rejected','skipped','dry_run')
      and (e.request_payload is not null or e.response_payload is not null)
      and not exists(select 1 from public.inbound_event_jobs j where j.event_id=e.id and j.status in ('queued','running','failed'));
  get diagnostics events=row_count;
  return jsonb_build_object('transcripts',transcripts,'chats',chats,'callExtracts',calls,'eventPayloads',events);
end $$;
revoke all on function public.purge_customer_interaction_content(timestamptz) from public,anon,authenticated;
grant execute on function public.purge_customer_interaction_content(timestamptz) to service_role;
