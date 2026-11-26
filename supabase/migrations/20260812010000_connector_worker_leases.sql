-- Durable leases for the trusted Codex connector worker. The public web
-- service only queues approved work; a separate trusted process claims it.

alter table public.connector_development_tasks
  add column if not exists worker_id text,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists attempt_count integer not null default 0,
  add column if not exists max_attempts integer not null default 3;

alter table public.connector_development_tasks
  drop constraint if exists connector_development_tasks_attempts_check;
alter table public.connector_development_tasks
  add constraint connector_development_tasks_attempts_check
  check (attempt_count >= 0 and max_attempts between 1 and 10);

create index if not exists connector_development_tasks_available_queue_idx
  on public.connector_development_tasks (available_at, created_at)
  where status = 'queued';

create index if not exists connector_development_tasks_heartbeat_idx
  on public.connector_development_tasks (heartbeat_at)
  where status = 'running';
