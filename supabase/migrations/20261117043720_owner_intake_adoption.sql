-- An imported inquiry is evidence, not an identity match or outreach consent.
-- Its explicit owner decision creates ordinary shared CRM work atomically.
create function public.adopt_owner_intake_record(
 p_partner uuid, p_client uuid, p_actor uuid, p_command jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 c public.integration_connections;
 r public.integration_canonical_records;
 saved public.business_owner_commands;
 selected public.crm_contacts;
 provider text;
 choice jsonb:=p_command->'contact';
 v_request_key uuid;
 contact_id uuid;
 lead_id uuid;
 task_id uuid;
 receipt_id uuid:=extensions.gen_random_uuid();
 source_version timestamptz;
 full_name text;
 result jsonb;
begin
 if p_actor is null or jsonb_typeof(p_command) is distinct from 'object'
  or p_command->>'action' is distinct from 'adopt_intake'
  or (p_command-array['action','key','connectionId','recordId','externalId','expectedUpdatedAt','contact'])<>'{}'::jsonb
  or jsonb_typeof(choice) is distinct from 'object'
  or nullif(btrim(p_command->>'externalId'),'') is null or length(p_command->>'externalId')>500
  or choice->>'mode' is null or choice->>'mode' not in ('create','existing')
  or (choice->>'mode'='create' and choice-'mode'<>'{}'::jsonb)
  or (choice->>'mode'='existing' and (choice-array['mode','id','expectedUpdatedAt'])<>'{}'::jsonb)
 then raise exception 'Invalid inquiry decision' using errcode='22023'; end if;
 v_request_key:=(p_command->>'key')::uuid;
 source_version:=(p_command->>'expectedUpdatedAt')::timestamptz;
 if v_request_key is null or source_version is null or p_command->>'connectionId' is null or p_command->>'recordId' is null then
  raise exception 'Missing inquiry decision fields' using errcode='22023';
 end if;

 -- Match the owner-command lock order. A retry after a lost response returns
 -- its committed receipt even if the source changed or was disconnected later.
 perform 1 from public.client_businesses where id=p_client and partner_id=p_partner for update;
 if not found then raise exception 'Business unavailable' using errcode='22023'; end if;
 select * into saved from public.business_owner_commands
  where partner_id=p_partner and client_id=p_client and request_key=v_request_key;
 if saved.id is not null then
  if saved.actor_id is distinct from p_actor or saved.command is distinct from p_command then
   raise exception 'Request key reused for another decision' using errcode='40001';
  end if;
  return saved.result||jsonb_build_object('replayed',true);
 end if;

 -- Connection then source matches the import writer and serializes adoption
 -- against new submissions, source edits/deletions and pause/disconnect.
 select * into c from public.integration_connections where id=(p_command->>'connectionId')::uuid
  and partner_id=p_partner and client_id=p_client for update;
 select provider_key into provider from public.integration_providers where id=c.provider_id;
 if c.id is null or provider is distinct from 'generic_inbound_webhook'
  or c.status is distinct from 'connected' or c.runtime_mode='paused'
  or coalesce(c.config->>'workspace_view_only','false')<>'true' then
  raise exception 'Resume and verify this form source first' using errcode='40001';
 end if;
 if exists(select 1 from public.integration_sync_states where partner_id=p_partner and client_id=p_client
  and connection_id=c.id and stream_key='lead' and (last_error is not null or status='failing')) then
  raise exception 'Resolve conflicting form source changes first' using errcode='40001';
 end if;
 select * into r from public.integration_canonical_records where id=(p_command->>'recordId')::uuid
  and connection_id=c.id and partner_id=p_partner and client_id=p_client and object_type='lead' for update;
 if r.id is null or r.external_object_id is distinct from p_command->>'externalId'
  or r.updated_at is distinct from source_version then
  raise exception 'Inquiry changed; review its current source' using errcode='40001';
 end if;
 if jsonb_typeof(r.canonical_data) is distinct from 'object' or r.canonical_data->>'deleted'='true'
  or coalesce(r.canonical_data->>'status','') not in ('new','updated')
  or (r.canonical_data ? 'provider' and r.canonical_data->>'provider' is distinct from 'generic_inbound_webhook') then
  raise exception 'This source is no longer an eligible form inquiry' using errcode='40001';
 end if;
 if r.native_object_id is not null or exists(select 1 from public.integration_object_links
  where partner_id=p_partner and client_id=p_client and connection_id=c.id
  and object_type='lead' and external_object_id=r.external_object_id) then
  raise exception 'Inquiry already added to shared work; refresh the source view' using errcode='40001';
 end if;
 if exists(select 1 from (values ('title',500),('description',6000)) fields(key,maximum)
  where jsonb_typeof(r.canonical_data->fields.key) not in ('string','null') or length(r.canonical_data->>fields.key)>fields.maximum) then
  raise exception 'Review malformed inquiry content' using errcode='22023';
 end if;

 if choice->>'mode'='existing' then
  select * into selected from public.crm_contacts where id=(choice->>'id')::uuid
   and partner_id=p_partner and client_id=p_client for update;
  if selected.id is null or (choice->>'expectedUpdatedAt') is null
   or selected.updated_at is distinct from (choice->>'expectedUpdatedAt')::timestamptz then
   raise exception 'Selected customer changed; choose again' using errcode='40001';
  end if;
  contact_id:=selected.id;
  -- Deliberate linking does not overwrite existing identity or suppression tags.
 else
  if exists(select 1 from (values ('name',200),('email',320),('phone',60)) fields(key,maximum)
   where jsonb_typeof(r.canonical_data->fields.key) not in ('string','null') or length(r.canonical_data->>fields.key)>fields.maximum) then
   raise exception 'Review malformed source identity claims' using errcode='22023';
  end if;
  if nullif(btrim(r.canonical_data->>'email'),'') is not null
   and btrim(r.canonical_data->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
   raise exception 'Review the source email before creating a customer' using errcode='22023';
  end if;
  full_name:=nullif(btrim(left(r.canonical_data->>'name',200)),'');
  insert into public.crm_contacts(partner_id,client_id,first_name,last_name,email,phone,source,created_by,tags)
  values(p_partner,p_client,coalesce(full_name,'Unidentified inquiry'),null,
   nullif(btrim(left(r.canonical_data->>'email',320)),''),nullif(btrim(left(r.canonical_data->>'phone',60)),''),
   'owner_intake_unverified',p_actor,array['source_identity_unverified']) returning id into contact_id;
 end if;
 insert into public.crm_leads(partner_id,client_id,contact_id,status,source_event_type,title,summary,description,next_action)
 values(p_partner,p_client,contact_id,'new','owner_intake_adoption',
  coalesce(nullif(left(r.canonical_data->>'title',200),''),'Website inquiry'),
  left(coalesce(r.canonical_data->>'description',''),6000),left(coalesce(r.canonical_data->>'description',''),6000),
  'Review the source inquiry and contact identity before choosing a follow-up.') returning id into lead_id;
 insert into public.crm_tasks(partner_id,client_id,contact_id,lead_id,title,description,status,priority,created_by,task_type)
 values(p_partner,p_client,contact_id,lead_id,left('Review inquiry: '||coalesce(nullif(r.canonical_data->>'title',''),'Website inquiry'),180),
  left(coalesce(r.canonical_data->>'description',''),6000)||E'\n\nSource form: '||coalesce(c.display_name,'Website form')||
  E'\nSubmission: '||r.external_object_id||E'\nImported identity claims are unverified. Review consent and current facts before outreach.',
  'open','medium',p_actor,'intake_review') returning id into task_id;
 insert into public.integration_object_links(partner_id,client_id,connection_id,object_type,native_object_id,external_object_id,external_updated_at,last_synced_at,metadata)
 values(p_partner,p_client,c.id,'lead',lead_id::text,r.external_object_id,r.external_updated_at,now(),
  jsonb_build_object('adoption_receipt_id',receipt_id,'source_record_id',r.id,'source_version',r.updated_at,'contact_id',contact_id,'task_id',task_id));
 update public.integration_canonical_records set native_object_id=lead_id::text,projection_status='projected',projection_error=null,projected_at=now()
  where id=r.id and partner_id=p_partner and client_id=p_client and connection_id=c.id;
 insert into public.crm_timeline_entries(partner_id,client_id,contact_id,lead_id,kind,actor_type,actor_user_id,title,body)
 values(p_partner,p_client,contact_id,lead_id,'note','user',p_actor,'Added form inquiry to shared work',
  'Source record '||r.id::text||'; submission '||r.external_object_id||'. Identity was explicitly selected by the owner. Outreach consent is not established by this decision.');
 result:=jsonb_build_object('id',receipt_id,'connectionId',c.id,'sourceRecordId',r.id,'sourceUpdatedAt',r.updated_at,
  'contactId',contact_id,'leadId',lead_id,'taskId',task_id,'createdContact',choice->>'mode'='create','replayed',false,
  'message','Inquiry added to shared work. Review the saved task before contacting anyone.');
 insert into public.business_owner_commands(id,partner_id,client_id,actor_id,request_key,command,result)
 values(receipt_id,p_partner,p_client,p_actor,v_request_key,p_command,result);
 return result;
end $$;
revoke all on function public.adopt_owner_intake_record(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.adopt_owner_intake_record(uuid,uuid,uuid,jsonb) to service_role;

insert into public.platform_schema_state(singleton,current_migration,applied_at)
 values(true,'20261117043720_owner_intake_adoption',now())
on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;
