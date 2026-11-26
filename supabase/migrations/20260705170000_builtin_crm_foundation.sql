-- Built-in CRM foundation (docs/12 "Built-In CRM Mode"). For clients
-- without a strong operating stack, Northstar itself holds contacts,
-- leads, timeline, tasks, and appointments. External CRM modes remain
-- primary for most clients; these tables fill when the client's
-- crm_operating_mode is primary_crm, mirror, or assist. The AI assistant
-- writes timeline contributions attributed as actor_type 'ai_assistant'.

create table if not exists public.crm_contacts (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  first_name text,
  last_name text,
  email text,
  phone text,
  address text,
  source text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_contacts_client_idx
  on public.crm_contacts (client_id, created_at desc);
create index if not exists crm_contacts_email_idx
  on public.crm_contacts (client_id, email);
create index if not exists crm_contacts_phone_idx
  on public.crm_contacts (client_id, phone);

create table if not exists public.crm_leads (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  contact_id uuid not null references public.crm_contacts (id) on delete cascade,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'quoted', 'scheduled', 'won', 'lost')),
  source_event_type text,
  urgency text,
  quality text,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_leads_client_idx
  on public.crm_leads (client_id, status, created_at desc);

create table if not exists public.crm_timeline_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  contact_id uuid references public.crm_contacts (id) on delete cascade,
  lead_id uuid references public.crm_leads (id) on delete set null,
  kind text not null
    check (kind in ('note', 'message', 'task', 'appointment', 'system')),
  actor_type text not null default 'system'
    check (actor_type in ('ai_assistant', 'user', 'system')),
  actor_user_id uuid references auth.users (id) on delete set null,
  title text not null,
  body text,
  ref_run_id uuid references public.workflow_runs (id) on delete set null,
  ref_approval_id uuid references public.approval_items (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists crm_timeline_contact_idx
  on public.crm_timeline_entries (contact_id, created_at desc);
create index if not exists crm_timeline_client_idx
  on public.crm_timeline_entries (client_id, created_at desc);

create table if not exists public.crm_tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  contact_id uuid references public.crm_contacts (id) on delete cascade,
  title text not null,
  description text,
  priority text not null default 'medium'
    check (priority in ('urgent', 'high', 'medium', 'low')),
  status text not null default 'open'
    check (status in ('open', 'done', 'cancelled')),
  due_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_tasks_client_idx
  on public.crm_tasks (client_id, status, due_at);

create table if not exists public.crm_appointments (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  contact_id uuid references public.crm_contacts (id) on delete cascade,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'booked', 'cancelled', 'completed')),
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_appointments_client_idx
  on public.crm_appointments (client_id, start_at desc);

-- updated_at triggers
drop trigger if exists set_crm_contacts_updated_at on public.crm_contacts;
create trigger set_crm_contacts_updated_at
  before update on public.crm_contacts
  for each row execute function public.set_updated_at();

drop trigger if exists set_crm_leads_updated_at on public.crm_leads;
create trigger set_crm_leads_updated_at
  before update on public.crm_leads
  for each row execute function public.set_updated_at();

drop trigger if exists set_crm_tasks_updated_at on public.crm_tasks;
create trigger set_crm_tasks_updated_at
  before update on public.crm_tasks
  for each row execute function public.set_updated_at();

drop trigger if exists set_crm_appointments_updated_at on public.crm_appointments;
create trigger set_crm_appointments_updated_at
  before update on public.crm_appointments
  for each row execute function public.set_updated_at();

-- RLS: tenant members read; partner operators and client owner/manager
-- write. The AI/engine writes through the service role.
do $$
declare
  t text;
begin
  foreach t in array array[
    'crm_contacts', 'crm_leads', 'crm_timeline_entries', 'crm_tasks', 'crm_appointments'
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
