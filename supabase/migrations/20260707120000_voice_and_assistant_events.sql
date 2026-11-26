-- Voice/call foundation + live assistant event contract (docs/11 Phase 4,
-- docs/12 popups). Production-shaped models that voice provider adapters
-- fill later; no telephony happens until a provider is connected AND live.

-- One row per phone call (inbound or outbound).
create table if not exists public.call_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  connection_id uuid references public.integration_connections (id) on delete set null,
  provider text not null default 'none',
  direction text not null default 'inbound'
    check (direction in ('inbound', 'outbound')),
  from_number text,
  to_number text,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'failed', 'abandoned')),
  disclosure_mode text not null default 'explicit'
    check (disclosure_mode in ('off', 'explicit', 'minimal')),
  matched_contact_id uuid references public.crm_contacts (id) on delete set null,
  external_ref text,
  -- Clean CRM-ready note (short) vs internal summary; the full transcript
  -- lives in call_transcript_turns, deliberately separate.
  summary text,
  crm_note text,
  extracted jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists call_sessions_client_idx
  on public.call_sessions (client_id, started_at desc);

create table if not exists public.call_transcript_turns (
  id uuid primary key default extensions.gen_random_uuid(),
  call_session_id uuid not null references public.call_sessions (id) on delete cascade,
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  seq integer not null,
  role text not null check (role in ('caller', 'staff', 'ai_assistant')),
  content text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists call_transcript_turns_session_idx
  on public.call_transcript_turns (call_session_id, seq);

-- Live assistant events: the feed future popups (desktop tray, browser
-- extension, CRM overlay) subscribe to. The web console reads it today
-- via the polling endpoint. Written by trusted server paths only.
create table if not exists public.assistant_events (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  event_type text not null check (event_type in (
    'active_call_started',
    'transcript_turn_added',
    'lead_detected',
    'appointment_intent_detected',
    'draft_ready',
    'approval_needed',
    'booking_proposed',
    'crm_sync_completed',
    'escalation_needed',
    'call_completed'
  )),
  payload jsonb not null default '{}'::jsonb,
  workflow_run_id uuid references public.workflow_runs (id) on delete set null,
  approval_id uuid references public.approval_items (id) on delete set null,
  call_session_id uuid references public.call_sessions (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists assistant_events_client_idx
  on public.assistant_events (client_id, created_at desc);

drop trigger if exists set_call_sessions_updated_at on public.call_sessions;
create trigger set_call_sessions_updated_at
  before update on public.call_sessions
  for each row execute function public.set_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array[
    'call_sessions', 'call_transcript_turns', 'assistant_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "%s_select_scoped" on public.%I', t, t);
    execute format($p$
      create policy "%s_select_scoped" on public.%I
      for select to authenticated
      using (
        public.current_user_has_platform_role()
        or public.current_user_has_partner_role(partner_id)
        or public.current_user_has_partner_client_role(partner_id, client_id)
      )
    $p$, t, t);

    -- Read-only for browser roles; trusted server paths write via the
    -- service role.
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
