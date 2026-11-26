-- Deliberate OAuth decision conflicts use HTTP 409 under PostgREST.
-- Only eight explicit SQLSTATE literals change. Backend errors propagate unchanged.
-- CREATE OR REPLACE preserves existing owners and service-only ACLs.

create or replace function public.finish_readonly_workspace_oauth(p_attempt uuid,p_encrypted text,p_last_four text,p_account_id text,p_account_name text)
returns void language plpgsql security invoker set search_path='' as $$
declare a public.business_connection_oauth_attempts; c public.integration_connections; provider text; secret public.integration_secrets;
begin
 select * into strict a from public.business_connection_oauth_attempts where id=p_attempt;
 perform 1 from public.client_businesses where id=a.client_id and partner_id=a.partner_id and status='active' for update;
 if not found then raise exception 'Business unavailable'; end if;
 select * into strict c from public.integration_connections where id=a.connection_id and partner_id=a.partner_id and client_id=a.client_id for update;
 select * into strict a from public.business_connection_oauth_attempts where id=p_attempt for update;
 select * into secret from public.integration_secrets where connection_id=c.id and partner_id=c.partner_id and client_id=c.client_id and secret_kind='provider_credentials' for update;
 select provider_key into provider from public.integration_providers where id=c.provider_id;
 if a.consumed_at is null or a.expires_at<now() or provider<>a.provider_key or provider not in ('google_workspace','microsoft_365') then raise exception 'Authorization expired or provider changed'; end if;
 if c.config->>'workspace_view_only' is distinct from 'true' or a.purpose is distinct from 'read_only' or c.updated_at is distinct from a.expected_connection_updated_at or secret.updated_at is distinct from a.expected_secret_updated_at or c.external_account_id is distinct from a.expected_account_id then raise exception 'Connection changed' using errcode='PT409'; end if;
 -- An older read-only attempt cannot silently downgrade a completed explicit
 -- upgrade. Normal reconnect of an upgraded account uses permission_upgrade.
 if provider='google_workspace' and (c.config->'google_action_permissions'->>'calendar_write'='true' or c.config->'google_action_permissions'->>'email_send'='true') then raise exception 'Reconnect the existing selected Google permissions' using errcode='PT409'; end if;
 if c.external_account_id is not null and c.external_account_id<>p_account_id then raise exception 'Reconnect the same account'; end if;
 if exists(select 1 from public.integration_connections other where other.partner_id=a.partner_id and other.client_id=a.client_id and
  other.provider_id=c.provider_id and other.id<>c.id and other.external_account_id=p_account_id and other.config->>'workspace_view_only'='true' and other.status in ('connected','needs_attention')) then
  raise exception 'This account is already connected. Reconnect its existing connection.';
 end if;
 insert into public.integration_secrets(partner_id,client_id,connection_id,secret_kind,encrypted_value,last_four)
 values(a.partner_id,a.client_id,c.id,'provider_credentials',p_encrypted,p_last_four)
 on conflict(connection_id,secret_kind) do update set encrypted_value=excluded.encrypted_value,last_four=excluded.last_four,updated_at=now();
 update public.integration_connections set status='connected',runtime_mode='dry_run',credential_status='configured',
 external_account_id=p_account_id,external_account_name=p_account_name,health_summary='Read-only email and calendar access verified; import pending.',last_checked_at=now(),last_success_at=now() where id=c.id;
 update public.integration_sync_states set status='idle',last_error=null,lease_owner=null,lease_expires_at=null where connection_id=c.id and partner_id=a.partner_id and client_id=a.client_id;
 delete from public.business_connection_oauth_attempts where id=p_attempt;
end $$;

create or replace function public.finish_google_permission_upgrade(p_attempt uuid,p_encrypted text,p_last_four text,p_account_id text,p_account_name text,p_verified_scopes text[],p_selected_permissions text[])
returns void language plpgsql security invoker set search_path='' as $$
declare a public.business_connection_oauth_attempts; c public.integration_connections; secret public.integration_secrets; provider text;
 permission text; old_scopes text[]; expected_permissions text[]:='{}'; old_permissions jsonb; permissions jsonb;
begin
 select * into strict a from public.business_connection_oauth_attempts where id=p_attempt;
 perform 1 from public.client_businesses where id=a.client_id and partner_id=a.partner_id and status='active' for update;
 if not found then raise exception 'Business unavailable' using errcode='PT409'; end if;
 select * into strict c from public.integration_connections where id=a.connection_id and partner_id=a.partner_id and client_id=a.client_id for update;
 select * into strict a from public.business_connection_oauth_attempts where id=p_attempt for update;
 select * into secret from public.integration_secrets where connection_id=c.id and partner_id=c.partner_id and client_id=c.client_id and secret_kind='provider_credentials' for update;
 select provider_key into provider from public.integration_providers where id=c.provider_id;
 if a.purpose is distinct from 'permission_upgrade' or a.provider_key is distinct from 'google_workspace' or provider is distinct from 'google_workspace' or a.consumed_at is null or a.expires_at<=now() or
  c.config->>'workspace_view_only' is distinct from 'true' or c.status not in ('connected','needs_attention') or c.credential_status<>'configured' or secret.id is null or
  c.updated_at is distinct from a.expected_connection_updated_at or secret.updated_at is distinct from a.expected_secret_updated_at or
  nullif(a.expected_account_id,'') is null or c.external_account_id is distinct from a.expected_account_id or p_account_id is distinct from a.expected_account_id or nullif(p_account_name,'') is null or
  nullif(p_encrypted,'') is null or p_last_four is null or p_verified_scopes is null or array_position(p_verified_scopes,null) is not null or p_selected_permissions is null or
  a.requested_permissions is null or cardinality(a.requested_permissions) not between 1 and 2 or not (a.requested_permissions<@array['calendar.write','email.send']) or array_position(a.requested_permissions,null) is not null then
  raise exception 'Google permission attempt, exact account or saved access changed' using errcode='PT409'; end if;
 if not (p_verified_scopes&&array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.modify','https://mail.google.com/']) or
  not (p_verified_scopes&&array['https://www.googleapis.com/auth/calendar.events.readonly','https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar','https://www.googleapis.com/auth/calendar.readonly']) or
  exists(select 1 from unnest(a.requested_permissions) requested where not public.google_upgrade_scope_allows(p_verified_scopes,requested)) then
  raise exception 'Actual verified Google grants are incomplete' using errcode='22023'; end if;
 old_permissions:=coalesce(c.config->'google_action_permissions','{}'::jsonb);
 if jsonb_typeof(c.config->'google_verified_scopes')='array' then select array_agg(value) into old_scopes from jsonb_array_elements_text(c.config->'google_verified_scopes'); end if;
 foreach permission in array array['calendar.write','email.send'] loop
  if public.google_upgrade_scope_allows(p_verified_scopes,permission) and (permission=any(a.requested_permissions) or
   ((old_permissions->>(case when permission='calendar.write' then 'calendar_write' else 'email_send' end))='true' and public.google_upgrade_scope_allows(old_scopes,permission))) then expected_permissions:=array_append(expected_permissions,permission); end if;
 end loop;
 if p_selected_permissions is distinct from expected_permissions then raise exception 'Selected permissions differ from the explicit owner request and actual retained grants' using errcode='PT409'; end if;
 permissions:=jsonb_build_object('calendar_write','calendar.write'=any(expected_permissions),'email_send','email.send'=any(expected_permissions));
 update public.integration_secrets set encrypted_value=p_encrypted,last_four=p_last_four,updated_at=now() where id=secret.id;
 update public.integration_connections set config=config||jsonb_build_object('google_action_permissions',permissions,'google_verified_scopes',to_jsonb(p_verified_scopes)),
  external_account_name=p_account_name,health_summary='Explicit Google action permissions verified. Business authority and existing pauses remain separate.',last_checked_at=now() where id=c.id;
 if permissions is distinct from old_permissions then
  update public.agent_team_settings set authority_revision=authority_revision+1 where partner_id=c.partner_id and client_id=c.client_id;
 end if;
 delete from public.business_connection_oauth_attempts where id=a.id;
end $$;

create or replace function public.begin_hubspot_oauth(p_partner uuid,p_client uuid,p_actor uuid,p_connection uuid,p_cookie_hash text,p_encrypted_verifier text,p_permissions text[],p_expires_at timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.integration_connections; secret public.integration_secrets; provider uuid; attempt uuid;
begin
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner and status='active' for update;
 if not found or p_actor is null or nullif(p_cookie_hash,'') is null or nullif(p_encrypted_verifier,'') is null or p_permissions is null or not(p_permissions<@array['contact.create','note.create']) or array_position(p_permissions,null) is not null or p_expires_at<=now() or p_expires_at>now()+interval '16 minutes' then raise exception 'Invalid HubSpot connection request'; end if;
 select id into strict provider from public.integration_providers where provider_key='hubspot' and is_active;
 if p_connection is not null then
  select * into strict c from public.integration_connections where id=p_connection and partner_id=p_partner and client_id=p_client and provider_id=provider for update;
  if c.config->>'hubspot_owner_crm' is distinct from 'true' then raise exception 'Reconnect the existing owner HubSpot account'; end if;
  if not (array(select jsonb_array_elements_text(coalesce(c.config->'hubspot_selected_permissions','[]'::jsonb)))<@p_permissions) then raise exception 'Reconnect the current selected HubSpot permissions' using errcode='PT409'; end if;
 else
  insert into public.integration_connections(partner_id,client_id,provider_id,display_name,status,runtime_mode,credential_status,created_by,config)
  values(p_partner,p_client,provider,'HubSpot','not_connected','dry_run','missing',p_actor,jsonb_build_object('workspace_view_only',true,'owner_workspace_imports',true,'hubspot_owner_crm',true,'hubspot_actions_enabled',false)) returning * into c;
 end if;
 select * into secret from public.integration_secrets where connection_id=c.id and partner_id=p_partner and client_id=p_client and secret_kind='provider_credentials' for update;
 delete from public.business_connection_oauth_attempts where connection_id=c.id and actor_id=p_actor;
 insert into public.business_connection_oauth_attempts(partner_id,client_id,connection_id,actor_id,provider_key,purpose,cookie_hash,encrypted_verifier,requested_permissions,expected_account_id,expected_connection_updated_at,expected_secret_updated_at,expires_at)
 values(p_partner,p_client,c.id,p_actor,'hubspot','hubspot_oauth',p_cookie_hash,p_encrypted_verifier,p_permissions,c.external_account_id,c.updated_at,secret.updated_at,p_expires_at) returning id into attempt;
 return jsonb_build_object('attemptId',attempt,'connectionId',c.id,'expectedAccountId',c.external_account_id);
end $$;

create or replace function public.finish_hubspot_oauth(p_attempt uuid,p_encrypted text,p_last_four text,p_account_id text,p_account_name text,p_verified_scopes text[],p_permissions text[],p_expires_at timestamptz,p_grant_revision uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare a public.business_connection_oauth_attempts; c public.integration_connections; secret public.integration_secrets;
begin
 select * into strict a from public.business_connection_oauth_attempts where id=p_attempt;
 perform 1 from public.client_businesses where id=a.client_id and partner_id=a.partner_id and status='active' for update;
 if not found then raise exception 'Business unavailable' using errcode='PT409'; end if;
 select * into strict c from public.integration_connections where id=a.connection_id and partner_id=a.partner_id and client_id=a.client_id for update;
 select * into strict a from public.business_connection_oauth_attempts where id=p_attempt for update;
 select * into secret from public.integration_secrets where connection_id=c.id and partner_id=c.partner_id and client_id=c.client_id and secret_kind='provider_credentials' for update;
 if a.provider_key<>'hubspot' or a.purpose<>'hubspot_oauth' or a.consumed_at is null or a.expires_at<=now() or c.config->>'hubspot_owner_crm' is distinct from 'true' or not exists(select 1 from public.integration_providers where id=c.provider_id and provider_key='hubspot') or c.updated_at is distinct from a.expected_connection_updated_at or secret.updated_at is distinct from a.expected_secret_updated_at or c.external_account_id is distinct from a.expected_account_id or (a.expected_account_id is not null and a.expected_account_id is distinct from p_account_id) or coalesce(p_account_id,'')!~'^[0-9]+$' or nullif(p_account_name,'') is null or nullif(p_encrypted,'') is null or p_last_four is null or p_grant_revision is null or p_expires_at<=now() or p_permissions is distinct from a.requested_permissions or not public.hubspot_scopes_allow(p_verified_scopes,p_permissions) then raise exception 'HubSpot attempt, verified account, grants or saved access changed' using errcode='PT409'; end if;
 if exists(select 1 from public.integration_connections other where other.partner_id=c.partner_id and other.client_id=c.client_id and other.provider_id=c.provider_id and other.id<>c.id and other.external_account_id=p_account_id and other.status in ('connected','needs_attention')) then raise exception 'This HubSpot portal is already connected; reconnect its existing connection'; end if;
 insert into public.integration_secrets(partner_id,client_id,connection_id,secret_kind,encrypted_value,last_four) values(c.partner_id,c.client_id,c.id,'provider_credentials',p_encrypted,p_last_four)
 on conflict(connection_id,secret_kind) do update set encrypted_value=excluded.encrypted_value,last_four=excluded.last_four,updated_at=now();
 update public.integration_connections set status='connected',credential_status='configured',external_account_id=p_account_id,external_account_name=p_account_name,
 config=config||jsonb_build_object('hubspot_grant_revision',p_grant_revision,'hubspot_secret_revision',p_grant_revision,'hubspot_config_revision',extensions.gen_random_uuid(),'hubspot_verified_scopes',to_jsonb(p_verified_scopes),'hubspot_selected_permissions',to_jsonb(p_permissions),'hubspot_actions_enabled',false),
 health_summary='HubSpot account and actual grants verified. Imports do not activate assistants or CRM changes.',last_checked_at=now(),last_success_at=now() where id=c.id;
 update public.agent_team_settings set authority_revision=authority_revision+1 where partner_id=c.partner_id and client_id=c.client_id;
 delete from public.hubspot_oauth_refresh_leases where connection_id=c.id;
 delete from public.business_connection_oauth_attempts where id=a.id;
end $$;

insert into public.platform_schema_state(singleton,current_migration,applied_at)
values(true,'20261121205414_oauth_conflict_transport',now())
on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;
