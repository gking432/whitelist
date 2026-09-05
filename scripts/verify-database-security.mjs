import { execFileSync } from "node:child_process";

// Hardcoded local disposable schema: never target an environment-provided DB.
const container = "supabase_db_partner-platform";

function query(sql) {
  return execFileSync(
    "docker",
    ["exec", container, "psql", "-U", "supabase_admin", "-d", "beta_security_test", "-v", "ON_ERROR_STOP=1", "-Atc", sql],
    { encoding: "utf8" },
  ).trim();
}

const policyIsScoped = query(`
  select (
    qual like '%business.partner_id = workflow_runs.partner_id%'
    and with_check like '%business.partner_id = workflow_runs.partner_id%'
    and qual not like '%business.partner_id = business.partner_id%'
    and with_check not like '%business.partner_id = business.partner_id%'
  )::text
  from pg_policies
  where schemaname = 'public'
    and tablename = 'workflow_runs'
    and policyname = 'workflow_runs_update_resolvers'
`);

if (policyIsScoped !== "true") {
  throw new Error(
    "workflow_runs_update_resolvers does not enforce the outer workflow run's partner scope.",
  );
}

const weakPolicies = query(`
  select count(*)
  from pg_policies
  where schemaname = 'public'
    and (
      coalesce(qual, '') like '%business.partner_id = business.partner_id%'
      or coalesce(with_check, '') like '%business.partner_id = business.partner_id%'
    )
`);

if (weakPolicies !== "0") {
  throw new Error(
    `${weakPolicies} policies compare client_businesses.partner_id to itself.`,
  );
}

const scopedPolicies = [
  ["approval_items", "approval_items_update_resolvers"],
  ["crm_appointments", "crm_appointments_insert_editors"],
  ["crm_appointments", "crm_appointments_update_editors"],
  ["crm_availability_windows", "crm_availability_windows_insert_editors"],
  ["crm_availability_windows", "crm_availability_windows_update_editors"],
  ["crm_communications", "crm_communications_insert_editors"],
  ["crm_communications", "crm_communications_update_editors"],
  ["crm_contacts", "crm_contacts_insert_editors"],
  ["crm_contacts", "crm_contacts_update_editors"],
  ["crm_feedback", "crm_feedback_insert_editors"],
  ["crm_feedback", "crm_feedback_update_editors"],
  ["crm_leads", "crm_leads_insert_editors"],
  ["crm_leads", "crm_leads_update_editors"],
  ["crm_quotes", "crm_quotes_insert_editors"],
  ["crm_quotes", "crm_quotes_update_editors"],
  ["crm_tasks", "crm_tasks_insert_editors"],
  ["crm_tasks", "crm_tasks_update_editors"],
  ["crm_timeline_entries", "crm_timeline_entries_insert_editors"],
  ["crm_timeline_entries", "crm_timeline_entries_update_editors"],
];

// The current policies use permission helpers plus composite foreign keys.
// Assert both the authority predicate and structural tenant pairing, then run
// actual JWT/role behavior in verify-beta-security.mjs.
for (const [table, policy] of scopedPolicies) {
  const permission = table === "approval_items" ? "resolve_approvals" : "edit_crm_data";
  const isScoped = query(`
    select (
      coalesce(with_check, '') like '%current_user_client_permission(client_id, ''${permission}''%'
      and coalesce(with_check, '') like '%current_user_agency_operator(partner_id, client_id)%'
      and (cmd = 'INSERT' or (
        coalesce(qual, '') like '%current_user_client_permission(client_id, ''${permission}''%'
        and coalesce(qual, '') like '%current_user_agency_operator(partner_id, client_id)%'
      ))
      and exists(select 1 from pg_constraint c
        where c.conrelid='public.${table}'::regclass and c.contype='f'
          and pg_get_constraintdef(c.oid) like 'FOREIGN KEY (partner_id, client_id) REFERENCES client_businesses(partner_id, id)%')
    )::text
    from pg_policies where schemaname='public' and tablename='${table}' and policyname='${policy}'
  `);
  if (isScoped !== "true") throw new Error(`${policy} lacks permission enforcement or its composite tenant foreign key.`);
}
const helpersScoped = query(`
  select (pg_get_functiondef('public.current_user_client_permission(uuid,text)'::regprocedure)
    like '%c.partner_id=m.partner_id%'
    and pg_get_functiondef('public.current_user_agency_operator(uuid,uuid)'::regprocedure)
    like '%id=target_client_id and partner_id=target_partner_id%')::text
`);
if (helpersScoped !== "true") throw new Error("Permission helpers do not verify the client/partner pairing.");

const releaseFunctions = [
  "complete_connector_support_release(uuid,uuid,text,text)",
  "rollback_connector_support_release(uuid,uuid,text)",
  "promote_provider_live_pilot(uuid,uuid)",
  "revoke_provider_live_pilot(uuid,uuid,text)",
];

for (const signature of releaseFunctions) {
  const privileges = query(`
    select concat_ws('|',
      has_function_privilege('authenticated', 'public.${signature}', 'execute')::text,
      has_function_privilege('anon', 'public.${signature}', 'execute')::text,
      has_function_privilege('service_role', 'public.${signature}', 'execute')::text
    )
  `);
  if (privileges !== "false|false|true") {
    throw new Error(`${signature} must be executable only by service_role.`);
  }
}

const releaseFlagsSecurity = query(`
  select concat_ws('|',
    c.relrowsecurity::text,
    count(p.policyname)::text
  )
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policies p
    on p.schemaname = n.nspname and p.tablename = c.relname
  where n.nspname = 'public'
    and c.relname = 'connector_release_flags'
  group by c.relrowsecurity
`);

if (releaseFlagsSecurity !== "true|1") {
  throw new Error("connector_release_flags must retain RLS and its scoped select policy.");
}

const providerPilotSecurity = query(`
  select concat_ws('|',
    c.relrowsecurity::text,
    count(p.policyname) filter (
      where p.cmd in ('INSERT', 'UPDATE')
        and coalesce(p.with_check, '') like '%platform_owner%'
        and coalesce(p.with_check, '') like '%platform_admin%'
    )::text
  )
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policies p
    on p.schemaname = n.nspname and p.tablename = c.relname
  where n.nspname = 'public'
    and c.relname = 'provider_live_pilots'
  group by c.relrowsecurity
`);

if (providerPilotSecurity !== "true|2") {
  throw new Error(
    "provider_live_pilots must retain RLS and platform-owner/admin write policies.",
  );
}

const serviceHeartbeatSecurity = query(`
  select concat_ws('|',
    c.relrowsecurity::text,
    count(p.policyname)::text,
    has_table_privilege('anon', 'public.platform_service_heartbeats', 'select')::text,
    has_table_privilege('authenticated', 'public.platform_service_heartbeats', 'select')::text,
    has_table_privilege('service_role', 'public.platform_service_heartbeats', 'select,insert,update,delete')::text
  )
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policies p
    on p.schemaname = n.nspname and p.tablename = c.relname
  where n.nspname = 'public'
    and c.relname = 'platform_service_heartbeats'
  group by c.relrowsecurity
`);

if (serviceHeartbeatSecurity !== "true|0|false|false|true") {
  throw new Error(
    "platform_service_heartbeats must be readable and writable only by service_role.",
  );
}

const voiceToolSecurity = query(`
  select concat_ws('|',
    c.relrowsecurity::text,
    count(p.policyname) filter (where p.cmd = 'SELECT')::text,
    has_table_privilege('anon', 'public.voice_tool_executions', 'select')::text,
    has_table_privilege('authenticated', 'public.voice_tool_executions', 'insert,update,delete')::text,
    has_table_privilege('service_role', 'public.voice_tool_executions', 'select,insert,update,delete')::text
  )
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policies p
    on p.schemaname = n.nspname and p.tablename = c.relname
  where n.nspname = 'public'
    and c.relname = 'voice_tool_executions'
  group by c.relrowsecurity
`);

if (voiceToolSecurity !== "true|1|false|false|true") {
  throw new Error(
    "voice_tool_executions must be tenant-readable and service-role writable only.",
  );
}

query(`
  begin;
  do $$
  declare
    v_partner_id uuid;
    v_client_id uuid;
    v_provider_id uuid;
    v_owner_id uuid := extensions.gen_random_uuid();
    v_package_id uuid;
    v_connection_id uuid;
    v_inbound_event_id uuid;
    v_outbound_event_id uuid;
    v_pilot_id uuid;
    v_result boolean;
    v_status text;
    v_test_client_id uuid;
    v_test_connection_id uuid;
    v_pre_pilot_event_id uuid;
    v_guarded boolean := false;
  begin
    insert into public.partners (name, slug)
    values ('Provider pilot verifier', 'provider-pilot-verifier-' || extensions.gen_random_uuid())
    returning id into v_partner_id;

    insert into public.client_businesses (partner_id, name, slug)
    values (v_partner_id, 'Provider pilot client', 'provider-pilot-client')
    returning id into v_client_id;

    insert into auth.users(id,email,email_confirmed_at)
    values(v_owner_id,'pilot-verifier-'||v_owner_id||'@synthetic.invalid',now());
    insert into public.memberships(user_id,partner_id,client_id,role)
    values(v_owner_id,v_partner_id,v_client_id,'client_owner');
    insert into public.partner_packages(partner_id,name)
    values(v_partner_id,'Synthetic pilot package') returning id into v_package_id;
    update public.client_businesses set package_id=v_package_id where id=v_client_id;
    insert into public.client_beta_acceptances(client_id,partner_id,package_id,accepted_by,provider_test_notes,fallback_contact)
    values(v_client_id,v_partner_id,v_package_id,v_owner_id,
      'Synthetic provider pilot verification and recovery plan for rollback-only tests.',
      'pilot-verifier@synthetic.invalid');

    insert into public.integration_providers (
      provider_key, display_name, category, supports_inbound,
      supports_outbound, connector_status
    ) values (
      'provider_pilot_verifier_' || replace(extensions.gen_random_uuid()::text, '-', ''),
      'Provider pilot verifier', 'test', true, true, 'contract_verified'
    ) returning id into v_provider_id;

    insert into public.integration_connections (
      partner_id, client_id, provider_id, display_name, status,
      runtime_mode, credential_status
    ) values (
      v_partner_id, v_client_id, v_provider_id, 'Verifier account',
      'connected', 'live', 'configured'
    ) returning id into v_connection_id;

    insert into public.integration_events (
      partner_id, client_id, connection_id, direction, event_type, status,
      created_at
    ) values (
      v_partner_id, v_client_id, v_connection_id,
      'inbound', 'verification.before_pilot', 'processed', clock_timestamp()
    ) returning id into v_pre_pilot_event_id;

    insert into public.provider_live_pilots (
      provider_id, connection_id, read_evidence, retry_evidence,
      revocation_evidence
    ) values (
      v_provider_id, v_connection_id, 'Real account read passed.',
      'Retry and idempotency passed.', 'Credential revocation passed.'
    ) returning id into v_pilot_id;

    begin
      update public.provider_live_pilots
      set inbound_event_id = v_pre_pilot_event_id
      where id = v_pilot_id;
    exception when others then
      v_guarded := true;
    end;
    if not v_guarded then
      raise exception 'Provider pilot accepted pre-pilot event evidence.';
    end if;

    select public.promote_provider_live_pilot(v_pilot_id, null)
    into v_result;
    if v_result then
      raise exception 'Pilot promoted without required inbound and outbound evidence.';
    end if;

    insert into public.integration_events (
      partner_id, client_id, connection_id, direction, event_type, status,
      created_at
    ) values (
      v_partner_id, v_client_id, v_connection_id,
      'inbound', 'verification.inbound', 'processed', clock_timestamp()
    ) returning id into v_inbound_event_id;

    insert into public.integration_events (
      partner_id, client_id, connection_id, direction, event_type, status,
      created_at
    ) values (
      v_partner_id, v_client_id, v_connection_id,
      'outbound', 'verification.outbound', 'processed', clock_timestamp()
    ) returning id into v_outbound_event_id;

    update public.provider_live_pilots
    set inbound_event_id = v_inbound_event_id,
        outbound_event_id = v_outbound_event_id
    where id = v_pilot_id;

    select public.promote_provider_live_pilot(v_pilot_id, null)
    into v_result;
    select connector_status into v_status
    from public.integration_providers where id = v_provider_id;
    if not v_result or v_status <> 'live_verified' then
      raise exception 'Complete provider pilot did not promote to live verified.';
    end if;

    select public.revoke_provider_live_pilot(
      v_pilot_id, null, 'Verifier rollback after completed lifecycle.'
    ) into v_result;
    select connector_status into v_status
    from public.integration_providers where id = v_provider_id;
    if not v_result or v_status <> 'contract_verified' then
      raise exception 'Revoked provider pilot did not restore contract verified status.';
    end if;

    insert into public.client_businesses (
      partner_id, name, slug, is_test_account
    ) values (
      v_partner_id, 'Provider pilot test account',
      'provider-pilot-test-account', true
    ) returning id into v_test_client_id;

    insert into public.integration_connections (
      partner_id, client_id, provider_id, display_name, status,
      runtime_mode, credential_status
    ) values (
      v_partner_id, v_test_client_id, v_provider_id, 'Test account',
      'connected', 'live', 'configured'
    ) returning id into v_test_connection_id;

    v_guarded := false;
    begin
      insert into public.provider_live_pilots (
        provider_id, connection_id, read_evidence, retry_evidence,
        revocation_evidence
      ) values (
        v_provider_id, v_test_connection_id, 'Real account read passed.',
        'Retry and idempotency passed.', 'Credential revocation passed.'
      );
    exception when others then
      v_guarded := true;
    end;
    if not v_guarded then
      raise exception 'Provider pilot accepted a test client connection.';
    end if;
  end $$;
  rollback;
`);

const clientSupportPolicy = query(`
  select (
    coalesce(qual, '') like '%origin = ''client''%'
    and coalesce(qual, '') like '%current_user_has_client_role(client_id)%'
  )::text
  from pg_policies
  where schemaname = 'public'
    and tablename = 'support_tickets'
    and policyname = 'support_tickets_select_scoped'
`);

if (clientSupportPolicy !== "true") {
  throw new Error(
    "support_tickets_select_scoped must hide partner, platform, and system tickets from client users.",
  );
}

console.log(
  `Database security verified: workflow runs, ${scopedPolicies.length} CRM/approval policies, support tickets, guarded connector releases, provider live pilots, and service-only runtime heartbeats are scoped.`,
);
