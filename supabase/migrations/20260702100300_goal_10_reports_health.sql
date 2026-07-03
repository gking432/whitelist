-- Goal 10: reporting aggregates.
-- client_metrics_daily is the durable aggregation target; the aggregation
-- function is the placeholder entry point for a future scheduled job.

create table if not exists public.client_metrics_daily (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  date date not null,
  workflow_runs integer not null default 0,
  failed_runs integer not null default 0,
  approvals_created integer not null default 0,
  approvals_resolved integer not null default 0,
  integration_events integer not null default 0,
  estimated_value_cents integer,
  created_at timestamptz not null default now(),
  constraint client_metrics_daily_client_date_unique unique (client_id, date),
  constraint client_metrics_daily_client_scope_fk
    foreign key (partner_id, client_id)
    references public.client_businesses (partner_id, id)
    on delete cascade
);

create index if not exists client_metrics_daily_partner_date_idx
  on public.client_metrics_daily (partner_id, date desc);

alter table public.client_metrics_daily enable row level security;

create policy "client_metrics_daily_select_accessible"
on public.client_metrics_daily
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or public.current_user_has_client_role(client_id)
);

grant select on public.client_metrics_daily to authenticated;

-- Aggregation placeholder: intended to run from a scheduled job (service role)
-- or a platform admin. Recomputes one day of metrics for all clients.
create or replace function public.aggregate_client_metrics_daily(target_date date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  if not (
    auth.uid() is null
    or public.current_user_has_platform_role(array[
      'platform_owner',
      'platform_admin'
    ]::public.membership_role[])
  ) then
    raise exception 'not authorized';
  end if;

  insert into public.client_metrics_daily (
    partner_id,
    client_id,
    date,
    workflow_runs,
    failed_runs,
    approvals_created,
    approvals_resolved,
    integration_events
  )
  select
    c.partner_id,
    c.id,
    target_date,
    coalesce(r.total_runs, 0),
    coalesce(r.failed_runs, 0),
    coalesce(a.approvals_created, 0),
    coalesce(a.approvals_resolved, 0),
    coalesce(e.integration_events, 0)
  from public.client_businesses c
  left join (
    select client_id,
           count(*) as total_runs,
           count(*) filter (where status = 'failed') as failed_runs
    from public.workflow_runs
    where created_at >= target_date
      and created_at < target_date + 1
    group by client_id
  ) r on r.client_id = c.id
  left join (
    select client_id,
           count(*) as approvals_created,
           count(*) filter (where resolved_at is not null) as approvals_resolved
    from public.approval_items
    where created_at >= target_date
      and created_at < target_date + 1
    group by client_id
  ) a on a.client_id = c.id
  left join (
    select client_id,
           count(*) as integration_events
    from public.integration_events
    where created_at >= target_date
      and created_at < target_date + 1
    group by client_id
  ) e on e.client_id = c.id
  on conflict (client_id, date) do update
    set workflow_runs = excluded.workflow_runs,
        failed_runs = excluded.failed_runs,
        approvals_created = excluded.approvals_created,
        approvals_resolved = excluded.approvals_resolved,
        integration_events = excluded.integration_events;

  get diagnostics affected = row_count;
  return affected;
end;
$$;
