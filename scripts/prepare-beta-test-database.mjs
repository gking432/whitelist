import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

// Isolated LOCAL schema clone. Never loads an environment file or copies rows.
const container = "supabase_db_partner-platform";
const database = "beta_security_test";
const run = (args, input) => execFileSync("docker", ["exec", "-i", container, ...args], {
  input, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024,
});
try {
  // A fresh local Supabase start already applies these migrations. Preserve that
  // schema instead of attempting to recreate tables after the schema-only clone.
  const applied = new Set(run(["psql", "-U", "supabase_admin", "-d", "postgres", "-Atc",
    "select version from supabase_migrations.schema_migrations"])
    .toString().trim().split("\n"));
  run(["psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE IF EXISTS ${database}`]);
  run(["psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE ${database}`]);
  const schema = run(["pg_dump", "-U", "supabase_admin", "-d", "postgres", "--schema-only"]);
  run(["psql", "-U", "supabase_admin", "-d", database, "-v", "ON_ERROR_STOP=1"], schema);
  for (const file of readdirSync("supabase/migrations").filter((name) => name.startsWith("20260904") && name.endsWith(".sql")).sort()) {
    if (applied.has(file.split("_")[0])) continue;
    run(["psql", "-U", "supabase_admin", "-d", database, "-v", "ON_ERROR_STOP=1"], `begin;\n${readFileSync(`supabase/migrations/${file}`, "utf8")}\ncommit;`);
    console.log(`Applied ${file} to disposable local database.`);
  }
} catch (error) {
  console.error(error.stderr?.toString() ?? error.message);
  process.exitCode = 1;
}
