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

console.log(
  `Database security verified: workflow runs and ${scopedPolicies.length} CRM/approval policies are tenant scoped.`,
);
