-- Identity claims are owned by Auth, not editable profile display fields.
revoke insert, update on public.profiles from authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;
update public.profiles p set email = u.email from auth.users u where u.id = p.id and u.email is not null;

create or replace function public.current_user_shares_partner_scope(target_user_id uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.memberships mine join public.memberships theirs
      on theirs.partner_id = mine.partner_id
    where mine.user_id = auth.uid() and mine.status = 'active'
      and theirs.user_id = target_user_id and theirs.status = 'active'
      and (mine.client_id is null or (mine.client_id = theirs.client_id))
  );
$$;

-- Partner staff management does not grant client-owner authority. Client
-- invitations use a trusted action with a verified, independent Auth identity.
drop policy if exists memberships_insert_authorized on public.memberships;
create policy memberships_insert_authorized on public.memberships for insert to authenticated
with check (
  public.current_user_has_platform_role(array['platform_owner','platform_admin']::public.membership_role[])
  or (client_id is null and role in ('partner_owner','partner_admin','partner_implementer','partner_viewer')
    and public.current_user_has_partner_role(partner_id, array['partner_owner','partner_admin']::public.membership_role[]))
  or (client_id is not null and role in ('client_owner','client_manager','client_staff','client_viewer')
    and public.current_user_has_client_role(client_id, array['client_owner']::public.membership_role[]))
);
drop policy if exists memberships_update_authorized on public.memberships;
create policy memberships_update_authorized on public.memberships for update to authenticated
using (
  public.current_user_has_platform_role(array['platform_owner','platform_admin']::public.membership_role[])
  or (client_id is null and public.current_user_has_partner_role(partner_id, array['partner_owner','partner_admin']::public.membership_role[]))
  or public.current_user_has_client_role(client_id, array['client_owner']::public.membership_role[])
)
with check (
  public.current_user_has_platform_role(array['platform_owner','platform_admin']::public.membership_role[])
  or (client_id is null and role in ('partner_owner','partner_admin','partner_implementer','partner_viewer')
    and public.current_user_has_partner_role(partner_id, array['partner_owner','partner_admin']::public.membership_role[]))
  or (client_id is not null and role in ('client_owner','client_manager','client_staff','client_viewer')
    and public.current_user_has_client_role(client_id, array['client_owner']::public.membership_role[]))
);

create or replace function public.guard_business_security_flags()
returns trigger language plpgsql set search_path = public, auth as $$
begin
  if auth.role() = 'authenticated' and not public.current_user_has_platform_role(array['platform_owner','platform_admin']::public.membership_role[]) then
    if (tg_op = 'INSERT' and (new.account_kind <> 'managed_client' or new.is_test_account))
      or (tg_op = 'UPDATE' and (new.account_kind is distinct from old.account_kind or new.is_test_account is distinct from old.is_test_account)) then
      raise exception 'Business security classification requires platform authorization.';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_business_security_flags before insert or update on public.client_businesses
for each row execute function public.guard_business_security_flags();

create or replace function public.guard_partner_test_flag()
returns trigger language plpgsql set search_path = public, auth as $$
begin
  if auth.role() = 'authenticated' and new.is_test_account is distinct from old.is_test_account
    and not public.current_user_has_platform_role(array['platform_owner','platform_admin']::public.membership_role[]) then
    raise exception 'Test classification requires platform authorization.';
  end if;
  return new;
end;
$$;
create trigger guard_partner_test_flag before update on public.partners
for each row execute function public.guard_partner_test_flag();

-- Reject existing scope corruption instead of silently moving customer secrets.
alter table public.integration_connections add constraint integration_connections_id_scope_unique unique (id, partner_id, client_id);
alter table public.integration_secrets add constraint integration_secrets_connection_scope_fk
  foreign key (connection_id, partner_id, client_id)
  references public.integration_connections (id, partner_id, client_id) on delete cascade;

-- Mirror the server's employee permission defaults. Malformed JSON flags do
-- not grant authority; explicit false overrides role defaults.
create or replace function public.current_user_client_permission(target_client_id uuid, permission_key text)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.memberships m join public.client_businesses c on c.id=m.client_id and c.partner_id=m.partner_id
    where m.user_id=auth.uid() and m.client_id=target_client_id and m.status='active' and c.client_portal_enabled
      and m.role in ('client_owner','client_manager','client_staff')
      and (m.role='client_owner' or case
        when jsonb_typeof(m.client_permissions->permission_key)='boolean' then m.client_permissions->permission_key='true'::jsonb
        when permission_key in ('resolve_approvals','view_action_center') then coalesce(m.client_job_role, case when m.role='client_manager' then 'manager' else 'staff' end) in ('owner','manager')
        when permission_key in ('edit_crm_data','operate_customer_actions') then coalesce(m.client_job_role, case when m.role='client_manager' then 'manager' else 'staff' end) in ('owner','manager','sales','front_desk')
        else false end)
  );
$$;

create or replace function public.current_user_client_sections(target_client_id uuid, required_sections text[])
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.memberships m join public.client_businesses c on c.id=m.client_id and c.partner_id=m.partner_id
    where m.user_id=auth.uid() and m.client_id=target_client_id and m.status='active' and c.client_portal_enabled
      and (m.role='client_owner' or (
        (case when jsonb_typeof(m.client_permissions->'sections')='array' then m.client_permissions->'sections'
        else to_jsonb(case coalesce(m.client_job_role, case m.role when 'client_manager' then 'manager' when 'client_viewer' then 'viewer' else 'staff' end)
          when 'owner' then array['overview','inbox','contacts','calls','pipeline','tasks','schedule','quotes','marketing','automations','reports','crm-sync','settings','notifications','assistant','approvals','activity','support']
          when 'manager' then array['overview','inbox','contacts','calls','pipeline','tasks','schedule','quotes','marketing','automations','reports','crm-sync','settings','notifications','assistant','approvals','activity','support']
          when 'sales' then array['overview','inbox','contacts','calls','pipeline','tasks','schedule','quotes','assistant','notifications']
          when 'front_desk' then array['overview','inbox','contacts','calls','tasks','schedule','assistant','notifications']
          when 'marketing' then array['overview','inbox','marketing','reports','notifications']
          when 'viewer' then array['overview']
          else array['overview','inbox','contacts','tasks','schedule','notifications'] end) end) ?| array_remove(required_sections,'action-center')
        or ('action-center'=any(required_sections) and public.current_user_client_permission(target_client_id,'view_action_center'))
      ))
  );
$$;

create or replace function public.current_user_agency_operator(target_partner_id uuid, target_client_id uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select public.current_user_has_partner_role(target_partner_id,array['partner_owner','partner_admin','partner_implementer']::public.membership_role[])
    and exists(select 1 from public.client_businesses where id=target_client_id and partner_id=target_partner_id and account_kind='partner_agency');
$$;

-- Each raw dataset requires its own section; overview/report access never
-- implicitly permits downloading all customer records.
do $$
declare item record;
begin
  for item in select * from (values
    ('crm_contacts', array['contacts']), ('crm_leads', array['contacts','pipeline']),
    ('crm_tasks', array['tasks']), ('crm_timeline_entries', array['contacts','activity']),
    ('crm_communications', array['inbox']), ('crm_appointments', array['schedule']),
    ('crm_availability_windows', array['schedule']), ('crm_quotes', array['quotes']),
    ('crm_feedback', array['marketing']), ('call_sessions', array['calls','assistant']),
    ('call_transcript_turns', array['calls','assistant']), ('assistant_events', array['assistant']),
    ('chat_sessions', array['inbox']), ('voice_tool_executions', array['calls','assistant']),
    ('marketing_campaign_snapshots', array['marketing','reports']), ('crm_contact_links', array['contacts','crm-sync']),
    ('integration_canonical_records', array['crm-sync']), ('integration_object_links', array['crm-sync']),
    ('integration_sync_states', array['crm-sync']), ('integration_sync_jobs', array['crm-sync']),
    ('integration_webhook_registrations', array['crm-sync']), ('integration_field_mappings', array['crm-sync'])
  ) as datasets(table_name, sections)
  loop
    execute format('drop policy if exists %I on public.%I', item.table_name || '_select_scoped', item.table_name);
    execute format('create policy %I on public.%I for select to authenticated using (public.current_user_has_platform_role() or public.current_user_has_partner_role(partner_id) or public.current_user_client_sections(client_id,%L::text[]))', item.table_name || '_select_scoped', item.table_name, item.sections);
  end loop;
end $$;

do $$
declare item record; t text;
begin
  for item in select * from (values
    ('crm_contacts',array['contacts']),('crm_leads',array['contacts','pipeline']),
    ('crm_tasks',array['tasks']),('crm_timeline_entries',array['contacts','activity']),
    ('crm_communications',array['inbox']),('crm_appointments',array['schedule']),
    ('crm_availability_windows',array['schedule']),('crm_quotes',array['quotes']),('crm_feedback',array['marketing'])
  ) as datasets(table_name,sections)
  loop
    t:=item.table_name;
    execute format('alter table public.%I add constraint %I foreign key (partner_id,client_id) references public.client_businesses(partner_id,id) on delete cascade',t,t||'_business_scope_fk');
    execute format('drop policy if exists %I on public.%I',t||'_insert_editors',t);
    execute format('drop policy if exists %I on public.%I',t||'_update_editors',t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((public.current_user_client_permission(client_id,''edit_crm_data'') and public.current_user_client_sections(client_id,%L::text[])) or public.current_user_agency_operator(partner_id,client_id))',t||'_insert_editors',t,item.sections);
    execute format('create policy %I on public.%I for update to authenticated using ((public.current_user_client_permission(client_id,''edit_crm_data'') and public.current_user_client_sections(client_id,%L::text[])) or public.current_user_agency_operator(partner_id,client_id)) with check ((public.current_user_client_permission(client_id,''edit_crm_data'') and public.current_user_client_sections(client_id,%L::text[])) or public.current_user_agency_operator(partner_id,client_id))',t||'_update_editors',t,item.sections,item.sections);
  end loop;
end $$;

do $$
declare item record;
begin
  for item in select * from (values
    ('integration_connections','integration_connections_select_accessible',array['crm-sync','settings','automations']),
    ('integration_events','integration_events_select_accessible',array['crm-sync','activity']),
    ('client_workflow_instances','client_workflow_instances_select_accessible',array['automations']),
    ('workflow_runs','workflow_runs_select_accessible',array['automations','activity','approvals']),
    ('client_metrics_daily','client_metrics_daily_select_accessible',array['overview','reports'])
  ) as datasets(table_name,policy_name,sections)
  loop
    execute format('drop policy if exists %I on public.%I',item.policy_name,item.table_name);
    execute format('create policy %I on public.%I for select to authenticated using (public.current_user_has_platform_role() or public.current_user_has_partner_role(partner_id) or public.current_user_client_sections(client_id,%L::text[]))',item.policy_name,item.table_name,item.sections);
  end loop;
end $$;

drop policy if exists approval_items_select_accessible on public.approval_items;
create policy approval_items_select_accessible on public.approval_items for select to authenticated
using (public.current_user_has_platform_role() or public.current_user_has_partner_role(partner_id)
  or (public.current_user_client_sections(client_id,array['approvals','action-center'])
    and (public.current_user_has_client_role(client_id,array['client_owner','client_manager']::public.membership_role[]) or assigned_to=auth.uid())));

drop policy if exists approval_items_update_resolvers on public.approval_items;
create policy approval_items_update_resolvers on public.approval_items for update to authenticated
using ((public.current_user_client_permission(client_id,'resolve_approvals')
  and (public.current_user_has_client_role(client_id,array['client_owner','client_manager']::public.membership_role[]) or assigned_to=auth.uid()))
  or public.current_user_agency_operator(partner_id,client_id))
with check ((public.current_user_client_permission(client_id,'resolve_approvals')
  and (public.current_user_has_client_role(client_id,array['client_owner','client_manager']::public.membership_role[]) or assigned_to=auth.uid()))
  or public.current_user_agency_operator(partner_id,client_id));

-- The aggregate worker is service-only; an anonymous JWT must not execute it.
revoke all on function public.aggregate_client_metrics_daily(date) from public, anon, authenticated;
grant execute on function public.aggregate_client_metrics_daily(date) to service_role;
