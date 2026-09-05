create table if not exists public.connector_development_tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  request_id uuid not null unique references public.integration_requests (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete restrict,
  approved_by uuid references public.profiles (id) on delete set null,
  status text not null default 'awaiting_approval',
  prompt_snapshot text not null,
  codex_thread_id text,
  branch_name text,
  final_response text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connector_development_tasks_status_check check (status in (
    'awaiting_approval', 'queued', 'running', 'succeeded', 'failed',
    'review_approved', 'staged', 'released', 'cancelled'
  ))
);

create index if not exists connector_development_tasks_queue_idx
  on public.connector_development_tasks (status, created_at)
  where status in ('queued', 'running');

drop trigger if exists set_connector_development_tasks_updated_at
  on public.connector_development_tasks;
create trigger set_connector_development_tasks_updated_at
before update on public.connector_development_tasks
for each row execute function public.set_updated_at();

alter table public.connector_development_tasks enable row level security;

create policy "connector_development_tasks_platform_only"
on public.connector_development_tasks for all to authenticated
using (public.current_user_has_platform_role(array[
  'platform_owner', 'platform_admin'
]::public.membership_role[]))
with check (public.current_user_has_platform_role(array[
  'platform_owner', 'platform_admin'
]::public.membership_role[]));

grant select, insert, update on public.connector_development_tasks to authenticated;
grant all on public.connector_development_tasks to service_role;
