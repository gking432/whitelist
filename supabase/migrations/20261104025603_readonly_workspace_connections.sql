SET check_function_bodies = false;
CREATE FUNCTION public.finish_readonly_workspace_oauth(p_attempt uuid, p_encrypted text, p_last_four text, p_account_id text, p_account_name text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a public.business_connection_oauth_attempts; c public.integration_connections;
begin
 select * into strict a from public.business_connection_oauth_attempts where id=p_attempt;
 if a.consumed_at is null or a.expires_at < now() then raise exception 'Authorization expired'; end if;
 select * into strict c from public.integration_connections where id=a.connection_id and partner_id=a.partner_id and client_id=a.client_id for update;
 select * into strict a from public.business_connection_oauth_attempts where id=p_attempt for update;
 if a.consumed_at is null or a.expires_at < now() then raise exception 'Authorization expired'; end if;
 if c.config->>'workspace_view_only' is distinct from 'true' then raise exception 'Connection changed'; end if;
 if c.external_account_id is not null and c.external_account_id<>p_account_id then raise exception 'Reconnect the same Google account'; end if;
 insert into public.integration_secrets(partner_id,client_id,connection_id,secret_kind,encrypted_value,last_four)
 values(a.partner_id,a.client_id,c.id,'provider_credentials',p_encrypted,p_last_four)
 on conflict(connection_id,secret_kind) do update set encrypted_value=excluded.encrypted_value,last_four=excluded.last_four,updated_at=now();
 update public.integration_connections set status='connected',runtime_mode='dry_run',credential_status='configured',
  external_account_id=p_account_id,external_account_name=p_account_name,health_summary='Read-only Gmail and primary calendar connected.',last_checked_at=now(),last_success_at=now() where id=c.id;
 update public.integration_sync_states set status='idle',last_error=null,lease_owner=null,lease_expires_at=null where connection_id=c.id;
 delete from public.business_connection_oauth_attempts where id=p_attempt;
end $function$;
GRANT ALL ON FUNCTION public.finish_readonly_workspace_oauth(uuid, text, text, text, text) TO service_role;
CREATE FUNCTION public.manage_readonly_workspace_connection(p_partner uuid, p_client uuid, p_connection uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.integration_connections;
begin
 select * into strict c from public.integration_connections where id=p_connection and partner_id=p_partner and client_id=p_client for update;
 if c.config->>'workspace_view_only' is distinct from 'true' or p_action not in ('pause','resume','disconnect') then raise exception 'Invalid connection action'; end if;
 if p_action='resume' then
  if c.status<>'connected' or c.credential_status<>'configured' then raise exception 'Reconnect Google first'; end if;
  update public.integration_connections set runtime_mode='dry_run' where id=c.id;
 else
  update public.integration_connections set runtime_mode='paused',status=case when p_action='disconnect' then 'not_connected' else status end,
   credential_status=case when p_action='disconnect' then 'missing' else credential_status end where id=c.id;
  delete from public.business_connection_oauth_attempts where connection_id=c.id;
  update public.integration_sync_jobs set status='cancelled',completed_at=now(),locked_at=null,locked_by=null where connection_id=c.id and status in ('queued','running','failed');
  update public.integration_sync_states set status='paused' where connection_id=c.id;
  if p_action='disconnect' then
   update public.integration_connections set external_account_id=null,external_account_name=null where id=c.id;
   delete from public.integration_secrets where connection_id=c.id;
   delete from public.integration_canonical_records where connection_id=c.id;
   delete from public.integration_sync_states where connection_id=c.id;
  end if;
 end if;
end $function$;
GRANT ALL ON FUNCTION public.manage_readonly_workspace_connection(uuid, uuid, uuid, text) TO service_role;
CREATE TABLE public.business_connection_oauth_attempts (id uuid DEFAULT gen_random_uuid() NOT NULL, partner_id uuid NOT NULL, client_id uuid NOT NULL, connection_id uuid NOT NULL, actor_id uuid NOT NULL, cookie_hash text NOT NULL, encrypted_verifier text NOT NULL, expires_at timestamp with time zone NOT NULL, consumed_at timestamp with time zone, created_at timestamp with time zone DEFAULT now() NOT NULL);
ALTER TABLE public.business_connection_oauth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_connection_oauth_attempts ADD CONSTRAINT business_connection_oauth_att_connection_id_partner_id_cli_fkey FOREIGN KEY (connection_id, partner_id, client_id) REFERENCES public.integration_connections(id, partner_id, client_id) ON DELETE CASCADE;
ALTER TABLE public.business_connection_oauth_attempts ADD CONSTRAINT business_connection_oauth_attempts_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.business_connection_oauth_attempts ADD CONSTRAINT business_connection_oauth_attempts_partner_id_client_id_fkey FOREIGN KEY (partner_id, client_id) REFERENCES public.client_businesses(partner_id, id) ON DELETE CASCADE;
ALTER TABLE public.business_connection_oauth_attempts ADD CONSTRAINT business_connection_oauth_attempts_pkey PRIMARY KEY (id);
GRANT ALL ON public.business_connection_oauth_attempts TO service_role;
CREATE INDEX connection_oauth_scope ON public.business_connection_oauth_attempts (partner_id, client_id);
CREATE INDEX connection_oauth_actor ON public.business_connection_oauth_attempts (actor_id);
CREATE INDEX connection_oauth_connection ON public.business_connection_oauth_attempts (connection_id);

-- Explicitly deny the browser roles, including installations with broad default privileges.
REVOKE ALL ON public.business_connection_oauth_attempts FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_readonly_workspace_oauth(uuid,text,text,text,text) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.manage_readonly_workspace_connection(uuid,uuid,uuid,text) FROM public,anon,authenticated;
INSERT INTO public.platform_schema_state(singleton,current_migration,applied_at)
VALUES(true,'20261104025603_readonly_workspace_connections',now())
ON CONFLICT(singleton) DO UPDATE SET current_migration=excluded.current_migration,applied_at=excluded.applied_at;

-- Assistant settings cannot adopt or pause an independent read-only connection.
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
    and (c.config->>'workspace_view_only') is distinct from 'true'
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
