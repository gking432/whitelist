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

console.log("Database security verified: workflow run updates are tenant scoped.");
