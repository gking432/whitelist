-- Shared application bridge. Metadata is readable within its client; all writes
-- run through authenticated server operations and the existing approval outbox.
insert into public.integration_providers(provider_key,display_name,category,supports_inbound,supports_outbound,supports_oauth)
values('zapier_embedded','Connected apps','automation',true,true,true)
on conflict(provider_key) do nothing;

create table public.embedded_connect_flows (
 id uuid primary key default gen_random_uuid(), partner_id uuid not null, client_id uuid not null,
 user_id uuid not null references public.profiles(id), app_id text not null, app_key text not null, app_title text not null,
 expires_at timestamptz not null default now()+interval '6 minutes', consumed_at timestamptz,
 foreign key(partner_id,client_id) references public.client_businesses(partner_id,id) on delete cascade
);
create table public.embedded_app_connections (
 id uuid primary key, partner_id uuid not null, client_id uuid not null,
 authorizing_user_id uuid not null references public.profiles(id), app_id text not null, app_key text not null,
 app_title text not null, authentication_id text not null, created_at timestamptz not null default now(),
 unique(id,partner_id,client_id), unique(partner_id,client_id,authorizing_user_id,authentication_id),
 foreign key(id,partner_id,client_id) references public.integration_connections(id,partner_id,client_id) on delete cascade
);
create table public.embedded_solution_bindings (
 id uuid primary key default gen_random_uuid(), partner_id uuid not null, client_id uuid not null,
 connection_id uuid not null, direction text not null check(direction in ('inbound','outbound')),
 pack_key text not null, event_type text not null, template_key text,
 action_key text not null, action_title text not null, inputs jsonb not null default '{}', field_mapping jsonb not null default '{}',
 inbox_id text, status text not null default 'draft' check(status in ('draft','enabled','paused','needs_attention')),
 verified_at timestamptz, last_polled_at timestamptz, last_success_at timestamptz, last_error text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(connection_id,partner_id,client_id) references public.embedded_app_connections(id,partner_id,client_id) on delete cascade
);
create unique index embedded_inbox_unique on public.embedded_solution_bindings(inbox_id) where inbox_id is not null;
create trigger set_embedded_binding_updated_at before update on public.embedded_solution_bindings
for each row execute function public.set_updated_at();
alter table public.embedded_connect_flows enable row level security;
alter table public.embedded_app_connections enable row level security;
alter table public.embedded_solution_bindings enable row level security;
revoke all on public.embedded_connect_flows,public.embedded_app_connections,public.embedded_solution_bindings from anon,authenticated;
grant select on public.embedded_app_connections,public.embedded_solution_bindings to authenticated;
grant all on public.embedded_connect_flows,public.embedded_app_connections,public.embedded_solution_bindings to service_role;
create policy embedded_connections_read on public.embedded_app_connections for select to authenticated using (
 public.current_user_has_platform_role() or public.current_user_has_partner_role(partner_id) or public.current_user_client_sections(client_id,array['settings','crm-sync'])
);
create policy embedded_bindings_read on public.embedded_solution_bindings for select to authenticated using (
 public.current_user_has_platform_role() or public.current_user_has_partner_role(partner_id) or public.current_user_client_sections(client_id,array['settings','automations'])
);

create function public.finish_embedded_connection(p_flow_id uuid,p_user_id uuid,p_client_id uuid,p_authentication_id text)
returns uuid language plpgsql security definer set search_path=public as $$
declare f public.embedded_connect_flows; connection_id uuid; provider uuid;
begin
 select * into f from public.embedded_connect_flows where id=p_flow_id and user_id=p_user_id and client_id=p_client_id and consumed_at is null and expires_at>now() for update;
 if not found then raise exception 'Connection session expired or consumed'; end if;
 select id into connection_id from public.embedded_app_connections where partner_id=f.partner_id and client_id=f.client_id and authorizing_user_id=f.user_id and authentication_id=p_authentication_id;
 if connection_id is null then
  select id into provider from public.integration_providers where provider_key='zapier_embedded';
  insert into public.integration_connections(partner_id,client_id,provider_id,display_name,status,credential_status,runtime_mode,created_by)
   values(f.partner_id,f.client_id,provider,f.app_title,'connected','configured','sandbox',f.user_id) returning id into connection_id;
  insert into public.embedded_app_connections(id,partner_id,client_id,authorizing_user_id,app_id,app_key,app_title,authentication_id)
   values(connection_id,f.partner_id,f.client_id,f.user_id,f.app_id,f.app_key,f.app_title,p_authentication_id);
 end if;
 update public.embedded_connect_flows set consumed_at=now() where id=f.id;
 return connection_id;
end $$;
revoke all on function public.finish_embedded_connection(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_embedded_connection(uuid,uuid,uuid,text) to service_role;

alter table public.approval_items add column embedded_binding_id uuid references public.embedded_solution_bindings(id);
create unique index embedded_approval_run_unique on public.approval_items(embedded_binding_id,workflow_run_id) where embedded_binding_id is not null;
alter table public.action_jobs drop constraint action_jobs_kind_check;
alter table public.action_jobs add constraint action_jobs_kind_check check(kind in ('sms.send','email.send','calendar.book','crm.sync','external.action'));
alter table public.action_jobs drop constraint action_jobs_status_check;
alter table public.action_jobs add constraint action_jobs_status_check check(status in ('pending','processing','succeeded','dry_run','skipped','failed','cancelled','uncertain','provider_pending'));
create or replace function public.enqueue_approved_action()
returns trigger language plpgsql security definer set search_path = public as $$
declare action_kind text; action_payload jsonb;
begin
  if new.status not in ('approved','edited_and_approved') then return new; end if;
  if new.type = 'customer_message' and nullif(btrim(new.resolved_content),'') is not null
     and new.proposed_payload->>'channel' in ('sms','email') then
    action_kind := case when new.proposed_payload->>'channel' = 'email' then 'email.send' else 'sms.send' end;
    action_payload := coalesce(new.proposed_payload,'{}'::jsonb) || jsonb_build_object('body',new.resolved_content);
  elsif new.type = 'appointment_booking' then
    action_kind := 'calendar.book'; action_payload := coalesce(new.proposed_payload,'{}'::jsonb);
  elsif new.type = 'external_action' and new.embedded_binding_id is not null then
    action_kind := 'external.action'; action_payload := coalesce(new.proposed_payload,'{}'::jsonb);
  else return new; end if;
  insert into public.action_jobs(partner_id,client_id,approval_id,workflow_run_id,kind,payload,status,execution_key)
  values(new.partner_id,new.client_id,new.id,new.workflow_run_id,action_kind,action_payload,'pending','approval:'||new.id)
  on conflict(execution_key) do nothing;
  return new;
end $$;

-- External action payloads are immutable. Editing the prose would not edit
-- their structured fields, so require rejection and a fresh proposal instead.
create function public.guard_external_action_edit() returns trigger language plpgsql set search_path=public as $$
begin
 if new.type='external_action' and new.status='edited_and_approved' then raise exception 'Reject and prepare a new external action to change its fields'; end if;
 return new;
end $$;
create trigger guard_external_action_edit before update on public.approval_items for each row execute function public.guard_external_action_edit();

insert into public.platform_schema_state(singleton,current_migration,applied_at)
values(true,'20260904200000_embedded_app_connections',now())
on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;
