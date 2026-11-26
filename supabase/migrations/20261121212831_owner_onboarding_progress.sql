-- Existing authorized business settings callers keep their server-derived
-- scope/actor policy; these two transport functions remain service-only.
create function public.get_business_profile_snapshot(p_partner uuid,p_client uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare profile_row public.business_workspace_profiles; knowledge_row public.client_knowledge_profiles;
begin
 if not exists(select 1 from public.client_businesses c where c.id=p_client and c.partner_id=p_partner) then
  raise exception 'Business unavailable' using errcode='42501'; end if;
 select * into profile_row from public.business_workspace_profiles p where p.partner_id=p_partner and p.client_id=p_client;
 select * into knowledge_row from public.client_knowledge_profiles k where k.partner_id=p_partner and k.client_id=p_client;
 return jsonb_build_object('profile',coalesce(profile_row.profile,'{}'::jsonb),'revision',md5(jsonb_build_array(
  case when profile_row.client_id is null then to_jsonb('profile_absent'::text) else jsonb_build_array(extract(epoch from profile_row.updated_at),profile_row.profile) end,
  case when knowledge_row.id is null then to_jsonb('knowledge_absent'::text) else jsonb_build_array(extract(epoch from knowledge_row.updated_at),to_jsonb(knowledge_row)-array['id','partner_id','client_id','created_at','updated_at']) end)::text));
end $$;
revoke all on function public.get_business_profile_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_business_profile_snapshot(uuid,uuid) to service_role;

-- This service-only lock primitive returns no identity data. Keep the trusted
-- server actor's lock before the business lock, matching existing preference
-- writers without exposing Auth tables or changing their authorization rules.
create function owner_onboarding.lock_profile_actor(p_actor uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 perform 1 from auth.users u where u.id=p_actor for no key update;
 if not found then raise exception 'Business actor unavailable' using errcode='42501'; end if;
end $$;
revoke all on function owner_onboarding.lock_profile_actor(uuid) from public,anon,authenticated;
grant execute on function owner_onboarding.lock_profile_actor(uuid) to service_role;

create function public.save_business_profile(p_partner uuid,p_client uuid,p_actor uuid,p_key uuid,p_revision text,p_profile jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare profile_row public.business_workspace_profiles; knowledge_row public.client_knowledge_profiles;
 receipt public.business_owner_commands; envelope jsonb; result jsonb; receipt_id uuid:=extensions.gen_random_uuid();
 old_raw jsonb; new_raw jsonb; cancelled integer:=0; current_revision text;
 trim_chars text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
 -- The authoritative profile has an Auth-user FK; service_role does not need
 -- SELECT on private Auth tables. The narrow lock helper returns no data.
 if p_key is null or p_actor is null or not exists(select 1 from public.profiles p where p.id=p_actor)
  or coalesce(p_revision,'')!~'^[a-f0-9]{32}$' or jsonb_typeof(p_profile) is distinct from 'object'
  or p_profile-array['description','industry','goals','services','audience','tone','hours','policies','currency','website']<>'{}'::jsonb
  or not p_profile ?& array['description','industry','goals','services','audience','tone','hours','policies','currency','website'] then
  raise exception 'Review the complete business settings request' using errcode='22023'; end if;
 if exists(select 1 from unnest(array['description','industry','services','audience','tone','hours','policies','currency','website']) as field(field_name) where jsonb_typeof(p_profile->field.field_name) is distinct from 'string')
  or jsonb_typeof(p_profile->'goals') is distinct from 'array' then
  raise exception 'Review the complete business settings' using errcode='22023'; end if;
 -- The service caller retains the existing URL parser; SQL preserves all of
 -- its valid HTTP/HTTPS spellings instead of inventing a stricter URL format.
 if length(p_profile->>'description') not between 5 and 3000 or p_profile->>'description' is distinct from btrim(p_profile->>'description',trim_chars)
  or p_profile->>'industry' not in('general','salon','trainer','retail','services','professional')
  or p_profile->>'currency' not in('USD','CAD','GBP','EUR','AUD') or length(p_profile->>'tone')>200
  or jsonb_array_length(p_profile->'goals')>12
  or exists(select 1 from jsonb_array_elements(p_profile->'goals') as goal(value) where jsonb_typeof(goal.value)<>'string' or length(goal.value#>>'{}')>80)
  or exists(select 1 from unnest(array['services','audience','hours','policies']) as field(field_name) where length(p_profile->>field.field_name)>4000 or p_profile->>field.field_name is distinct from btrim(p_profile->>field.field_name,trim_chars))
  or (p_profile->>'website'<>'' and btrim(p_profile->>'website',trim_chars)!~*'^https?:') then
  raise exception 'Review the complete business settings' using errcode='22023'; end if;
 perform owner_onboarding.lock_profile_actor(p_actor);
 perform 1 from public.client_businesses c where c.id=p_client and c.partner_id=p_partner for update;
 if not found then raise exception 'Business unavailable' using errcode='42501'; end if;
 envelope:=jsonb_build_object('action','save_business_profile','revision',p_revision,'profile',p_profile);
 select * into receipt from public.business_owner_commands r where r.partner_id=p_partner and r.client_id=p_client and r.request_key=p_key;
 if found then
  if receipt.actor_id is distinct from p_actor or receipt.command is distinct from envelope then
   raise exception 'This business settings key was already used for a different request' using errcode='PT409'; end if;
  return receipt.result||jsonb_build_object('replayed',true);
 end if;
 select * into profile_row from public.business_workspace_profiles p where p.partner_id=p_partner and p.client_id=p_client for update;
 select * into knowledge_row from public.client_knowledge_profiles k where k.partner_id=p_partner and k.client_id=p_client for update;
 current_revision:=public.get_business_profile_snapshot(p_partner,p_client)->>'revision';
 if current_revision is distinct from p_revision then
  raise exception 'Business facts changed elsewhere. Reload before saving' using errcode='PT409'; end if;
 old_raw:=coalesce(profile_row.profile,'{}'::jsonb); new_raw:=old_raw||p_profile;
 if new_raw is distinct from old_raw or knowledge_row.business_description is distinct from p_profile->>'description'
  or knowledge_row.services_offered is distinct from p_profile->>'services' or knowledge_row.business_hours is distinct from p_profile->>'hours'
  or knowledge_row.booking_rules is distinct from p_profile->>'policies' then
  if knowledge_row.id is null then
   insert into public.client_knowledge_profiles(partner_id,client_id,business_description,services_offered,business_hours,booking_rules)
   values(p_partner,p_client,p_profile->>'description',p_profile->>'services',p_profile->>'hours',p_profile->>'policies');
  elsif knowledge_row.business_description is distinct from p_profile->>'description' or knowledge_row.services_offered is distinct from p_profile->>'services'
   or knowledge_row.business_hours is distinct from p_profile->>'hours' or knowledge_row.booking_rules is distinct from p_profile->>'policies' then
   update public.client_knowledge_profiles k set business_description=p_profile->>'description',services_offered=p_profile->>'services',business_hours=p_profile->>'hours',booking_rules=p_profile->>'policies'
   where k.partner_id=p_partner and k.client_id=p_client;
  end if;
  insert into public.agent_team_settings(partner_id,client_id,status,channel_authority)
  values(p_partner,p_client,'paused','{"website":"off","email":"off","sms":"off","instagram":"off","calendar":"off"}') on conflict(client_id) do nothing;
  perform 1 from public.agent_team_settings s where s.partner_id=p_partner and s.client_id=p_client for update;
  if profile_row.client_id is null then
   insert into public.business_workspace_profiles(partner_id,client_id,profile,updated_at) values(p_partner,p_client,new_raw,clock_timestamp());
   update public.agent_team_settings s set authority_revision=s.authority_revision+1 where s.partner_id=p_partner and s.client_id=p_client;
   delete from public.business_context_reviews r where r.partner_id=p_partner and r.client_id=p_client;
  else
   update public.business_workspace_profiles p set profile=new_raw,updated_at=greatest(clock_timestamp(),p.updated_at+interval '1 microsecond') where p.partner_id=p_partner and p.client_id=p_client;
  end if;
  cancelled:=public.cancel_business_unsent(p_partner,p_client,null);
 end if;
 current_revision:=public.get_business_profile_snapshot(p_partner,p_client)->>'revision';
 result:=jsonb_build_object('id',receipt_id,'key',p_key,'revision',current_revision,'replayed',false,'cancelledWork',cancelled);
 insert into public.business_owner_commands(id,partner_id,client_id,actor_id,request_key,command,result)
 values(receipt_id,p_partner,p_client,p_actor,p_key,envelope,result);
 return result;
end $$;
revoke all on function public.save_business_profile(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_business_profile(uuid,uuid,uuid,uuid,text,jsonb) to service_role;

-- Actor/business presentation progress and one raw shared business fact.
-- Finishing this presentation never reviews context or grants action authority.
create table public.owner_onboarding_progress (
 user_id uuid not null references auth.users(id) on delete cascade,
 client_id uuid not null references public.client_businesses(id) on delete cascade,
 partner_id uuid not null references public.partners(id) on delete cascade,
 revision bigint not null check(revision between 1 and 9007199254740991),
 step text not null check(step in('description','connections','assistant','assistant_choice','review','permissions','done')),
 skipped text[] not null default '{}' check(cardinality(skipped)<=6 and array_position(skipped,null) is null
  and (cardinality(skipped)=0 or array_ndims(skipped)=1)
  and skipped<@array['description','connections','assistant','assistant_choice','review','permissions']),
 finished boolean not null default false,
 finished_at timestamptz,
 updated_at timestamptz not null default now(),
 primary key(user_id,client_id),
 foreign key(partner_id,client_id) references public.client_businesses(partner_id,id) on delete cascade,
 check(finished=(step='done') and finished=(finished_at is not null))
);
alter table public.owner_onboarding_progress enable row level security;
revoke all on public.owner_onboarding_progress from public,anon,authenticated;
grant all on public.owner_onboarding_progress to service_role;

create function owner_onboarding.onboarding_snapshot(p_client uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=owner_onboarding.workspace_actor(p_client); progress_row public.owner_onboarding_progress;
 source_snapshot jsonb; partner uuid;
begin
 if not exists(select 1 from public.memberships m where m.user_id=actor and m.client_id=p_client
  and m.status='active' and m.role='client_owner') then
  raise exception 'Business owner access is required' using errcode='42501'; end if;
 select c.partner_id into strict partner from public.client_businesses c where c.id=p_client;
 source_snapshot:=public.get_business_profile_snapshot(partner,p_client);
 select * into progress_row from public.owner_onboarding_progress p where p.user_id=actor and p.client_id=p_client;
 return jsonb_build_object('available',true,'canEdit',true,'profileRevision',source_snapshot->'revision',
  'answers',jsonb_build_object('description',case when jsonb_typeof(source_snapshot->'profile'->'description')='string' then source_snapshot->'profile'->'description' else 'null'::jsonb end),
  'progress',jsonb_build_object('revision',coalesce(progress_row.revision,0),'step',coalesce(progress_row.step,'description'),
   'skipped',coalesce(to_jsonb(progress_row.skipped),'[]'::jsonb),'finished',coalesce(progress_row.finished,false)));
end $$;
revoke all on function owner_onboarding.onboarding_snapshot(uuid) from public,anon;
grant execute on function owner_onboarding.onboarding_snapshot(uuid) to authenticated,service_role;
create function public.get_owner_onboarding(p_client uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select owner_onboarding.onboarding_snapshot(p_client); $$;
revoke all on function public.get_owner_onboarding(uuid) from public,anon;
grant execute on function public.get_owner_onboarding(uuid) to authenticated,service_role;

create function owner_onboarding.save_onboarding(p_client uuid,p_key uuid,p_revision bigint,p_command jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=owner_onboarding.workspace_actor(p_client); partner uuid;
 progress_row public.owner_onboarding_progress; profile_row public.business_workspace_profiles; knowledge_row public.client_knowledge_profiles;
 receipt public.business_owner_commands; envelope jsonb; result jsonb; receipt_id uuid:=extensions.gen_random_uuid();
 action_value text; next_step text; skipped_steps text[]; old_raw jsonb; new_raw jsonb; description_value text;
 profile_revision jsonb; next_revision bigint; finished_time timestamptz; cancelled integer:=0;
 -- ECMAScript String.trim whitespace, matching the request contract. Internal whitespace remains raw.
 trim_chars text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
 if not exists(select 1 from public.memberships m where m.user_id=actor and m.client_id=p_client
  and m.status='active' and m.role='client_owner') then
  raise exception 'Business owner access is required' using errcode='42501'; end if;
 if p_key is null or p_revision is null or p_revision<0 or p_revision>=9007199254740991
  or jsonb_typeof(p_command) is distinct from 'object' or jsonb_typeof(p_command->'action') is distinct from 'string' then
  raise exception 'Review the onboarding request' using errcode='22023'; end if;
 action_value:=p_command->>'action';
 if action_value='answer' then
  if p_command-array['action','field','value','expectedProfileRevision']<>'{}'::jsonb
   or not p_command ?& array['action','field','value','expectedProfileRevision']
   or p_command->>'field' is distinct from 'description'
   or jsonb_typeof(p_command->'expectedProfileRevision') is distinct from 'string'
   or (p_command->>'expectedProfileRevision')!~'^[a-f0-9]{32}$'
   or jsonb_typeof(p_command->'value') not in('string','null') then
   raise exception 'Review the business description' using errcode='22023'; end if;
  if jsonb_typeof(p_command->'value')='string' then
   description_value:=p_command->>'value';
   if length(description_value) not between 1 and 3000 or description_value is distinct from btrim(description_value,trim_chars)
    or btrim(description_value,trim_chars)='' or description_value ~ U&'[\0001-\0008\000B\000C\000E-\001F\007F]' then
    raise exception 'Review the business description' using errcode='22023'; end if;
  end if;
 elsif action_value in('navigate','skip') then
  if p_command-array['action','step']<>'{}'::jsonb or not p_command ?& array['action','step']
   or jsonb_typeof(p_command->'step') is distinct from 'string'
   or p_command->>'step' not in('description','connections','assistant','assistant_choice','review','permissions','done')
   or (action_value='skip' and p_command->>'step'='done') then
   raise exception 'Review the onboarding step' using errcode='22023'; end if;
 else raise exception 'Unsupported onboarding request' using errcode='22023'; end if;

 -- NO KEY UPDATE serializes membership mutations without blocking another
 -- business command's actor foreign-key KEY SHARE check. The actor key is never changed.
 -- Membership mutations use the conflicting actor UPDATE lock. The actual session and owner
 -- access are rechecked after waiting; business locking serializes all shared
 -- context/authority commands before profile -> knowledge -> settings -> review/work locks.
 perform 1 from auth.users u where u.id=actor for no key update;
 perform 1 from auth.sessions s where s.id=(auth.jwt()->>'session_id')::uuid and s.user_id=actor for update;
 perform owner_onboarding.workspace_actor(p_client);
 if not exists(select 1 from public.memberships m where m.user_id=actor and m.client_id=p_client
  and m.status='active' and m.role='client_owner') then raise exception 'Business owner access is required' using errcode='42501'; end if;
 select c.partner_id into strict partner from public.client_businesses c where c.id=p_client for update;
 perform owner_onboarding.workspace_actor(p_client);
 if not exists(select 1 from public.memberships m where m.user_id=actor and m.client_id=p_client
  and m.partner_id=partner and m.status='active' and m.role='client_owner') then raise exception 'Business owner access is required' using errcode='42501'; end if;

 envelope:=jsonb_build_object('action','owner_onboarding','revision',p_revision,'command',p_command);
 select * into receipt from public.business_owner_commands r where r.partner_id=partner and r.client_id=p_client and r.request_key=p_key;
 if found then
  if receipt.actor_id is distinct from actor or receipt.command is distinct from envelope then
   raise exception 'This onboarding key was already used for a different request' using errcode='PT409'; end if;
  return jsonb_build_object('snapshot',owner_onboarding.onboarding_snapshot(p_client),'result',receipt.result||jsonb_build_object('replayed',true));
 end if;
 select * into profile_row from public.business_workspace_profiles p where p.partner_id=partner and p.client_id=p_client for update;
 select * into knowledge_row from public.client_knowledge_profiles k where k.partner_id=partner and k.client_id=p_client for update;
 select * into progress_row from public.owner_onboarding_progress p where p.user_id=actor and p.client_id=p_client for update;
 if coalesce(progress_row.revision,0)<>p_revision then
  raise exception 'Onboarding changed elsewhere. Reload before saving' using errcode='PT409'; end if;
 profile_revision:=owner_onboarding.onboarding_snapshot(p_client)->'profileRevision';
 if action_value='answer' then
  if profile_revision is distinct from p_command->'expectedProfileRevision' then
   raise exception 'Business facts changed elsewhere. Reload before saving' using errcode='PT409'; end if;
  old_raw:=coalesce(profile_row.profile,'{}'::jsonb);
  new_raw:=case when p_command->'value'='null'::jsonb then old_raw-'description' else jsonb_set(old_raw,array['description'],p_command->'value',true) end;
  -- The agent loader reads business_description. A raw-profile no-op is not a
  -- true no-op if that existing knowledge copy differs. Only this one column
  -- is synchronized; all other knowledge facts and raw profile keys survive.
  if new_raw is distinct from old_raw or knowledge_row.business_description is distinct from description_value then
   -- Existing knowledge writers lock their row before the invalidation trigger
   -- locks settings. Keep the same order; do not take settings first.
   if knowledge_row.id is null and description_value is not null then
    insert into public.client_knowledge_profiles(partner_id,client_id,business_description)
    values(partner,p_client,description_value) returning * into knowledge_row;
   elsif knowledge_row.id is not null and knowledge_row.business_description is distinct from description_value then
    update public.client_knowledge_profiles k set business_description=description_value
    where k.partner_id=partner and k.client_id=p_client returning * into knowledge_row;
   end if;
   insert into public.agent_team_settings(partner_id,client_id,status,channel_authority)
   values(partner,p_client,'paused','{"website":"off","email":"off","sms":"off","instagram":"off","calendar":"off"}') on conflict(client_id) do nothing;
   perform 1 from public.agent_team_settings s where s.partner_id=partner and s.client_id=p_client for update;
   if profile_row.client_id is null then
    insert into public.business_workspace_profiles(partner_id,client_id,profile,updated_at) values(partner,p_client,new_raw,clock_timestamp()) returning * into profile_row;
    -- The existing profile invalidation trigger covers UPDATE only. Knowledge
    -- INSERT may have run before a missing settings row was initialized.
    update public.agent_team_settings s set authority_revision=s.authority_revision+1 where s.partner_id=partner and s.client_id=p_client;
    delete from public.business_context_reviews r where r.partner_id=partner and r.client_id=p_client;
   else
    update public.business_workspace_profiles p set profile=new_raw,updated_at=greatest(clock_timestamp(),p.updated_at+interval '1 microsecond')
    where p.partner_id=partner and p.client_id=p_client returning * into profile_row;
   end if;
   profile_revision:=owner_onboarding.onboarding_snapshot(p_client)->'profileRevision';
   cancelled:=public.cancel_business_unsent(partner,p_client,null);
  end if;
 end if;

 skipped_steps:=coalesce(progress_row.skipped,'{}'::text[]);
 if action_value='navigate' then next_step:=p_command->>'step';
 elsif action_value='answer' then next_step:='connections'; skipped_steps:=array_remove(skipped_steps,'description');
 else
  if not (p_command->>'step'=any(skipped_steps)) then skipped_steps:=array_append(skipped_steps,p_command->>'step'); end if;
  next_step:=case p_command->>'step' when 'description' then 'connections' when 'connections' then 'assistant'
   when 'assistant' then 'review' when 'assistant_choice' then 'review' when 'review' then 'permissions' when 'permissions' then 'done' end;
 end if;
 next_revision:=p_revision+1;
 finished_time:=case when next_step='done' then coalesce(progress_row.finished_at,clock_timestamp()) else null end;
 insert into public.owner_onboarding_progress(user_id,client_id,partner_id,revision,step,skipped,finished,finished_at)
 values(actor,p_client,partner,next_revision,next_step,skipped_steps,next_step='done',finished_time)
 on conflict(user_id,client_id) do update set revision=excluded.revision,step=excluded.step,skipped=excluded.skipped,
  finished=excluded.finished,finished_at=excluded.finished_at,updated_at=now();
 result:=jsonb_build_object('id',receipt_id,'key',p_key,'revision',next_revision,'profileRevision',profile_revision,'replayed',false,'cancelledWork',cancelled);
 insert into public.business_owner_commands(id,partner_id,client_id,actor_id,request_key,command,result)
 values(receipt_id,partner,p_client,actor,p_key,envelope,result);
 return jsonb_build_object('snapshot',owner_onboarding.onboarding_snapshot(p_client),'result',result);
end $$;
revoke all on function owner_onboarding.save_onboarding(uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function owner_onboarding.save_onboarding(uuid,uuid,bigint,jsonb) to authenticated,service_role;
create function public.save_owner_onboarding(p_client uuid,p_key uuid,p_revision bigint,p_command jsonb) returns jsonb
language sql volatile security invoker set search_path='' as $$ select owner_onboarding.save_onboarding(p_client,p_key,p_revision,p_command); $$;
revoke all on function public.save_owner_onboarding(uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.save_owner_onboarding(uuid,uuid,bigint,jsonb) to authenticated,service_role;

insert into public.platform_schema_state(singleton,current_migration,applied_at)
values(true,'20261121212831_owner_onboarding_progress',now())
on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;
