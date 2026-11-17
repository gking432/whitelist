-- Client business workspace. Writes are made by scoped server operations only.
create table public.business_workspace_profiles (
 client_id uuid primary key, partner_id uuid not null, profile jsonb not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(partner_id,client_id) references public.client_businesses(partner_id,id) on delete cascade,
 check(jsonb_typeof(profile)='object')
);
create table public.business_capability_installs (
 id uuid primary key default gen_random_uuid(), partner_id uuid not null, client_id uuid not null,
 recipe_key text not null, status text not null default 'enabled' check(status in ('enabled','paused')),
 schedule_enabled boolean not null default false, last_run_at timestamptz, next_run_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(client_id,recipe_key),
 foreign key(partner_id,client_id) references public.client_businesses(partner_id,id) on delete cascade
);
create table public.business_records (
 id uuid primary key default gen_random_uuid(), partner_id uuid not null, client_id uuid not null,
 kind text not null check(kind in ('campaign','opportunity','supplier','product','purchase','job','knowledge','brief','quote','invoice')),
 title text not null check(length(title) between 2 and 180), body text not null default '' check(length(body)<=20000),
 data jsonb not null default '{}' check(jsonb_typeof(data)='object'),
 status text not null default 'draft' check(status in ('draft','needs_approval','approved','rejected','in_progress','blocked','completed','ordered','received','published','paid','archived')),
 revision integer not null default 1, source_record_id uuid, request_key text not null,
 created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,partner_id,client_id), unique(client_id,request_key),
 foreign key(partner_id,client_id) references public.client_businesses(partner_id,id) on delete cascade,
 foreign key(source_record_id,partner_id,client_id) references public.business_records(id,partner_id,client_id)
);
create table public.business_workspace_events (
 id uuid primary key default gen_random_uuid(), partner_id uuid not null, client_id uuid not null,
 record_id uuid, actor_id uuid references public.profiles(id), action text not null, summary text not null,
 created_at timestamptz not null default now(),
 foreign key(partner_id,client_id) references public.client_businesses(partner_id,id) on delete cascade,
 foreign key(record_id,partner_id,client_id) references public.business_records(id,partner_id,client_id)
);
create index business_records_client_kind on public.business_records(client_id,kind,created_at desc);
create index business_records_approvals on public.business_records(client_id,status) where status='needs_approval';
create index business_events_client_date on public.business_workspace_events(client_id,created_at desc);
create index business_installs_due on public.business_capability_installs(next_run_at) where schedule_enabled and status='enabled';

do $$ declare tab text; begin
 foreach tab in array array['business_workspace_profiles','business_capability_installs','business_records','business_workspace_events'] loop
 execute format('alter table public.%I enable row level security',tab);
 execute format('revoke all on public.%I from anon,authenticated',tab);
 execute format('grant select on public.%I to authenticated',tab);
 execute format('grant all on public.%I to service_role',tab);
 execute format('create policy business_owner_read on public.%I for select to authenticated using (public.current_user_has_platform_role() or public.current_user_has_client_role(client_id,array[''client_owner'']::public.membership_role[]) or (public.current_user_has_client_role(client_id,array[''client_manager'']::public.membership_role[]) and public.current_user_client_sections(client_id,array[''settings'']) and public.current_user_client_sections(client_id,array[''marketing'']) and public.current_user_client_sections(client_id,array[''tasks'']) and public.current_user_client_sections(client_id,array[''contacts'']) and public.current_user_client_sections(client_id,array[''automations'']) and public.current_user_client_sections(client_id,array[''action-center''])))',tab);
 end loop;
end $$;

-- Creation and its activity entry commit together. Stable request keys make
-- retries safe without creating duplicate campaigns or purchase proposals.
create function public.create_business_record(p_partner uuid,p_client uuid,p_actor uuid,p_kind text,p_title text,p_body text,p_data jsonb,p_request text,p_source uuid default null)
returns uuid language plpgsql security invoker set search_path=public as $$
declare result_id uuid;
begin
 insert into public.business_records(partner_id,client_id,created_by,kind,title,body,data,request_key,source_record_id)
 values(p_partner,p_client,p_actor,p_kind,p_title,p_body,p_data,p_request,p_source)
 on conflict(client_id,request_key) do nothing returning id into result_id;
 if result_id is not null then
  insert into public.business_workspace_events(partner_id,client_id,record_id,actor_id,action,summary)
  values(p_partner,p_client,result_id,p_actor,'created','Created '||p_title);
 else
  select id into result_id from public.business_records where client_id=p_client and partner_id=p_partner and request_key=p_request;
 end if;
 return result_id;
end $$;
revoke all on function public.create_business_record(uuid,uuid,uuid,text,text,text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.create_business_record(uuid,uuid,uuid,text,text,text,jsonb,text,uuid) to service_role;

-- State changes and stock receipts are atomic, scoped, revision-checked, and
-- logged. Approval alone never asserts that a supplier order was submitted.
create function public.transition_business_record(p_partner uuid,p_client uuid,p_actor uuid,p_id uuid,p_revision integer,p_action text,p_reference text default '')
returns uuid language plpgsql security invoker set search_path=public as $$
declare r public.business_records; next_status text; product public.business_records; qty integer;
begin
 select * into r from public.business_records where id=p_id and client_id=p_client and partner_id=p_partner for update;
 if not found then raise exception 'Record not found'; end if;
 if r.revision<>p_revision then raise exception 'Record changed. Refresh and review the latest version.'; end if;
 next_status := case
 when p_action='submit' and r.status='draft' and r.kind in ('campaign','purchase','quote') then 'needs_approval'
 when p_action='approve' and r.status='needs_approval' then 'approved'
 when p_action='reject' and r.status='needs_approval' then 'rejected'
 when p_action='start' and r.kind='job' and r.status in ('draft','blocked') then 'in_progress'
 when p_action='block' and r.kind='job' and r.status='in_progress' then 'blocked'
 when p_action='complete' and r.kind='job' and r.status='in_progress' then 'completed'
 when p_action='order' and r.kind='purchase' and r.status='approved' then 'ordered'
 when p_action='receive' and r.kind='purchase' and r.status='ordered' then 'received'
 when p_action='publish' and r.kind='campaign' and r.status='approved' then 'published'
 when p_action='pay' and r.kind='invoice' and r.status='draft' then 'paid'
 when p_action='archive' and r.status in ('draft','rejected','completed','received','published','paid') then 'archived'
 else null end;
 if next_status is null then raise exception 'This transition is not allowed'; end if;
 if p_action in ('order','publish','pay') and length(btrim(p_reference))<3 then raise exception 'Add a reference confirming the external action'; end if;
 if length(p_reference)>2000 then raise exception 'Reference is too long'; end if;
 if p_action='receive' and nullif(r.data->>'product_id','') is not null then
  select * into product from public.business_records where id=(r.data->>'product_id')::uuid and client_id=p_client and partner_id=p_partner and kind='product' and status<>'archived' for update;
  if not found then raise exception 'Linked inventory item is unavailable'; end if;
  qty := (r.data->>'quantity')::integer;
  if qty<=0 then raise exception 'Invalid receiving quantity'; end if;
  update public.business_records set data=jsonb_set(data,'{quantity}',to_jsonb(coalesce((data->>'quantity')::integer,0)+qty)),revision=revision+1,updated_at=now() where id=product.id;
  insert into public.business_workspace_events(partner_id,client_id,record_id,actor_id,action,summary) values(p_partner,p_client,product.id,p_actor,'stock_received','Received '||qty||' units from '||r.title);
 end if;
 update public.business_records set status=next_status,revision=revision+1,updated_at=now(),data=case when p_reference<>'' then data||jsonb_build_object('completion_reference',p_reference) else data end where id=r.id;
 insert into public.business_workspace_events(partner_id,client_id,record_id,actor_id,action,summary) values(p_partner,p_client,r.id,p_actor,p_action,r.title||' · '||replace(next_status,'_',' '));
 return r.id;
end $$;
revoke all on function public.transition_business_record(uuid,uuid,uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.transition_business_record(uuid,uuid,uuid,uuid,integer,text,text) to service_role;

create function public.edit_business_record(p_partner uuid,p_client uuid,p_actor uuid,p_id uuid,p_revision integer,p_title text,p_body text,p_data jsonb)
returns uuid language plpgsql security invoker set search_path=public as $$
declare r public.business_records;
begin
 select * into r from public.business_records where id=p_id and partner_id=p_partner and client_id=p_client for update;
 if not found or r.revision<>p_revision then raise exception 'Record changed. Refresh before editing.'; end if;
 if r.status not in ('draft','rejected') then raise exception 'Only draft or declined records can be edited'; end if;
 update public.business_records set title=p_title,body=p_body,data=p_data,status='draft',revision=revision+1,updated_at=now() where id=r.id;
 insert into public.business_workspace_events(partner_id,client_id,record_id,actor_id,action,summary) values(p_partner,p_client,r.id,p_actor,'edited','Updated '||p_title);
 return r.id;
end $$;
revoke all on function public.edit_business_record(uuid,uuid,uuid,uuid,integer,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.edit_business_record(uuid,uuid,uuid,uuid,integer,text,text,jsonb) to service_role;

insert into public.platform_schema_state(singleton,current_migration,applied_at)
values(true,'20261003033634_business_workspace',now())
on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;
