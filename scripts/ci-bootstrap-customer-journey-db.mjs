#!/usr/bin/env node
// HOSTED CI ONLY. Only --start launches the pinned ephemeral stack. Never
// installs tools, loads dotenv, connects to a linked project, replaces an
// existing database, or copies business/auth rows.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFile, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONFIRMATION, EXPECTED_MIGRATION, migrationVersion, redact } from "./verify-customer-journey-db.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PINNED_CLI_VERSION = "2.107.0";
export const SOURCE_CONTAINER = "supabase_db_partner-platform";
export const ACCEPTANCE_DATABASE = "customer_journey_acceptance";
const cli = join(root, "node_modules/.bin/supabase");
export const CATALOG_TABLES = ["public.integration_providers", "public.platform_schema_state", "supabase_migrations.schema_migrations"];
export function sanitizeCiFailure(value) {
  return redact(value)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted JWT]")
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/g, "[redacted API key]")
    .replace(/\b(anon[ _-]*key|service[ _-]*role(?:[ _-]*key)?|jwt[ _-]*secret|secret[ _-]*key|publishable[ _-]*key|db[ _-]*password|password)["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, "$1=[redacted]");
}
export function assertHostedCi(env) {
  if (env.CI !== "true" || env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted" || !env.GITHUB_ENV)
    throw new Error("This bootstrap is restricted to a disposable GitHub-hosted CI runner. No tool or database was contacted.");
}
export function assertToolchain(lockVersion, installedVersion, reportedVersion, config) {
  if ([lockVersion, installedVersion, reportedVersion.trim()].some((value) => value !== PINNED_CLI_VERSION))
    throw new Error(`The lockfile, installed package and executable must all use audited Supabase CLI ${PINNED_CLI_VERSION}. Upgrade the CLI/config together.`);
  if (!/^\[inbucket\]$/m.test(config) || /^\[local_smtp\]$/m.test(config) || !/^project_id\s*=\s*"partner-platform"$/m.test(config))
    throw new Error("The Supabase config does not match the pinned CLI/project contract.");
  if (!/\[db\.seed\][\s\S]*?\nenabled\s*=\s*false\b/.test(config)) throw new Error("CI requires opt-in-only database seeding.");
}
export function isolatedUrl(source) {
  const url = new URL(source);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/postgres" || url.search || url.hash || !url.username || !url.password)
    throw new Error("Only the explicit loopback Supabase postgres URL may bootstrap this CI database.");
  url.pathname = `/${ACCEPTANCE_DATABASE}`;
  return url.href;
}
export function assertBaseline(report, migrationFiles) {
  const expected = migrationFiles.filter((file) => /^\d{14}_[a-z0-9_]+\.sql$/.test(file)).map((file) => file.slice(0, 14)).sort();
  if (!report || report.database !== "postgres" || report.partners !== 0 || report.clients !== 0 || report.users !== 0 ||
      report.authUid !== true || report.authJwt !== true || !Array.isArray(report.versions) ||
      JSON.stringify([...report.versions].sort()) !== JSON.stringify(expected) || migrationVersion(report.migration) !== EXPECTED_MIGRATION ||
      !expected.includes(EXPECTED_MIGRATION) || report.providers < 1)
    throw new Error("The source is not a complete, empty, genuinely migrated Supabase baseline. No database was cloned.");
}
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, shell: false, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, timeout: 120000, ...options });
const inside = (args, input) => run("docker", ["exec", "-i", SOURCE_CONTAINER, ...args], input === undefined ? {} : { input });
const sql = (database, statement) => inside(["psql", "-X", "-U", "supabase_admin", "-d", database, "-v", "ON_ERROR_STOP=1", "-qAtc", statement]).toString().trim();

async function toolchain() {
  const [lock, installed, config] = await Promise.all([
    readFile(join(root, "package-lock.json"), "utf8"), readFile(join(root, "node_modules/supabase/package.json"), "utf8"), readFile(join(root, "supabase/config.toml"), "utf8"),
  ]);
  assertToolchain(JSON.parse(lock).packages["node_modules/supabase"].version, JSON.parse(installed).version, run(cli, ["--version"]).toString(), config);
}
export async function main(args = process.argv.slice(2), env = process.env) {
  if (args.length && (args.length !== 1 || !["--check-toolchain", "--start"].includes(args[0]))) throw new Error("Use no arguments, --check-toolchain, or --start.");
  assertHostedCi(env);
  await toolchain();
  if (args[0] === "--check-toolchain") { console.log(`Pinned Supabase CLI ${PINNED_CLI_VERSION} and config agree.`); return; }
  if (args[0] === "--start") {
    try { run(cli, ["start"]); }
    catch (error) {
      const diagnostic = `${error.stdout?.toString() ?? ""}\n${error.stderr?.toString() ?? error.message}`;
      throw new Error(`Pinned Supabase startup failed:\n${sanitizeCiFailure(diagnostic).slice(-18000)}`);
    }
    console.log("Pinned Supabase started. Generated configuration output was captured and was not printed.");
    return;
  }
  const status = JSON.parse(run(cli, ["status", "--output", "json"]).toString());
  const targetUrl = isolatedUrl(status.DB_URL);
  const inspected = JSON.parse(run("docker", ["inspect", SOURCE_CONTAINER]).toString());
  const container = inspected[0];
  const sourcePort = new URL(status.DB_URL).port || "5432";
  if (inspected.length !== 1 || container.Name !== `/${SOURCE_CONTAINER}` || !String(container.Config?.Image).includes("supabase/postgres") ||
      !container.NetworkSettings?.Ports?.["5432/tcp"]?.some((entry) => entry.HostPort === sourcePort))
    throw new Error("The running container/port does not match the explicit CI Supabase source.");
  const baseline = JSON.parse(sql("postgres", `select jsonb_build_object('database',current_database(),
   'partners',(select count(*) from public.partners),'clients',(select count(*) from public.client_businesses),'users',(select count(*) from auth.users),
   'authUid',to_regprocedure('auth.uid()') is not null,'authJwt',to_regprocedure('auth.jwt()') is not null,
   'providers',(select count(*) from public.integration_providers),'migration',(select current_migration from public.platform_schema_state where singleton),
   'versions',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations));`));
  assertBaseline(baseline, await readdir(join(root, "supabase/migrations")));
  if (sql("postgres", `select count(*) from pg_database where datname='${ACCEPTANCE_DATABASE}'`) !== "0") throw new Error("The named acceptance database already exists; it will never be replaced.");
  // Use the real managed schemas, extension definitions, ACLs and owners from
  // the running Supabase cluster. Cluster roles already exist on this cluster.
  const schema = inside(["pg_dump", "-U", "supabase_admin", "-d", "postgres", "--format=custom", "--schema-only"]);
  const catalogs = inside(["pg_dump", "-U", "supabase_admin", "-d", "postgres", "--format=custom", "--data-only", ...CATALOG_TABLES.map((table) => `--table=${table}`)]);
  sql("postgres", `create database ${ACCEPTANCE_DATABASE} owner postgres template template0`);
  inside(["pg_restore", "-U", "supabase_admin", "-d", ACCEPTANCE_DATABASE, "--exit-on-error", "--clean", "--if-exists"], schema);
  inside(["pg_restore", "-U", "supabase_admin", "-d", ACCEPTANCE_DATABASE, "--exit-on-error", "--data-only"], catalogs);
  const cloned = JSON.parse(sql(ACCEPTANCE_DATABASE, `select jsonb_build_object('database',current_database(),'partners',(select count(*) from public.partners),
   'clients',(select count(*) from public.client_businesses),'users',(select count(*) from auth.users),'authUid',to_regprocedure('auth.uid()') is not null,'authJwt',to_regprocedure('auth.jwt()') is not null,
   'providers',(select count(*) from public.integration_providers),'migration',(select current_migration from public.platform_schema_state where singleton),
   'versions',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations));`));
  assertBaseline({ ...cloned, database: "postgres" }, await readdir(join(root, "supabase/migrations")));
  if (cloned.database !== ACCEPTANCE_DATABASE) throw new Error("The cloned database identity changed.");
  const environment = {
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY, SECRETS_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    ISOLATED_DATABASE_URL: targetUrl, ISOLATED_DATABASE_CONFIRMATION: CONFIRMATION,
  };
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value !== "string" || !value || /[\r\n]/.test(value)) throw new Error(`The CI environment value ${key} is unavailable or invalid.`);
    if (["SUPABASE_SERVICE_ROLE_KEY", "SECRETS_ENCRYPTION_KEY", "ISOLATED_DATABASE_URL"].includes(key)) console.log(`::add-mask::${value}`);
  }
  await appendFile(env.GITHUB_ENV, Object.entries(environment).map(([key, value]) => `${key}=${value}\n`).join(""));
  console.log(`Created ${ACCEPTANCE_DATABASE} from real Supabase schemas and ${baseline.versions.length} reviewed migrations; no auth/business rows copied. Acceptance has not run yet.`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch((error) => { console.error(`FAIL: ${sanitizeCiFailure(error.message)}`); process.exitCode = 1; });
