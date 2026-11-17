#!/usr/bin/env node
// No dotenv, linked-project default, container runtime, or dependency install.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const EXPECTED_MIGRATION = "20261117214644";
export const CONFIRMATION = "customer-journey-disposable";
export const COVERAGE = [
  "rollback: reviewed context and enforceable authority",
  "rollback: canonical intake import, adoption replay, changed payload/actor/key, stale source and tenant scope",
  "rollback: actual anon/authenticated RPC denial and cross-business RLS",
  "rollback: one approved booking/outbox, immutable resolution, internal booking replay and overlap rollback",
  "rollback: source-bound replacement offer, approved internal cancellation/time change, exact receipt recovery and review dedupe",
  "rollback: received customer body/status immutability while scoped identity linking remains possible",
  "concurrency (opt-in): two-session approval resolution, outbox claim, leased assignment claim and adoption dedupe",
];
export class Blocked extends Error {}

export function parseOptions(args) {
  const allowed = new Set(["--plan", "--preflight", "--apply-migrations", "--concurrency"]);
  if (args.some((arg) => !allowed.has(arg)) || new Set(args).size !== args.length) throw new Blocked("Use only --plan, --preflight, --apply-migrations, or --concurrency.");
  if ((args.includes("--plan") && args.length > 1) || (args.includes("--preflight") && args.length > 1)) throw new Blocked("--plan and --preflight are standalone read-only modes.");
  return { plan: args.includes("--plan"), preflight: args.includes("--preflight"), apply: args.includes("--apply-migrations"), concurrency: args.includes("--concurrency") };
}
function identity(url) {
  return `${url.hostname.toLowerCase()}:${url.port || "5432"}/${decodeURIComponent(url.pathname.slice(1))}`;
}
export function validateTarget(env) {
  if (!env.ISOLATED_DATABASE_URL) throw new Blocked("ISOLATED_DATABASE_URL is missing. No database connection was attempted.");
  if (env.ISOLATED_DATABASE_CONFIRMATION !== CONFIRMATION) throw new Blocked(`ISOLATED_DATABASE_CONFIRMATION must equal ${CONFIRMATION}.`);
  let url;
  try { url = new URL(env.ISOLATED_DATABASE_URL); } catch { throw new Blocked("The isolated database URL is invalid."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || url.hash) throw new Blocked("Use an explicit PostgreSQL URL with a host, user and test database.");
  let database;
  try { database = decodeURIComponent(url.pathname.slice(1)); } catch { throw new Blocked("The isolated database name is invalid."); }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*_(test|acceptance)$/.test(database) || /^(postgres|template[01])$/i.test(database)) throw new Blocked("The isolated database name must end in _test or _acceptance; system and runtime databases are forbidden.");
  for (const [key, value] of url.searchParams) {
    if ((key !== "sslmode" && key !== "connect_timeout") ||
      (key === "sslmode" && !["disable", "allow", "prefer", "require", "verify-ca", "verify-full"].includes(value)) ||
      (key === "connect_timeout" && !/^\d{1,2}$/.test(value))) throw new Blocked("Only sslmode and connect_timeout connection options are allowed; database/host/role overrides are forbidden.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  if (!local && env.ISOLATED_DATABASE_ALLOW_REMOTE !== "true") throw new Blocked("Remote test databases also require ISOLATED_DATABASE_ALLOW_REMOTE=true.");
  for (const name of ["DATABASE_URL", "DIRECT_URL", "POSTGRES_URL", "SUPABASE_DB_URL"]) {
    if (!env[name]) continue;
    try { if (identity(new URL(env[name])) === identity(url)) throw new Blocked("The isolated target matches a configured runtime database; refusing it."); }
    catch (error) { if (error instanceof Blocked) throw error; }
  }
  return { url: url.href, database, remote: !local };
}
export function redact(value, targetUrl = "") {
  let output = String(value);
  const secrets = [];
  if (targetUrl) {
    secrets.push(targetUrl);
    try {
      const url = new URL(targetUrl);
      for (const item of [url.password, decodeURIComponent(url.password), url.username, decodeURIComponent(url.username)]) if (item) secrets.push(item);
    } catch { /* Never print the supplied URL when parsing fails. */ }
  }
  for (const secret of secrets.sort((a, b) => b.length - a.length)) output = output.split(secret).join("[redacted]");
  return output.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[redacted database URL]").replace(/\b(password|PGPASSWORD)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
}
export function parseCliRows(text) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error("The CLI did not return a complete JSON result; no database proof was accepted."); }
  const rows = (item) => {
    if (Array.isArray(item)) return item.flatMap((row) => row && typeof row === "object" && ("rows" in row || "result" in row) ? rows(row) : [row]);
    if (item && typeof item === "object") {
      if (item.error || item.errors) throw new Error("The CLI returned an error envelope; no database proof was accepted.");
      for (const key of ["rows", "result", "results", "data"]) if (item[key] !== undefined) return rows(item[key]);
    }
    throw new Error("The CLI JSON has no supported result rows; no database proof was accepted.");
  };
  const result = rows(value);
  if (result.some((row) => !row || typeof row !== "object" || Array.isArray(row) || row.error || row.errors)) throw new Error("The CLI returned malformed result rows or a database error.");
  return result;
}
export const REPORT_PREFIX = "__CUSTOMER_JOURNEY_REPORT__";
export function parsePsqlRows(output) {
  const rows = [];
  for (const line of String(output).split(/\r?\n/)) {
    if (!line.startsWith(REPORT_PREFIX)) continue;
    let report;
    try { report = JSON.parse(line.slice(REPORT_PREFIX.length)); } catch { throw new Error("psql returned a malformed tagged report; no database proof was accepted."); }
    if (!report || typeof report !== "object" || Array.isArray(report) || typeof report.kind !== "string" || report.error || report.errors)
      throw new Error("psql returned an invalid tagged report; no database proof was accepted.");
    rows.push({ cj_report: report });
  }
  if (!rows.length) throw new Error("psql returned no tagged report; no database proof was accepted.");
  return rows;
}
export function parsePsqlExecution({ code, signal, exceeded, stdout, stderr }, targetUrl) {
  if (code !== 0 || exceeded) throw new Error(redact(`Database script failed${signal ? ` (${signal})` : ""}: ${String(stderr).slice(-6000) || "No SQL proof returned."}`, targetUrl));
  return JSON.stringify(parsePsqlRows(stdout));
}
export function readReport(output, kind) {
  const reports = parseCliRows(output).flatMap((row) => {
    if (!row.cj_report) return [];
    try { return [typeof row.cj_report === "string" ? JSON.parse(row.cj_report) : row.cj_report]; } catch { throw new Error("The database report is invalid JSON."); }
  }).filter((report) => report?.kind === kind);
  if (reports.length !== 1) throw new Error("The expected database report is missing or duplicated; no proof was accepted.");
  return reports[0];
}
export function migrationVersion(marker) { return typeof marker === "string" ? /^(\d{14})(?:_|$)/.exec(marker)?.[1] ?? null : null; }
export function migrationPlan(files, report) {
  const eligible = files.filter((file) => /^20261117\d{6}_[a-z0-9_]+\.sql$/.test(file)).sort();
  const versions = new Set(report.appliedVersions);
  const marker = migrationVersion(report.migration);
  if (!marker || marker > EXPECTED_MIGRATION) throw new Blocked("The schema marker is missing, unrecognized, or newer than this verifier.");
  if (eligible.some((file) => file.slice(0, 14) <= marker && !versions.has(file.slice(0, 14)))) throw new Blocked("The schema marker and migration ledger disagree; repair the dedicated test target separately.");
  return eligible.filter((file) => !versions.has(file.slice(0, 14)));
}
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const isolationAssertion = (database) => `
do $cj_isolation$ begin
 if current_database()<>${literal(database)} then raise exception 'Isolated database identity changed'; end if;
 if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'Unfiltered role required before fixture/schema writes'; end if;
 if exists(select 1 from public.partners where slug not like 'cj-acceptance-%' or name not like 'Synthetic customer journey acceptance%')
  or exists(select 1 from public.client_businesses c left join public.partners p on p.id=c.partner_id where p.id is null or c.slug not like 'cj-acceptance-%' or c.name not like 'Synthetic customer journey acceptance%' or p.slug not like 'cj-acceptance-%') then
  raise exception 'Non-test business rows exist: refusing all fixture/schema writes'; end if;
end $cj_isolation$;`;
export function preflightSql(database) {
  return `begin read only; set local statement_timeout='20s'; set local lock_timeout='3s';
select '${REPORT_PREFIX}' || jsonb_build_object('kind','preflight','database',current_database(),
 'unfilteredRead',(select rolsuper or rolbypassrls from pg_catalog.pg_roles where rolname=current_user),
 'nonTestPartners',(select count(*) from public.partners where slug not like 'cj-acceptance-%' or name not like 'Synthetic customer journey acceptance%'),
 'nonTestClients',(select count(*) from public.client_businesses c left join public.partners p on p.id=c.partner_id where p.id is null or c.slug not like 'cj-acceptance-%' or c.name not like 'Synthetic customer journey acceptance%' or p.slug not like 'cj-acceptance-%'),
 'migration',(select current_migration from public.platform_schema_state where singleton),
 'appliedVersions',(select coalesce(jsonb_agg(version order by version),'[]'::jsonb) from supabase_migrations.schema_migrations),
 'expectedDatabase',${literal(database)}) as cj_report; rollback;`;
}
export function assertPreflight(report, target) {
  if (report.database !== target.database || report.expectedDatabase !== target.database || report.unfilteredRead !== true || report.nonTestPartners !== 0 || report.nonTestClients !== 0 || !Array.isArray(report.appliedVersions) || report.appliedVersions.some((version) => !/^\d{14}$/.test(version))) throw new Blocked("Read-only preflight did not prove an unfiltered isolated target without non-test business rows.");
}
function requireLatest(report, missing) {
  if (migrationVersion(report.migration) !== EXPECTED_MIGRATION || missing.length || !report.appliedVersions.includes(EXPECTED_MIGRATION)) throw new Blocked(`Schema ${EXPECTED_MIGRATION} is required. Only --apply-migrations may apply missing November 17 migrations to the validated disposable target.`);
}
async function query(target, sql) {
  const work = await mkdtemp(join(tmpdir(), "customer-journey-db-"));
  const file = join(work, "query.sql");
  try {
    await writeFile(file, sql, { mode: 0o600 });
    return await new Promise((resolveQuery, reject) => {
      // psql file execution supports real multi-statement transactions. The
      // pinned CLI's db query uses prepared execution and rejects this script.
      const child = spawn("psql", ["--dbname", target.url, "--no-psqlrc", "--no-password", "--quiet", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--file", file], {
        cwd: work, shell: false, stdio: ["ignore", "pipe", "pipe"],
        env: Object.fromEntries(["PATH", "HOME", "TMPDIR", "SYSTEMROOT"].filter((key) => process.env[key]).map((key) => [key, process.env[key]])),
      });
      let stdout = "", stderr = "", exceeded = false;
      const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
      child.stdout.on("data", (chunk) => { stdout += chunk; if (stdout.length > 2_000_000) { exceeded = true; child.kill("SIGKILL"); } });
      child.stderr.on("data", (chunk) => { stderr += chunk; if (stderr.length > 2_000_000) { exceeded = true; child.kill("SIGKILL"); } });
      child.on("error", () => { clearTimeout(timer); reject(new Blocked("The psql client could not be started. Install/enable the PostgreSQL client separately; no database proof was accepted.")); });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        try { resolveQuery(parsePsqlExecution({ code, signal, exceeded, stdout, stderr }, target.url)); }
        catch (error) { reject(error); }
      });
    });
  } finally { await rm(work, { recursive: true, force: true }); }
}
async function preflight(target) {
  const report = readReport(await query(target, preflightSql(target.database)), "preflight");
  assertPreflight(report, target);
  return report;
}
async function applyMigrations(target, missing) {
  let body = `begin; set local statement_timeout='40s'; set local lock_timeout='5s'; select pg_advisory_xact_lock(1937402189); ${isolationAssertion(target.database)}\n`;
  for (const name of missing) {
    const sql = await readFile(join(root, "supabase/migrations", name), "utf8");
    if (!sql.trim() || /^\s*(?:begin|commit|rollback)\s*;/im.test(sql) || /\bdrop\s+(?:database|schema|table)\b|\btruncate\s/i.test(sql)) throw new Blocked("A pending migration is empty, manages its own transaction, or contains a destructive reset; it was not applied.");
    const version = name.slice(0, 14);
    body += `do $cj_migration$ begin if exists(select 1 from supabase_migrations.schema_migrations where version=${literal(version)}) then raise exception 'Migration ledger changed; repeat preflight'; end if; end $cj_migration$;\n${sql}\ninsert into supabase_migrations.schema_migrations(version,name) values(${literal(version)},${literal(name.slice(15, -4))});\n`;
  }
  body += "commit; select '__CUSTOMER_JOURNEY_REPORT__' || jsonb_build_object('kind','migration_apply','committed',true) as cj_report;";
  const result = readReport(await query(target, body), "migration_apply");
  if (result.committed !== true) throw new Error("Migration commit was not confirmed.");
}
async function rollbackAcceptance(target) {
  const run = randomUUID();
  const source = await readFile(join(root, "scripts/sql/customer-journey-acceptance.sql"), "utf8");
  const sql = source.replaceAll("__RUN_ID__", run).replace("-- __ISOLATION_ASSERTION__", isolationAssertion(target.database));
  const report = readReport(await query(target, sql), "acceptance");
  if (report.rolledBack !== true || report.remainingFixtures !== 0 || !Array.isArray(report.checks) || !report.checks.length) throw new Error("Rollback acceptance did not return complete evidence.");
  console.log(`PASS: ${report.checks.length} rollback SQL acceptance groups; synthetic fixtures rolled back.`);
}
async function concurrencyAcceptance(target) {
  const ids = Object.fromEntries(["run", "partner", "client", "owner", "approval", "work", "connection", "request"].map((key) => [key, randomUUID()]));
  const prefix = `cj-acceptance-${ids.run}`;
  const cleanup = `begin; set local lock_timeout='5s'; delete from public.partners where id='${ids.partner}' and slug='${prefix}'; delete from auth.users where id='${ids.owner}' and email='${prefix}@synthetic.invalid'; commit; select '__CUSTOMER_JOURNEY_REPORT__' || jsonb_build_object('kind','cleanup','remaining',(select count(*) from public.partners where id='${ids.partner}')+(select count(*) from auth.users where id='${ids.owner}')) as cj_report;`;
  let testError;
  try {
    const fixture = readReport(await query(target, `begin; ${isolationAssertion(target.database)}
insert into auth.users(id,email) values('${ids.owner}','${prefix}@synthetic.invalid');
insert into public.profiles(id,email) values('${ids.owner}','${prefix}@synthetic.invalid') on conflict(id) do nothing;
insert into public.partners(id,name,slug) values('${ids.partner}','Synthetic customer journey acceptance concurrency','${prefix}');
insert into public.client_businesses(id,partner_id,name,slug,status,client_portal_enabled) values('${ids.client}','${ids.partner}','Synthetic customer journey acceptance concurrency','${prefix}','active',true);
insert into public.memberships(user_id,partner_id,client_id,role) values('${ids.owner}','${ids.partner}','${ids.client}','client_owner');
insert into public.agent_team_settings(partner_id,client_id,status,scheduling_enabled,conversations_enabled) values('${ids.partner}','${ids.client}','active',true,false);
insert into public.approval_items(id,partner_id,client_id,type,title,editable_content,proposed_payload) values('${ids.approval}','${ids.partner}','${ids.client}','customer_message','Synthetic concurrency decision','Synthetic acceptance content','{"channel":"email","to":"nobody@synthetic.invalid"}');
insert into public.agent_work_items(id,partner_id,client_id,kind,agent_key,title,dedupe_key,input) values('${ids.work}','${ids.partner}','${ids.client}','booking_request','scheduling','Synthetic concurrency assignment','${prefix}','{"origin":"owner_intake"}');
insert into public.integration_connections(id,partner_id,client_id,provider_id,display_name,status,runtime_mode,credential_status,config) select '${ids.connection}','${ids.partner}','${ids.client}',id,'Synthetic acceptance intake','connected','dry_run','configured','{"workspace_view_only":true}' from public.integration_providers where provider_key='generic_inbound_webhook';
set local role service_role;
select public.persist_owner_import_record('${ids.partner}','${ids.client}','${ids.connection}','lead','${prefix}',null,'{"provider":"generic_inbound_webhook","status":"new","title":"Synthetic inquiry","name":"Synthetic acceptance customer"}','{}',now(),now(),now(),'${prefix}');
commit; select '__CUSTOMER_JOURNEY_REPORT__' || jsonb_build_object('kind','fixture','recordId',id,'updatedAt',updated_at) as cj_report from public.integration_canonical_records where connection_id='${ids.connection}' and external_object_id='${prefix}';`), "fixture");
    if (!/^[0-9a-f-]{36}$/i.test(fixture.recordId) || !Number.isFinite(Date.parse(fixture.updatedAt))) throw new Error("Committed concurrency fixture could not be verified.");
    const pair = async (sqlFor) => Promise.all(["a", "b"].map(async (worker) => readReport(await query(target, sqlFor(worker)), "worker")));
    const resolutions = await pair((worker) => `begin; create temp table cj_worker_result(won boolean); grant insert,select on cj_worker_result to authenticated; set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','${ids.owner}',true); with resolved as(update public.approval_items set status='approved',resolved_by='${ids.owner}',resolution_note='${worker}' where id='${ids.approval}' and status='pending' returning id) insert into cj_worker_result select count(*)=1 from resolved; select pg_sleep(0.2); commit; select '__CUSTOMER_JOURNEY_REPORT__' || jsonb_build_object('kind','worker','won',(select won from cj_worker_result)) as cj_report;`);
    if (resolutions.filter((result) => result.won === true).length !== 1) throw new Error("Concurrent resolution did not have exactly one winner.");
    const claims = await pair((worker) => `begin; create temp table cj_worker_result(won boolean); grant insert,select on cj_worker_result to service_role; set local role service_role; with claimed as(update public.action_jobs set status='processing',claim_token='${worker === "a" ? ids.request : ids.run}',claimed_at=now() where approval_id='${ids.approval}' and status='pending' returning id) insert into cj_worker_result select count(*)=1 from claimed; select pg_sleep(0.2); commit; select '__CUSTOMER_JOURNEY_REPORT__' || jsonb_build_object('kind','worker','won',(select won from cj_worker_result)) as cj_report;`);
    if (claims.filter((result) => result.won === true).length !== 1) throw new Error("Concurrent action claim did not have exactly one winner.");
    const assignments = await pair(() => `begin; create temp table cj_worker_result(won boolean); grant insert,select on cj_worker_result to service_role; set local role service_role; insert into cj_worker_result select count(*)=1 from public.claim_agent_work('${ids.partner}','${ids.client}'); select pg_sleep(0.2); commit; select '__CUSTOMER_JOURNEY_REPORT__' || jsonb_build_object('kind','worker','won',(select won from cj_worker_result)) as cj_report;`);
    if (assignments.filter((result) => result.won === true).length !== 1) throw new Error("Concurrent leased assignment claim did not have exactly one winner.");
    const command = literal(JSON.stringify({ action: "adopt_intake", key: ids.request, connectionId: ids.connection, recordId: fixture.recordId, externalId: prefix, expectedUpdatedAt: fixture.updatedAt, contact: { mode: "create" } }));
    const adoptions = await pair(() => `begin; create temp table cj_worker_result(result jsonb); grant insert,select on cj_worker_result to service_role; set local role service_role; insert into cj_worker_result select public.adopt_owner_intake_record('${ids.partner}','${ids.client}','${ids.owner}',${command}::jsonb); select pg_sleep(0.2); commit; select '__CUSTOMER_JOURNEY_REPORT__' || jsonb_build_object('kind','worker','receipt',(select result->>'id' from cj_worker_result),'replayed',(select result->'replayed' from cj_worker_result)) as cj_report;`);
    if (!adoptions[0].receipt || adoptions[0].receipt !== adoptions[1].receipt || adoptions.filter((result) => result.replayed === true).length !== 1) throw new Error("Concurrent intake adoption did not replay one durable receipt.");
    const counts = readReport(await query(target, `select '__CUSTOMER_JOURNEY_REPORT__' || jsonb_build_object('kind','counts','outbox',(select count(*) from public.action_jobs where approval_id='${ids.approval}'),'leads',(select count(*) from public.crm_leads where partner_id='${ids.partner}' and client_id='${ids.client}'),'receipts',(select count(*) from public.business_owner_commands where client_id='${ids.client}' and request_key='${ids.request}')) as cj_report;`), "counts");
    if (counts.outbox !== 1 || counts.leads !== 1 || counts.receipts !== 1) throw new Error("Concurrent operations created duplicate durable rows.");
  } catch (error) { testError = error; }
  finally {
    const result = readReport(await query(target, cleanup), "cleanup");
    if (result.remaining !== 0) throw new Error("Synthetic concurrency cleanup was incomplete.");
  }
  if (testError) throw testError;
  console.log("PASS: four actual two-session concurrency cases; committed synthetic fixtures cleaned up.");
}
export async function main(args = process.argv.slice(2), env = process.env) {
  const options = parseOptions(args);
  if (options.plan) { console.log(`PLAN ONLY — SQL not executed.\n${COVERAGE.map((item) => `- ${item}`).join("\n")}`); return; }
  const target = validateTarget(env);
  const files = await readdir(join(root, "supabase/migrations"));
  let report = await preflight(target);
  let missing = migrationPlan(files, report);
  if (options.preflight) { console.log(`READY: read-only isolated preflight; ${missing.length} pending November 17 migrations. SQL acceptance was not run.`); return; }
  if (options.apply && missing.length) { await applyMigrations(target, missing); report = await preflight(target); missing = migrationPlan(files, report); }
  requireLatest(report, missing);
  await rollbackAcceptance(target);
  if (options.concurrency) await concurrencyAcceptance(target);
  else console.log("NOT RUN: committed-fixture concurrency checks (use --concurrency on the same validated disposable target).");
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`${error instanceof Blocked ? "BLOCKED" : "FAIL"}: ${redact(error.message, process.env.ISOLATED_DATABASE_URL || "")}`);
    process.exitCode = error instanceof Blocked ? 2 : 1;
  });
}
