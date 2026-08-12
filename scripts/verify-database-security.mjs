import { execFileSync } from "node:child_process";

const container =
  process.env.SECURITY_DATABASE_CONTAINER ?? "supabase_db_partner-platform";

function query(sql) {
  return execFileSync(
    "docker",
    ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-Atc", sql],
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

for (const [table, policy] of scopedPolicies) {
  const isScoped = query(`
    select (
      coalesce(qual, '') || coalesce(with_check, '')
    ) like '%business.partner_id = ${table}.partner_id%'
    from pg_policies
    where schemaname = 'public'
      and tablename = '${table}'
      and policyname = '${policy}'
  `);

  if (isScoped !== "t") {
    throw new Error(`${policy} does not enforce ${table}.partner_id scope.`);
  }
}

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

query(`
  begin;
  do $$
  declare
    v_partner_id uuid;
    v_client_id uuid;
    v_provider_id uuid;
    v_connection_id uuid;
    v_inbound_event_id uuid;
    v_outbound_event_id uuid;
    v_pilot_id uuid;
    v_result boolean;
    v_status text;
  begin
    insert into public.partners (name, slug)
    values ('Provider pilot verifier', 'provider-pilot-verifier-' || extensions.gen_random_uuid())
    returning id into v_partner_id;

    insert into public.client_businesses (partner_id, name, slug)
    values (v_partner_id, 'Provider pilot client', 'provider-pilot-client')
    returning id into v_client_id;

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

    insert into public.provider_live_pilots (
      provider_id, connection_id, read_evidence, retry_evidence,
      revocation_evidence
    ) values (
      v_provider_id, v_connection_id, 'Real account read passed.',
      'Retry and idempotency passed.', 'Credential revocation passed.'
    ) returning id into v_pilot_id;

    select public.promote_provider_live_pilot(v_pilot_id, null)
    into v_result;
    if v_result then
      raise exception 'Pilot promoted without required inbound and outbound evidence.';
    end if;

    insert into public.integration_events (
      partner_id, client_id, connection_id, direction, event_type, status
    ) values (
      v_partner_id, v_client_id, v_connection_id,
      'inbound', 'verification.inbound', 'processed'
    ) returning id into v_inbound_event_id;

    insert into public.integration_events (
      partner_id, client_id, connection_id, direction, event_type, status
    ) values (
      v_partner_id, v_client_id, v_connection_id,
      'outbound', 'verification.outbound', 'processed'
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
  `Database security verified: workflow runs, ${scopedPolicies.length} CRM/approval policies, support tickets, guarded connector releases, and provider live pilots are scoped.`,
);
