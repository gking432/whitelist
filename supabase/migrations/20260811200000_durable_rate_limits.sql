create table if not exists public.api_rate_limit_windows (
  key_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (key_hash, window_started_at)
);

alter table public.api_rate_limit_windows enable row level security;
revoke all on public.api_rate_limit_windows from anon, authenticated;
grant all on public.api_rate_limit_windows to service_role;

create or replace function public.consume_api_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_started_at timestamptz;
  v_count integer;
begin
  if p_key_hash !~ '^[0-9a-f]{64}$'
    or p_limit < 1 or p_limit > 10000
    or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'Invalid rate-limit input';
  end if;

  v_window_started_at := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds)
    * p_window_seconds
  );

  insert into public.api_rate_limit_windows (
    key_hash, window_started_at, request_count, updated_at
  ) values (
    p_key_hash, v_window_started_at, 1, now()
  )
  on conflict (key_hash, window_started_at) do update
  set request_count = public.api_rate_limit_windows.request_count + 1,
      updated_at = now()
  returning request_count into v_count;

  return query select
    v_count <= p_limit,
    case when v_count <= p_limit then 0 else greatest(
      1,
      ceil(extract(epoch from (
        v_window_started_at + make_interval(secs => p_window_seconds) - clock_timestamp()
      )))::integer
    ) end;
end;
$$;

revoke all on function public.consume_api_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer) to service_role;
