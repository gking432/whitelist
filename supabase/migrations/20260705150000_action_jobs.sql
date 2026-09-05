-- Durable outbound action attempts. Every provider-facing action (approved
-- SMS/email delivery, calendar booking, CRM sync) records an action_jobs
-- row so failures are visible and retryable instead of vanishing into a
-- synchronous call stack. Rows are written ONLY by trusted server paths
-- (service role); browser roles can read, never write.

create table if not exists public.action_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  connection_id uuid references public.integration_connections (id) on delete set null,
  approval_id uuid references public.approval_items (id) on delete set null,
  workflow_run_id uuid references public.workflow_runs (id) on delete set null,
  kind text not null check (kind in ('sms.send', 'email.send', 'calendar.book', 'crm.sync')),
  -- Customer-facing content only (to/body/slot/contact). Never secrets.
  payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('pending', 'succeeded', 'dry_run', 'skipped', 'failed', 'cancelled')),
  attempt_count integer not null default 0,
  last_error text,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists action_jobs_client_idx
  on public.action_jobs (client_id, status, created_at desc);

drop trigger if exists set_action_jobs_updated_at on public.action_jobs;
create trigger set_action_jobs_updated_at
  before update on public.action_jobs
  for each row execute function public.set_updated_at();

alter table public.action_jobs enable row level security;

drop policy if exists "action_jobs_select_scoped" on public.action_jobs;
create policy "action_jobs_select_scoped"
on public.action_jobs
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or public.current_user_has_partner_client_role(partner_id, client_id)
);

-- Read-only for browser roles; the service role (bypasses RLS) writes.
grant select on public.action_jobs to authenticated;
