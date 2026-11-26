-- Northstar operating suite. Extends the built-in CRM from a workflow
-- destination into the white-label product partners operate and sell.

alter table public.crm_contacts
  add column if not exists company_name text,
  add column if not exists preferred_channel text,
  add column if not exists tags text[] not null default array[]::text[];

alter table public.crm_leads
  add column if not exists title text,
  add column if not exists service_type text,
  add column if not exists description text,
  add column if not exists estimated_value_min numeric,
  add column if not exists estimated_value_max numeric,
  add column if not exists next_action text,
  add column if not exists assigned_to uuid references auth.users (id) on delete set null,
  add column if not exists last_contact_at timestamptz;

alter table public.crm_tasks
  add column if not exists lead_id uuid references public.crm_leads (id) on delete cascade,
  add column if not exists task_type text not null default 'follow_up',
  add column if not exists assigned_to uuid references auth.users (id) on delete set null,
  add column if not exists completed_at timestamptz;

alter table public.crm_appointments
  add column if not exists lead_id uuid references public.crm_leads (id) on delete set null,
  add column if not exists location text,
  add column if not exists notes text,
  add column if not exists source text not null default 'northstar';

create table if not exists public.crm_communications (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  contact_id uuid references public.crm_contacts (id) on delete cascade,
  lead_id uuid references public.crm_leads (id) on delete set null,
  call_session_id uuid references public.call_sessions (id) on delete set null,
  approval_id uuid references public.approval_items (id) on delete set null,
  channel text not null check (channel in (
    'form', 'phone', 'sms', 'email', 'website_chat', 'internal_note'
  )),
  direction text not null check (direction in ('inbound', 'outbound', 'internal')),
  status text not null default 'received' check (status in (
    'received', 'draft', 'pending_approval', 'approved', 'scheduled',
    'sent', 'delivered', 'failed', 'cancelled'
  )),
  from_value text,
  to_value text,
  subject text,
  body text not null,
  ai_generated boolean not null default false,
  human_approved boolean not null default false,
  provider_ref text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_communications_client_idx
  on public.crm_communications (client_id, occurred_at desc);
create index if not exists crm_communications_contact_idx
  on public.crm_communications (contact_id, occurred_at desc);

create table if not exists public.crm_availability_windows (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  weekday integer not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  appointment_minutes integer not null default 60
    check (appointment_minutes between 15 and 480),
  label text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index if not exists crm_availability_client_idx
  on public.crm_availability_windows (client_id, weekday, start_time);

create table if not exists public.crm_quotes (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  contact_id uuid references public.crm_contacts (id) on delete cascade,
  lead_id uuid references public.crm_leads (id) on delete set null,
  service_type text not null,
  status text not null default 'internal_ballpark'
    check (status in ('internal_ballpark', 'draft', 'sent', 'accepted', 'declined')),
  low_amount numeric not null default 0,
  high_amount numeric not null default 0,
  line_items jsonb not null default '[]'::jsonb,
  assumptions text[] not null default array[]::text[],
  notes text,
  ai_summary text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_quotes_client_idx
  on public.crm_quotes (client_id, created_at desc);

create table if not exists public.crm_feedback (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  contact_id uuid references public.crm_contacts (id) on delete set null,
  source text not null default 'manual',
  rating integer check (rating between 1 and 5),
  feedback_text text not null,
  sentiment text not null check (sentiment in ('positive', 'mixed', 'negative')),
  risk_level text not null check (risk_level in ('low', 'medium', 'high', 'urgent')),
  summary text not null,
  suggested_internal_action text,
  suggested_customer_response text,
  tags text[] not null default array[]::text[],
  ai_status text not null default 'fallback'
    check (ai_status in ('ai', 'fallback')),
  raw_output jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists crm_feedback_client_idx
  on public.crm_feedback (client_id, created_at desc);

drop trigger if exists set_crm_communications_updated_at on public.crm_communications;
create trigger set_crm_communications_updated_at
  before update on public.crm_communications
  for each row execute function public.set_updated_at();

drop trigger if exists set_crm_availability_updated_at on public.crm_availability_windows;
create trigger set_crm_availability_updated_at
  before update on public.crm_availability_windows
  for each row execute function public.set_updated_at();

drop trigger if exists set_crm_quotes_updated_at on public.crm_quotes;
create trigger set_crm_quotes_updated_at
  before update on public.crm_quotes
  for each row execute function public.set_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array[
    'crm_communications',
    'crm_availability_windows',
    'crm_quotes',
    'crm_feedback'
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

    execute format('drop policy if exists "%s_insert_editors" on public.%I', t, t);
    execute format($p$
      create policy "%s_insert_editors" on public.%I
      for insert to authenticated
      with check (
        public.current_user_has_platform_role()
        or public.current_user_has_partner_client_role(partner_id, client_id, array[
          'partner_owner', 'partner_admin', 'partner_implementer',
          'client_owner', 'client_manager'
        ]::public.membership_role[])
      )
    $p$, t, t);

    execute format('drop policy if exists "%s_update_editors" on public.%I', t, t);
    execute format($p$
      create policy "%s_update_editors" on public.%I
      for update to authenticated
      using (
        public.current_user_has_platform_role()
        or public.current_user_has_partner_client_role(partner_id, client_id, array[
          'partner_owner', 'partner_admin', 'partner_implementer',
          'client_owner', 'client_manager'
        ]::public.membership_role[])
      )
      with check (
        public.current_user_has_platform_role()
        or public.current_user_has_partner_client_role(partner_id, client_id, array[
          'partner_owner', 'partner_admin', 'partner_implementer',
          'client_owner', 'client_manager'
        ]::public.membership_role[])
      )
    $p$, t, t);

    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;

