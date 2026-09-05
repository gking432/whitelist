create table public.ai_daily_token_budgets (
  scope_key text not null,
  day date not null,
  committed_tokens bigint not null default 0 check(committed_tokens >= 0),
  primary key(scope_key,day)
);
create table public.ai_call_usage (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  client_id uuid references public.client_businesses(id) on delete cascade,
  scope_key text not null,
  day date not null,
  task_key text not null,
  provider text not null default 'anthropic',
  model text not null,
  prompt_hash text not null,
  reserved_tokens integer not null check(reserved_tokens>0),
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  status text not null default 'reserved' check(status in ('reserved','succeeded','failed')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.ai_daily_token_budgets enable row level security;
alter table public.ai_call_usage enable row level security;
revoke all on public.ai_daily_token_budgets,public.ai_call_usage from public,anon,authenticated;
grant all on public.ai_daily_token_budgets,public.ai_call_usage to service_role;
grant select on public.ai_call_usage to authenticated;
create policy ai_call_usage_scoped on public.ai_call_usage for select to authenticated using (
  public.current_user_has_platform_role() or public.current_user_has_partner_role(partner_id)
  or public.current_user_client_sections(client_id,array['reports'])
);

create or replace function public.reserve_ai_call(p_partner uuid,p_client uuid,p_task text,p_model text,p_hash text,p_tokens integer,p_limit integer)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare scope text; day_key date := (now() at time zone 'UTC')::date; call_id uuid;
begin
  if not exists(select 1 from public.partners where id=p_partner) or (p_client is not null and not exists(select 1 from public.client_businesses where id=p_client and partner_id=p_partner)) then raise exception 'Invalid AI tenant scope'; end if;
  if p_tokens<1 or p_limit<1 or p_limit>10000000 or p_tokens>p_limit then return null; end if;
  if p_hash !~ '^[a-f0-9]{64}$' or length(p_task)>100 or length(p_model)>160 then raise exception 'Invalid AI accounting metadata'; end if;
  scope:=case when p_client is null then 'partner:'||p_partner else 'client:'||p_client end;
  insert into public.ai_daily_token_budgets(scope_key,day) values(scope,day_key) on conflict do nothing;
  update public.ai_daily_token_budgets set committed_tokens=committed_tokens+p_tokens
    where scope_key=scope and day=day_key and committed_tokens+p_tokens<=p_limit;
  if not found then return null; end if;
  insert into public.ai_call_usage(partner_id,client_id,scope_key,day,task_key,model,prompt_hash,reserved_tokens)
  values(p_partner,p_client,scope,day_key,p_task,p_model,p_hash,p_tokens) returning id into call_id;
  return call_id;
end $$;

create or replace function public.finish_ai_call(p_id uuid,p_input integer,p_output integer,p_latency integer,p_succeeded boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare call public.ai_call_usage; measured bigint;
begin
  select * into call from public.ai_call_usage where id=p_id for update;
  if not found or call.status<>'reserved' then return; end if;
  if p_input<0 or p_output<0 or p_latency<0 then raise exception 'Invalid AI usage'; end if;
  measured:=coalesce(p_input::bigint+p_output::bigint,call.reserved_tokens);
  update public.ai_daily_token_budgets set committed_tokens=greatest(0,committed_tokens-call.reserved_tokens+measured)
    where scope_key=call.scope_key and day=call.day;
  update public.ai_call_usage set input_tokens=p_input,output_tokens=p_output,latency_ms=p_latency,
    status=case when p_succeeded then 'succeeded' else 'failed' end,finished_at=now() where id=p_id;
  if p_input is not null and p_output is not null then
    insert into public.usage_events(partner_id,client_id,event_type,quantity,unit,metadata)
    values(call.partner_id,call.client_id,'ai.model_tokens',measured,'tokens',jsonb_build_object(
      'call_id',call.id,'provider',call.provider,'model',call.model,'task_key',call.task_key,
      'prompt_hash',call.prompt_hash,'input_tokens',p_input,'output_tokens',p_output,'latency_ms',p_latency));
  end if;
end $$;
revoke all on function public.reserve_ai_call(uuid,uuid,text,text,text,integer,integer),public.finish_ai_call(uuid,integer,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.reserve_ai_call(uuid,uuid,text,text,text,integer,integer),public.finish_ai_call(uuid,integer,integer,integer,boolean) to service_role;
