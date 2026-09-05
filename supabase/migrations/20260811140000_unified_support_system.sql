-- Unified support from client to partner to platform, with AI triage,
-- private escalation notes, evidence, and guarded release validation.

create table if not exists public.support_tickets (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid references public.client_businesses (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete restrict,
  assigned_to uuid references public.profiles (id) on delete set null,
  origin text not null,
  category text not null default 'other',
  priority text not null default 'normal',
  status text not null default 'new',
  current_route text not null default 'partner',
  title text not null,
  description text not null,
  affected_area text,
  related_connection_id uuid references public.integration_connections (id) on delete set null,
  related_workflow_run_id uuid references public.workflow_runs (id) on delete set null,
  ai_summary text,
  ai_diagnosis text,
  ai_recommended_action text,
  ai_recommended_route text,
  ai_confidence text,
  ai_metadata jsonb not null default '{}'::jsonb,
  escalated_by uuid references public.profiles (id) on delete set null,
  escalated_at timestamptz,
  escalation_reason text,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  resolution text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_tickets_origin_check
    check (origin in ('client', 'partner', 'platform', 'system')),
  constraint support_tickets_category_check
    check (category in (
      'how_to', 'setup', 'incident', 'bug', 'integration_request',
      'feature_request', 'billing', 'security', 'permissions', 'other'
    )),
  constraint support_tickets_priority_check
    check (priority in ('normal', 'important', 'critical')),
  constraint support_tickets_status_check
    check (status in (
      'new', 'triaged', 'waiting_requester', 'partner_working', 'escalated',
      'platform_working', 'validation', 'resolved', 'closed'
    )),
  constraint support_tickets_route_check
    check (current_route in ('partner', 'support_ai', 'platform', 'codex', 'owner')),
  constraint support_tickets_ai_route_check
    check (ai_recommended_route is null or ai_recommended_route in (
      'partner', 'support_ai', 'platform', 'codex', 'owner'
    )),
  constraint support_tickets_ai_confidence_check
    check (ai_confidence is null or ai_confidence in ('low', 'medium', 'high')),
  constraint support_tickets_client_scope_fk
    foreign key (partner_id, client_id)
    references public.client_businesses (partner_id, id)
    on delete cascade,
  constraint support_tickets_origin_scope_check
    check (origin <> 'client' or client_id is not null)
);

create table if not exists public.support_ticket_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid references public.client_businesses (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  author_kind text not null,
  audience text not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint support_ticket_messages_author_kind_check
    check (author_kind in ('client', 'partner', 'platform', 'ai', 'system')),
  constraint support_ticket_messages_audience_check
    check (audience in ('client', 'partner', 'internal')),
  constraint support_ticket_messages_client_scope_fk
    foreign key (partner_id, client_id)
    references public.client_businesses (partner_id, id)
    on delete cascade
);

create table if not exists public.support_ticket_events (
  id uuid primary key default extensions.gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid references public.client_businesses (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  event_type text not null,
  audience text not null default 'partner',
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint support_ticket_events_audience_check
    check (audience in ('client', 'partner', 'internal')),
  constraint support_ticket_events_client_scope_fk
    foreign key (partner_id, client_id)
    references public.client_businesses (partner_id, id)
    on delete cascade
);

create table if not exists public.support_ticket_attachments (
  id uuid primary key default extensions.gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid references public.client_businesses (id) on delete cascade,
  uploaded_by uuid references public.profiles (id) on delete set null,
  audience text not null default 'partner',
  file_name text not null,
  content_type text,
  storage_path text,
  external_url text,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  constraint support_ticket_attachments_audience_check
    check (audience in ('client', 'partner', 'internal')),
  constraint support_ticket_attachments_location_check
    check (storage_path is not null or external_url is not null),
  constraint support_ticket_attachments_client_scope_fk
    foreign key (partner_id, client_id)
    references public.client_businesses (partner_id, id)
    on delete cascade
);

create table if not exists public.support_ticket_releases (
  id uuid primary key default extensions.gen_random_uuid(),
  ticket_id uuid not null unique references public.support_tickets (id) on delete cascade,
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid references public.client_businesses (id) on delete cascade,
  branch_name text,
  feature_flag_key text,
  status text not null default 'draft',
  staging_url text,
  test_evidence jsonb not null default '{}'::jsonb,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  requester_confirmed_by uuid references public.profiles (id) on delete set null,
  requester_confirmed_at timestamptz,
  requester_notes text,
  released_at timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_ticket_releases_status_check
    check (status in (
      'draft', 'staging', 'requester_validation', 'requester_approved',
      'global_release', 'released', 'rolled_back'
    )),
  constraint support_ticket_releases_client_scope_fk
    foreign key (partner_id, client_id)
    references public.client_businesses (partner_id, id)
    on delete cascade
);

create table if not exists public.support_notification_outbox (
  id uuid primary key default extensions.gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  partner_id uuid not null references public.partners (id) on delete cascade,
  recipient_kind text not null,
  recipient_user_id uuid references public.profiles (id) on delete cascade,
  destination text not null,
  subject text not null,
  body text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  provider_ref text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint support_notification_outbox_recipient_check
    check (recipient_kind in ('partner', 'platform')),
  constraint support_notification_outbox_status_check
    check (status in ('pending', 'sent', 'failed')),
  constraint support_notification_outbox_once
    unique (ticket_id, recipient_kind, destination)
);

alter table public.integration_requests
  add column if not exists support_ticket_id uuid
  references public.support_tickets (id) on delete set null;

create index if not exists support_tickets_partner_status_idx
  on public.support_tickets (partner_id, status, updated_at desc);
create index if not exists support_tickets_client_status_idx
  on public.support_tickets (client_id, status, updated_at desc)
  where client_id is not null;
create index if not exists support_tickets_platform_queue_idx
  on public.support_tickets (current_route, priority, updated_at desc)
  where current_route in ('platform', 'codex', 'owner');
create index if not exists support_ticket_messages_ticket_idx
  on public.support_ticket_messages (ticket_id, created_at);
create index if not exists support_ticket_events_ticket_idx
  on public.support_ticket_events (ticket_id, created_at);
create index if not exists support_notification_outbox_pending_idx
  on public.support_notification_outbox (status, last_attempt_at, created_at)
  where status in ('pending', 'failed');

create or replace function public.enforce_support_ticket_child_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.support_tickets ticket
    where ticket.id = new.ticket_id
      and ticket.partner_id = new.partner_id
      and ticket.client_id is not distinct from new.client_id
  ) then
    raise exception 'Support ticket child scope does not match its ticket.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_support_ticket_messages_scope on public.support_ticket_messages;
create trigger enforce_support_ticket_messages_scope
before insert or update on public.support_ticket_messages
for each row execute function public.enforce_support_ticket_child_scope();
drop trigger if exists enforce_support_ticket_events_scope on public.support_ticket_events;
create trigger enforce_support_ticket_events_scope
before insert or update on public.support_ticket_events
for each row execute function public.enforce_support_ticket_child_scope();
drop trigger if exists enforce_support_ticket_attachments_scope on public.support_ticket_attachments;
create trigger enforce_support_ticket_attachments_scope
before insert or update on public.support_ticket_attachments
for each row execute function public.enforce_support_ticket_child_scope();
drop trigger if exists enforce_support_ticket_releases_scope on public.support_ticket_releases;
create trigger enforce_support_ticket_releases_scope
before insert or update on public.support_ticket_releases
for each row execute function public.enforce_support_ticket_child_scope();

drop trigger if exists set_support_tickets_updated_at on public.support_tickets;
create trigger set_support_tickets_updated_at
before update on public.support_tickets
for each row execute function public.set_updated_at();

drop trigger if exists set_support_ticket_releases_updated_at on public.support_ticket_releases;
create trigger set_support_ticket_releases_updated_at
before update on public.support_ticket_releases
for each row execute function public.set_updated_at();

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
alter table public.support_ticket_events enable row level security;
alter table public.support_ticket_attachments enable row level security;
alter table public.support_ticket_releases enable row level security;
alter table public.support_notification_outbox enable row level security;

drop policy if exists "support_tickets_select_scoped" on public.support_tickets;
create policy "support_tickets_select_scoped"
on public.support_tickets for select to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or (client_id is not null and public.current_user_has_client_role(client_id))
);

drop policy if exists "support_tickets_insert_scoped" on public.support_tickets;
create policy "support_tickets_insert_scoped"
on public.support_tickets for insert to authenticated
with check (
  requested_by = auth.uid()
  and (
    public.current_user_has_platform_role()
    or (
      origin = 'partner'
      and public.current_user_has_partner_role(partner_id)
    )
    or (
      origin = 'client'
      and client_id is not null
      and public.current_user_has_client_role(client_id)
    )
  )
);

-- Status and route transitions happen through trusted server actions after
-- role checks; message inserts remain available to the relevant tenant.
drop policy if exists "support_tickets_update_scoped" on public.support_tickets;
create policy "support_tickets_update_scoped"
on public.support_tickets for update to authenticated
using (
  public.current_user_has_platform_role(array[
    'platform_owner', 'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner', 'partner_admin', 'partner_implementer'
  ]::public.membership_role[])
)
with check (
  public.current_user_has_platform_role(array[
    'platform_owner', 'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner', 'partner_admin', 'partner_implementer'
  ]::public.membership_role[])
);

drop policy if exists "support_ticket_messages_select_scoped" on public.support_ticket_messages;
create policy "support_ticket_messages_select_scoped"
on public.support_ticket_messages for select to authenticated
using (
  public.current_user_has_platform_role()
  or (
    audience in ('client', 'partner')
    and public.current_user_has_partner_role(partner_id)
  )
  or (
    audience = 'client'
    and client_id is not null
    and public.current_user_has_client_role(client_id)
  )
);

drop policy if exists "support_ticket_messages_insert_scoped" on public.support_ticket_messages;
create policy "support_ticket_messages_insert_scoped"
on public.support_ticket_messages for insert to authenticated
with check (
  author_id = auth.uid()
  and (
    public.current_user_has_platform_role(array[
      'platform_owner', 'platform_admin'
    ]::public.membership_role[])
    or (
      author_kind = 'partner'
      and audience in ('client', 'partner')
      and public.current_user_has_partner_role(partner_id, array[
        'partner_owner', 'partner_admin', 'partner_implementer'
      ]::public.membership_role[])
    )
    or (
      author_kind = 'client'
      and audience = 'client'
      and client_id is not null
      and public.current_user_has_client_role(client_id)
    )
  )
);

drop policy if exists "support_ticket_events_select_scoped" on public.support_ticket_events;
create policy "support_ticket_events_select_scoped"
on public.support_ticket_events for select to authenticated
using (
  public.current_user_has_platform_role()
  or (
    audience in ('client', 'partner')
    and public.current_user_has_partner_role(partner_id)
  )
  or (
    audience = 'client'
    and client_id is not null
    and public.current_user_has_client_role(client_id)
  )
);

drop policy if exists "support_ticket_events_insert_operators" on public.support_ticket_events;
create policy "support_ticket_events_insert_operators"
on public.support_ticket_events for insert to authenticated
with check (
  actor_id = auth.uid()
  and (
    public.current_user_has_platform_role(array[
      'platform_owner', 'platform_admin'
    ]::public.membership_role[])
    or public.current_user_has_partner_role(partner_id, array[
      'partner_owner', 'partner_admin', 'partner_implementer'
    ]::public.membership_role[])
  )
);

drop policy if exists "support_ticket_attachments_select_scoped" on public.support_ticket_attachments;
create policy "support_ticket_attachments_select_scoped"
on public.support_ticket_attachments for select to authenticated
using (
  public.current_user_has_platform_role()
  or (audience in ('client', 'partner') and public.current_user_has_partner_role(partner_id))
  or (audience = 'client' and client_id is not null and public.current_user_has_client_role(client_id))
);

drop policy if exists "support_ticket_attachments_insert_scoped" on public.support_ticket_attachments;
create policy "support_ticket_attachments_insert_scoped"
on public.support_ticket_attachments for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and (
    public.current_user_has_platform_role(array['platform_owner', 'platform_admin']::public.membership_role[])
    or public.current_user_has_partner_role(partner_id, array['partner_owner', 'partner_admin', 'partner_implementer']::public.membership_role[])
    or (audience = 'client' and client_id is not null and public.current_user_has_client_role(client_id))
  )
);

drop policy if exists "support_ticket_releases_select_scoped" on public.support_ticket_releases;
create policy "support_ticket_releases_select_scoped"
on public.support_ticket_releases for select to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or (
    status in ('requester_validation', 'requester_approved', 'global_release', 'released')
    and client_id is not null
    and public.current_user_has_client_role(client_id)
  )
);

drop policy if exists "support_ticket_releases_write_platform" on public.support_ticket_releases;
create policy "support_ticket_releases_write_platform"
on public.support_ticket_releases for all to authenticated
using (public.current_user_has_platform_role(array['platform_owner', 'platform_admin']::public.membership_role[]))
with check (public.current_user_has_platform_role(array['platform_owner', 'platform_admin']::public.membership_role[]));

drop policy if exists "support_notification_outbox_select_scoped" on public.support_notification_outbox;
create policy "support_notification_outbox_select_scoped"
on public.support_notification_outbox for select to authenticated
using (
  public.current_user_has_platform_role()
  or (
    recipient_kind = 'partner'
    and public.current_user_has_partner_role(partner_id)
  )
);

grant select, insert on public.support_tickets to authenticated;
grant select, insert on public.support_ticket_messages to authenticated;
grant select, insert on public.support_ticket_events to authenticated;
grant select, insert on public.support_ticket_attachments to authenticated;
grant select on public.support_ticket_releases to authenticated;
grant select on public.support_notification_outbox to authenticated;
grant all on public.support_tickets to service_role;
grant all on public.support_ticket_messages to service_role;
grant all on public.support_ticket_events to service_role;
grant all on public.support_ticket_attachments to service_role;
grant all on public.support_ticket_releases to service_role;
grant all on public.support_notification_outbox to service_role;
