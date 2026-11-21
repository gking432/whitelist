-- Owner-selected assistants share existing connections, records and approval outbox.
create table if not exists public.business_agent_activation (
 client_id uuid primary key, partner_id uuid not null,
 revision integer not null default 1 check(revision > 0),
 status text not null check(status in ('active','paused')),
 inquiries boolean not null default true, bookings boolean not null default false,
 website boolean not null default true, email boolean not null default false,
 instagram boolean not null default false, sms boolean not null default false,
 workspace_provider text not null check(workspace_provider in ('google_workspace','microsoft_365')),
 workspace_connection_id uuid,
 updated_at timestamptz not null default now(),
 foreign key(partner_id,client_id) references public.client_businesses(partner_id,id) on delete cascade,
 foreign key(workspace_connection_id,partner_id,client_id) references public.integration_connections(id,partner_id,client_id),
 check(inquiries or bookings), check(website or email or instagram or sms)
);
alter table public.business_agent_activation enable row level security;
-- The authenticated application API checks workspace permissions. Neither table is a browser API.
revoke all on public.business_agent_activation from public,anon,authenticated;
grant all on public.business_agent_activation to service_role;
alter table public.business_agent_activation
 add column if not exists booking_start_hour integer not null default 9 check(booking_start_hour between 0 and 23),
 add column if not exists booking_end_hour integer not null default 17 check(booking_end_hour between 1 and 24),
 add column if not exists booking_minutes integer not null default 60 check(booking_minutes between 15 and 480),
 add column if not exists booking_weekdays integer[] not null default array[1,2,3,4,5] check(cardinality(booking_weekdays) between 1 and 7 and booking_weekdays <@ array[0,1,2,3,4,5,6]),
 add column if not exists timezone text not null default 'America/Chicago';

create table if not exists public.business_activation_oauth_attempts (
 id uuid primary key default gen_random_uuid(), partner_id uuid not null, client_id uuid not null,
 connection_id uuid not null, actor_id uuid not null references auth.users(id) on delete cascade,
 provider_key text not null check(provider_key in ('google_workspace','microsoft_365')),
 plan_revision integer not null, cookie_hash text not null,
 encrypted_verifier text not null, expires_at timestamptz not null,
 consumed_at timestamptz, created_at timestamptz not null default now(),
 foreign key(partner_id,client_id) references public.client_businesses(partner_id,id) on delete cascade,
 foreign key(connection_id,partner_id,client_id) references public.integration_connections(id,partner_id,client_id)
);
create index if not exists activation_oauth_client on public.business_activation_oauth_attempts(client_id,created_at desc);
create index if not exists activation_oauth_connection on public.business_activation_oauth_attempts(connection_id);
create index if not exists activation_oauth_actor on public.business_activation_oauth_attempts(actor_id);
create index if not exists activation_workspace_connection on public.business_agent_activation(workspace_connection_id);
alter table public.business_activation_oauth_attempts enable row level security;
revoke all on public.business_activation_oauth_attempts from public,anon,authenticated;
grant all on public.business_activation_oauth_attempts to service_role;

create or replace function public.apply_business_activation(p_partner uuid,p_client uuid,p_revision integer,p_choices jsonb,p_widget_key text)
returns void language plpgsql security invoker set search_path = '' as $$
declare plan public.business_agent_activation; conn record; selected boolean; now_at timestamptz := now(); widget_provider uuid;
begin
 -- Serializes first-time setup as well as concurrent edits and OAuth completion.
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner for update;
 if not found then raise exception 'Business unavailable'; end if;
 select * into plan from public.business_agent_activation where client_id=p_client and partner_id=p_partner for update;
 if coalesce(plan.revision,0) <> p_revision then raise exception 'Setup changed. Refresh before saving.'; end if;
 if p_choices is not null then
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_choices->>'timezone') or
    (p_choices->>'booking_end_hour')::integer<=(p_choices->>'booking_start_hour')::integer or
    (p_choices->>'booking_minutes')::integer > ((p_choices->>'booking_end_hour')::integer-(p_choices->>'booking_start_hour')::integer)*60 then raise exception 'Invalid booking hours'; end if;
  insert into public.business_agent_activation(client_id,partner_id,status,inquiries,bookings,website,email,instagram,sms,workspace_provider,booking_start_hour,booking_end_hour,booking_minutes,booking_weekdays,timezone)
  values(p_client,p_partner,p_choices->>'status',(p_choices->>'inquiries')::boolean,(p_choices->>'bookings')::boolean,
   (p_choices->>'website')::boolean,(p_choices->>'email')::boolean,(p_choices->>'instagram')::boolean,(p_choices->>'sms')::boolean,p_choices->>'workspace_provider',
   (p_choices->>'booking_start_hour')::integer,(p_choices->>'booking_end_hour')::integer,(p_choices->>'booking_minutes')::integer,
   array(select jsonb_array_elements_text(p_choices->'booking_weekdays')::integer),p_choices->>'timezone')
  on conflict(client_id) do update set status=excluded.status,inquiries=excluded.inquiries,bookings=excluded.bookings,
   website=excluded.website,email=excluded.email,instagram=excluded.instagram,sms=excluded.sms,workspace_provider=excluded.workspace_provider,
   booking_start_hour=excluded.booking_start_hour,booking_end_hour=excluded.booking_end_hour,booking_minutes=excluded.booking_minutes,booking_weekdays=excluded.booking_weekdays,timezone=excluded.timezone,
   workspace_connection_id=case when business_agent_activation.workspace_provider=excluded.workspace_provider then business_agent_activation.workspace_connection_id else null end,
   revision=business_agent_activation.revision+1,updated_at=now_at;
 end if;
 select * into strict plan from public.business_agent_activation where client_id=p_client and partner_id=p_partner;
 if plan.website then
  select id into widget_provider from public.integration_providers where provider_key='northstar_web_chat' and is_active;
  if widget_provider is null then raise exception 'Website chat unavailable'; end if;
  if not exists(select 1 from public.integration_connections where partner_id=p_partner and client_id=p_client and provider_id=widget_provider) then
   if p_widget_key is null or p_widget_key !~ '^wk_[A-Za-z0-9_-]{20,}$' then raise exception 'Invalid website key'; end if;
   insert into public.integration_connections(partner_id,client_id,provider_id,display_name,status,runtime_mode,credential_status,config)
    values(p_partner,p_client,widget_provider,'Website chat','connected','live','configured',jsonb_build_object('widget_public_key',p_widget_key,'activation_managed',true));
  else
   update public.integration_connections set config=config || jsonb_build_object('widget_public_key',coalesce(config->>'widget_public_key',p_widget_key)),status='connected',credential_status='configured'
    where partner_id=p_partner and client_id=p_client and provider_id=widget_provider;
  end if;
 end if;
 for conn in select c.*,p.provider_key from public.integration_connections c join public.integration_providers p on p.id=c.provider_id
  where c.partner_id=p_partner and c.client_id=p_client and p.provider_key in ('google_workspace','microsoft_365','northstar_web_chat','instagram_messaging','twilio')
  order by c.created_at,c.id for update of c
 loop
  selected := case conn.provider_key when 'northstar_web_chat' then plan.website when 'instagram_messaging' then plan.instagram when 'twilio' then plan.sms
    else (plan.email or plan.bookings) and conn.provider_key=plan.workspace_provider and (plan.workspace_connection_id is null or plan.workspace_connection_id=conn.id) end;
  if selected and conn.provider_key=plan.workspace_provider and plan.workspace_connection_id is null then
   update public.business_agent_activation set workspace_connection_id=conn.id where client_id=p_client;
   plan.workspace_connection_id:=conn.id;
  end if;
  if selected or conn.config->>'activation_managed'='true' then
   update public.integration_connections set
    runtime_mode=case when selected and plan.status='active' and conn.status='connected' and conn.credential_status='configured' then 'live'::public.runtime_mode else 'paused'::public.runtime_mode end,
    config=conn.config || jsonb_build_object('activation_managed',true,'activation_selected',selected,
      'activation_calendar_enabled',selected and plan.bookings and conn.provider_key=plan.workspace_provider,
      'conversation_intake_enabled',selected and (conn.provider_key not in ('google_workspace','microsoft_365') or plan.email),
      'conversation_intake_enabled_at',case when selected and plan.email and conn.provider_key=plan.workspace_provider
        then case when conn.config->>'conversation_intake_enabled'='true' then coalesce(conn.config->>'conversation_intake_enabled_at',now_at::text) else now_at::text end
        else conn.config->>'conversation_intake_enabled_at' end)
    where id=conn.id;
  end if;
 end loop;
 insert into public.agent_team_settings(client_id,partner_id,status,conversations_enabled,scheduling_enabled)
 values(p_client,p_partner,plan.status,true,plan.bookings)
 on conflict(client_id) do update set status=excluded.status,conversations_enabled=true,scheduling_enabled=excluded.scheduling_enabled,updated_at=now_at;
end $$;
revoke all on function public.apply_business_activation(uuid,uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.apply_business_activation(uuid,uuid,integer,jsonb,text) to service_role;

create or replace function public.record_activation_workspace_check(p_partner uuid,p_client uuid,p_revision integer,p_connection uuid,p_email boolean,p_calendar boolean)
returns void language plpgsql security invoker set search_path='' as $$
declare plan public.business_agent_activation; healthy boolean;
begin
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner for update;
 select * into plan from public.business_agent_activation where client_id=p_client and partner_id=p_partner and revision=p_revision and workspace_connection_id=p_connection for update;
 if not found then raise exception 'Setup changed'; end if;
 healthy := (not plan.email or p_email) and (not plan.bookings or p_calendar);
 update public.integration_connections set config=config || jsonb_build_object('activation_checked_at',now(),'activation_mail_verified',p_email,'activation_calendar_verified',p_calendar),
  status=case when healthy then 'connected'::public.integration_status else 'needs_attention'::public.integration_status end,
  runtime_mode=case when healthy and plan.status='active' then 'live'::public.runtime_mode else 'paused'::public.runtime_mode end,
  credential_status=case when healthy then 'configured' else credential_status end,last_checked_at=now()
 where id=p_connection and partner_id=p_partner and client_id=p_client;
 if healthy then
  update public.integration_sync_states set status='idle',last_error=null,lease_owner=null,lease_expires_at=null
   where connection_id=p_connection and partner_id=p_partner and client_id=p_client and status='paused';
 end if;
end $$;
revoke all on function public.record_activation_workspace_check(uuid,uuid,integer,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.record_activation_workspace_check(uuid,uuid,integer,uuid,boolean,boolean) to service_role;

create or replace function public.finish_activation_oauth(p_attempt uuid,p_encrypted text,p_last_four text,p_account_id text,p_account_name text,p_email boolean,p_calendar boolean)
returns void language plpgsql security invoker set search_path='' as $$
declare attempt public.business_activation_oauth_attempts; plan public.business_agent_activation;
begin
 select * into strict attempt from public.business_activation_oauth_attempts where id=p_attempt for update;
 perform 1 from public.client_businesses where id=attempt.client_id and partner_id=attempt.partner_id for update;
 select * into strict plan from public.business_agent_activation where client_id=attempt.client_id and partner_id=attempt.partner_id for update;
 if plan.revision<>attempt.plan_revision or plan.status<>'active' or plan.workspace_provider<>attempt.provider_key or attempt.consumed_at is null or attempt.expires_at<now() then
  raise exception 'Setup changed or authorization expired';
 end if;
 perform 1 from public.integration_connections c join public.integration_providers p on p.id=c.provider_id where c.id=attempt.connection_id and c.client_id=attempt.client_id and c.partner_id=attempt.partner_id and p.provider_key=attempt.provider_key;
 if not found then raise exception 'Connection unavailable'; end if;
 if exists(select 1 from public.integration_connections where id=attempt.connection_id and external_account_id is not null and external_account_id<>p_account_id) then
  raise exception 'Reconnect the same account. Account replacement requires a separate migration.';
 end if;
 if (plan.email and not p_email) or (plan.bookings and not p_calendar) then raise exception 'Missing permissions'; end if;
 insert into public.integration_secrets(partner_id,client_id,connection_id,secret_kind,encrypted_value,last_four)
 values(attempt.partner_id,attempt.client_id,attempt.connection_id,'provider_credentials',p_encrypted,p_last_four)
 on conflict(connection_id,secret_kind) do update set encrypted_value=excluded.encrypted_value,last_four=excluded.last_four,updated_at=now();
 update public.integration_connections set status='connected',credential_status='configured',external_account_id=p_account_id,external_account_name=p_account_name,
  last_checked_at=now(),last_success_at=now(),health_summary='Account authorized; selected capabilities checked.',
  config=config || jsonb_build_object('activation_account_email',p_account_name) where id=attempt.connection_id;
 update public.business_agent_activation set workspace_connection_id=attempt.connection_id where client_id=attempt.client_id;
 perform public.record_activation_workspace_check(attempt.partner_id,attempt.client_id,plan.revision,attempt.connection_id,p_email,p_calendar);
 perform public.apply_business_activation(attempt.partner_id,attempt.client_id,plan.revision,null,null);
 -- Delete sensitive transient material; a consumed attempt cannot be completed twice.
 delete from public.business_activation_oauth_attempts where id=p_attempt;
end $$;
revoke all on function public.finish_activation_oauth(uuid,text,text,text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.finish_activation_oauth(uuid,text,text,text,text,boolean,boolean) to service_role;

create or replace function public.due_activation_checks(p_limit integer default 3)
returns setof public.business_agent_activation language sql security invoker set search_path='' as $$
 select a.* from public.business_agent_activation a join public.integration_connections c on c.id=a.workspace_connection_id
 join public.client_businesses b on b.id=a.client_id and b.partner_id=a.partner_id
 where a.status='active' and b.status='active' and (a.email or a.bookings) and c.credential_status='configured'
 and coalesce((c.config->>'activation_checked_at')::timestamptz,'-infinity'::timestamptz) < now()-interval '1 hour'
 order by coalesce((c.config->>'activation_checked_at')::timestamptz,'-infinity'::timestamptz)
 limit greatest(1,least(p_limit,10))
$$;
revoke all on function public.due_activation_checks(integer) from public,anon,authenticated;
grant execute on function public.due_activation_checks(integer) to service_role;

insert into public.platform_schema_state(singleton,current_migration,applied_at) values(true,'20261009014610_business_agent_activation',now())
on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;
