alter table public.call_transcript_turns
  add column if not exists source_event_id text;

create unique index if not exists call_transcript_turns_source_event_idx
  on public.call_transcript_turns (call_session_id, source_event_id)
  where source_event_id is not null;
