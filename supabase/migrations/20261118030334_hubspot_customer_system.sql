-- Customer-owned HubSpot: exact-account OAuth, CAS token rotation and reviewed gateway.
-- All exposed routines are invoker/service-only. Imported records never project into crm_*.
alter table public.business_connection_oauth_attempts drop constraint business_connection_oauth_attempts_provider_key_check;
alter table public.business_connection_oauth_attempts add constraint business_connection_oauth_attempts_provider_key_check check(provider_key in ('google_workspace','microsoft_365','hubspot'));
alter table public.business_connection_oauth_attempts drop constraint business_connection_oauth_attempts_purpose_check;
alter table public.business_connection_oauth_attempts add constraint business_connection_oauth_attempts_purpose_check check(purpose in ('read_only','permission_upgrade','hubspot_oauth'));
alter table public.client_businesses add column customer_system_connection_id uuid references public.integration_connections(id) on delete restrict;
create function public.guard_customer_system_connection() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.customer_system_connection_id is not null and not exists(select 1 from public.integration_connections c join public.integration_providers p on p.id=c.provider_id where c.id=new.customer_system_connection_id and c.partner_id=new.partner_id and c.client_id=new.id and p.provider_key='hubspot' and c.config->>'hubspot_owner_crm'='true') then raise exception 'Customer system must be an exact business-owned HubSpot connection'; end if;
 if tg_op='UPDATE' and new.customer_system_connection_id is distinct from old.customer_system_connection_id and current_user<>'service_role' then raise exception 'Use reviewed customer-system settings'; end if;
 return new;
end $$;
create trigger guard_customer_system_connection before insert or update on public.client_businesses for each row execute function public.guard_customer_system_connection();

create function public.hubspot_scopes_allow(p_scopes text[],p_permissions text[]) returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(array['oauth','crm.objects.contacts.read','crm.objects.deals.read']<@p_scopes and p_permissions<@array['contact.create','note.create'] and array_position(p_permissions,null) is null and (cardinality(p_permissions)=0 or 'crm.objects.contacts.write'=any(p_scopes)),false);
$$;
create function public.begin_hubspot_oauth(p_partner uuid,p_client uuid,p_actor uuid,p_connection uuid,p_cookie_hash text,p_encrypted_verifier text,p_permissions text[],p_expires_at timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.integration_connections; secret public.integration_secrets; provider uuid; attempt uuid;
begin
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner and status='active' for update;
 if not found or p_actor is null or nullif(p_cookie_hash,'') is null or nullif(p_encrypted_verifier,'') is null or p_permissions is null or not(p_permissions<@array['contact.create','note.create']) or array_position(p_permissions,null) is not null or p_expires_at<=now() or p_expires_at>now()+interval '16 minutes' then raise exception 'Invalid HubSpot connection request'; end if;
 select id into strict provider from public.integration_providers where provider_key='hubspot' and is_active;
 if p_connection is not null then
  select * into strict c from public.integration_connections where id=p_connection and partner_id=p_partner and client_id=p_client and provider_id=provider for update;
  if c.config->>'hubspot_owner_crm' is distinct from 'true' then raise exception 'Reconnect the existing owner HubSpot account'; end if;
  if not (array(select jsonb_array_elements_text(coalesce(c.config->'hubspot_selected_permissions','[]'::jsonb)))<@p_permissions) then raise exception 'Reconnect the current selected HubSpot permissions' using errcode='40001'; end if;
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
create table public.hubspot_oauth_refresh_leases(connection_id uuid primary key references public.integration_connections(id) on delete cascade,partner_id uuid not null,client_id uuid not null,claim uuid not null,secret_revision uuid not null,expires_at timestamptz not null);
alter table public.hubspot_oauth_refresh_leases enable row level security;
revoke all on public.hubspot_oauth_refresh_leases from public,anon,authenticated;
grant all on public.hubspot_oauth_refresh_leases to service_role;
create function public.finish_hubspot_oauth(p_attempt uuid,p_encrypted text,p_last_four text,p_account_id text,p_account_name text,p_verified_scopes text[],p_permissions text[],p_expires_at timestamptz,p_grant_revision uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare a public.business_connection_oauth_attempts; c public.integration_connections; secret public.integration_secrets;
begin
 select * into strict a from public.business_connection_oauth_attempts where id=p_attempt;
 perform 1 from public.client_businesses where id=a.client_id and partner_id=a.partner_id and status='active' for update;
 if not found then raise exception 'Business unavailable' using errcode='40001'; end if;
 select * into strict c from public.integration_connections where id=a.connection_id and partner_id=a.partner_id and client_id=a.client_id for update;
 select * into strict a from public.business_connection_oauth_attempts where id=p_attempt for update;
 select * into secret from public.integration_secrets where connection_id=c.id and partner_id=c.partner_id and client_id=c.client_id and secret_kind='provider_credentials' for update;
 if a.provider_key<>'hubspot' or a.purpose<>'hubspot_oauth' or a.consumed_at is null or a.expires_at<=now() or c.config->>'hubspot_owner_crm' is distinct from 'true' or not exists(select 1 from public.integration_providers where id=c.provider_id and provider_key='hubspot') or c.updated_at is distinct from a.expected_connection_updated_at or secret.updated_at is distinct from a.expected_secret_updated_at or c.external_account_id is distinct from a.expected_account_id or (a.expected_account_id is not null and a.expected_account_id is distinct from p_account_id) or coalesce(p_account_id,'')!~'^[0-9]+$' or nullif(p_account_name,'') is null or nullif(p_encrypted,'') is null or p_last_four is null or p_grant_revision is null or p_expires_at<=now() or p_permissions is distinct from a.requested_permissions or not public.hubspot_scopes_allow(p_verified_scopes,p_permissions) then raise exception 'HubSpot attempt, verified account, grants or saved access changed' using errcode='40001'; end if;
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
create function public.claim_hubspot_oauth_refresh(p_partner uuid,p_client uuid,p_connection uuid,p_expected_secret_revision uuid,p_claim uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare c public.integration_connections;
begin
 select * into c from public.integration_connections where id=p_connection and partner_id=p_partner and client_id=p_client for update;
 if c.id is null or c.status not in ('connected','needs_attention') or c.runtime_mode='paused' or c.credential_status<>'configured' or c.config->>'hubspot_owner_crm' is distinct from 'true' or c.config->>'hubspot_secret_revision' is distinct from p_expected_secret_revision::text or p_claim is null then return false; end if;
 insert into public.hubspot_oauth_refresh_leases values(c.id,p_partner,p_client,p_claim,p_expected_secret_revision,now()+interval '90 seconds')
 on conflict(connection_id) do update set claim=excluded.claim,secret_revision=excluded.secret_revision,expires_at=excluded.expires_at where hubspot_oauth_refresh_leases.expires_at<=now();
 return found;
end $$;
create function public.finish_hubspot_oauth_refresh(p_partner uuid,p_client uuid,p_connection uuid,p_expected_secret_revision uuid,p_claim uuid,p_new_secret_revision uuid,p_encrypted text,p_last_four text,p_account_id text,p_verified_scopes text[],p_expires_at timestamptz)
returns boolean language plpgsql security invoker set search_path='' as $$
declare c public.integration_connections; rights text[];
begin
 select * into c from public.integration_connections where id=p_connection and partner_id=p_partner and client_id=p_client for update;
 select array_agg(value) into rights from jsonb_array_elements_text(coalesce(c.config->'hubspot_selected_permissions','[]'::jsonb));
 if c.id is null or c.status not in ('connected','needs_attention') or c.runtime_mode='paused' or c.credential_status<>'configured' or c.config->>'hubspot_secret_revision' is distinct from p_expected_secret_revision::text or c.external_account_id is distinct from p_account_id or not public.hubspot_scopes_allow(p_verified_scopes,coalesce(rights,'{}')) or p_expires_at<=now() or nullif(p_encrypted,'') is null or p_new_secret_revision is null or p_new_secret_revision=p_expected_secret_revision or not exists(select 1 from public.hubspot_oauth_refresh_leases where connection_id=c.id and partner_id=p_partner and client_id=p_client and claim=p_claim and secret_revision=p_expected_secret_revision and expires_at>now()) then return false; end if;
 update public.integration_secrets set encrypted_value=p_encrypted,last_four=p_last_four,updated_at=now() where connection_id=c.id and partner_id=p_partner and client_id=p_client and secret_kind='provider_credentials';
 if not found then return false; end if;
 update public.integration_connections set config=config||jsonb_build_object('hubspot_secret_revision',p_new_secret_revision,'hubspot_verified_scopes',to_jsonb(p_verified_scopes)) where id=c.id;
 delete from public.hubspot_oauth_refresh_leases where connection_id=c.id and claim=p_claim;
 return true;
end $$;
create function public.fail_hubspot_oauth_refresh(p_partner uuid,p_client uuid,p_connection uuid,p_expected_secret_revision uuid,p_claim uuid,p_reauth boolean)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.integration_connections where id=p_connection and partner_id=p_partner and client_id=p_client and config->>'hubspot_secret_revision'=p_expected_secret_revision::text for update;
 if not found then return; end if;
 delete from public.hubspot_oauth_refresh_leases where connection_id=p_connection and partner_id=p_partner and client_id=p_client and claim=p_claim and secret_revision=p_expected_secret_revision;
 if found and p_reauth then update public.integration_connections set status='needs_attention',credential_status='invalid',health_summary='HubSpot authorization needs reconnection. Saved source evidence and unknown writes remain preserved.' where id=p_connection; end if;
end $$;

create or replace function public.persist_owner_import_record(p_partner uuid,p_client uuid,p_connection uuid,p_type text,p_external text,p_parent text,p_data jsonb,p_source jsonb,p_external_updated timestamptz,p_observed timestamptz,p_event_at timestamptz default null,p_event_id text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare c public.integration_connections; previous public.integration_canonical_records; provider text; facts jsonb:=p_data; refunded bigint; received bigint; linked_native text; linked_count integer;
begin
 select * into strict c from public.integration_connections where id=p_connection and partner_id=p_partner and client_id=p_client for update;
 select provider_key into provider from public.integration_providers where id=c.provider_id;
 if c.status not in ('connected','needs_attention') or c.runtime_mode='paused' or provider not in ('google_workspace','microsoft_365','stripe','generic_inbound_webhook','hubspot') or
  not (coalesce(c.config->>'workspace_view_only'='true',false) or provider='stripe') then raise exception 'Source is paused, disconnected or not an owner import'; end if;
 if p_type not in ('lead','invoice','payment','message','appointment','customer','note') or nullif(p_external,'') is null or length(p_external)>500 or jsonb_typeof(p_data)<>'object' or
  p_observed is null or p_observed>now()+interval '5 minutes' or p_event_at>now()+interval '5 minutes' or
  (p_event_at is not null and (nullif(p_event_id,'') is null or length(p_event_id)>500)) or
  (p_event_at is null and p_event_id is not null) then raise exception 'Invalid imported record'; end if;
 if (provider='hubspot' and (c.config->>'hubspot_owner_crm' is distinct from 'true' or p_type not in ('customer','lead','note') or p_data->>'portal_id' is distinct from c.external_account_id)) or (provider='stripe' and p_type not in ('invoice','payment')) or (provider='generic_inbound_webhook' and p_type<>'lead') or
  (provider in ('google_workspace','microsoft_365') and p_type not in ('message','appointment')) then raise exception 'Unsupported source object'; end if;
 select * into previous from public.integration_canonical_records where connection_id=p_connection and partner_id=p_partner and client_id=p_client and object_type=p_type and external_object_id=p_external for update;
 if provider='generic_inbound_webhook' and p_data->>'deleted' is distinct from 'true' then
  facts:=(coalesce(previous.canonical_data,'{}'::jsonb)-'deleted')||p_data;
  if p_data->>'received_at' is null and previous.canonical_data ? 'received_at' then
   facts:=facts||jsonb_build_object('received_at',previous.canonical_data->'received_at');
  end if;
 end if;
 -- A non-expanded PaymentIntent is not evidence that a known refund vanished.
 if provider='stripe' and p_type='payment' and p_data->>'refunds_known'='false' and previous.canonical_data->>'refunds_known'='true' and
  (nullif(p_data->>'charge_id','') is null or p_data->>'charge_id'=previous.canonical_data->>'charge_id') then
  refunded:=(previous.canonical_data->>'amount_refunded_minor')::bigint;
  received:=coalesce((p_data->>'amount_minor')::bigint,(previous.canonical_data->>'amount_minor')::bigint);
  facts:=facts||jsonb_build_object('amount_refunded_minor',refunded,'amount_refunded',refunded,'refunds_known',true,
   'status',case when refunded>0 and received>0 and refunded>=received then 'refunded' when refunded>0 then 'partially_refunded' else p_data->>'status' end);
 end if;
 if provider='hubspot' then
  if p_external_updated is null then raise exception 'HubSpot source version is required'; end if;
  if previous.id is not null then
   if p_external_updated<previous.external_updated_at then return false; end if;
   if p_external_updated=previous.external_updated_at and (previous.canonical_data-'observed_at') is distinct from (facts-'observed_at') then
    insert into public.integration_sync_states(partner_id,client_id,connection_id,stream_key,status,last_error)
    values(p_partner,p_client,p_connection,p_type,'failing','HubSpot source facts conflict at the same version. Refresh to reconcile; no older snapshot or archive resurrection was applied.')
    on conflict(connection_id,stream_key) do update set status='failing',last_error=excluded.last_error;
    return false;
   end if;
  end if;
 end if;
 if p_event_at is not null then
  if previous.source_event_id=p_event_id or p_event_at<previous.source_event_at or
    p_event_at+interval '1 second'<=previous.snapshot_observed_at then return false; end if;
  if ((p_event_at=previous.source_event_at and previous.source_event_id is distinct from p_event_id) or
      (previous.snapshot_observed_at>=p_event_at and previous.snapshot_observed_at<p_event_at+interval '1 second')) and
      (previous.canonical_data-array['observed_at','source_event_at','source_created_at','source_updated_at']) is distinct from
      (facts-array['observed_at','source_event_at','source_created_at','source_updated_at']) then
   -- Event IDs are not ordered versions. Compare effective business facts, not
   -- ingestion clocks; a true equal-clock conflict requires a fresh snapshot.
   insert into public.integration_sync_states(partner_id,client_id,connection_id,stream_key,status,last_error)
   values(p_partner,p_client,p_connection,p_type,'failing','Source changes share a timestamp. Refresh the account to reconcile current records.')
   on conflict(connection_id,stream_key) do update set status='failing',last_error=excluded.last_error;
   return false;
  end if;
 else
  if p_observed<greatest(previous.source_event_at,previous.snapshot_observed_at) then return false; end if;
 end if;
 if p_type='appointment' then
  -- A read-only import may link an existing booking receipt by the exact event
  -- and authorized provider account. It does not edit or guess a CRM record.
  select min(ap.id::text),count(*) into linked_native,linked_count
  from public.crm_appointments ap join public.approval_items a on a.id=ap.approval_id and a.partner_id=p_partner and a.client_id=p_client
  join public.integration_connections source on source.id::text=a.proposed_payload->>'calendar_connection_id' and source.partner_id=p_partner and source.client_id=p_client
  where ap.partner_id=p_partner and ap.client_id=p_client and ap.external_ref=p_external and source.provider_id=c.provider_id
   and (source.id=c.id or (source.external_account_id is not null and source.external_account_id=c.external_account_id));
  if linked_count<>1 then linked_native:=null; end if;
 end if;
 insert into public.integration_canonical_records(partner_id,client_id,connection_id,object_type,external_object_id,external_parent_id,canonical_data,source_payload,external_updated_at,native_object_id,projection_status,source_event_at,source_event_id,snapshot_observed_at)
 values(p_partner,p_client,p_connection,p_type,p_external,p_parent,facts,p_source,p_external_updated,coalesce(previous.native_object_id,linked_native),'skipped',p_event_at,p_event_id,case when p_event_at is null then p_observed end)
 on conflict(connection_id,object_type,external_object_id) do update set
  external_parent_id=coalesce(excluded.external_parent_id,integration_canonical_records.external_parent_id),canonical_data=excluded.canonical_data,
  source_payload=excluded.source_payload,external_updated_at=excluded.external_updated_at,updated_at=now(),
  native_object_id=coalesce(integration_canonical_records.native_object_id,excluded.native_object_id),
  source_event_at=coalesce(excluded.source_event_at,integration_canonical_records.source_event_at),source_event_id=coalesce(excluded.source_event_id,integration_canonical_records.source_event_id),
  snapshot_observed_at=coalesce(excluded.snapshot_observed_at,integration_canonical_records.snapshot_observed_at);
 if p_event_at is not null then
  insert into public.integration_sync_states(partner_id,client_id,connection_id,stream_key,status,last_completed_at,last_error)
  values(p_partner,p_client,p_connection,p_type,'idle',now(),null)
  on conflict(connection_id,stream_key) do update set last_completed_at=excluded.last_completed_at,
   status=case when integration_sync_states.last_error is not null then integration_sync_states.status else 'idle' end,
   last_error=integration_sync_states.last_error;
 end if;
 update public.integration_connections set status='connected',last_success_at=now(),health_summary='Imported source records received. Agent authority is unchanged.' where id=c.id;
 return true;
end $$;

create or replace function public.manage_readonly_workspace_connection(p_partner uuid,p_client uuid,p_connection uuid,p_action text)
returns void language plpgsql security invoker set search_path='' as $$
declare c public.integration_connections; provider text;
begin
 select * into strict c from public.integration_connections where id=p_connection and partner_id=p_partner and client_id=p_client for update;
 select provider_key into provider from public.integration_providers where id=c.provider_id;
 if provider not in ('google_workspace','microsoft_365','stripe','generic_inbound_webhook','hubspot') or p_action not in ('pause','resume','disconnect') or
  (provider in ('google_workspace','microsoft_365') and c.config->>'workspace_view_only' is distinct from 'true') then raise exception 'Unsupported owner data connection'; end if;
 if provider='hubspot' then
  update public.integration_connections set config=config||jsonb_build_object('hubspot_actions_enabled',false,'hubspot_config_revision',extensions.gen_random_uuid()) where id=c.id;
  update public.agent_team_settings set authority_revision=authority_revision+1 where partner_id=p_partner and client_id=p_client;
  delete from public.hubspot_oauth_refresh_leases where connection_id=c.id;
 end if;
 if p_action='resume' then
  if c.status not in ('connected','needs_attention') or c.credential_status<>'configured' then raise exception 'Reconnect the account first'; end if;
  update public.integration_connections set runtime_mode=case when c.config->>'workspace_view_only'='true' then 'dry_run'::public.runtime_mode else 'live'::public.runtime_mode end where id=c.id;
  update public.integration_sync_states set status='idle',last_error=null where connection_id=c.id and partner_id=p_partner and client_id=p_client and status='paused';
 else
  update public.integration_connections set runtime_mode='paused',status=case when p_action='disconnect' then 'not_connected'::public.integration_status else status end,
   credential_status=case when p_action='disconnect' then 'missing' else credential_status end where id=c.id;
  delete from public.business_connection_oauth_attempts where connection_id=c.id;
  update public.integration_sync_jobs set status='cancelled',completed_at=now(),locked_at=null,locked_by=null where connection_id=c.id and partner_id=p_partner and client_id=p_client and status in ('queued','running','failed');
  update public.integration_sync_states set status='paused' where connection_id=c.id and partner_id=p_partner and client_id=p_client;
  if p_action='disconnect' then
   -- Retain the bound account ID: reconnect cannot silently replace its identity.
   delete from public.integration_secrets where connection_id=c.id and partner_id=p_partner and client_id=p_client;
   delete from public.integration_canonical_records where connection_id=c.id and partner_id=p_partner and client_id=p_client;
   delete from public.integration_sync_states where connection_id=c.id and partner_id=p_partner and client_id=p_client;
  end if;
 end if;
end $$;


create function public.configure_hubspot(p_partner uuid,p_client uuid,p_connection uuid,p_expected_revision text,p_selected boolean,p_enabled boolean)
returns void language plpgsql security invoker set search_path='' as $$
declare c public.integration_connections; rights text[];
begin
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner and status='active' for update;
 if not found then raise exception 'Business unavailable'; end if;
 select * into strict c from public.integration_connections where id=p_connection and partner_id=p_partner and client_id=p_client for update;
 select array_agg(value) into rights from jsonb_array_elements_text(coalesce(c.config->'hubspot_selected_permissions','[]'::jsonb));
 if c.config->>'hubspot_owner_crm' is distinct from 'true' or not exists(select 1 from public.integration_providers where id=c.provider_id and provider_key='hubspot') or c.config->>'hubspot_config_revision' is distinct from p_expected_revision or c.status<>'connected' or c.credential_status<>'configured' or c.runtime_mode='paused' or nullif(c.external_account_id,'') is null or p_selected is null or p_enabled is null or (p_enabled and (not p_selected or cardinality(coalesce(rights,'{}'))=0 or not public.hubspot_scopes_allow(array(select jsonb_array_elements_text(c.config->'hubspot_verified_scopes')),rights))) then raise exception 'Refresh the exact account settings before saving' using errcode='40001'; end if;
 update public.client_businesses set customer_system_connection_id=case when p_selected then c.id when customer_system_connection_id=c.id then null else customer_system_connection_id end where id=p_client and partner_id=p_partner;
 update public.integration_connections set config=config||jsonb_build_object('hubspot_actions_enabled',p_enabled,'hubspot_config_revision',extensions.gen_random_uuid()),runtime_mode=case when p_enabled then 'live'::public.runtime_mode else 'dry_run'::public.runtime_mode end where id=c.id;
 update public.agent_team_settings set authority_revision=authority_revision+1 where partner_id=p_partner and client_id=p_client;
end $$;
alter table public.action_jobs add column crm_gateway_attempted_at timestamptz;
create function public.crm_gateway_source_check(p_partner uuid,p_client uuid,p_pin jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare c public.integration_connections; b public.client_businesses; settings public.agent_team_settings; src public.integration_canonical_records; rights text[];
begin
 select * into b from public.client_businesses where id=p_client and partner_id=p_partner;
 select * into c from public.integration_connections where id::text=p_pin->>'connection_id' and partner_id=p_partner and client_id=p_client;
 select * into settings from public.agent_team_settings where partner_id=p_partner and client_id=p_client;
 if b.status is distinct from 'active' or c.id is null or b.customer_system_connection_id is distinct from c.id or c.status<>'connected' or c.runtime_mode<>'live' or c.credential_status<>'configured' or c.config->>'hubspot_owner_crm' is distinct from 'true' or c.config->>'hubspot_actions_enabled' is distinct from 'true' or c.external_account_id is distinct from p_pin->>'account_id' or c.config->>'hubspot_grant_revision' is distinct from p_pin->>'grant_revision' or not exists(select 1 from public.integration_providers where id=c.provider_id and provider_key='hubspot') then return jsonb_build_object('allowed',false,'reason','The exact selected HubSpot account is unavailable, paused or changed.'); end if;
 select array_agg(value) into rights from jsonb_array_elements_text(coalesce(c.config->'hubspot_selected_permissions','[]'::jsonb));
 if p_pin->'crm_gateway_version' is distinct from '1'::jsonb or p_pin->>'provider' is distinct from 'hubspot' or coalesce(p_pin->>'operation','') not in ('contact.create','note.create') or not(coalesce(rights,'{}')@>array[p_pin->>'operation']) or not public.hubspot_scopes_allow(array(select jsonb_array_elements_text(c.config->'hubspot_verified_scopes')),rights) then return jsonb_build_object('allowed',false,'reason','The explicit selected operation and actual provider grants are unavailable.'); end if;
 if settings.status is distinct from 'active' or settings.authority_revision::text is distinct from p_pin->>'authority_revision' or not public.business_context_has_no_conflicts(p_partner,p_client) or not exists(select 1 from public.business_context_reviews r join public.business_workspace_profiles profile on profile.partner_id=r.partner_id and profile.client_id=r.client_id where r.partner_id=p_partner and r.client_id=p_client and r.profile_revision::timestamptz=profile.updated_at) then return jsonb_build_object('allowed',false,'reason','Review current business context and manager authority before CRM changes.'); end if;
 if p_pin->>'operation'='contact.create' then
  if p_pin->'new_identity_confirmed' is distinct from 'true'::jsonb or p_pin->>'source_record_id' is not null or p_pin->>'external_id' is not null or jsonb_typeof(p_pin->'properties') is distinct from 'object' or p_pin->'properties'='{}'::jsonb or p_pin->>'note_body' is not null then return jsonb_build_object('allowed',false,'reason','Deliberate creation requires a new-identity review with bounded properties.'); end if;
 else
  if not exists(select 1 from public.integration_sync_states state where state.connection_id=c.id and state.partner_id=p_partner and state.client_id=p_client and state.stream_key='customer' and state.status='idle' and state.last_error is null and state.last_completed_at between now()-interval '45 minutes' and now()+interval '5 minutes' and not(coalesce(state.cursor_value,'{}'::jsonb) ?| array['after','pageToken','nextLink']) and coalesce(state.cursor_value->>'phase','') not in ('active','archived')) then return jsonb_build_object('allowed',false,'reason','Complete and reconcile the HubSpot contact import before reviewing a note.'); end if;
  select * into src from public.integration_canonical_records where id::text=p_pin->>'source_record_id' and partner_id=p_partner and client_id=p_client and connection_id=c.id and object_type='customer';
  if src.id is null or src.external_object_id is distinct from p_pin->>'external_id' or src.canonical_data->>'portal_id' is distinct from c.external_account_id or src.updated_at is distinct from (p_pin->>'source_updated_at')::timestamptz or src.external_updated_at is distinct from (p_pin->>'source_external_updated_at')::timestamptz or src.canonical_data->>'archived'='true' or src.canonical_data->>'deleted'='true' or src.snapshot_observed_at is null or src.snapshot_observed_at<now()-interval '45 minutes' or src.snapshot_observed_at>now()+interval '5 minutes' or nullif(btrim(p_pin->>'note_body'),'') is null or length(p_pin->>'note_body')>4000 or p_pin->'properties'<>'{}'::jsonb then return jsonb_build_object('allowed',false,'reason','Refresh and review the exact active HubSpot contact before attaching this note.'); end if;
 end if;
 return jsonb_build_object('allowed',true);
exception when invalid_text_representation or datetime_field_overflow then return jsonb_build_object('allowed',false,'reason','Invalid saved CRM source pin.');
end $$;
create function public.prepare_hubspot_change(p_partner uuid,p_client uuid,p_actor uuid,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare request jsonb:=p_command->'owner_request'; pin jsonb:=p_command->'pin'; prior public.business_owner_commands; verdict jsonb; proposal uuid; receipt uuid:=(pin->>'owner_command_id')::uuid; result jsonb; c public.integration_connections;
begin
 if p_actor is null or request->>'action' is distinct from 'prepare_hubspot_change' or request->'targetConfirmed' is distinct from 'true'::jsonb or request->>'operation' is distinct from pin->>'operation' or request->>'connectionId' is distinct from pin->>'connection_id' or request-array['action','key','connectionId','expectedRevision','operation','recordId','expectedSourceRevision','properties','note','targetConfirmed','newIdentityConfirmed','sourceRunId']<>'{}'::jsonb then raise exception 'Invalid CRM review'; end if;
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner for update;
 if not found then raise exception 'Business unavailable'; end if;
 select * into prior from public.business_owner_commands where partner_id=p_partner and client_id=p_client and request_key=(request->>'key')::uuid;
 if prior.id is not null then
  if prior.actor_id is distinct from p_actor or prior.command->'owner_request' is distinct from request then raise exception 'Request key changed' using errcode='40001'; end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 select * into strict c from public.integration_connections where id::text=pin->>'connection_id' and partner_id=p_partner and client_id=p_client for update;
 if c.config->>'hubspot_config_revision' is distinct from request->>'expectedRevision' or pin->>'source_run_id' is distinct from request->>'sourceRunId' or (pin->>'source_run_id' is not null and not exists(select 1 from public.workflow_runs where id::text=pin->>'source_run_id' and partner_id=p_partner and client_id=p_client)) or
  (pin->>'operation'='contact.create' and (request->'newIdentityConfirmed' is distinct from 'true'::jsonb or pin->'properties' is distinct from request->'properties')) or
  (pin->>'operation'='note.create' and (request->>'recordId' is distinct from pin->>'source_record_id' or request->>'expectedSourceRevision' is distinct from pin->>'source_updated_at' or request->>'note' is distinct from pin->>'note_body')) then raise exception 'The reviewed CRM request changed' using errcode='40001'; end if;
 verdict:=public.crm_gateway_source_check(p_partner,p_client,pin);
 if verdict->>'allowed' is distinct from 'true' then raise exception '%',verdict->>'reason' using errcode='40001'; end if;
 if exists(select 1 from public.approval_items a where a.partner_id=p_partner and a.client_id=p_client and a.type='crm_change' and a.proposed_payload->>'connection_id'=c.id::text and a.proposed_payload->>'operation'=pin->>'operation' and (a.proposed_payload->>'source_record_id') is not distinct from (pin->>'source_record_id') and ((a.status='pending' and a.expires_at>now()) or exists(select 1 from public.action_jobs j where j.approval_id=a.id and j.status in ('pending','processing','uncertain','provider_pending','failed')))) then raise exception 'An existing CRM decision needs resolution or reconciliation before preparing another'; end if;
 insert into public.approval_items(partner_id,client_id,workflow_run_id,type,status,title,summary,risk_level,proposed_payload,expires_at)
 values(p_partner,p_client,(pin->>'source_run_id')::uuid,'crm_change','pending',case when pin->>'operation'='contact.create' then 'Review new HubSpot contact' else 'Review exact-contact HubSpot note' end,'Exact account and source reviewed. Approval authorizes one creation attempt; uncertain outcomes require reconciliation.','medium',pin,now()+interval '30 minutes') returning id into proposal;
 result:=jsonb_build_object('id',receipt,'approvalId',proposal,'connectionId',c.id,'message','CRM change prepared in Approvals. No provider write has occurred.','replayed',false);
 insert into public.business_owner_commands(id,partner_id,client_id,actor_id,request_key,command,result) values(receipt,p_partner,p_client,p_actor,(request->>'key')::uuid,p_command,result);
 return result;
end $$;
create function public.crm_gateway_action_check(p_partner uuid,p_client uuid,p_job uuid,p_claim uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.action_jobs; a public.approval_items; receipt public.business_owner_commands;
begin
 select * into j from public.action_jobs where id=p_job and partner_id=p_partner and client_id=p_client;
 if j.crm_gateway_attempted_at is not null then return jsonb_build_object('allowed',false,'uncertain',true,'reason','A HubSpot creation attempt already began. Reconcile the provider result; never repeat this POST.'); end if;
 select * into a from public.approval_items where id=j.approval_id and partner_id=p_partner and client_id=p_client;
 select * into receipt from public.business_owner_commands where id::text=a.proposed_payload->>'owner_command_id' and partner_id=p_partner and client_id=p_client;
 if p_claim is null or j.id is null or j.kind<>'crm.sync' or j.status<>'processing' or j.claim_token is distinct from p_claim or a.type is distinct from 'crm_change' or a.status not in ('approved','edited_and_approved') or a.expires_at is null or a.expires_at<=now() or a.proposed_payload is distinct from j.payload or receipt.id is null or receipt.command->'pin' is distinct from a.proposed_payload or receipt.result->>'approvalId' is distinct from a.id::text then return jsonb_build_object('allowed',false,'reason','The exact approved CRM command or delivery claim is unavailable.'); end if;
 return public.crm_gateway_source_check(p_partner,p_client,j.payload);
end $$;
create function public.mark_crm_gateway_attempt(p_partner uuid,p_client uuid,p_job uuid,p_claim uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare verdict jsonb; j public.action_jobs;
begin
 -- Serialize with owner settings and source imports using their business/account lock order.
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner for update;
 select * into j from public.action_jobs where id=p_job and partner_id=p_partner and client_id=p_client;
 perform 1 from public.integration_connections where id::text=j.payload->>'connection_id' and partner_id=p_partner and client_id=p_client for update;
 perform 1 from public.action_jobs where id=p_job and partner_id=p_partner and client_id=p_client for update;
 verdict:=public.crm_gateway_action_check(p_partner,p_client,p_job,p_claim);
 if verdict->>'allowed' is distinct from 'true' then return false; end if;
 update public.action_jobs set crm_gateway_attempted_at=now() where id=p_job and claim_token=p_claim and status='processing' and crm_gateway_attempted_at is null;
 return found;
end $$;
create function public.guard_hubspot_approval() returns trigger language plpgsql security invoker set search_path='' as $$
declare verdict jsonb;
begin
 if new.type<>'crm_change' then return new; end if;
 if tg_op='UPDATE' and new.status='edited_and_approved' then raise exception 'Reject and prepare a fresh exact CRM change'; end if;
 -- Authenticated owner resolution uses the private definer enqueue for privileged source checks.
 if tg_op='INSERT' then
  verdict:=public.crm_gateway_source_check(new.partner_id,new.client_id,new.proposed_payload);
  if verdict->>'allowed' is distinct from 'true' then raise exception '%',verdict->>'reason' using errcode='40001'; end if;
 end if;
 return new;
end $$;
create trigger guard_hubspot_approval before insert or update on public.approval_items for each row execute function public.guard_hubspot_approval();

create or replace function public.enqueue_approved_action()
returns trigger language plpgsql security definer set search_path='' as $$
declare action_kind text; action_payload jsonb; bound_appointment uuid; check_result jsonb;
begin
 if new.status not in ('approved','edited_and_approved') then return new; end if;
 if new.proposed_payload ? 'invoice_followup_version' then
  if new.resolved_content is distinct from new.editable_content then raise exception 'The reviewed invoice financial template cannot be edited' using errcode='40001'; end if;
  check_result:=public.invoice_followup_action_check(new.partner_id,new.client_id,new.id);
  if check_result->>'allowed' is distinct from 'true' then raise exception '%',check_result->>'reason' using errcode='40001'; end if;
 end if;
 if new.type='customer_message' and nullif(btrim(new.resolved_content),'') is not null
  and new.proposed_payload->>'channel' in ('sms','email','website_chat','instagram') then
  action_kind:=case when new.proposed_payload->>'channel' in ('website_chat','instagram') then 'conversation.send' when new.proposed_payload->>'channel'='email' then 'email.send' else 'sms.send' end;
  action_payload:=coalesce(new.proposed_payload,'{}'::jsonb)||jsonb_build_object('body',new.resolved_content);
 elsif new.type='appointment_booking' then
  action_kind:='calendar.book'; action_payload:=coalesce(new.proposed_payload,'{}'::jsonb);
 elsif new.type='appointment_change' and new.proposed_payload->'calendar_mutation_version'='1'::jsonb and new.proposed_payload->>'mutation' in ('cancel','reschedule') then
  -- Serialize with source-pinned follow-up preparation without taking a
  -- conversation lock after this approval row. Final send checks independently
  -- reject approved outstanding changes; do not lock sibling proposals here.
  select n.id into bound_appointment from public.crm_appointments n where n.id::text=new.proposed_payload->>'appointment_id'
   and n.partner_id=new.partner_id and n.client_id=new.client_id and n.approval_id::text=new.proposed_payload->>'booking_approval_id' for update;
  if bound_appointment is null then raise exception 'The exact appointment is unavailable' using errcode='40001'; end if;
  if new.expires_at is null or new.expires_at<=now() then raise exception 'The appointment change expired; prepare a fresh review' using errcode='40001'; end if;
  check_result:=public.calendar_mutation_source_check(new.partner_id,new.client_id,new.proposed_payload,true);
  if check_result->>'allowed' is distinct from 'true' then raise exception '%',check_result->>'reason' using errcode='40001'; end if;
  action_kind:='calendar.'||(new.proposed_payload->>'mutation'); action_payload:=new.proposed_payload;
  -- Freeze future preparation while preserving a separate explicit stop.
  -- Completion may initialize the new effective time after its receipt commits.
  update public.action_jobs set confirmation_due_at=null,booking_followup_due_at=null,
   booking_followup_reason='An approved appointment change is awaiting a verified result.'
   where id::text=new.proposed_payload->>'booking_action_job_id' and approval_id::text=new.proposed_payload->>'booking_approval_id'
    and partner_id=new.partner_id and client_id=new.client_id and kind='calendar.book' and status='succeeded';
 elsif new.type='crm_change' and new.proposed_payload->'crm_gateway_version'='1'::jsonb then
  if new.expires_at is null or new.expires_at<=now() or not exists(select 1 from public.business_owner_commands receipt where receipt.id::text=new.proposed_payload->>'owner_command_id' and receipt.partner_id=new.partner_id and receipt.client_id=new.client_id and receipt.command->'pin'=new.proposed_payload and receipt.result->>'approvalId'=new.id::text) then raise exception 'The saved owner CRM review is unavailable or expired' using errcode='40001'; end if;
  check_result:=public.crm_gateway_source_check(new.partner_id,new.client_id,new.proposed_payload);
  if check_result->>'allowed' is distinct from 'true' then raise exception '%',check_result->>'reason' using errcode='40001'; end if;
  action_kind:='crm.sync'; action_payload:=new.proposed_payload;
 elsif new.type='external_action' and new.embedded_binding_id is not null then
  action_kind:='external.action'; action_payload:=coalesce(new.proposed_payload,'{}'::jsonb);
 else return new; end if;
 insert into public.action_jobs(partner_id,client_id,approval_id,workflow_run_id,kind,payload,status,execution_key)
 values(new.partner_id,new.client_id,new.id,new.workflow_run_id,action_kind,action_payload,'pending','approval:'||new.id)
 on conflict(execution_key) do nothing;
 return new;
end $$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('guard_customer_system_connection','hubspot_scopes_allow','begin_hubspot_oauth','finish_hubspot_oauth','claim_hubspot_oauth_refresh','finish_hubspot_oauth_refresh','fail_hubspot_oauth_refresh','configure_hubspot','crm_gateway_source_check','prepare_hubspot_change','crm_gateway_action_check','mark_crm_gateway_attempt','guard_hubspot_approval') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
insert into public.platform_schema_state(singleton,current_migration,applied_at) values(true,'20261118030334_hubspot_customer_system',now()) on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;

-- The existing run CRM sync now hands off through the same reviewed gateway.
alter table public.crm_tasks add column source_crm_review_run_id uuid references public.workflow_runs(id) on delete restrict;
create unique index crm_run_review_once on public.crm_tasks(partner_id,client_id,source_crm_review_run_id) where source_crm_review_run_id is not null;
create function public.guard_crm_run_review_source() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (tg_op='UPDATE' and new.source_crm_review_run_id is distinct from old.source_crm_review_run_id) or (new.source_crm_review_run_id is not null and (current_user<>'service_role' or not exists(select 1 from public.workflow_runs r where r.id=new.source_crm_review_run_id and r.partner_id=new.partner_id and r.client_id=new.client_id))) then raise exception 'CRM review source is immutable and business scoped'; end if;
 return new;
end $$;
create trigger guard_crm_run_review_source before insert or update on public.crm_tasks for each row execute function public.guard_crm_run_review_source();
create function public.prepare_hubspot_run_handoff(p_partner uuid,p_client uuid,p_connection uuid,p_run uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare task uuid;
begin
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner for update;
 if not found or not exists(select 1 from public.workflow_runs where id=p_run and partner_id=p_partner and client_id=p_client) or not exists(select 1 from public.integration_connections c join public.integration_providers p on p.id=c.provider_id where c.id=p_connection and c.partner_id=p_partner and c.client_id=p_client and p.provider_key='hubspot') then raise exception 'Exact HubSpot source run unavailable'; end if;
 select id into task from public.crm_tasks where partner_id=p_partner and client_id=p_client and source_crm_review_run_id=p_run;
 if task is not null then return task; end if;
 insert into public.crm_tasks(partner_id,client_id,title,description,priority,status,source_crm_review_run_id)
 values(p_partner,p_client,'Review HubSpot customer change','Read source run '||p_run||', then open /client/apps?crmRun='||p_run||'. Choose one exact imported HubSpot contact for a note or deliberately review a new identity. No email/phone match, merge or CRM write was performed.','medium','open',p_run) returning id into task;
 return task;
end $$;
revoke all on function public.guard_crm_run_review_source(),public.prepare_hubspot_run_handoff(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.guard_crm_run_review_source(),public.prepare_hubspot_run_handoff(uuid,uuid,uuid,uuid) to service_role;

-- Query only unresolved work. Successful history must not impose a lifetime creation cap.
create function public.hubspot_open_review(p_partner uuid,p_client uuid,p_connection uuid,p_source uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('approvalId',a.id,'status',coalesce(j.status::text,a.status::text),'detail','An existing CRM review or attempt needs resolution. Unknown creation outcomes must be reconciled in HubSpot.')
 from public.approval_items a left join lateral (select action.status from public.action_jobs action where action.approval_id=a.id and action.partner_id=p_partner and action.client_id=p_client and action.status in ('pending','processing','uncertain','provider_pending','failed') order by action.created_at desc limit 1) j on true
 where a.partner_id=p_partner and a.client_id=p_client and a.type='crm_change' and a.proposed_payload->>'connection_id'=p_connection::text and a.proposed_payload->>'operation'=case when p_source is null then 'contact.create' else 'note.create' end and (a.proposed_payload->>'source_record_id') is not distinct from p_source::text and ((a.status='pending' and a.expires_at>now()) or j.status is not null) order by a.created_at desc limit 1;
$$;
revoke all on function public.hubspot_open_review(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.hubspot_open_review(uuid,uuid,uuid,uuid) to service_role;
