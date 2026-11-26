create table if not exists public.platform_error_events (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  source text not null check (source in ('server', 'browser', 'desktop', 'voice_stream', 'job_worker')),
  severity text not null default 'error' check (severity in ('warning', 'error', 'fatal')),
  environment text not null default 'production',
  release text,
  message text not null,
  error_name text,
  digest text,
  route_path text,
  route_type text,
  stack_preview text,
  metadata jsonb not null default '{}'::jsonb,
  occurrence_count bigint not null default 1 check (occurrence_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution_note text
);

create index if not exists platform_error_events_unresolved_idx
  on public.platform_error_events (last_seen_at desc)
  where resolved_at is null;

alter table public.platform_error_events enable row level security;

drop policy if exists platform_error_events_owner_read on public.platform_error_events;
create policy platform_error_events_owner_read
on public.platform_error_events for select to authenticated
using (
  public.current_user_has_platform_role(
    array['platform_owner', 'platform_admin', 'platform_support']::public.membership_role[]
  )
);

drop policy if exists platform_error_events_owner_update on public.platform_error_events;
create policy platform_error_events_owner_update
on public.platform_error_events for update to authenticated
using (
  public.current_user_has_platform_role(
    array['platform_owner', 'platform_admin']::public.membership_role[]
  )
)
with check (
  public.current_user_has_platform_role(
    array['platform_owner', 'platform_admin']::public.membership_role[]
  )
);

grant select on public.platform_error_events to authenticated;
grant update (resolved_at, resolved_by, resolution_note) on public.platform_error_events to authenticated;
grant all on public.platform_error_events to service_role;

create or replace function public.record_platform_error(
  p_fingerprint text,
  p_source text,
  p_severity text,
  p_environment text,
  p_release text,
  p_message text,
  p_error_name text,
  p_digest text,
  p_route_path text,
  p_route_type text,
  p_stack_preview text,
  p_metadata jsonb
)
returns table(error_id uuid, occurrence_count bigint, should_alert boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  insert into public.platform_error_events (
    fingerprint, source, severity, environment, release, message, error_name,
    digest, route_path, route_type, stack_preview, metadata
  ) values (
    p_fingerprint, p_source, p_severity, p_environment, p_release, p_message,
    p_error_name, p_digest, p_route_path, p_route_type, p_stack_preview,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (fingerprint) do update set
    severity = excluded.severity,
    environment = excluded.environment,
    release = excluded.release,
    message = excluded.message,
    error_name = excluded.error_name,
    digest = excluded.digest,
    route_path = excluded.route_path,
    route_type = excluded.route_type,
    stack_preview = excluded.stack_preview,
    metadata = excluded.metadata,
    occurrence_count = case
      when platform_error_events.resolved_at is not null then 1
      else platform_error_events.occurrence_count + 1
    end,
    last_seen_at = now(),
    resolved_at = null,
    resolved_by = null,
    resolution_note = null
  returning
    platform_error_events.id,
    platform_error_events.occurrence_count,
    platform_error_events.occurrence_count = 1;
end;
$$;

revoke all on function public.record_platform_error(
  text, text, text, text, text, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_platform_error(
  text, text, text, text, text, text, text, text, text, text, text, jsonb
) to service_role;
