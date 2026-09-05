-- Partner-requested connector work and its owner/partner conversation.

create table if not exists public.integration_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid references public.client_businesses (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete restrict,
  assigned_to uuid references public.profiles (id) on delete set null,
  application_name text not null,
  application_url text,
  category text not null default 'other',
  trigger_description text not null,
  desired_result text not null,
  current_systems text[] not null default array[]::text[],
  priority text not null default 'normal',
  status text not null default 'requested',
  connector_key text,
  release_version text,
  staging_evidence jsonb not null default '{}'::jsonb,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_requests_priority_check
    check (priority in ('normal', 'important', 'blocking')),
  constraint integration_requests_status_check
    check (status in (
      'requested', 'researching', 'needs_information', 'building', 'testing',
      'ready', 'released', 'blocked', 'declined'
    )),
  constraint integration_requests_client_scope_fk
    foreign key (partner_id, client_id)
    references public.client_businesses (partner_id, id)
    on delete cascade
);

create table if not exists public.integration_request_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  request_id uuid not null references public.integration_requests (id) on delete cascade,
  partner_id uuid not null references public.partners (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete restrict,
  audience text not null default 'partner',
  body text not null,
  created_at timestamptz not null default now(),
  constraint integration_request_messages_audience_check
    check (audience in ('partner', 'internal'))
);

create index if not exists integration_requests_partner_status_idx
  on public.integration_requests (partner_id, status, updated_at desc);
create index if not exists integration_requests_owner_queue_idx
  on public.integration_requests (status, priority, updated_at desc);
create index if not exists integration_request_messages_request_idx
  on public.integration_request_messages (request_id, created_at);

drop trigger if exists set_integration_requests_updated_at on public.integration_requests;
create trigger set_integration_requests_updated_at
before update on public.integration_requests
for each row execute function public.set_updated_at();

alter table public.integration_requests enable row level security;
alter table public.integration_request_messages enable row level security;

create policy "integration_requests_select_scoped"
on public.integration_requests for select to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
);

create policy "integration_requests_insert_partner_operators"
on public.integration_requests for insert to authenticated
with check (
  requested_by = auth.uid()
  and (
    public.current_user_has_platform_role()
    or public.current_user_has_partner_role(partner_id, array[
      'partner_owner', 'partner_admin', 'partner_implementer'
    ]::public.membership_role[])
  )
);

create policy "integration_requests_update_platform"
on public.integration_requests for update to authenticated
using (public.current_user_has_platform_role(array[
  'platform_owner', 'platform_admin'
]::public.membership_role[]))
with check (public.current_user_has_platform_role(array[
  'platform_owner', 'platform_admin'
]::public.membership_role[]));

create policy "integration_request_messages_select_scoped"
on public.integration_request_messages for select to authenticated
using (
  public.current_user_has_platform_role()
  or (
    audience = 'partner'
    and public.current_user_has_partner_role(partner_id)
  )
);

create policy "integration_request_messages_insert_scoped"
on public.integration_request_messages for insert to authenticated
with check (
  author_id = auth.uid()
  and (
    public.current_user_has_platform_role(array[
      'platform_owner', 'platform_admin'
    ]::public.membership_role[])
    or (
      audience = 'partner'
      and public.current_user_has_partner_role(partner_id, array[
        'partner_owner', 'partner_admin', 'partner_implementer'
      ]::public.membership_role[])
    )
  )
);

grant select, insert on public.integration_requests to authenticated;
grant update on public.integration_requests to authenticated;
grant select, insert on public.integration_request_messages to authenticated;
grant all on public.integration_requests to service_role;
grant all on public.integration_request_messages to service_role;
