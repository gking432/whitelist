-- Explicit Google action grants and owner source reconciliation.
-- Actual migration/role/transaction acceptance is required in hosted CI.
-- DRAFT for root integration only. Not database executed.
-- Owner imports stay workspace_view_only=true. Provider grants never activate
-- assistants, change channel modes, unpause a connection or resume action jobs.
alter table public.business_connection_oauth_attempts
 add column purpose text not null default 'read_only' check(purpose in ('read_only','permission_upgrade')),
 add column requested_permissions text[],add column expected_account_id text,
 add column expected_connection_updated_at timestamptz,add column expected_secret_updated_at timestamptz;

create function public.google_upgrade_scope_allows(p_scopes text[],p_permission text)
returns boolean language sql immutable security invoker set search_path='' as $$
 select case p_permission
 when 'email.send' then coalesce(p_scopes&&array['https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.modify','https://www.googleapis.com/auth/gmail.compose','https://mail.google.com/'],false)
 when 'calendar.write' then coalesce(p_scopes&&array['https://www.googleapis.com/auth/calendar','https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.events.owned'],false)
  and coalesce(p_scopes&&array['https://www.googleapis.com/auth/calendar','https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.calendarlist','https://www.googleapis.com/auth/calendar.calendarlist.readonly'],false)
 else false end;
$$;

create function public.finish_google_permission_upgrade(p_attempt uuid,p_encrypted text,p_last_four text,p_account_id text,p_account_name text,p_verified_scopes text[],p_selected_permissions text[])
returns void language plpgsql security invoker set search_path='' as $$
declare a public.business_connection_oauth_attempts; c public.integration_connections; secret public.integration_secrets; provider text;
 permission text; old_scopes text[]; expected_permissions text[]:='{}'; old_permissions jsonb; permissions jsonb;
begin
 select * into strict a from public.business_connection_oauth_attempts where id=p_attempt;
 perform 1 from public.client_businesses where id=a.client_id and partner_id=a.partner_id and status='active' for update;
 if not found then raise exception 'Business unavailable' using errcode='40001'; end if;
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
  raise exception 'Google permission attempt, exact account or saved access changed' using errcode='40001'; end if;
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
 if p_selected_permissions is distinct from expected_permissions then raise exception 'Selected permissions differ from the explicit owner request and actual retained grants' using errcode='40001'; end if;
 permissions:=jsonb_build_object('calendar_write','calendar.write'=any(expected_permissions),'email_send','email.send'=any(expected_permissions));
 update public.integration_secrets set encrypted_value=p_encrypted,last_four=p_last_four,updated_at=now() where id=secret.id;
 update public.integration_connections set config=config||jsonb_build_object('google_action_permissions',permissions,'google_verified_scopes',to_jsonb(p_verified_scopes)),
  external_account_name=p_account_name,health_summary='Explicit Google action permissions verified. Business authority and existing pauses remain separate.',last_checked_at=now() where id=c.id;
 if permissions is distinct from old_permissions then
  update public.agent_team_settings set authority_revision=authority_revision+1 where partner_id=c.partner_id and client_id=c.client_id;
 end if;
 delete from public.business_connection_oauth_attempts where id=a.id;
end $$;

revoke all on function public.google_upgrade_scope_allows(text[],text),public.finish_google_permission_upgrade(uuid,text,text,text,text,text[],text[]) from public,anon,authenticated;
grant execute on function public.google_upgrade_scope_allows(text[],text),public.finish_google_permission_upgrade(uuid,text,text,text,text,text[],text[]) to service_role;

-- Read-only completion pins the same snapshots; old outstanding attempts fail safely.
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
 if c.config->>'workspace_view_only' is distinct from 'true' or a.purpose is distinct from 'read_only' or c.updated_at is distinct from a.expected_connection_updated_at or secret.updated_at is distinct from a.expected_secret_updated_at or c.external_account_id is distinct from a.expected_account_id then raise exception 'Connection changed' using errcode='40001'; end if;
 -- An older read-only attempt cannot silently downgrade a completed explicit
 -- upgrade. Normal reconnect of an upgraded account uses permission_upgrade.
 if provider='google_workspace' and (c.config->'google_action_permissions'->>'calendar_write'='true' or c.config->'google_action_permissions'->>'email_send'='true') then raise exception 'Reconnect the existing selected Google permissions' using errcode='40001'; end if;
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


-- A verified selected action is a channel-specific exception to import-only
-- access. The original view-only flag still excludes generic CRM/projection.
create function public.google_config_can_act(p_config jsonb,p_channel text)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare scopes text[];
begin
 if jsonb_typeof(p_config->'google_verified_scopes') is distinct from 'array' then return false; end if;
 select array_agg(value) into scopes from jsonb_array_elements_text(p_config->'google_verified_scopes');
 if p_channel='calendar' then
  return coalesce(p_config->'google_action_permissions'->'calendar_write'='true'::jsonb,false) and public.google_upgrade_scope_allows(scopes,'calendar.write');
 elsif p_channel='email' then
  return coalesce(p_config->'google_action_permissions'->'email_send'='true'::jsonb,false) and public.google_upgrade_scope_allows(scopes,'email.send');
 end if;
 return false;
end $$;
revoke all on function public.google_config_can_act(jsonb,text) from public,anon,authenticated;
grant execute on function public.google_config_can_act(jsonb,text) to service_role;
create or replace function public.business_channel_can_draft(
 p_partner uuid,p_client uuid,p_channel text,p_connection uuid default null
) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare channel_key text:=case when p_channel='website_chat' then 'website' else p_channel end;
 allowed boolean;
begin
 if channel_key not in ('website','email','sms','instagram','calendar') then return false; end if;
 select s.status='active' and b.status='active'
   and case when channel_key='calendar' then s.scheduling_enabled else s.conversations_enabled end
   and coalesce(s.channel_authority->>channel_key,
     case when a.status='active' and case channel_key
       when 'website' then a.website when 'email' then a.email
       when 'sms' then a.sms when 'instagram' then a.instagram
       when 'calendar' then a.bookings else false end
     then 'require_approval' else 'off' end) in ('draft','require_approval')
   and exists(select 1 from public.business_context_reviews r
     join public.business_workspace_profiles p on p.partner_id=r.partner_id and p.client_id=r.client_id
     where r.partner_id=p_partner and r.client_id=p_client and r.profile_revision::timestamptz=p.updated_at)
   and public.business_context_has_no_conflicts(p_partner,p_client)
   and (p_connection is null or exists(select 1 from public.integration_connections i
     where i.id=p_connection and i.partner_id=p_partner and i.client_id=p_client
       and i.status in ('connected','needs_attention')
       and (i.config->'workspace_view_only' is distinct from 'true'::jsonb or (exists(select 1 from public.integration_providers provider where provider.id=i.provider_id and provider.provider_key='google_workspace') and public.google_config_can_act(i.config,channel_key) and a.status='active' and a.workspace_connection_id=i.id and (case when channel_key='calendar' then a.bookings when channel_key='email' then a.email else false end) and i.runtime_mode='live' and i.config->>'activation_selected'='true'))))
 into allowed
 from public.agent_team_settings s
 join public.client_businesses b on b.partner_id=s.partner_id and b.id=s.client_id
 left join public.business_agent_activation a on a.partner_id=s.partner_id and a.client_id=s.client_id
 where s.partner_id=p_partner and s.client_id=p_client;
 return coalesce(allowed,false);
end $$;

create or replace function public.save_intake_scheduling_offer(p_work uuid,p_claim uuid,p_offer jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare w public.agent_work_items; check_result jsonb; s jsonb; checked timestamptz; expires timestamptz; account public.integration_connections; provider text;
begin
 select * into strict w from public.agent_work_items where id=p_work for update;
 check_result:=public.intake_scheduling_check(p_work,p_claim);
 if not coalesce((check_result->>'allowed')::boolean,false) or w.approval_id is not null then raise exception 'Inquiry scheduling changed' using errcode='40001'; end if;
 if jsonb_typeof(p_offer) is distinct from 'object' or jsonb_typeof(p_offer->'slots') is distinct from 'array' or jsonb_array_length(p_offer->'slots') not between 1 and 3 or nullif(p_offer->>'timezone','') is null or length(p_offer->>'timezone')>100 or p_offer->>'provider' not in ('northstar_internal','google_calendar','google_workspace','microsoft_365') then raise exception 'Invalid availability offer' using errcode='22023'; end if;
 checked:=(p_offer->>'checked_at')::timestamptz; expires:=(p_offer->>'expires_at')::timestamptz;
 if checked is null or expires is null or checked>now()+interval '5 minutes' or expires<=now() or expires<=checked or expires>checked+interval '15 minutes' then raise exception 'Availability expired' using errcode='40001'; end if;
 for s in select value from jsonb_array_elements(p_offer->'slots') loop
  if nullif(s->>'start_iso','') is null or nullif(s->>'end_iso','') is null or (s->>'start_iso')::timestamptz<=now() or (s->>'end_iso')::timestamptz<=(s->>'start_iso')::timestamptz or nullif(s->>'label','') is null or length(s->>'label')>300 then raise exception 'Invalid offered slot' using errcode='22023'; end if;
 end loop;
 if p_offer->>'provider'='northstar_internal' then
  if p_offer->>'calendar_connection_id' is not null or not exists(select 1 from public.client_businesses b where b.partner_id=w.partner_id and b.id=w.client_id and b.status='active' and b.default_runtime_mode='live' and b.crm_operating_mode in ('primary_crm','mirror','assist')) then raise exception 'Internal calendar unavailable' using errcode='22023'; end if;
 else
  select * into account from public.integration_connections where id=(p_offer->>'calendar_connection_id')::uuid and partner_id=w.partner_id and client_id=w.client_id;
  select provider_key into provider from public.integration_providers where id=account.provider_id;
  if account.id is null or provider is distinct from p_offer->>'provider' or account.status<>'connected' or account.runtime_mode<>'live' or (account.config->>'workspace_view_only'='true' and not (provider='google_workspace' and public.google_config_can_act(account.config,'calendar'))) then raise exception 'Calendar account unavailable or read only' using errcode='22023'; end if;
 end if;
 update public.agent_work_items set status='waiting_approval',summary='Choose an offered appointment time. Nothing is held or booked.',result=result||jsonb_build_object('phase','choose_slot','offer',p_offer),claim_token=null,lease_until=null,revision=revision+1,next_run_at=expires,updated_at=now() where id=w.id and claim_token=p_claim and status='running' and lease_until>now();
 if not found then raise exception 'Scheduling claim lost' using errcode='40001'; end if;
 insert into public.agent_work_events(partner_id,client_id,work_id,status,summary) values(w.partner_id,w.client_id,w.id,'waiting_approval','Real availability saved for an explicit owner choice. No booking was made.');
 return true;
end $$;

create or replace function public.propose_intake_booking(p_work uuid,p_claim uuid,p_metadata jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare w public.agent_work_items; check_result jsonb; chosen jsonb; approval uuid; payload jsonb; selection integer; account public.integration_connections; provider text;
begin
 select * into strict w from public.agent_work_items where id=p_work for update;
 check_result:=public.intake_scheduling_check(p_work,p_claim);
 if not coalesce((check_result->>'allowed')::boolean,false) or w.approval_id is not null then raise exception 'Inquiry scheduling changed' using errcode='40001'; end if;
 selection:=(w.input->>'selection_index')::integer;
 if selection not between 1 and 3 or jsonb_typeof(w.result->'offer'->'slots')<>'array' then raise exception 'Choose a saved offered slot first' using errcode='22023'; end if;
 chosen:=w.result->'offer'->'slots'->(selection-1);
 if chosen is null or chosen is distinct from w.input->'slot' or chosen is distinct from p_metadata->'slot' or (chosen->>'start_iso')::timestamptz<=now() or p_metadata->>'provider' is distinct from w.result->'offer'->>'provider' or p_metadata->>'calendar_connection_id' is distinct from w.result->'offer'->>'calendar_connection_id' or p_metadata->>'timezone' is distinct from w.result->'offer'->>'timezone' then raise exception 'The selected slot or calendar changed' using errcode='40001'; end if;
 if (p_metadata->>'authority_revision')::integer is distinct from (w.input->>'authority_revision')::integer or p_metadata->>'intake_work_id' is distinct from w.id::text or p_metadata->>'lead_id' is distinct from w.source_lead_id::text or p_metadata->>'contact_id' is distinct from check_result->'contact'->>'id' then raise exception 'Proposal identity or authority changed' using errcode='40001'; end if;
 if w.result->'offer'->>'provider'='northstar_internal' then
  if w.result->'offer'->>'calendar_connection_id' is not null or not exists(select 1 from public.client_businesses b where b.partner_id=w.partner_id and b.id=w.client_id and b.status='active' and b.default_runtime_mode='live' and b.crm_operating_mode in ('primary_crm','mirror','assist')) then raise exception 'Internal calendar unavailable' using errcode='40001'; end if;
 else
  select * into account from public.integration_connections where id=(w.result->'offer'->>'calendar_connection_id')::uuid and partner_id=w.partner_id and client_id=w.client_id;
  select provider_key into provider from public.integration_providers where id=account.provider_id;
  if account.id is null or provider is distinct from w.result->'offer'->>'provider' or account.status<>'connected' or account.runtime_mode<>'live' or (account.config->>'workspace_view_only'='true' and not (provider='google_workspace' and public.google_config_can_act(account.config,'calendar'))) then raise exception 'Calendar account changed or is read only' using errcode='40001'; end if;
 end if;
 -- Copy all provenance and identity pins from durable work/checked records,
 -- never from a model or browser-supplied metadata bag.
 payload:=jsonb_build_object('origin','owner_intake','intake_work_id',w.id,'intake_record_id',w.input->'intake_record_id','intake_connection_id',w.input->'intake_connection_id','intake_external_id',w.input->'intake_external_id',
  'source_updated_at',w.input->'source_updated_at','lead_updated_at',w.input->'lead_updated_at','contact_updated_at',w.input->'contact_updated_at','authority_revision',w.input->'authority_revision',
  'lead_id',w.source_lead_id,'contact_id',check_result->'contact'->'id','contact',check_result->'contact','task_id',check_result->'taskId','identity_confirmed',true,'booking_requested',true,'service',w.input->'service',
  'provider',w.result->'offer'->'provider','calendar_connection_id',w.result->'offer'->'calendar_connection_id','timezone',w.result->'offer'->'timezone','slot',chosen);
 insert into public.approval_items(partner_id,client_id,type,status,title,summary,proposed_payload,expires_at)
 values(w.partner_id,w.client_id,'appointment_booking','pending',left('Book appointment: '||coalesce(w.input->>'service','Service'),180),
  'Owner selected '||(chosen->>'label')||'. Availability will be checked again before booking. A form does not provide a confirmation delivery channel.',payload,least(now()+interval '24 hours',(chosen->>'start_iso')::timestamptz)) returning id into approval;
 update public.agent_work_items set approval_id=approval,status='waiting_approval',summary='The selected appointment is awaiting owner approval. Nothing is held or booked.',result=result||jsonb_build_object('phase','booking_approval','booking_approval_id',approval),claim_token=null,lease_until=null,revision=revision+1,updated_at=now() where id=w.id and claim_token=p_claim and status='running' and lease_until>now();
 if not found then raise exception 'Scheduling claim lost' using errcode='40001'; end if;
 insert into public.agent_work_events(partner_id,client_id,work_id,status,summary) values(w.partner_id,w.client_id,w.id,'waiting_approval','Booking proposal saved for owner approval. No provider write occurred.');
 return true;
end $$;

create or replace function public.save_customer_rebooking_offer(p_work uuid,p_claim uuid,p_offer jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare w public.agent_work_items; check_result jsonb; s jsonb; checked timestamptz; expires timestamptz; account public.integration_connections; provider text;
begin
 select * into strict w from public.agent_work_items where id=p_work for update;
 check_result:=public.customer_rebooking_scheduling_check(p_work,p_claim);
 if not coalesce((check_result->>'allowed')::boolean,false) or w.approval_id is not null then raise exception 'Inquiry scheduling changed' using errcode='40001'; end if;
 if jsonb_typeof(p_offer) is distinct from 'object' or jsonb_typeof(p_offer->'slots') is distinct from 'array' or jsonb_array_length(p_offer->'slots') not between 1 and 3 or nullif(p_offer->>'timezone','') is null or length(p_offer->>'timezone')>100 or p_offer->>'provider' not in ('northstar_internal','google_calendar','google_workspace','microsoft_365') then raise exception 'Invalid availability offer' using errcode='22023'; end if;
 checked:=(p_offer->>'checked_at')::timestamptz; expires:=(p_offer->>'expires_at')::timestamptz;
 if checked is null or expires is null or checked>now()+interval '5 minutes' or expires<=now() or expires<=checked or expires>checked+interval '15 minutes' then raise exception 'Availability expired' using errcode='40001'; end if;
 for s in select value from jsonb_array_elements(p_offer->'slots') loop
  if nullif(s->>'start_iso','') is null or nullif(s->>'end_iso','') is null or (s->>'start_iso')::timestamptz<=now() or (s->>'end_iso')::timestamptz<=(s->>'start_iso')::timestamptz or nullif(s->>'label','') is null or length(s->>'label')>300 then raise exception 'Invalid offered slot' using errcode='22023'; end if;
 end loop;
 if p_offer->>'provider'='northstar_internal' then
  if p_offer->>'calendar_connection_id' is not null or not exists(select 1 from public.client_businesses b where b.partner_id=w.partner_id and b.id=w.client_id and b.status='active' and b.default_runtime_mode='live' and b.crm_operating_mode in ('primary_crm','mirror','assist')) then raise exception 'Internal calendar unavailable' using errcode='22023'; end if;
 else
  select * into account from public.integration_connections where id=(p_offer->>'calendar_connection_id')::uuid and partner_id=w.partner_id and client_id=w.client_id;
  select provider_key into provider from public.integration_providers where id=account.provider_id;
  if account.id is null or provider is distinct from p_offer->>'provider' or account.status<>'connected' or account.runtime_mode<>'live' or (account.config->>'workspace_view_only'='true' and not (provider='google_workspace' and public.google_config_can_act(account.config,'calendar'))) then raise exception 'Calendar account unavailable or read only' using errcode='22023'; end if;
 end if;
 update public.agent_work_items set status='waiting_approval',summary='Choose an offered appointment time. Nothing is held or booked.',result=result||jsonb_build_object('phase','choose_slot','offer',p_offer),claim_token=null,lease_until=null,revision=revision+1,next_run_at=expires,updated_at=now() where id=w.id and claim_token=p_claim and status='running' and lease_until>now();
 if not found then raise exception 'Scheduling claim lost' using errcode='40001'; end if;
 insert into public.agent_work_events(partner_id,client_id,work_id,status,summary) values(w.partner_id,w.client_id,w.id,'waiting_approval','Real availability saved for an explicit owner choice. No booking was made.');
 return true;
end $$;

create or replace function public.propose_customer_rebooking(p_work uuid,p_claim uuid,p_metadata jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare w public.agent_work_items; check_result jsonb; chosen jsonb; approval uuid; payload jsonb; selection integer; account public.integration_connections; provider text;
begin
 select * into strict w from public.agent_work_items where id=p_work for update;
 check_result:=public.customer_rebooking_scheduling_check(p_work,p_claim);
 if not coalesce((check_result->>'allowed')::boolean,false) or w.approval_id is not null then raise exception 'Inquiry scheduling changed' using errcode='40001'; end if;
 selection:=(w.input->>'selection_index')::integer;
 if selection not between 1 and 3 or jsonb_typeof(w.result->'offer'->'slots')<>'array' then raise exception 'Choose a saved offered slot first' using errcode='22023'; end if;
 chosen:=w.result->'offer'->'slots'->(selection-1);
 if chosen is null or chosen is distinct from w.input->'slot' or chosen is distinct from p_metadata->'slot' or (chosen->>'start_iso')::timestamptz<=now() or p_metadata->>'provider' is distinct from w.result->'offer'->>'provider' or p_metadata->>'calendar_connection_id' is distinct from w.result->'offer'->>'calendar_connection_id' or p_metadata->>'timezone' is distinct from w.result->'offer'->>'timezone' then raise exception 'The selected slot or calendar changed' using errcode='40001'; end if;
 if (p_metadata->>'authority_revision')::integer is distinct from (w.input->>'authority_revision')::integer or p_metadata->>'customer_rebooking_work_id' is distinct from w.id::text or p_metadata->>'lead_id' is distinct from w.source_lead_id::text or p_metadata->>'contact_id' is distinct from check_result->'contact'->>'id' then raise exception 'Proposal identity or authority changed' using errcode='40001'; end if;
 if w.result->'offer'->>'provider'='northstar_internal' then
  if w.result->'offer'->>'calendar_connection_id' is not null or not exists(select 1 from public.client_businesses b where b.partner_id=w.partner_id and b.id=w.client_id and b.status='active' and b.default_runtime_mode='live' and b.crm_operating_mode in ('primary_crm','mirror','assist')) then raise exception 'Internal calendar unavailable' using errcode='40001'; end if;
 else
  select * into account from public.integration_connections where id=(w.result->'offer'->>'calendar_connection_id')::uuid and partner_id=w.partner_id and client_id=w.client_id;
  select provider_key into provider from public.integration_providers where id=account.provider_id;
  if account.id is null or provider is distinct from w.result->'offer'->>'provider' or account.status<>'connected' or account.runtime_mode<>'live' or (account.config->>'workspace_view_only'='true' and not (provider='google_workspace' and public.google_config_can_act(account.config,'calendar'))) then raise exception 'Calendar account changed or is read only' using errcode='40001'; end if;
 end if;
 -- Copy all provenance and identity pins from durable work/checked records,
 -- never from a model or browser-supplied metadata bag.
 payload:=jsonb_build_object('origin','owner_conversation','customer_rebooking_work_id',w.id,'conversation_id',w.conversation_id,'conversation_revision',w.input->'conversation_revision','source_connection_id',w.input->'source_connection_id',
  'activity_id',w.input->'activity_id','activity_at',w.input->'activity_at','qualified_at',w.input->'qualified_at','rebooking_origin_approval_id',w.input->'rebooking_origin_approval_id',
  'lead_updated_at',w.input->'lead_updated_at','contact_updated_at',w.input->'contact_updated_at','authority_revision',w.input->'authority_revision',
  'lead_id',w.source_lead_id,'contact_id',check_result->'contact'->'id','contact',check_result->'contact','task_id',check_result->'taskId','identity_confirmed',true,'booking_requested',true,'instructions_reviewed',true,'service',w.input->'service',
  'provider',w.result->'offer'->'provider','calendar_connection_id',w.result->'offer'->'calendar_connection_id','timezone',w.result->'offer'->'timezone','slot',chosen);
 insert into public.approval_items(partner_id,client_id,type,status,title,summary,proposed_payload,expires_at)
 values(w.partner_id,w.client_id,'appointment_booking','pending',left('Book appointment: '||coalesce(w.input->>'service','Service'),180),
  'Owner selected '||(chosen->>'label')||'. Availability will be checked again before booking. This owner selection was not sent to the customer. Confirmation requires a separate reviewed action in the original thread.',payload,least(now()+interval '24 hours',(chosen->>'start_iso')::timestamptz)) returning id into approval;
 update public.agent_work_items set approval_id=approval,status='waiting_approval',summary='The selected appointment is awaiting owner approval. Nothing is held or booked.',result=result||jsonb_build_object('phase','booking_approval','booking_approval_id',approval),claim_token=null,lease_until=null,revision=revision+1,updated_at=now() where id=w.id and claim_token=p_claim and status='running' and lease_until>now();
 if not found then raise exception 'Scheduling claim lost' using errcode='40001'; end if;
 insert into public.agent_work_events(partner_id,client_id,work_id,status,summary) values(w.partner_id,w.client_id,w.id,'waiting_approval','Booking proposal saved for owner approval. No provider write occurred.');
 return true;
end $$;

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
  insert into public.business_agent_activation(client_id,partner_id,status,inquiries,bookings,website,email,instagram,sms,workspace_provider,booking_start_hour,booking_end_hour,booking_minutes,booking_weekdays,timezone,workspace_connection_id)
  values(p_client,p_partner,p_choices->>'status',(p_choices->>'inquiries')::boolean,(p_choices->>'bookings')::boolean,
   (p_choices->>'website')::boolean,(p_choices->>'email')::boolean,(p_choices->>'instagram')::boolean,(p_choices->>'sms')::boolean,p_choices->>'workspace_provider',
   (p_choices->>'booking_start_hour')::integer,(p_choices->>'booking_end_hour')::integer,(p_choices->>'booking_minutes')::integer,
   array(select jsonb_array_elements_text(p_choices->'booking_weekdays')::integer),p_choices->>'timezone',(p_choices->>'workspace_connection_id')::uuid)
  on conflict(client_id) do update set status=excluded.status,inquiries=excluded.inquiries,bookings=excluded.bookings,
   website=excluded.website,email=excluded.email,instagram=excluded.instagram,sms=excluded.sms,workspace_provider=excluded.workspace_provider,
   booking_start_hour=excluded.booking_start_hour,booking_end_hour=excluded.booking_end_hour,booking_minutes=excluded.booking_minutes,booking_weekdays=excluded.booking_weekdays,timezone=excluded.timezone,
   workspace_connection_id=case when p_choices ? 'workspace_connection_id' then excluded.workspace_connection_id when business_agent_activation.workspace_provider=excluded.workspace_provider then business_agent_activation.workspace_connection_id else null end,
   revision=business_agent_activation.revision+1,updated_at=now_at;
 end if;
 select * into strict plan from public.business_agent_activation where client_id=p_client and partner_id=p_partner;
 -- Consent alone never selects or starts an imported account. This exact
 -- explicit save is the separate owner decision to enable the chosen work.
 if plan.workspace_connection_id is not null then
  select c.*,p.provider_key into conn from public.integration_connections c join public.integration_providers p on p.id=c.provider_id
   where c.id=plan.workspace_connection_id and c.partner_id=p_partner and c.client_id=p_client and p.provider_key=plan.workspace_provider for update of c;
  if conn.id is null then raise exception 'Choose the exact current business account' using errcode='40001'; end if;
  if plan.status='active' and conn.config->>'workspace_view_only'='true' and
   (conn.provider_key<>'google_workspace' or (plan.email and not public.google_config_can_act(conn.config,'email')) or (plan.bookings and not public.google_config_can_act(conn.config,'calendar'))) then
   raise exception 'Grant the selected Google workflow permissions in Apps before enabling this account' using errcode='22023'; end if;
 end if;
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
    and ((c.config->>'workspace_view_only') is distinct from 'true' or (p.provider_key='google_workspace' and (c.id=plan.workspace_connection_id or c.config->>'activation_managed'='true')))
  order by c.created_at,c.id for update of c
 loop
  selected := case conn.provider_key when 'northstar_web_chat' then plan.website when 'instagram_messaging' then plan.instagram when 'twilio' then plan.sms
    else (plan.email or plan.bookings) and conn.provider_key=plan.workspace_provider and (plan.workspace_connection_id is null or plan.workspace_connection_id=conn.id) end;
  if conn.config->>'workspace_view_only'='true' then selected:=coalesce(selected and plan.workspace_connection_id=conn.id,false); end if;
  if selected and conn.provider_key=plan.workspace_provider and plan.workspace_connection_id is null then
   update public.business_agent_activation set workspace_connection_id=conn.id where client_id=p_client;
   plan.workspace_connection_id:=conn.id;
  end if;
  if selected or conn.config->>'activation_managed'='true' then
   update public.integration_connections set
    runtime_mode=case when selected and plan.status='active' and conn.status='connected' and conn.credential_status='configured' then 'live'::public.runtime_mode when conn.config->>'workspace_view_only'='true' then (case when conn.runtime_mode='paused' then 'paused'::public.runtime_mode else 'dry_run'::public.runtime_mode end) else 'paused'::public.runtime_mode end,
    config=conn.config || jsonb_build_object('activation_managed',true,'activation_selected',selected,
      'activation_calendar_enabled',selected and plan.bookings and conn.provider_key=plan.workspace_provider and (conn.config->>'workspace_view_only' is distinct from 'true' or public.google_config_can_act(conn.config,'calendar')),
      'conversation_intake_enabled',selected and (conn.provider_key not in ('google_workspace','microsoft_365') or plan.email) and (conn.config->>'workspace_view_only' is distinct from 'true' or public.google_config_can_act(conn.config,'email')),
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

-- DRAFT ONLY. Root owns apply_business_activation exact connection selection.
-- Apply must set explicit selected owner Google runtime_mode='live' ONLY on an
-- owner save(status=active) with required selected+verified channel permissions.
-- Keep workspace_view_only=true and generic CRM/push blocked. Deselecting an
-- owner import clears managed intake/action flags but does not pause its reads.
-- Rechecks below NEVER turn dry_run/paused into live or resume sync/action jobs.
create function public.record_selected_workspace_check(p_partner uuid,p_client uuid,p_revision integer,p_connection uuid,p_expected_connection_updated_at timestamptz,p_expected_secret_updated_at timestamptz,p_account_id text,p_email boolean,p_calendar boolean)
returns void language plpgsql security invoker set search_path='' as $$
declare plan public.business_agent_activation; c public.integration_connections; secret public.integration_secrets; provider text; healthy boolean; scopes text[]; email_ok boolean:=p_email; calendar_ok boolean:=p_calendar;
begin
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner for update;
 if not found then raise exception 'Business unavailable' using errcode='40001'; end if;
 select * into plan from public.business_agent_activation where partner_id=p_partner and client_id=p_client and revision=p_revision and workspace_connection_id=p_connection for update;
 if plan.client_id is null then raise exception 'Selected activation changed' using errcode='40001'; end if;
 select * into c from public.integration_connections where id=p_connection and partner_id=p_partner and client_id=p_client for update;
 select * into secret from public.integration_secrets where connection_id=c.id and partner_id=p_partner and client_id=p_client and secret_kind='provider_credentials' for update;
 select provider_key into provider from public.integration_providers where id=c.provider_id;
 if c.id is null or secret.id is null or provider is distinct from plan.workspace_provider or c.updated_at is distinct from p_expected_connection_updated_at or secret.updated_at is distinct from p_expected_secret_updated_at or
  c.external_account_id is distinct from p_account_id or nullif(p_account_id,'') is null or p_email is null or p_calendar is null then raise exception 'The exact selected account changed during its read-only check' using errcode='40001'; end if;
 if c.config->>'workspace_view_only'='true' then
  if provider<>'google_workspace' then raise exception 'Imported accounts require separate explicit action permissions' using errcode='40001'; end if;
  if jsonb_typeof(c.config->'google_verified_scopes')='array' then select array_agg(value) into scopes from jsonb_array_elements_text(c.config->'google_verified_scopes'); end if;
  email_ok:=p_email and c.config->'google_action_permissions'->>'email_send'='true' and public.google_upgrade_scope_allows(scopes,'email.send');
  calendar_ok:=p_calendar and c.config->'google_action_permissions'->>'calendar_write'='true' and public.google_upgrade_scope_allows(scopes,'calendar.write');
 end if;
 email_ok:=coalesce(email_ok,false); calendar_ok:=coalesce(calendar_ok,false);
 healthy:=(not plan.email or email_ok) and (not plan.bookings or calendar_ok);
 update public.integration_connections set config=config||jsonb_build_object('activation_checked_at',now(),'activation_mail_verified',email_ok,'activation_calendar_verified',calendar_ok),
  status=case when healthy then 'connected'::public.integration_status else 'needs_attention'::public.integration_status end,
  credential_status=case when healthy then 'configured' else credential_status end,last_checked_at=now() where id=c.id;
end $$;
revoke all on function public.record_selected_workspace_check(uuid,uuid,integer,uuid,timestamptz,timestamptz,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.record_selected_workspace_check(uuid,uuid,integer,uuid,timestamptz,timestamptz,text,boolean,boolean) to service_role;

create function public.selected_google_inbox_allowed(p_partner uuid,p_client uuid,p_connection uuid,p_occurred_at timestamptz)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare c public.integration_connections; provider text; scopes text[];
begin
 select * into c from public.integration_connections where id=p_connection and partner_id=p_partner and client_id=p_client;
 select provider_key into provider from public.integration_providers where id=c.provider_id;
 if c.id is null or provider is distinct from 'google_workspace' or c.config->>'workspace_view_only' is distinct from 'true' or c.status<>'connected' or c.runtime_mode<>'live' or c.config->>'activation_managed' is distinct from 'true' or
  c.config->>'conversation_intake_enabled' is distinct from 'true' or c.config->>'activation_mail_verified' is distinct from 'true' or c.config->'google_action_permissions'->>'email_send' is distinct from 'true' or
  nullif(c.config->>'activation_checked_at','') is null or (c.config->>'activation_checked_at')::timestamptz<now()-interval '24 hours' or (c.config->>'activation_checked_at')::timestamptz>now()+interval '1 minute' or
  nullif(c.config->>'conversation_intake_enabled_at','') is null or p_occurred_at is null or p_occurred_at<(c.config->>'conversation_intake_enabled_at')::timestamptz or p_occurred_at>now()+interval '1 minute' then return false; end if;
 if not exists(select 1 from public.business_agent_activation plan where plan.partner_id=p_partner and plan.client_id=p_client and plan.status='active' and plan.email and plan.workspace_provider='google_workspace' and plan.workspace_connection_id=c.id) then return false; end if;
 if jsonb_typeof(c.config->'google_verified_scopes')='array' then select array_agg(value) into scopes from jsonb_array_elements_text(c.config->'google_verified_scopes'); end if;
 -- Incoming evidence remains durable during manager/team/context pauses.
 -- queue_conversation_work independently checks current outgoing authority.
 return public.google_upgrade_scope_allows(scopes,'email.send') and coalesce(scopes&&array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.modify','https://mail.google.com/'],false);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return false;
end $$;
revoke all on function public.selected_google_inbox_allowed(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.selected_google_inbox_allowed(uuid,uuid,uuid,timestamptz) to service_role;

-- Preserve the original shared-customer ingestion implementation after the narrow gate.
create or replace function public.ingest_business_message(p_partner uuid,p_client uuid,p_connection uuid,p_channel text,p_thread text,p_key text,p_body text,p_occurred_at timestamptz default now())
returns jsonb language plpgsql security invoker set search_path=public as $$
declare c public.business_conversations; customer uuid; lead uuid; mid uuid; wid uuid; other uuid; owner_import boolean;
begin
 if p_occurred_at>now()+interval '5 minutes' then raise exception 'Invalid message timestamp'; end if;
 if p_channel not in ('website_chat','sms','email','instagram') or length(btrim(p_body)) not between 1 and 6000 then raise exception 'Invalid message'; end if;
 perform 1 from public.integration_connections i join public.client_businesses b on b.id=i.client_id and b.partner_id=i.partner_id where i.id=p_connection and i.partner_id=p_partner and i.client_id=p_client and i.status in ('connected','needs_attention') and b.status='active';
 if not found then raise exception 'Connection unavailable'; end if;
 -- Data-only owner imports are consumed without CRM/legacy fallback unless
 -- this exact Google inbox was separately consented and explicitly activated.
 select i.config->>'workspace_view_only'='true' into owner_import from public.integration_connections i where i.id=p_connection and i.partner_id=p_partner and i.client_id=p_client for update;
 if owner_import and (p_channel<>'email' or not public.selected_google_inbox_allowed(p_partner,p_client,p_connection,p_occurred_at)) then
  return jsonb_build_object('ignored',true,'reason','The imported inbox is not the currently authorized active customer channel.'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_connection::text||':'||p_channel||':'||p_thread,0));
 select * into c from public.business_conversations where connection_id=p_connection and channel=p_channel and external_thread_id=p_thread for update;
 if not found then
  -- A claimed name/email must never unlock an existing customer's records.
  insert into public.crm_contacts(partner_id,client_id,first_name,phone,email,source)
  values(p_partner,p_client,case when p_channel='website_chat' then 'Website visitor' else 'New inquiry' end,case when p_channel='sms' then p_thread end,case when p_channel='email' then p_thread end,'agent_conversation') returning id into customer;
  insert into public.crm_leads(partner_id,client_id,contact_id,title,summary,next_action,source_event_type)
  values(p_partner,p_client,customer,'New '||replace(p_channel,'_',' ')||' inquiry',left(p_body,1000),'Respond to customer','conversation.received') returning id into lead;
  insert into public.business_conversations(partner_id,client_id,connection_id,channel,external_thread_id,contact_id,lead_id)
  values(p_partner,p_client,p_connection,p_channel,p_thread,customer,lead) returning * into c;
 end if;
 if exists(select 1 from public.business_conversation_messages where conversation_id=c.id and external_key=p_key) then return jsonb_build_object('id',c.id,'duplicate',true,'revision',c.revision); end if;
 if p_channel='website_chat' and (select count(*) from public.business_conversation_messages where conversation_id=c.id and direction='inbound')>=40 then raise exception 'Conversation message limit reached'; end if;
 perform public.invalidate_conversation_work(c.id);
 -- A newly arrived reply also supersedes drafts on owner-linked channels.
 if c.identity_status='owner_verified' then
  for other in select id from public.business_conversations where contact_id=c.contact_id and client_id=p_client and partner_id=p_partner and identity_status='owner_verified' and id<>c.id order by id loop
   perform public.invalidate_conversation_work(other);
   update public.business_conversations set revision=revision+1,updated_at=now() where id=other;
  end loop;
 end if;
 update public.business_conversations set revision=revision+1,state=case when mode='human' then 'needs_attention' else 'open' end,
 opted_out=opted_out or upper(btrim(p_body)) in ('STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT','DO NOT CONTACT ME'),updated_at=now() where id=c.id returning * into c;
 if c.opted_out then
  update public.crm_contacts set tags=array_append(tags,'do_not_contact'),updated_at=now() where id=c.contact_id and not ('do_not_contact'=any(tags));
  update public.business_conversations set state='needs_attention',next_action='Customer opted out. Do not send.' where id=c.id;
 end if;
 insert into public.business_conversation_messages(partner_id,client_id,conversation_id,external_key,direction,body,status,created_at)
 values(p_partner,p_client,c.id,p_key,'inbound',btrim(p_body),'received',p_occurred_at) returning id into mid;
 insert into public.crm_communications(partner_id,client_id,contact_id,lead_id,channel,direction,body,status,metadata)
 values(p_partner,p_client,c.contact_id,c.lead_id,case when p_channel='instagram' then 'internal_note' else p_channel end,'inbound',btrim(p_body),'received',jsonb_build_object('conversation_id',c.id,'conversation_message_id',mid,'source_channel',p_channel));
 update public.crm_leads set last_contact_at=now(),next_action='Review latest customer message',updated_at=now() where id=c.lead_id;
 wid:=public.queue_conversation_work(c.id);
 return jsonb_build_object('id',c.id,'duplicate',false,'revision',c.revision,'workId',wid);
end $$;

-- Preserve uncertain write receipts while recording independently verified source state.
alter table public.action_jobs add column if not exists calendar_reconciliation jsonb,
 add column if not exists calendar_reconciled_at timestamptz;
alter table public.crm_appointments add column if not exists calendar_reconciliation_job_id uuid references public.action_jobs(id);

create function public.guard_calendar_reconciliation_marker() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and new.calendar_state_job_id is distinct from old.calendar_state_job_id then new.calendar_reconciliation_job_id:=null; end if;
 if ((tg_op='INSERT' and new.calendar_reconciliation_job_id is not null) or (tg_op='UPDATE' and new.calendar_reconciliation_job_id is distinct from old.calendar_reconciliation_job_id))
  and current_user not in ('service_role','postgres','supabase_admin') then raise exception 'Only verified source reconciliation may set the calendar reconciliation marker'; end if;
 return new;
end $$;
create trigger guard_calendar_reconciliation_marker before insert or update of calendar_state_job_id,calendar_reconciliation_job_id on public.crm_appointments
 for each row execute function public.guard_calendar_reconciliation_marker();

-- Exact historical proof: freshness is measured at evidence.verified_at, while
-- the RPC separately rejects stale newly submitted evidence. No write-response
-- status is invented and the original provider job status remains unchanged.
create function public.calendar_reconciliation_valid(p_partner uuid,p_client uuid,p_job uuid,p_evidence jsonb,p_at timestamptz default now())
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare j public.action_jobs; a public.approval_items; original public.action_jobs; original_approval public.approval_items; payload jsonb; observed jsonb; event jsonb;
 verified timestamptz; attempted timestamptz; seen timestamptz; changed timestamptz; first_seen timestamptz; first_changed timestamptz; first_etag text; first_calendar text; read_index integer:=0;
begin
 select * into j from public.action_jobs where id=p_job and partner_id=p_partner and client_id=p_client;
 select * into a from public.approval_items where id=j.approval_id and partner_id=p_partner and client_id=p_client and type='appointment_change'; payload:=a.proposed_payload;
 select * into original_approval from public.approval_items where id=(payload->>'booking_approval_id')::uuid and partner_id=p_partner and client_id=p_client and type='appointment_booking';
 select * into original from public.action_jobs where id=(payload->>'booking_action_job_id')::uuid and approval_id=(payload->>'booking_approval_id')::uuid and partner_id=p_partner and client_id=p_client and kind='calendar.book';
 if j.id is null or j.status not in ('uncertain','provider_pending') or a.id is null or a.status not in ('approved','edited_and_approved')
  or j.kind is distinct from 'calendar.'||(payload->>'mutation') or j.payload is distinct from payload or payload->'calendar_mutation_version' is distinct from '1'::jsonb or coalesce(payload->>'provider','') not in ('google_workspace','google_calendar')
  or original_approval.id is null or original_approval.status not in ('approved','edited_and_approved')
  or original_approval.proposed_payload->>'provider' is distinct from payload->>'provider' or original_approval.proposed_payload->>'calendar_connection_id' is distinct from payload->>'calendar_connection_id'
  or (original_approval.proposed_payload->>'contact_id' is not null and original_approval.proposed_payload->>'contact_id' is distinct from payload->>'contact_id')
  or original.status is distinct from 'succeeded' or original.receipt_recorded_at is null or nullif(original.external_ref,'') is null or original.external_ref is distinct from payload->>'external_ref'
  or jsonb_typeof(p_evidence) is distinct from 'object' or p_evidence->'version' is distinct from '1'::jsonb or p_evidence->>'state' is distinct from 'source_state_verified'
  or p_evidence->>'previous_status' is distinct from j.status or p_evidence->>'action_job_id' is distinct from j.id::text or p_evidence->>'approval_id' is distinct from a.id::text
  or p_evidence->>'booking_approval_id' is distinct from payload->>'booking_approval_id' or p_evidence->>'booking_action_job_id' is distinct from original.id::text
  or p_evidence->>'provider' is distinct from payload->>'provider' or p_evidence->>'operation' is distinct from payload->>'mutation'
  or p_evidence->>'calendar_connection_id' is distinct from payload->>'calendar_connection_id' or nullif(payload->>'calendar_connection_id','') is null
  or p_evidence->>'calendar_account_id' is distinct from payload->>'calendar_account_id' or nullif(payload->>'calendar_account_id','') is null
  or p_evidence->>'calendar_id' is distinct from payload->>'calendar_id' or nullif(payload->>'calendar_id','') is null or p_evidence->>'external_ref' is distinct from original.external_ref
  or p_evidence->'old_slot' is distinct from payload->'old_slot' or coalesce(p_evidence->'new_slot','null'::jsonb) is distinct from coalesce(payload->'new_slot','null'::jsonb)
  or jsonb_typeof(p_evidence->'observations') is distinct from 'array' or jsonb_array_length(p_evidence->'observations')<>2
  or coalesce(p_evidence->>'attempted_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(p_evidence->>'verified_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or coalesce(payload->>'source_etag','') collate "C" !~ '^"[\x21\x23-\x7e]+"$' then return false; end if;
 if jsonb_typeof(payload->'old_slot') is distinct from 'object' or coalesce(payload->'old_slot'->>'start_iso','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or coalesce(payload->'old_slot'->>'end_iso','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or (payload->'old_slot'->>'end_iso')::timestamptz<=(payload->'old_slot'->>'start_iso')::timestamptz then return false; end if;
 if payload->>'mutation'='reschedule' and (jsonb_typeof(payload->'new_slot') is distinct from 'object' or coalesce(payload->'new_slot'->>'start_iso','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or coalesce(payload->'new_slot'->>'end_iso','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or (payload->'new_slot'->>'end_iso')::timestamptz<=(payload->'new_slot'->>'start_iso')::timestamptz
  or (payload->'new_slot'->>'start_iso')::timestamptz=(payload->'old_slot'->>'start_iso')::timestamptz
  or (payload->'new_slot'->>'end_iso')::timestamptz-(payload->'new_slot'->>'start_iso')::timestamptz<>(payload->'old_slot'->>'end_iso')::timestamptz-(payload->'old_slot'->>'start_iso')::timestamptz) then return false; end if;
 if payload->>'mutation'='cancel' and coalesce(payload->'new_slot','null'::jsonb)<>'null'::jsonb then return false; end if;
 verified:=(p_evidence->>'verified_at')::timestamptz; attempted:=coalesce(j.last_attempt_at,j.claimed_at);
 if p_at is null or attempted is null or attempted is distinct from (p_evidence->>'attempted_at')::timestamptz or attempted<original.receipt_recorded_at or verified<attempted or verified>p_at then return false; end if;
 for observed in select value from jsonb_array_elements(p_evidence->'observations') loop
  read_index:=read_index+1;
  if jsonb_typeof(observed) is distinct from 'object' or observed->>'calendar_access_role' is distinct from 'owner'
   or observed->>'account_id' is distinct from payload->>'calendar_account_id' or observed->>'requested_calendar_id' is distinct from payload->>'calendar_id'
   or observed->>'event_id' is distinct from original.external_ref or nullif(observed->>'resolved_calendar_id','') is null
   or (payload->>'calendar_id'<>'primary' and observed->>'resolved_calendar_id' is distinct from payload->>'calendar_id')
   or (payload->>'provider'='google_calendar' and observed->>'resolved_calendar_id' is distinct from payload->>'calendar_account_id')
   or coalesce(observed->>'observed_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then return false; end if;
  seen:=(observed->>'observed_at')::timestamptz;
  if seen<attempted or seen>verified or seen<verified-interval '5 minutes' then return false; end if;
  if payload->>'mutation'='cancel' then
   if observed->'http_status'='200'::jsonb then event:=observed->'event';
   elsif observed->'http_status' in ('404'::jsonb,'410'::jsonb) and observed->'event'='null'::jsonb and observed->'tombstone_complete'='true'::jsonb then event:=observed->'tombstone';
   else return false; end if;
   if event->>'status' is distinct from 'cancelled' then return false; end if;
  elsif payload->>'mutation'='reschedule' then
   event:=observed->'event';
   if observed->'http_status' is distinct from '200'::jsonb or event->>'status' is distinct from 'confirmed'
    or event->'organizer_self' is distinct from 'true'::jsonb or event->'recurring' is distinct from 'false'::jsonb or event->'attendee_count' is distinct from '0'::jsonb or event->>'event_type' is distinct from 'default'
    or jsonb_typeof(event->'slot') is distinct from 'object' or coalesce(event->'slot'->>'start_iso','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(event->'slot'->>'end_iso','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
    or (event->'slot'->>'start_iso')::timestamptz is distinct from (payload->'new_slot'->>'start_iso')::timestamptz
    or (event->'slot'->>'end_iso')::timestamptz is distinct from (payload->'new_slot'->>'end_iso')::timestamptz then return false; end if;
  else return false; end if;
  if jsonb_typeof(event) is distinct from 'object' or event->>'id' is distinct from original.external_ref or coalesce(event->>'etag','') collate "C" !~ '^"[\x21\x23-\x7e]+"$'
   or event->>'etag' is not distinct from payload->>'source_etag' or coalesce(event->>'updated_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then return false; end if;
  changed:=(event->>'updated_at')::timestamptz;
  if changed<attempted or changed>seen then return false; end if;
  if read_index=1 then first_seen:=seen; first_changed:=changed; first_etag:=event->>'etag'; first_calendar:=observed->>'resolved_calendar_id';
  elsif seen<first_seen or changed is distinct from first_changed or event->>'etag' is distinct from first_etag or observed->>'resolved_calendar_id' is distinct from first_calendar then return false; end if;
 end loop;
 return read_index=2;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range or invalid_parameter_value then return false;
end $$;

create function public.calendar_reconciled_state(p_partner uuid,p_client uuid,p_booking uuid,p_native uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare n public.crm_appointments; j public.action_jobs; a public.approval_items; e jsonb;
begin
 select * into n from public.crm_appointments where id=p_native and approval_id=p_booking and partner_id=p_partner and client_id=p_client;
 select * into j from public.action_jobs where id=n.calendar_reconciliation_job_id and partner_id=p_partner and client_id=p_client;
 select * into a from public.approval_items where id=j.approval_id and partner_id=p_partner and client_id=p_client; e:=j.calendar_reconciliation;
 if n.id is null or j.id is null or j.calendar_reconciled_at is null or n.updated_at is distinct from j.calendar_reconciled_at
  or a.proposed_payload->>'booking_approval_id' is distinct from p_booking::text or a.proposed_payload->>'appointment_id' is distinct from n.id::text
  or a.proposed_payload->>'contact_id' is distinct from n.contact_id::text or a.proposed_payload->>'external_ref' is distinct from n.external_ref
  or not public.calendar_reconciliation_valid(p_partner,p_client,j.id,e) then return null; end if;
 if e->>'operation'='cancel' and n.status is distinct from 'cancelled' then return null; end if;
 if e->>'operation'='reschedule' and (n.status is distinct from 'booked' or n.start_at is distinct from (e->'new_slot'->>'start_iso')::timestamptz or n.end_at is distinct from (e->'new_slot'->>'end_iso')::timestamptz) then return null; end if;
 return jsonb_build_object('state','source_state_verified','jobId',j.id,'bookingApprovalId',p_booking,'appointmentId',n.id,'operation',e->'operation',
  'provider',e->'provider','externalRef',e->'external_ref','verifiedAt',e->'verified_at','reconciledAt',j.calendar_reconciled_at,'previousStatus',j.status,
  'calendarConnectionId',e->'calendar_connection_id','calendarAccountId',e->'calendar_account_id','calendarId',e->'calendar_id','slot',case when e->>'operation'='reschedule' then e->'new_slot' else e->'old_slot' end,'evidence',e);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return null;
end $$;

create function public.reconcile_calendar_change(p_partner uuid,p_client uuid,p_actor uuid,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior public.business_owner_commands; j public.action_jobs; a public.approval_items; origin public.approval_items; n public.crm_appointments; customer public.crm_contacts; account public.integration_connections;
 request_id uuid; receipt_id uuid:=extensions.gen_random_uuid(); public_request jsonb; evidence jsonb; reason text; task_id uuid; result jsonb; mirror_allowed boolean; linked_lead uuid;
begin
 public_request:=p_command-array['owner_request','expectedJobUpdatedAt','expectedAppointmentUpdatedAt','expectedContactUpdatedAt','expectedConnectionUpdatedAt','evidence'];
 if p_actor is null or jsonb_typeof(p_command) is distinct from 'object' or public_request->>'action' is distinct from 'reconcile_calendar_change'
  or public_request-array['action','key','targetId','expectedRevision','acceptReviewedSource']<>'{}'::jsonb or p_command->'owner_request' is distinct from public_request
  or (public_request ? 'acceptReviewedSource' and public_request->'acceptReviewedSource' is distinct from 'true'::jsonb)
  or nullif(public_request->>'expectedRevision','') is null or length(public_request->>'expectedRevision')>1500 then raise exception 'Invalid source reconciliation command' using errcode='22023'; end if;
 request_id:=(public_request->>'key')::uuid; if request_id is null then raise exception 'A durable request key is required' using errcode='22023'; end if;
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner for update;
 if not found then raise exception 'Business unavailable' using errcode='40001'; end if;
 select * into prior from public.business_owner_commands c where c.partner_id=p_partner and c.client_id=p_client and c.request_key=request_id;
 if prior.id is not null then
  if prior.actor_id is distinct from p_actor or prior.command->'owner_request' is distinct from public_request then raise exception 'Request key changed' using errcode='40001'; end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 select * into j from public.action_jobs where id=(public_request->>'targetId')::uuid and partner_id=p_partner and client_id=p_client;
 select * into a from public.approval_items where id=j.approval_id and partner_id=p_partner and client_id=p_client and type='appointment_change';
 select * into origin from public.approval_items where id=(a.proposed_payload->>'booking_approval_id')::uuid and partner_id=p_partner and client_id=p_client and type='appointment_booking' for update;
 if nullif(origin.proposed_payload->>'conversation_id','') is not null then perform 1 from public.business_conversations c where c.id=(origin.proposed_payload->>'conversation_id')::uuid and c.partner_id=p_partner and c.client_id=p_client for update; end if;
 select * into n from public.crm_appointments where id=(a.proposed_payload->>'appointment_id')::uuid and approval_id=origin.id and partner_id=p_partner and client_id=p_client for update;
 select * into customer from public.crm_contacts where id=(a.proposed_payload->>'contact_id')::uuid and partner_id=p_partner and client_id=p_client for update;
 select * into account from public.integration_connections where id=(a.proposed_payload->>'calendar_connection_id')::uuid and partner_id=p_partner and client_id=p_client for update;
 select * into a from public.approval_items where id=j.approval_id and partner_id=p_partner and client_id=p_client for update;
 select * into j from public.action_jobs where id=(public_request->>'targetId')::uuid and partner_id=p_partner and client_id=p_client for update;
 if j.id is null or j.status not in ('uncertain','provider_pending') or a.id is null or a.type is distinct from 'appointment_change' or a.status not in ('approved','edited_and_approved')
  or j.payload is distinct from a.proposed_payload or j.kind is distinct from 'calendar.'||(a.proposed_payload->>'mutation') or origin.id is null or n.id is null or customer.id is null
  or j.updated_at is distinct from (p_command->>'expectedJobUpdatedAt')::timestamptz or n.updated_at is distinct from (p_command->>'expectedAppointmentUpdatedAt')::timestamptz
  or customer.updated_at is distinct from (p_command->>'expectedContactUpdatedAt')::timestamptz or account.updated_at is distinct from (p_command->>'expectedConnectionUpdatedAt')::timestamptz then raise exception 'The exact saved action, source or customer changed' using errcode='40001'; end if;
 if public.calendar_reconciliation_valid(p_partner,p_client,j.id,j.calendar_reconciliation) and public_request->'acceptReviewedSource' is distinct from 'true'::jsonb then raise exception 'This saved action requires fresh explicit review before accepting another current native state' using errcode='40001'; end if;
 evidence:=p_command->'evidence';
 if jsonb_typeof(evidence) is distinct from 'object' or evidence->'version' is distinct from '1'::jsonb or coalesce(evidence->>'state','') not in ('source_state_verified','needs_review')
  or evidence->>'previous_status' is distinct from j.status or evidence->>'action_job_id' is distinct from j.id::text or evidence->>'approval_id' is distinct from a.id::text
  or evidence->>'booking_approval_id' is distinct from origin.id::text or evidence->>'booking_action_job_id' is distinct from a.proposed_payload->>'booking_action_job_id'
  or evidence->>'provider' is distinct from a.proposed_payload->>'provider' or evidence->>'operation' is distinct from a.proposed_payload->>'mutation'
  or evidence->>'calendar_connection_id' is distinct from a.proposed_payload->>'calendar_connection_id' or evidence->>'calendar_account_id' is distinct from a.proposed_payload->>'calendar_account_id'
  or evidence->>'calendar_id' is distinct from a.proposed_payload->>'calendar_id' or evidence->>'external_ref' is distinct from a.proposed_payload->>'external_ref'
  or evidence->'old_slot' is distinct from a.proposed_payload->'old_slot' or coalesce(evidence->'new_slot','null'::jsonb) is distinct from coalesce(a.proposed_payload->'new_slot','null'::jsonb)
  or coalesce(evidence->>'verified_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or (evidence->>'verified_at')::timestamptz>now() or (evidence->>'verified_at')::timestamptz<now()-interval '5 minutes'
  or nullif(evidence->>'reason','') is null or length(evidence->>'reason')>2000 or jsonb_typeof(evidence->'observations') is distinct from 'array' or jsonb_array_length(evidence->'observations')>2 then raise exception 'Invalid normalized source evidence' using errcode='22023'; end if;
 if evidence->>'state'='source_state_verified' then
  if account.id is null or account.status not in ('connected','needs_attention') or account.external_account_id is distinct from evidence->>'calendar_account_id'
   or not exists(select 1 from public.integration_providers p where p.id=account.provider_id and p.provider_key=evidence->>'provider')
   or not public.calendar_reconciliation_valid(p_partner,p_client,j.id,evidence) then raise exception 'Exact source verification failed' using errcode='22023'; end if;
  mirror_allowed:=n.contact_id=customer.id and n.external_ref=a.proposed_payload->>'external_ref' and
   (public_request->'acceptReviewedSource'='true'::jsonb or (n.updated_at=(a.proposed_payload->>'appointment_updated_at')::timestamptz and n.status='booked'
    and n.start_at=(a.proposed_payload->'old_slot'->>'start_iso')::timestamptz and n.end_at=(a.proposed_payload->'old_slot'->>'end_iso')::timestamptz));
  if not coalesce(mirror_allowed,false) then reason:='The source state is observed, but the native appointment changed. Compare the current source and local record before mirroring.';
  elsif evidence->>'operation'='reschedule' and exists(select 1 from public.crm_appointments other where other.partner_id=p_partner and other.client_id=p_client and other.id<>n.id and other.status in ('booked','proposed')
   and other.start_at<(evidence->'new_slot'->>'end_iso')::timestamptz and other.end_at>(evidence->'new_slot'->>'start_iso')::timestamptz) then reason:='The source state is observed, but the replacement time conflicts with another native appointment. Review the exact source.'; end if;
 else reason:=evidence->>'reason'; end if;
 if reason is not null then
  evidence:=evidence||jsonb_build_object('state','needs_review','reason',reason);
  select l.id into linked_lead from public.crm_leads l where l.id=coalesce(n.lead_id,(origin.proposed_payload->>'lead_id')::uuid) and l.partner_id=p_partner and l.client_id=p_client and l.contact_id=customer.id;
  select t.id into task_id from public.crm_tasks t where t.partner_id=p_partner and t.client_id=p_client and t.calendar_action_job_id=j.id and t.task_type='calendar_change_reconciliation';
  if task_id is null then insert into public.crm_tasks(partner_id,client_id,contact_id,lead_id,booking_approval_id,calendar_action_job_id,title,description,status,priority,task_type)
   values(p_partner,p_client,customer.id,linked_lead,origin.id,j.id,'Review unresolved calendar source state',reason||' The original uncertain provider result is preserved. No calendar mutation was repeated.','open','high','calendar_change_reconciliation') returning id into task_id;
  else update public.crm_tasks set status='open',completed_at=null,description=reason||' The original uncertain provider result is preserved. No calendar mutation was repeated.' where id=task_id and partner_id=p_partner and client_id=p_client; end if;
 else
  if evidence->>'operation'='cancel' then update public.crm_appointments set status='cancelled',calendar_reconciliation_job_id=j.id,updated_at=now() where id=n.id;
  else update public.crm_appointments set status='booked',start_at=(evidence->'new_slot'->>'start_iso')::timestamptz,end_at=(evidence->'new_slot'->>'end_iso')::timestamptz,calendar_reconciliation_job_id=j.id,updated_at=now() where id=n.id; end if;
  if evidence->>'operation'='cancel' then update public.crm_tasks set status='done',completed_at=now() where partner_id=p_partner and client_id=p_client and booking_approval_id=origin.id and task_type='booking_cancellation_request' and status='open'; end if;
  update public.crm_tasks set status='done',completed_at=now() where partner_id=p_partner and client_id=p_client and calendar_action_job_id=j.id and task_type='calendar_change_reconciliation' and status='open';
 end if;
 perform public.stop_booking_change_followups(p_partner,p_client,origin.id,'The old calendar state has an owner source-reconciliation decision. No automatic follow-up renewal.');
 update public.action_jobs set confirmation_due_at=null,booking_followup_due_at=null,
  booking_followup_phase=case when booking_followup_phase='stopped' or evidence->>'operation'='cancel' or evidence->>'state'='needs_review' then 'stopped' else 'done' end,
  booking_followup_reason='The saved source review requires a fresh explicit follow-up decision.' where id=(a.proposed_payload->>'booking_action_job_id')::uuid and approval_id=origin.id and partner_id=p_partner and client_id=p_client and kind='calendar.book' and status='succeeded';
 update public.action_jobs set calendar_reconciliation=evidence,calendar_reconciled_at=now() where id=j.id;
 result:=jsonb_build_object('id',receipt_id,'actionJobId',j.id,'bookingApprovalId',origin.id,'taskId',task_id,'state',evidence->>'state','replayed',false,
  'message',case when evidence->>'state'='source_state_verified' then 'Current approved source state verified and recorded. The original uncertain provider result is preserved; no calendar change was repeated or attributed to this request.' else 'Source result remains in review. One linked review task is saved; no calendar change was repeated.' end);
 insert into public.business_owner_commands(id,partner_id,client_id,actor_id,request_key,command,result) values(receipt_id,p_partner,p_client,p_actor,request_id,p_command,result);
 return result;
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('guard_calendar_reconciliation_marker','calendar_reconciliation_valid','calendar_reconciled_state','reconcile_calendar_change') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

-- A successful source review remains historical evidence after a later verified
-- change advances the native state marker. It never becomes retryable work.
create function public.calendar_change_source_resolved(p_partner uuid,p_client uuid,p_job uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce((select j.calendar_reconciled_at is not null and public.calendar_reconciliation_valid(p_partner,p_client,j.id,j.calendar_reconciliation)
 from public.action_jobs j where j.id=p_job and j.partner_id=p_partner and j.client_id=p_client),false);
$$;
revoke all on function public.calendar_change_source_resolved(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.calendar_change_source_resolved(uuid,uuid,uuid) to service_role;
create or replace function public.calendar_mutation_source_check(p_partner uuid,p_client uuid,p_payload jsonb,p_execute boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare origin public.approval_items; receipt public.action_jobs; native public.crm_appointments; customer public.crm_contacts;
 business public.client_businesses; settings public.agent_team_settings; activation public.business_agent_activation;
 account public.integration_connections; source public.integration_canonical_records; thread public.business_conversations;
 state_job public.action_jobs; provider text; latest jsonb; desired_start timestamptz; desired_end timestamptz;
 original_start timestamptz; original_end timestamptz; effective_clock timestamptz; peer_ids uuid[]; count_sources integer; zone text;
 local_start timestamp; local_end timestamp; effective jsonb;
begin
 if jsonb_typeof(p_payload) is distinct from 'object' or p_payload->'calendar_mutation_version' is distinct from '1'::jsonb
  or coalesce(p_payload->>'mutation','') not in ('cancel','reschedule') or coalesce(p_payload->>'provider','') not in ('northstar_internal','google_workspace','google_calendar')
  or not (p_payload ?& array['booking_approval_id','booking_action_job_id','appointment_id','appointment_updated_at','contact_id','contact_updated_at','provider','calendar_connection_id','calendar_account_id','calendar_id','external_ref','source_record_id','source_updated_at','source_etag','old_slot','authority_revision','customer_activity_id','customer_activity_at','conversation_id','conversation_revision'])
  or p_payload->>'scenario_lab'='true' then
  return jsonb_build_object('allowed',false,'reason','The exact supported calendar mutation payload is required.'); end if;
 select * into origin from public.approval_items where id=(p_payload->>'booking_approval_id')::uuid and partner_id=p_partner and client_id=p_client and type='appointment_booking';
 select * into receipt from public.action_jobs where id=(p_payload->>'booking_action_job_id')::uuid and partner_id=p_partner and client_id=p_client and approval_id=origin.id and kind='calendar.book';
 select * into native from public.crm_appointments where id=(p_payload->>'appointment_id')::uuid and partner_id=p_partner and client_id=p_client and approval_id=origin.id;
 select * into customer from public.crm_contacts where id=(p_payload->>'contact_id')::uuid and partner_id=p_partner and client_id=p_client;
 if origin.id is null or origin.status not in ('approved','edited_and_approved') or receipt.status is distinct from 'succeeded' or receipt.receipt_recorded_at is null
  or nullif(receipt.external_ref,'') is null or receipt.external_ref is distinct from p_payload->>'external_ref'
  or native.id is null or native.contact_id is distinct from customer.id or customer.id is null or native.status is distinct from 'booked'
  or native.external_ref is distinct from receipt.external_ref or native.updated_at is distinct from (p_payload->>'appointment_updated_at')::timestamptz
  or customer.updated_at is distinct from (p_payload->>'contact_updated_at')::timestamptz
  or origin.proposed_payload->>'provider' is distinct from p_payload->>'provider' then
  return jsonb_build_object('allowed',false,'reason','The original successful booking, exact appointment or customer changed.'); end if;
 original_start:=(p_payload->'old_slot'->>'start_iso')::timestamptz; original_end:=(p_payload->'old_slot'->>'end_iso')::timestamptz;
 if original_start is null or original_end is null or original_start<=now() or original_end<=original_start
  or native.start_at is distinct from original_start or native.end_at is distinct from original_end then
  return jsonb_build_object('allowed',false,'reason','The original appointment time changed or has started.'); end if;
 if customer.tags is null or exists(select 1 from unnest(customer.tags) tag where lower(regexp_replace(btrim(tag),'[[:space:]-]+','_','g')) in ('do_not_contact','opt_out','opted_out','unsubscribed','stop'))
  or exists(select 1 from public.business_conversations c where c.partner_id=p_partner and c.client_id=p_client and c.contact_id=customer.id and c.identity_status='owner_verified'
    and (c.opted_out or (c.mode='human' and c.state<>'closed'))) then
  return jsonb_build_object('allowed',false,'reason','Customer suppression or human handling requires review before another action.'); end if;
 latest:=public.calendar_mutation_latest_activity(p_partner,p_client,customer.id);
 if latest->>'id' is distinct from p_payload->>'customer_activity_id' or (latest->>'at')::timestamptz is distinct from (p_payload->>'customer_activity_at')::timestamptz then
  return jsonb_build_object('allowed',false,'reason','The customer instructions changed. Review the latest received response.'); end if;
 if (p_payload->>'customer_activity_id' is null) is distinct from (p_payload->>'customer_activity_at' is null) then
  return jsonb_build_object('allowed',false,'reason','The customer activity identity and version must be pinned together.'); end if;
 if nullif(origin.proposed_payload->>'conversation_id','') is not null then
  select * into thread from public.business_conversations where id=(origin.proposed_payload->>'conversation_id')::uuid and partner_id=p_partner and client_id=p_client;
  if thread.id is null or thread.id::text is distinct from p_payload->>'conversation_id' or thread.contact_id is distinct from customer.id or thread.identity_status is distinct from 'owner_verified'
   or thread.mode is distinct from 'agent' or thread.opted_out or thread.state='closed' or thread.revision is distinct from (p_payload->>'conversation_revision')::integer then
   return jsonb_build_object('allowed',false,'reason','The original verified conversation changed or is under human handling.'); end if;
 elsif p_payload->>'conversation_id' is not null or p_payload->>'conversation_revision' is not null then
  return jsonb_build_object('allowed',false,'reason','An unrelated conversation cannot authorize this appointment change.'); end if;
 select * into business from public.client_businesses where id=p_client and partner_id=p_partner;
 select * into settings from public.agent_team_settings where partner_id=p_partner and client_id=p_client;
 select * into activation from public.business_agent_activation where partner_id=p_partner and client_id=p_client;
 if business.status is distinct from 'active' or settings.status is distinct from 'active' or not coalesce(settings.scheduling_enabled,false)
  or settings.authority_revision is distinct from (p_payload->>'authority_revision')::integer
  or activation.status is distinct from 'active' or not coalesce(activation.bookings,false)
  or not public.business_channel_can_draft(p_partner,p_client,'calendar',null)
  or (p_execute and coalesce(settings.channel_authority->>'calendar','require_approval')<>'require_approval') then
  return jsonb_build_object('allowed',false,'reason','Current reviewed business context and selected calendar authority do not permit this step.'); end if;
 if native.calendar_reconciliation_job_id is not null then
  effective:=public.calendar_reconciled_state(p_partner,p_client,origin.id,native.id);
  if effective is null or effective->>'operation' is distinct from 'reschedule' then return jsonb_build_object('allowed',false,'reason','The reconciled source state changed; review the current appointment.'); end if;
  effective:=effective||jsonb_build_object('allowed',true,'receiptAt',effective->'verifiedAt');
 else effective:=public.booking_effective_calendar_state(p_partner,p_client,origin.id,receipt.id,native.id); end if;
 if effective->>'allowed' is distinct from 'true' then return jsonb_build_object('allowed',false,'reason',coalesce(effective->>'reason','The effective calendar state is unverified.')); end if;
 effective_clock:=(effective->>'receiptAt')::timestamptz;
 provider:=p_payload->>'provider';
 if provider='northstar_internal' then
  if business.crm_operating_mode not in ('primary_crm','mirror','assist') or business.default_runtime_mode is distinct from 'live'
   or p_payload->>'calendar_connection_id' is not null or p_payload->>'calendar_account_id' is not null or p_payload->>'calendar_id' is not null
   or p_payload->>'source_record_id' is not null or p_payload->>'source_etag' is not null or (p_payload->>'source_updated_at')::timestamptz is distinct from native.updated_at then
   return jsonb_build_object('allowed',false,'reason','The exact active internal calendar version is required.'); end if;
 else
  select c.* into account from public.integration_connections c join public.integration_providers p on p.id=c.provider_id
   where c.id=(p_payload->>'calendar_connection_id')::uuid and c.partner_id=p_partner and c.client_id=p_client and p.provider_key=provider;
  if account.id is null or origin.proposed_payload->>'calendar_connection_id' is distinct from account.id::text or account.status is distinct from 'connected' or account.runtime_mode is distinct from 'live'
   or (account.config->>'workspace_view_only'='true' and not (provider='google_workspace' and public.google_config_can_act(account.config,'calendar'))) or nullif(account.external_account_id,'') is null or account.external_account_id is distinct from p_payload->>'calendar_account_id'
   or coalesce(nullif(account.config->>'calendar_id',''),'primary') is distinct from p_payload->>'calendar_id' then
   return jsonb_build_object('allowed',false,'reason','The exact calendar account is paused, read only, disconnected or changed.'); end if;
  if account.config->>'workspace_view_only'='true' and (not public.business_channel_can_draft(p_partner,p_client,'calendar',account.id)
   or (p_execute and (account.config->>'activation_calendar_verified' is distinct from 'true' or nullif(account.config->>'activation_checked_at','') is null
    or (account.config->>'activation_checked_at')::timestamptz<now()-interval '24 hours' or (account.config->>'activation_checked_at')::timestamptz>now()+interval '1 minute'))) then
   return jsonb_build_object('allowed',false,'reason','Recheck and explicitly select this Google calendar before approved changes.'); end if;
  select array_agg(c.id order by c.id) into peer_ids from public.integration_connections c where c.partner_id=p_partner and c.client_id=p_client and c.provider_id=account.provider_id
   and (c.id=account.id or c.external_account_id=account.external_account_id);
  if coalesce(cardinality(peer_ids),0)>100 then return jsonb_build_object('allowed',false,'reason','Calendar account coverage is incomplete.'); end if;
  select * into source from public.integration_canonical_records r where r.id=(p_payload->>'source_record_id')::uuid and r.partner_id=p_partner and r.client_id=p_client
   and r.connection_id=any(peer_ids) and r.object_type='appointment' and r.external_object_id=receipt.external_ref;
  if source.id is null or (source.native_object_id is not null and source.native_object_id is distinct from native.id::text)
   or source.external_updated_at is distinct from (p_payload->>'source_updated_at')::timestamptz
   or coalesce(source.source_payload->>'etag',source.source_payload->>'@odata.etag') is distinct from p_payload->>'source_etag'
   or coalesce(p_payload->>'source_etag','') !~ '^"[^"\r\n]+"$'
   or source.snapshot_observed_at is null or source.snapshot_observed_at<effective_clock or source.snapshot_observed_at<now()-interval '45 minutes' or source.snapshot_observed_at>now()
   or source.source_payload->'organizer'->>'self' is distinct from 'true'
   or source.source_payload ? 'recurringEventId' or source.source_payload ? 'recurrence'
   or (jsonb_typeof(source.source_payload->'attendees')='array' and jsonb_array_length(source.source_payload->'attendees')>0)
   or coalesce(source.source_payload->>'eventType','default')<>'default' then
   return jsonb_build_object('allowed',false,'reason','Refresh the exact owned single-event source version before changing this appointment.'); end if;
  select count(*) into count_sources from public.integration_canonical_records r where r.partner_id=p_partner and r.client_id=p_client and r.connection_id=any(peer_ids) and r.object_type='appointment' and r.external_object_id=receipt.external_ref;
  if count_sources>100 or exists(select 1 from public.integration_canonical_records r where r.partner_id=p_partner and r.client_id=p_client and r.connection_id=any(peer_ids) and r.object_type='appointment' and r.external_object_id=receipt.external_ref
    and ((r.native_object_id is not null and r.native_object_id is distinct from native.id::text) or coalesce(r.canonical_data->>'deleted','false')='true'
     or coalesce(r.canonical_data->>'status','') not in ('confirmed','booked')
     or (r.canonical_data->>'start_at')::timestamptz is distinct from native.start_at or (r.canonical_data->>'end_at')::timestamptz is distinct from native.end_at
     or coalesce(r.source_payload->>'etag',r.source_payload->>'@odata.etag') is distinct from p_payload->>'source_etag'))
   or exists(select 1 from public.integration_sync_states s where s.partner_id=p_partner and s.client_id=p_client and s.connection_id=any(peer_ids) and s.stream_key='appointment'
    and (nullif(s.last_error,'') is not null or s.status in ('paused','failing') or nullif(s.cursor_value->>'pageToken','') is not null or nullif(s.cursor_value->>'nextLink','') is not null or s.cursor_value->>'has_more'='true')) then
   return jsonb_build_object('allowed',false,'reason','Exact calendar sources conflict or an import is incomplete. Reconcile the account first.'); end if;
 end if;
 if p_payload->>'mutation'='cancel' then
  if p_payload ? 'new_slot' and p_payload->'new_slot'<>'null'::jsonb then return jsonb_build_object('allowed',false,'reason','Cancellation cannot include a replacement time.'); end if;
 else
  desired_start:=(p_payload->'new_slot'->>'start_iso')::timestamptz; desired_end:=(p_payload->'new_slot'->>'end_iso')::timestamptz;
  if desired_start is null or desired_end is null or desired_start<=now() or desired_end<=desired_start or desired_end-desired_start<>original_end-original_start
   or (desired_start=original_start and desired_end=original_end) then return jsonb_build_object('allowed',false,'reason','Choose a different future time with the same service duration.'); end if;
  if receipt.booking_followup_phase='stopped' or exists(select 1 from public.crm_tasks t where t.partner_id=p_partner and t.client_id=p_client and t.booking_approval_id=origin.id and t.task_type='booking_cancellation_request' and t.status='open') then
   return jsonb_build_object('allowed',false,'reason','A cancellation request stopped this booking. Review that decision before a time change.'); end if;
  zone:=activation.timezone;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then return jsonb_build_object('allowed',false,'reason','The current business timezone is unavailable.'); end if;
  local_start:=desired_start at time zone zone; local_end:=desired_end at time zone zone;
  if not (extract(dow from local_start)::integer=any(activation.booking_weekdays)) or local_start::date<>local_end::date
   or extract(epoch from local_start::time)/3600<activation.booking_start_hour or extract(epoch from local_end::time)/3600>activation.booking_end_hour then
   return jsonb_build_object('allowed',false,'reason','The replacement time no longer fits the selected business hours.'); end if;
  if provider='northstar_internal' and exists(select 1 from public.crm_availability_windows w where w.partner_id=p_partner and w.client_id=p_client and w.active) and not exists(
   select 1 from public.crm_availability_windows w where w.partner_id=p_partner and w.client_id=p_client and w.active and w.weekday=extract(dow from local_start)
    and local_start::time>=w.start_time and local_end::time<=w.end_time and extract(epoch from desired_end-desired_start)/60=w.appointment_minutes) then
   return jsonb_build_object('allowed',false,'reason','The replacement time no longer fits current native availability windows.'); end if;
  if exists(select 1 from public.crm_appointments n where n.partner_id=p_partner and n.client_id=p_client and n.id<>native.id and n.status in ('proposed','booked') and n.start_at<desired_end and n.end_at>desired_start) then
   return jsonb_build_object('allowed',false,'reason','The shared business calendar replacement time is already occupied.'); end if;
 end if;
 return jsonb_build_object('allowed',true,'reason','Current exact source, customer, context and calendar authority permit this step.');
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
 return jsonb_build_object('allowed',false,'reason','The appointment change contains an invalid identity or source version.');
end $$;

create or replace function public.prepare_calendar_mutation(p_partner uuid,p_client uuid,p_actor uuid,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior public.business_owner_commands; origin public.approval_items; native public.crm_appointments; customer public.crm_contacts;
 offer public.booking_change_offers; request_id uuid; proposal_id uuid; receipt_id uuid:=extensions.gen_random_uuid(); public_request jsonb; payload jsonb; verdict jsonb; result jsonb; action text;
begin
 public_request:=p_command-array['payload','owner_request']; action:=p_command->>'action'; request_id:=(p_command->>'key')::uuid; payload:=p_command->'payload';
 if p_actor is null or request_id is null or jsonb_typeof(p_command) is distinct from 'object' or p_command->'owner_request' is distinct from public_request
  or public_request-array['action','key','targetId','expectedRevision','offerId','slot']<>'{}'::jsonb or coalesce(action,'') not in ('prepare_cancellation','prepare_time_change') then raise exception 'Invalid calendar decision' using errcode='22023'; end if;
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner for update;
 if not found then raise exception 'Business unavailable'; end if;
 select * into prior from public.business_owner_commands c where c.partner_id=p_partner and c.client_id=p_client and c.request_key=request_id;
 if prior.id is not null then
  if prior.actor_id is distinct from p_actor or coalesce(prior.command->'owner_request',prior.command) is distinct from public_request then raise exception 'Request key changed' using errcode='40001'; end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 select * into origin from public.approval_items where id=(p_command->>'targetId')::uuid and partner_id=p_partner and client_id=p_client and type='appointment_booking' for update;
 if origin.id is null or payload->>'booking_approval_id' is distinct from origin.id::text or nullif(p_command->>'expectedRevision','') is null then raise exception 'The exact original booking is unavailable' using errcode='40001'; end if;
 -- Acquire conversation before mutable customer/proposal rows, matching intake.
 if nullif(origin.proposed_payload->>'conversation_id','') is not null then perform 1 from public.business_conversations c where c.id=(origin.proposed_payload->>'conversation_id')::uuid and c.partner_id=p_partner and c.client_id=p_client for update; end if;
 select * into native from public.crm_appointments where approval_id=origin.id and partner_id=p_partner and client_id=p_client for update;
 select * into customer from public.crm_contacts where id=native.contact_id and partner_id=p_partner and client_id=p_client for update;
 if action='prepare_cancellation' and (payload->>'mutation' is distinct from 'cancel' or p_command ? 'offerId' or p_command ? 'slot') then raise exception 'Invalid cancellation decision' using errcode='22023'; end if;
 if action='prepare_time_change' then
  select * into offer from public.booking_change_offers o where o.id=(p_command->>'offerId')::uuid and o.partner_id=p_partner and o.client_id=p_client and o.actor_id=p_actor and o.booking_approval_id=origin.id for update;
  if offer.id is null or offer.expires_at<=now() or offer.consumed_by_approval is not null or offer.revision is distinct from p_command->>'expectedRevision'
   or payload->>'mutation' is distinct from 'reschedule' or (offer.payload-array['mutation','new_slot']) is distinct from (payload-array['mutation','new_slot'])
   or not exists(select 1 from jsonb_array_elements(offer.slots) selected where selected=p_command->'slot')
   or payload->'new_slot' is distinct from ((p_command->'slot')-'label') then raise exception 'Choose an exact current actor-bound replacement offer' using errcode='40001'; end if;
 end if;
 verdict:=public.calendar_mutation_source_check(p_partner,p_client,payload,false);
 if verdict->>'allowed' is distinct from 'true' then raise exception '%',verdict->>'reason' using errcode='40001'; end if;
 -- Retire expired review and definitely unsent failed/dry-run attempts before
 -- preparing a replacement. A formerly approved action remains immutable history.
 update public.approval_items a set status='expired',resolution_note='Expired calendar decision; a fresh exact review is required.'
  where a.partner_id=p_partner and a.client_id=p_client and a.type='appointment_change' and a.proposed_payload->>'booking_approval_id'=origin.id::text
   and a.status='pending' and a.expires_at<=now();
 update public.action_jobs j set status='cancelled',outcome_detail='Superseded by a fresh owner-reviewed calendar decision; no provider effect was established.'
  from public.approval_items a where j.approval_id=a.id and a.partner_id=p_partner and a.client_id=p_client and a.type='appointment_change'
   and a.proposed_payload->>'booking_approval_id'=origin.id::text and j.partner_id=p_partner and j.client_id=p_client
   and j.status in ('failed','dry_run','skipped') and nullif(j.external_ref,'') is null;
 if exists(select 1 from public.approval_items a where a.partner_id=p_partner and a.client_id=p_client and a.type='appointment_change'
  and a.proposed_payload->>'booking_approval_id'=origin.id::text and (
   (a.status='pending' and a.expires_at>now() and (a.proposed_payload->>'appointment_updated_at')::timestamptz=native.updated_at)
   or exists(select 1 from public.action_jobs j where j.partner_id=p_partner and j.client_id=p_client and j.approval_id=a.id and not public.calendar_change_source_resolved(p_partner,p_client,j.id) and (
    j.status in ('processing','provider_pending','uncertain') or (j.status='failed' and nullif(j.external_ref,'') is not null)
    or ((a.proposed_payload->>'appointment_updated_at')::timestamptz=native.updated_at and j.status in ('pending','succeeded')))))) then
  raise exception 'Review the existing or uncertain calendar decision first' using errcode='40001'; end if;
 insert into public.approval_items(partner_id,client_id,workflow_run_id,type,status,title,summary,risk_level,proposed_payload,expires_at)
 values(p_partner,p_client,origin.workflow_run_id,'appointment_change','pending',case when action='prepare_cancellation' then 'Review appointment cancellation' else 'Review appointment time change' end,
  'The exact current event, customer, policy and replacement availability are checked again after approval. No calendar change has occurred.',
  'medium',payload,least(now()+interval '15 minutes',native.start_at)) returning id into proposal_id;
 if offer.id is not null then update public.booking_change_offers set consumed_by_approval=proposal_id where id=offer.id; end if;
 result:=jsonb_build_object('id',receipt_id,'bookingApprovalId',origin.id,'approvalId',proposal_id,'message','Calendar proposal saved for owner approval. No appointment was changed.','replayed',false);
 insert into public.business_owner_commands(id,partner_id,client_id,actor_id,request_key,command,result) values(receipt_id,p_partner,p_client,p_actor,request_id,p_command,result);
 return result;
end $$;

create or replace function public.booking_terminal_rebooking_proof(p_partner uuid,p_client uuid,p_booking_approval uuid,p_appointment uuid)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare a public.approval_items; j public.action_jobs; n public.crm_appointments; state_job public.action_jobs; change public.approval_items; account public.integration_connections;
 mutation jsonb; proof jsonb; effective jsonb; receipt_at timestamptz; source_count integer; all_cancelled boolean; post_receipt boolean; fresh boolean; native_link boolean; consistent_link boolean;
begin
 select * into a from public.approval_items where id=p_booking_approval and partner_id=p_partner and client_id=p_client and type='appointment_booking' and status in ('approved','edited_and_approved');
 select * into j from public.action_jobs where approval_id=a.id and partner_id=p_partner and client_id=p_client and kind='calendar.book' and status='succeeded' and nullif(external_ref,'') is not null;
 select * into n from public.crm_appointments where id=p_appointment and approval_id=a.id and partner_id=p_partner and client_id=p_client;
 if a.id is null or j.id is null or j.receipt_recorded_at is null or n.id is null or n.external_ref is distinct from j.external_ref then return false; end if;
 if n.calendar_reconciliation_job_id is not null and n.status='cancelled' then
  effective:=public.calendar_reconciled_state(p_partner,p_client,a.id,n.id);
  if effective->>'operation'='cancel' then return true; end if;
 end if;
 if n.status='completed' then return n.lifecycle_completed_at is not null and n.lifecycle_completed_at<=now() and n.end_at<=now(); end if;
 if n.status<>'cancelled' then return false; end if;
 if a.proposed_payload->>'provider'='northstar_internal' then return true; end if;
 select c.* into account from public.integration_connections c join public.integration_providers provider on provider.id=c.provider_id where c.id::text=a.proposed_payload->>'calendar_connection_id' and c.partner_id=p_partner and c.client_id=p_client and provider.provider_key=a.proposed_payload->>'provider';
 if account.id is null or account.external_account_id is null then return false; end if;
 if n.calendar_state_job_id is not null then
  select * into state_job from public.action_jobs where id=n.calendar_state_job_id and partner_id=p_partner and client_id=p_client and kind='calendar.cancel' and status='succeeded';
  select * into change from public.approval_items where id=state_job.approval_id and partner_id=p_partner and client_id=p_client and type='appointment_change' and status in ('approved','edited_and_approved');
  mutation:=change.proposed_payload; proof:=state_job.provider_receipt;
  if state_job.id is not null and change.id is not null and state_job.external_ref=j.external_ref and jsonb_typeof(mutation)='object' and jsonb_typeof(proof)='object' and
   proof ?& array['provider','operation','event_id','http_status','request_id','event_etag','event_updated_at','verified_at','verified_absent','old_slot','new_slot'] and
   jsonb_typeof(proof->'request_id') in ('string','null') and coalesce(length(proof->>'request_id'),0)<=1000 and jsonb_typeof(proof->'event_etag') in ('string','null') and coalesce(length(proof->>'event_etag'),0)<=1100 and jsonb_typeof(proof->'event_updated_at') in ('string','null') and
   coalesce(proof->>'verified_at','') ~ '(Z|[+-][0-9]{2}:[0-9]{2})$' and
   mutation->'calendar_mutation_version'='1'::jsonb and mutation->>'mutation'='cancel' and mutation->>'booking_approval_id'=a.id::text and mutation->>'booking_action_job_id'=j.id::text and mutation->>'appointment_id'=n.id::text and mutation->>'contact_id'=n.contact_id::text and
   mutation->>'provider'=a.proposed_payload->>'provider' and mutation->>'provider' in ('google_calendar','google_workspace') and mutation->>'calendar_connection_id'=account.id::text and mutation->>'calendar_account_id'=account.external_account_id and mutation->>'external_ref'=j.external_ref and
   nullif(mutation->>'calendar_id','') is not null and nullif(mutation->>'source_record_id','') is not null and nullif(mutation->>'source_etag','') is not null and mutation->>'new_slot' is null and
   proof->>'provider'=mutation->>'provider' and proof->>'operation'='cancel' and proof->>'event_id'=j.external_ref and proof->'http_status'='204'::jsonb and proof->>'new_slot' is null and jsonb_typeof(proof->'verified_absent')='boolean' and
   (proof->>'verified_at')::timestamptz between j.receipt_recorded_at and now() and
   (proof->'old_slot'->>'start_iso')::timestamptz=(mutation->'old_slot'->>'start_iso')::timestamptz and (proof->'old_slot'->>'end_iso')::timestamptz=(mutation->'old_slot'->>'end_iso')::timestamptz and
   (mutation->'old_slot'->>'start_iso')::timestamptz=n.start_at and (mutation->'old_slot'->>'end_iso')::timestamptz=n.end_at and
   (proof->'verified_absent'='true'::jsonb or (coalesce(proof->>'event_etag','') ~ '^"[!#-~]+"$' and nullif(proof->>'event_updated_at','') is not null)) then
   if nullif(proof->>'event_updated_at','') is not null then perform (proof->>'event_updated_at')::timestamptz; end if;
   if proof->'verified_absent'='true'::jsonb then return true; end if;
   receipt_at:=(proof->>'verified_at')::timestamptz;
  end if;
 end if;
 -- A previous verified reschedule moves the minimum source observation clock.
 -- An unknown state pointer never falls back to the original receipt.
 if receipt_at is null then
  effective:=public.booking_effective_calendar_state(p_partner,p_client,a.id,j.id,n.id);
  if effective->>'allowed' is distinct from 'true' then return false; end if;
  receipt_at:=(effective->>'receiptAt')::timestamptz;
 end if;
 if account.status not in ('connected','needs_attention') or account.runtime_mode='paused' then return false; end if;
 select count(*),bool_and(coalesce(r.canonical_data->>'deleted'='true',false) or coalesce(r.canonical_data->>'status','') in ('cancelled','canceled')),
  bool_and(coalesce(r.snapshot_observed_at>=receipt_at and r.snapshot_observed_at<=now(),false)),bool_or(r.snapshot_observed_at>=now()-interval '45 minutes' and r.snapshot_observed_at<=now()),
  bool_or(r.native_object_id=n.id::text),bool_and(r.native_object_id is null or r.native_object_id=n.id::text)
 into source_count,all_cancelled,post_receipt,fresh,native_link,consistent_link
 from public.integration_canonical_records r join public.integration_connections peer on peer.id=r.connection_id and peer.partner_id=r.partner_id and peer.client_id=r.client_id
 where r.partner_id=p_partner and r.client_id=p_client and r.object_type='appointment' and r.external_object_id=j.external_ref and peer.provider_id=account.provider_id and
  (peer.id=account.id or peer.external_account_id=account.external_account_id) and peer.status in ('connected','needs_attention') and peer.runtime_mode<>'paused';
 if source_count=0 or all_cancelled is distinct from true or post_receipt is distinct from true or fresh is distinct from true or native_link is distinct from true or consistent_link is distinct from true then return false; end if;
 if exists(select 1 from public.integration_sync_states stream join public.integration_connections peer on peer.id=stream.connection_id and peer.partner_id=stream.partner_id and peer.client_id=stream.client_id where stream.partner_id=p_partner and stream.client_id=p_client and stream.stream_key='appointment' and peer.provider_id=account.provider_id and (peer.id=account.id or peer.external_account_id=account.external_account_id) and
  (nullif(stream.last_error,'') is not null or stream.status in ('failing','paused') or nullif(stream.cursor_value->>'pageToken','') is not null or nullif(stream.cursor_value->>'nextLink','') is not null or stream.cursor_value->>'has_more'='true')) then return false; end if;
 return true;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return false;
end $$;

create or replace function public.booking_lifecycle_source_check(p_work uuid,p_approval uuid,p_state_job uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.agent_work_items; a public.approval_items; booking_job public.action_jobs; n public.crm_appointments;
 state_job public.action_jobs; change public.approval_items; effective jsonb; mutation jsonb;
 l public.crm_leads; person public.crm_contacts; cv public.business_conversations; c public.integration_connections;
 r public.integration_canonical_records; link public.integration_object_links; provider text; task_id uuid; activity_id uuid; activity_at timestamptz;
begin
 select * into a from public.approval_items where id=p_approval and type='appointment_booking';
 select * into booking_job from public.action_jobs where approval_id=a.id and partner_id=a.partner_id and client_id=a.client_id and kind='calendar.book' and status='succeeded' and nullif(external_ref,'') is not null;
 select * into n from public.crm_appointments where approval_id=a.id and partner_id=a.partner_id and client_id=a.client_id;
 if a.id is null or booking_job.id is null or n.id is null or n.status<>'booked' or n.calendar_state_job_id is distinct from p_state_job then
  return jsonb_build_object('allowed',false,'reason','The exact current receipt-backed appointment state changed.'); end if;
 if exists(select 1 from public.approval_items changing join public.action_jobs mutation_job on mutation_job.approval_id=changing.id and mutation_job.partner_id=changing.partner_id and mutation_job.client_id=changing.client_id
  where changing.partner_id=a.partner_id and changing.client_id=a.client_id and changing.type='appointment_change' and changing.status in ('approved','edited_and_approved') and changing.proposed_payload->>'booking_approval_id'=a.id::text and changing.proposed_payload->>'appointment_id'=n.id::text and
   mutation_job.kind in ('calendar.cancel','calendar.reschedule') and not public.calendar_change_source_resolved(changing.partner_id,changing.client_id,mutation_job.id) and
   (mutation_job.status in ('processing','provider_pending','uncertain') or (mutation_job.status='failed' and nullif(mutation_job.external_ref,'') is not null)
    or ((changing.proposed_payload->>'appointment_updated_at')::timestamptz=n.updated_at and mutation_job.status in ('pending','succeeded')))) then
  return jsonb_build_object('allowed',false,'reason','An approved current appointment change is pending or awaiting reconciliation.'); end if;
 effective:=public.booking_effective_calendar_state(a.partner_id,a.client_id,a.id,booking_job.id,n.id);
 if effective->>'allowed' is distinct from 'true' or effective->>'stateJobId' is distinct from p_state_job::text then
  return jsonb_build_object('allowed',false,'reason','The current calendar state lacks an exact approved successful receipt.'); end if;
 if a.proposed_payload->>'origin' not in ('owner_intake','owner_conversation') or a.proposed_payload->>'origin' is null then
  -- Ordinary original-thread bookings still require the current lifecycle's
  -- exact conversation/delivery/authority pins; no intake work is invented.
  if p_work is not null then return jsonb_build_object('allowed',false,'reason','An unrelated source assignment was supplied.'); end if;
  return jsonb_build_object('allowed',true,'reason','The current booking state is proved and no accepted current mutation is outstanding.');
 end if;
 select * into w from public.agent_work_items where id=p_work and partner_id=a.partner_id and client_id=a.client_id;
 if w.id is null or w.kind<>'booking_request' or w.approval_id is distinct from a.id or w.status='cancelled' or w.input->>'origin' is distinct from a.proposed_payload->>'origin' or
  (w.input->>'origin'='owner_intake' and w.id::text is distinct from a.proposed_payload->>'intake_work_id') or (w.input->>'origin'='owner_conversation' and w.id::text is distinct from a.proposed_payload->>'customer_rebooking_work_id') then
  return jsonb_build_object('allowed',false,'reason','The exact completed source-linked booking assignment is unavailable.'); end if;
 if p_state_job is null then
  if w.input->>'origin'='owner_conversation' then return public.customer_rebooking_action_check(p_work,p_approval,true); end if;
  return public.intake_booking_action_check(p_work,p_approval,true);
 end if;
 select * into state_job from public.action_jobs where id=p_state_job and partner_id=w.partner_id and client_id=w.client_id and kind='calendar.reschedule' and status='succeeded';
 select * into change from public.approval_items where id=state_job.approval_id and partner_id=w.partner_id and client_id=w.client_id and type='appointment_change' and status in ('approved','edited_and_approved');
 mutation:=change.proposed_payload;
 select * into l from public.crm_leads where id=w.source_lead_id and partner_id=w.partner_id and client_id=w.client_id;
 select * into person from public.crm_contacts where id=l.contact_id and partner_id=w.partner_id and client_id=w.client_id;
 if l.id is null or person.id is null or person.id is distinct from n.contact_id or (n.lead_id is not null and n.lead_id<>l.id) or person.id::text is distinct from mutation->>'contact_id' or person.updated_at is distinct from (mutation->>'contact_updated_at')::timestamptz or l.status in ('won','lost') then
  return jsonb_build_object('allowed',false,'reason','The exact lead, customer or freshly reviewed customer version changed.'); end if;
 -- Lead timestamps can advance during successful native receipt reconciliation.
 -- Exact lead/contact/source linkage remains mandatory; no inferred merge.
 if w.input->>'origin'='owner_intake' then
  if w.conversation_id is not null then return jsonb_build_object('allowed',false,'reason','The inquiry assignment changed source identity.'); end if;
  select * into c from public.integration_connections where id=(w.input->>'intake_connection_id')::uuid and partner_id=w.partner_id and client_id=w.client_id;
  select provider_key into provider from public.integration_providers where id=c.provider_id;
  select * into r from public.integration_canonical_records where id=(w.input->>'intake_record_id')::uuid and connection_id=c.id and partner_id=w.partner_id and client_id=w.client_id and object_type='lead' and external_object_id=w.input->>'intake_external_id';
  select * into link from public.integration_object_links where connection_id=c.id and partner_id=w.partner_id and client_id=w.client_id and object_type='lead' and external_object_id=r.external_object_id;
  if c.id is null or provider is distinct from 'generic_inbound_webhook' or c.status<>'connected' or c.runtime_mode='paused' or c.config->>'workspace_view_only' is distinct from 'true' or r.id is null or link.id is null or
   r.native_object_id is distinct from l.id::text or link.native_object_id is distinct from l.id::text or link.metadata->>'source_record_id' is distinct from r.id::text or link.metadata->>'contact_id' is distinct from person.id::text or r.updated_at is distinct from (w.input->>'source_updated_at')::timestamptz or
   jsonb_typeof(r.canonical_data) is distinct from 'object' or (r.canonical_data ? 'provider' and r.canonical_data->>'provider' is distinct from 'generic_inbound_webhook') or r.canonical_data->>'deleted'='true' or coalesce(r.canonical_data->>'status','') not in ('new','updated') then
   return jsonb_build_object('allowed',false,'reason','The original adopted inquiry source identity or source version changed.'); end if;
  if exists(select 1 from public.integration_sync_states stream where stream.connection_id=c.id and stream.partner_id=w.partner_id and stream.client_id=w.client_id and stream.stream_key='lead' and (stream.status in ('failing','paused') or nullif(stream.last_error,'') is not null)) then
   return jsonb_build_object('allowed',false,'reason','Reconcile the original inquiry source before follow-up.'); end if;
  task_id:=(link.metadata->>'task_id')::uuid;
 else
  select * into cv from public.business_conversations where id=w.conversation_id and partner_id=w.partner_id and client_id=w.client_id;
  if cv.id is null or cv.id::text is distinct from w.input->>'conversation_id' or cv.id::text is distinct from a.proposed_payload->>'conversation_id' or cv.contact_id is distinct from person.id or (cv.lead_id is not null and cv.lead_id<>l.id) or cv.identity_status<>'owner_verified' or cv.mode<>'agent' or cv.opted_out or cv.state='closed' or cv.connection_id::text is distinct from w.input->>'source_connection_id' then
   return jsonb_build_object('allowed',false,'reason','The original verified customer conversation or exact source binding changed.'); end if;
  if cv.connection_id is not null and not exists(select 1 from public.integration_connections account where account.id=cv.connection_id and account.partner_id=w.partner_id and account.client_id=w.client_id and account.status='connected' and account.runtime_mode<>'paused') then
   return jsonb_build_object('allowed',false,'reason','The original customer conversation source is paused or disconnected.'); end if;
  task_id:=(w.input->>'task_id')::uuid;
 end if;
 if task_id is null or task_id is distinct from (w.input->>'task_id')::uuid or not exists(select 1 from public.crm_tasks t where t.id=task_id and t.partner_id=w.partner_id and t.client_id=w.client_id and t.lead_id=l.id and t.contact_id=person.id and (w.input->>'origin'='owner_intake' or t.booking_approval_id::text=w.input->>'rebooking_origin_approval_id')) then
  return jsonb_build_object('allowed',false,'reason','The exact shared source review task is unavailable.'); end if;
 if w.input->>'identity_confirmed' is distinct from 'true' or w.input->>'booking_requested' is distinct from 'true' or nullif(btrim(w.input->>'service'),'') is null or (w.input->>'origin'='owner_conversation' and w.input->>'instructions_reviewed' is distinct from 'true') then
  return jsonb_build_object('allowed',false,'reason','The original explicit owner qualification is unavailable.'); end if;
 if exists(select 1 from unnest(person.tags) tag where lower(regexp_replace(btrim(tag),'[[:space:]-]+','_','g')) in ('do_not_contact','opt_out','opted_out','unsubscribed','stop')) or
  exists(select 1 from public.business_conversations linked where linked.partner_id=w.partner_id and linked.client_id=w.client_id and linked.contact_id=person.id and linked.identity_status='owner_verified' and (linked.opted_out or (linked.mode='human' and linked.state<>'closed'))) then
  return jsonb_build_object('allowed',false,'reason','Current customer suppression or human handling prevents follow-up.'); end if;
 select activity.id,activity.created_at into activity_id,activity_at from (
  select comm.id,comm.created_at from public.crm_communications comm where comm.partner_id=w.partner_id and comm.client_id=w.client_id and comm.contact_id=person.id and comm.direction='inbound' and comm.status='received'
  union all select msg.id,msg.created_at from public.business_conversation_messages msg join public.business_conversations linked on linked.id=msg.conversation_id and linked.partner_id=msg.partner_id and linked.client_id=msg.client_id where linked.partner_id=w.partner_id and linked.client_id=w.client_id and linked.contact_id=person.id and linked.identity_status='owner_verified' and msg.direction='inbound' and msg.status='received'
 ) activity order by activity.created_at desc,activity.id desc limit 1;
 if activity_id::text is distinct from mutation->>'customer_activity_id' or activity_at is distinct from (mutation->>'customer_activity_at')::timestamptz or activity_at>(effective->>'receiptAt')::timestamptz then
  return jsonb_build_object('allowed',false,'reason','The customer replied after the approved current calendar decision. Review that response.'); end if;
 if a.proposed_payload->>'conversation_id' is not null then
  select * into cv from public.business_conversations where id=(a.proposed_payload->>'conversation_id')::uuid and partner_id=w.partner_id and client_id=w.client_id;
  if cv.id is null or cv.id::text is distinct from mutation->>'conversation_id' or cv.revision is distinct from (mutation->>'conversation_revision')::integer or cv.contact_id is distinct from person.id or cv.identity_status<>'owner_verified' or cv.mode<>'agent' or cv.opted_out or cv.state='closed' then
   return jsonb_build_object('allowed',false,'reason','The exact freshly reviewed customer conversation changed.'); end if;
 elsif mutation->>'conversation_id' is not null or mutation->>'conversation_revision' is not null then
  return jsonb_build_object('allowed',false,'reason','The calendar change introduced an unrelated customer conversation.'); end if;
 -- Current follow-up authority is checked separately by its own current pin;
 -- original calendar approval/work authority is intentionally not renewed here.
 return jsonb_build_object('allowed',true,'reason','Current source identity and immutable reviewed reschedule customer pins permit a new follow-up.');
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
 return jsonb_build_object('allowed',false,'reason','The source review or current calendar mutation pins are invalid.');
end $$;

create or replace function public.prepare_booking_lifecycle_followup(p_partner uuid,p_client uuid,p_booking_approval uuid,p_action_job uuid,p_kind text,p_pin jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.approval_items; j public.action_jobs; n public.crm_appointments; customer public.crm_contacts;
 b public.client_businesses; settings public.agent_team_settings; source public.integration_canonical_records;
 account public.integration_connections; conversation public.business_conversations; effective jsonb; activity_id uuid; activity_at timestamptz; effective_receipt_at timestamptz;
 result_id uuid; result_state text:='existing'; version_key text; body text; recipient text; channel text; source_provider text; desired_start timestamptz; desired_end timestamptz;
begin
 if p_kind is null or p_kind not in ('confirmation','reminder') or jsonb_typeof(p_pin) is distinct from 'object' or p_pin->>'booking_lifecycle_version' is distinct from '1' or p_pin->>'booking_followup_kind' is distinct from p_kind then
  raise exception 'Invalid booking follow-up proposal' using errcode='22023';
 end if;
 select * into a from public.approval_items where id=p_booking_approval and partner_id=p_partner and client_id=p_client and type='appointment_booking';
 select * into j from public.action_jobs where id=p_action_job and approval_id=a.id and partner_id=p_partner and client_id=p_client and kind='calendar.book';
 if a.id is null or a.status not in ('approved','edited_and_approved') or j.status is distinct from 'succeeded' or nullif(j.external_ref,'') is null then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The original durable successful booking receipt is unavailable.');
 end if;
 -- Ingestion takes conversation -> proposal -> outbox locks. Match that order
 -- before supersession so approval cannot append a child after our snapshot.
 if nullif(a.proposed_payload->>'conversation_id','') is not null then
  select * into conversation from public.business_conversations where id::text=a.proposed_payload->>'conversation_id'
   and partner_id=p_partner and client_id=p_client for update;
  if conversation.id is null then return jsonb_build_object('state','blocked','approvalId',null,'reason','The originating conversation is unavailable.'); end if;
 end if;
 if j.receipt_recorded_at is null then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The booking has no immutable receipt time. Review this historical booking before preparing follow-ups.');
 end if;
 if j.booking_followup_phase='stopped' or exists(select 1 from public.crm_tasks where partner_id=p_partner and client_id=p_client and booking_approval_id=a.id and task_type='booking_cancellation_request' and status='open') then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','An owner stopped booking follow-ups or requested cancellation.');
 end if;
 select * into n from public.crm_appointments where approval_id=a.id and partner_id=p_partner and client_id=p_client for update;
 select * into customer from public.crm_contacts where id=n.contact_id and partner_id=p_partner and client_id=p_client for update;
 if n.id is null or customer.id is null or n.id::text is distinct from p_pin->>'appointment_id' or n.updated_at is distinct from (p_pin->>'appointment_updated_at')::timestamptz
  or customer.id::text is distinct from p_pin->>'contact_id' or customer.updated_at is distinct from (p_pin->>'contact_updated_at')::timestamptz
  or a.id::text is distinct from p_pin->>'booking_approval_id' or j.id::text is distinct from p_pin->>'booking_action_job_id' then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The appointment, customer or receipt changed before preparation.');
 end if;
 if exists(select 1 from public.approval_items changing join public.action_jobs mutation_job on mutation_job.approval_id=changing.id and mutation_job.partner_id=changing.partner_id and mutation_job.client_id=changing.client_id
  where changing.partner_id=p_partner and changing.client_id=p_client and changing.type='appointment_change' and changing.status in ('approved','edited_and_approved') and changing.proposed_payload->>'booking_approval_id'=a.id::text and changing.proposed_payload->>'appointment_id'=n.id::text and
   mutation_job.kind in ('calendar.cancel','calendar.reschedule') and not public.calendar_change_source_resolved(changing.partner_id,changing.client_id,mutation_job.id) and
   (mutation_job.status in ('processing','provider_pending','uncertain') or (mutation_job.status='failed' and nullif(mutation_job.external_ref,'') is not null)
    or ((changing.proposed_payload->>'appointment_updated_at')::timestamptz=n.updated_at and mutation_job.status in ('pending','succeeded')))) then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','An approved current appointment change is pending or needs receipt reconciliation. No old-state follow-up was prepared.'); end if;
 effective:=public.booking_effective_calendar_state(p_partner,p_client,a.id,j.id,n.id);
 if effective->>'allowed' is distinct from 'true' then
  return jsonb_build_object('state','blocked','approvalId',null,'reason',coalesce(effective->>'reason','The current time-change proof is unavailable.')); end if;
 if n.calendar_state_job_id::text is distinct from p_pin->>'booking_state_job_id' then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The effective booking state changed before preparation.'); end if;
 effective_receipt_at:=(effective->>'receiptAt')::timestamptz; desired_start:=(effective->>'startAt')::timestamptz; desired_end:=(effective->>'endAt')::timestamptz;
 if n.status<>'booked' or n.start_at is distinct from desired_start or n.end_at is distinct from desired_end or n.start_at<=now()
  or n.start_at is distinct from (p_pin->'booking_slot'->>'start_iso')::timestamptz or n.end_at is distinct from (p_pin->'booking_slot'->>'end_iso')::timestamptz then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The effective booked appointment was cancelled, changed or has passed.');
 end if;
 perform 1 from public.approval_items proposal where proposal.partner_id=p_partner and proposal.client_id=p_client
  and proposal.type='customer_message' and proposal.proposed_payload->>'booking_approval_id'=a.id::text
  and coalesce(proposal.proposed_payload->>'booking_followup_kind','confirmation')=p_kind for update;
 -- Lock every existing same-origin/kind outbox row before deciding whether
 -- an unsent proposal may be superseded. Never duplicate an accepted, in-flight
 -- or uncertain provider message, including the pre-versioned confirmation.
 perform 1 from public.action_jobs child join public.approval_items proposal on proposal.id=child.approval_id
 where child.partner_id=p_partner and child.client_id=p_client and proposal.partner_id=p_partner and proposal.client_id=p_client
  and proposal.type='customer_message' and proposal.proposed_payload->>'booking_approval_id'=a.id::text
  and coalesce(proposal.proposed_payload->>'booking_followup_kind','confirmation')=p_kind for update of child;
 select proposal.id into result_id from public.approval_items proposal
 where proposal.partner_id=p_partner and proposal.client_id=p_client and proposal.type='customer_message'
  and proposal.proposed_payload->>'booking_approval_id'=a.id::text
  and coalesce(proposal.proposed_payload->>'booking_followup_kind','confirmation')=p_kind
  and proposal.proposed_payload->>'booking_state_job_id' is not distinct from n.calendar_state_job_id::text
  and exists(select 1 from public.action_jobs child where child.partner_id=p_partner and child.client_id=p_client and child.approval_id=proposal.id
    and (child.status in ('processing','provider_pending','uncertain','succeeded') or nullif(child.external_ref,'') is not null))
 order by proposal.created_at,proposal.id limit 1;
 if result_id is not null then
  if p_kind='reminder' then update public.action_jobs set booking_followup_due_at=null,booking_followup_phase=case when booking_followup_phase='stopped' then 'stopped' else 'done' end where id=j.id; end if;
  return jsonb_build_object('state','existing','approvalId',result_id,'reason','An existing provider outcome must be reconciled; no duplicate message was created.');
 end if;
 select * into b from public.client_businesses where id=p_client and partner_id=p_partner;
 if p_kind='reminder' then
  if b.native_lifecycle_enabled_at is null or effective_receipt_at is null or effective_receipt_at<b.native_lifecycle_enabled_at then
   return jsonb_build_object('state','blocked','approvalId',null,'reason','Reminders were not enabled for this booking.');
  end if;
  if now()<n.start_at-interval '24 hours' then
   update public.action_jobs set booking_followup_due_at=n.start_at-interval '24 hours',booking_followup_phase='reminder' where id=j.id and booking_followup_phase='reminder';
   return jsonb_build_object('state','not_due','approvalId',null,'reason','Reminder preparation is scheduled for the day before the appointment.','nextDueAt',n.start_at-interval '24 hours');
  end if;
 end if;
 if exists(select 1 from unnest(customer.tags) tag where lower(regexp_replace(btrim(tag),'[[:space:]-]+','_','g')) in ('do_not_contact','opt_out','opted_out','unsubscribed','stop')) then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The customer opted out.');
 end if;
 select activity.id,activity.created_at into activity_id,activity_at from (
  select comm.id,comm.created_at from public.crm_communications comm where comm.partner_id=p_partner and comm.client_id=p_client and comm.contact_id=customer.id and comm.direction='inbound' and comm.status='received'
  union all select msg.id,msg.created_at from public.business_conversation_messages msg join public.business_conversations cv on cv.id=msg.conversation_id and cv.partner_id=msg.partner_id and cv.client_id=msg.client_id where cv.partner_id=p_partner and cv.client_id=p_client and cv.contact_id=customer.id and cv.identity_status='owner_verified' and msg.direction='inbound' and msg.status='received'
 ) activity order by activity.created_at desc,activity.id desc limit 1;
 if activity_at>effective_receipt_at then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The customer replied after the current booking state was recorded. Review their current request before another follow-up.');
 end if;
 if activity_id::text is distinct from p_pin->>'customer_activity_id' or activity_at is distinct from (p_pin->>'customer_activity_at')::timestamptz then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','New customer activity needs review before follow-up.');
 end if;
 if exists(select 1 from public.business_conversations where partner_id=p_partner and client_id=p_client and contact_id=customer.id and identity_status='owner_verified' and mode='human' and state<>'closed') then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','An owner is handling the customer.');
 end if;
 effective:=public.booking_lifecycle_source_check(case when a.proposed_payload->>'origin'='owner_intake' then (a.proposed_payload->>'intake_work_id')::uuid when a.proposed_payload->>'origin'='owner_conversation' then (a.proposed_payload->>'customer_rebooking_work_id')::uuid else null end,a.id,n.calendar_state_job_id);
 if effective->>'allowed' is distinct from 'true' then
  return jsonb_build_object('state','blocked','approvalId',null,'reason',coalesce(effective->>'reason','The current customer source review changed.')); end if;
 channel:=p_pin->>'channel'; recipient:=p_pin->>'to';
 if nullif(a.proposed_payload->>'conversation_id','') is not null then
  if conversation.id is null or conversation.contact_id<>customer.id or conversation.identity_status<>'owner_verified' or conversation.mode<>'agent' or conversation.opted_out or conversation.state='closed'
   or conversation.id::text is distinct from p_pin->>'conversation_id' or conversation.revision is distinct from (p_pin->>'conversation_revision')::integer
   or conversation.channel is distinct from channel or conversation.external_thread_id is distinct from recipient then
   return jsonb_build_object('state','blocked','approvalId',null,'reason','The originating customer conversation changed.');
  end if;
 elsif (channel='sms' and recipient is distinct from customer.phone) or (channel='email' and recipient is distinct from customer.email) or channel not in ('sms','email') or nullif(recipient,'') is null then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The approved customer destination changed.');
 end if;
 select * into settings from public.agent_team_settings where partner_id=p_partner and client_id=p_client;
 if channel in ('sms','email') and (nullif(p_pin->>'connection_id','') is null or not exists(
  select 1 from public.integration_connections delivery_account join public.integration_providers delivery_provider on delivery_provider.id=delivery_account.provider_id
  where delivery_account.id::text=p_pin->>'connection_id' and delivery_account.partner_id=p_partner and delivery_account.client_id=p_client and delivery_account.status='connected' and delivery_account.runtime_mode='live'
   and (case when channel='email' then delivery_provider.provider_key in ('google_workspace','microsoft_365','resend') else delivery_provider.provider_key='twilio' end)
   and (conversation.id is null or conversation.connection_id=delivery_account.id)
   and public.business_channel_can_draft(p_partner,p_client,channel,delivery_account.id))) then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','Choose and verify the exact delivery account before preparing this follow-up.'); end if;
 if b.status is distinct from 'active' or settings.authority_revision is distinct from (p_pin->>'authority_revision')::integer or not public.business_channel_can_draft(p_partner,p_client,channel,case when conversation.id is null then (p_pin->>'connection_id')::uuid else conversation.connection_id end) then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','Current owner context or channel authority does not permit the follow-up.');
 end if;
 if a.proposed_payload->>'provider' is distinct from p_pin->'booking_source'->>'provider' or j.external_ref is distinct from p_pin->'booking_source'->>'external_ref' then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','The booking source identity changed.');
 end if;
 if a.proposed_payload->>'provider'<>'northstar_internal' then
  select * into account from public.integration_connections where id::text=a.proposed_payload->>'calendar_connection_id' and partner_id=p_partner and client_id=p_client;
  select * into source from public.integration_canonical_records where id::text=p_pin->'booking_source'->>'canonical_record_id' and partner_id=p_partner and client_id=p_client and object_type='appointment';
  select p.provider_key into source_provider from public.integration_connections c join public.integration_providers p on p.id=c.provider_id where c.id=source.connection_id and c.partner_id=p_partner and c.client_id=p_client
   and c.provider_id=account.provider_id and (c.id=account.id or (c.external_account_id is not null and c.external_account_id=account.external_account_id));
  if account.id is null or account.status not in ('connected','needs_attention') or account.runtime_mode='paused'
   or account.id::text is distinct from p_pin->'booking_source'->>'connection_id' or account.external_account_id is distinct from p_pin->'booking_source'->>'external_account_id'
   or (source.native_object_id is not null and source.native_object_id is distinct from n.id::text) or source.id is null or source_provider is distinct from a.proposed_payload->>'provider' or source.external_object_id is distinct from j.external_ref
   or source.external_updated_at is distinct from (p_pin->'booking_source'->>'source_updated_at')::timestamptz or source.source_event_at is distinct from (p_pin->'booking_source'->>'source_event_at')::timestamptz
   or exists(select 1 from public.integration_sync_states stream where stream.partner_id=p_partner and stream.client_id=p_client and stream.connection_id=source.connection_id
    and stream.stream_key='appointment' and (nullif(stream.last_error,'') is not null or stream.status in ('failing','paused')
     or nullif(stream.cursor_value->>'pageToken','') is not null or nullif(stream.cursor_value->>'nextLink','') is not null or stream.cursor_value->>'has_more'='true'))
   or (source.external_updated_at is null and source.source_event_at is null)
   or source.canonical_data->>'deleted'='true' or coalesce(source.canonical_data->>'status','') not in ('booked','confirmed')
   or (source.canonical_data->>'start_at')::timestamptz is distinct from n.start_at or (source.canonical_data->>'end_at')::timestamptz is distinct from n.end_at
   or source.snapshot_observed_at is null or source.snapshot_observed_at<effective_receipt_at or source.snapshot_observed_at<now()-interval '45 minutes' or source.snapshot_observed_at>now() then
   return jsonb_build_object('state','waiting','approvalId',null,'reason','A current exact calendar source version is required before follow-up.');
  end if;
 else
  if n.updated_at is distinct from (p_pin->'booking_source'->>'source_updated_at')::timestamptz then
   return jsonb_build_object('state','blocked','approvalId',null,'reason','The native calendar version changed.');
  end if;
 end if;
 version_key:=md5(p_pin::text);
 select id into result_id from public.approval_items where partner_id=p_partner and client_id=p_client and type='customer_message' and proposed_payload->>'booking_followup_key'=version_key;
 if result_id is not null and exists(select 1 from public.approval_items where id=result_id and status in ('rejected','expired','cancelled')) then
  return jsonb_build_object('state','blocked','approvalId',null,'reason','This exact source proposal was already declined or retired. Review the booking before preparing another.');
 end if;
 if result_id is null then
  -- Supersede only messages that have never reached a provider; a second check
  -- above holds their outbox locks through this transaction.
  update public.action_jobs child set status='cancelled',outcome_detail='Superseded by a current source-pinned booking follow-up.'
   from public.approval_items proposal where child.approval_id=proposal.id and child.partner_id=p_partner and child.client_id=p_client
    and proposal.partner_id=p_partner and proposal.client_id=p_client and proposal.type='customer_message'
    and proposal.proposed_payload->>'booking_approval_id'=a.id::text and coalesce(proposal.proposed_payload->>'booking_followup_kind','confirmation')=p_kind
    and child.status in ('pending','failed','dry_run','skipped') and nullif(child.external_ref,'') is null;
  update public.approval_items proposal set status='expired',resolution_note='Superseded by a current source-pinned booking follow-up.',updated_at=now()
   where proposal.partner_id=p_partner and proposal.client_id=p_client and proposal.type='customer_message'
    and proposal.proposed_payload->>'booking_approval_id'=a.id::text and coalesce(proposal.proposed_payload->>'booking_followup_kind','confirmation')=p_kind
    and proposal.status='pending'
    and not exists(select 1 from public.action_jobs child where child.approval_id=proposal.id and child.partner_id=p_partner and child.client_id=p_client
     and (child.status<>'cancelled' or nullif(child.external_ref,'') is not null));
  result_state:='queued';
  body:=case when p_kind='reminder' then 'A reminder: your appointment with ' else 'Your appointment with ' end||coalesce(b.name,'the business')||' is set for '||case when n.calendar_state_job_id is null then coalesce(a.proposed_payload->'slot'->>'label',n.start_at::text) else to_char(n.start_at at time zone coalesce(b.timezone,'UTC'),'YYYY-MM-DD HH24:MI')||' '||coalesce(b.timezone,'UTC') end||'. Reply if you need to change it.';
  insert into public.approval_items(partner_id,client_id,workflow_run_id,type,status,title,summary,risk_level,proposed_payload,editable_content,expires_at)
  values(p_partner,p_client,a.workflow_run_id,'customer_message','pending',case when p_kind='reminder' then 'Review appointment reminder' else 'Review booking confirmation' end,
   'The saved booking and exact customer/source version are rechecked again before sending.','medium',
   p_pin||jsonb_build_object('booking_followup_key',version_key,'draft_source','booking_lifecycle_template','subject','Your appointment with '||coalesce(b.name,'the business'))||
    case when conversation.id is null then '{}'::jsonb else jsonb_build_object('connection_id',conversation.connection_id) end,
   body,n.start_at) returning id into result_id;
  if conversation.id is not null then
   insert into public.business_conversation_messages(partner_id,client_id,conversation_id,external_key,direction,body,status,approval_id)
   values(p_partner,p_client,conversation.id,'approval:'||result_id,'outbound',body,'draft',result_id);
  end if;
 end if;
 if p_kind='reminder' then update public.action_jobs set booking_followup_due_at=null,booking_followup_phase='done',booking_followup_reason=null where id=j.id and booking_followup_phase='reminder'; end if;
 return jsonb_build_object('state',result_state,'approvalId',result_id);
end $$;
insert into public.platform_schema_state(singleton,current_migration,applied_at)
values(true,'20261117225829_google_permissions_calendar_reconciliation',now())
on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;
