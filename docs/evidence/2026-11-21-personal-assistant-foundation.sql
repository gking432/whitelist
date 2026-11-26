-- SOURCE-REVIEW DRAFT ONLY. Root creates/integrates the migration and marker.
-- Personal declared onboarding preference; never a connection, credential,
-- provider permission, model request, business authority or activation record.
-- Source reviewed against the installed owner workspace/session primitives and
-- current Supabase function/RLS guidance. No SQL was executed by this worker.
create table public.owner_personal_assistant_preferences (
 user_id uuid not null references auth.users(id) on delete cascade,
 client_id uuid not null references public.client_businesses(id) on delete cascade,
 partner_id uuid not null references public.partners(id) on delete cascade,
 revision bigint not null check(revision between 1 and 9007199254740991),
 settings jsonb not null,
 request_key uuid not null,
 request_revision bigint not null check(request_revision>=0 and revision=request_revision+1),
 updated_at timestamptz not null default now(),
 primary key(user_id,client_id),
 foreign key(partner_id,client_id) references public.client_businesses(partner_id,id) on delete cascade,
 check((jsonb_typeof(settings)='object'
  and settings-array['answer','assistant']='{}'::jsonb and settings ?& array['answer','assistant']
  and jsonb_typeof(settings->'answer')='string' and jsonb_typeof(settings->'assistant') in('string','null')
  and ((settings->>'answer'='yes' and settings->>'assistant' in('muse','chatgpt_dot','grok','other'))
   or (settings->>'answer'='no' and (settings->'assistant'='null'::jsonb or settings->>'assistant'='workstation'))
   or (settings->>'answer' in('unanswered','skipped') and settings->'assistant'='null'::jsonb))) is true)
);
alter table public.owner_personal_assistant_preferences enable row level security;
revoke all on public.owner_personal_assistant_preferences from public,anon,authenticated;
grant all on public.owner_personal_assistant_preferences to service_role;

create function owner_onboarding.personal_assistant(p_client uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=owner_onboarding.workspace_actor(p_client); saved public.owner_personal_assistant_preferences;
begin
 select * into saved from public.owner_personal_assistant_preferences p where p.user_id=actor and p.client_id=p_client;
 return jsonb_build_object('preferences',coalesce(saved.settings,'{"answer":"unanswered","assistant":null}'::jsonb)
  ||jsonb_build_object('revision',coalesce(saved.revision,0)),'available',true,'canEdit',true);
end $$;
revoke all on function owner_onboarding.personal_assistant(uuid) from public,anon;
grant execute on function owner_onboarding.personal_assistant(uuid) to authenticated,service_role;
create function public.get_owner_personal_assistant(p_client uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select owner_onboarding.personal_assistant(p_client); $$;
revoke all on function public.get_owner_personal_assistant(uuid) from public,anon;
grant execute on function public.get_owner_personal_assistant(uuid) to authenticated,service_role;

create function owner_onboarding.save_personal_assistant(p_client uuid,p_key uuid,p_revision bigint,p_settings jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=owner_onboarding.workspace_actor(p_client); saved public.owner_personal_assistant_preferences; partner uuid;
begin
 if p_key is null or p_revision is null or p_revision<0 or p_revision>=9007199254740991
  or jsonb_typeof(p_settings) is distinct from 'object' then
  raise exception 'Review your personal assistant preference' using errcode='22023'; end if;
 if p_settings-array['answer','assistant']<>'{}'::jsonb or not p_settings ?& array['answer','assistant']
  or jsonb_typeof(p_settings->'answer') is distinct from 'string'
  or jsonb_typeof(p_settings->'assistant') not in('string','null') then
  raise exception 'Review your personal assistant preference' using errcode='22023'; end if;
 if ((p_settings->>'answer'='yes' and p_settings->>'assistant' in('muse','chatgpt_dot','grok','other'))
  or (p_settings->>'answer'='no' and (p_settings->'assistant'='null'::jsonb or p_settings->>'assistant'='workstation'))
  or (p_settings->>'answer' in('unanswered','skipped') and p_settings->'assistant'='null'::jsonb)) is distinct from true then
  raise exception 'Review your personal assistant preference' using errcode='22023'; end if;
 -- Existing membership mutations take the same actor lock. Recheck the actual
 -- Auth session and scoped portal access after every potentially stale wait.
 perform 1 from auth.users where id=actor for update;
 perform 1 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=actor for update;
 perform owner_onboarding.workspace_actor(p_client);
 select c.partner_id into strict partner from public.client_businesses c where c.id=p_client for share;
 perform owner_onboarding.workspace_actor(p_client);
 select * into saved from public.owner_personal_assistant_preferences p where p.user_id=actor and p.client_id=p_client for update;
 if saved.request_key=p_key then
  if saved.settings is distinct from p_settings or saved.request_revision is distinct from p_revision then
   raise exception 'This save key was already used for a different personal assistant choice' using errcode='PT409'; end if;
  return owner_onboarding.personal_assistant(p_client);
 end if;
 if coalesce(saved.revision,0)<>p_revision then
  raise exception 'Your personal assistant preference changed elsewhere. Reload it before saving' using errcode='PT409'; end if;
 insert into public.owner_personal_assistant_preferences(user_id,client_id,partner_id,revision,settings,request_key,request_revision)
 values(actor,p_client,partner,p_revision+1,p_settings,p_key,p_revision)
 on conflict(user_id,client_id) do update set revision=excluded.revision,settings=excluded.settings,
  request_key=excluded.request_key,request_revision=excluded.request_revision,updated_at=now();
 return owner_onboarding.personal_assistant(p_client);
end $$;
revoke all on function owner_onboarding.save_personal_assistant(uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function owner_onboarding.save_personal_assistant(uuid,uuid,bigint,jsonb) to authenticated,service_role;
create function public.save_owner_personal_assistant(p_client uuid,p_key uuid,p_revision bigint,p_settings jsonb) returns jsonb
language sql volatile security invoker set search_path='' as $$ select owner_onboarding.save_personal_assistant(p_client,p_key,p_revision,p_settings); $$;
revoke all on function public.save_owner_personal_assistant(uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.save_owner_personal_assistant(uuid,uuid,bigint,jsonb) to authenticated,service_role;
-- Semantic conflicts are explicit PT409 only. No catch for real backend
-- 40001/40P01, no historical receipt table, no automatic retry or provider call.
-- Exact replay applies to the latest committed key/body/request revision.
-- An older superseded key at its original revision is stale and fails PT409.
