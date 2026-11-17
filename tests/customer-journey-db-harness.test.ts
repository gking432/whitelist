// These exercise harness gates/parsing only. They do not execute or prove SQL.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const harnessUrl = new URL("../scripts/verify-customer-journey-db.mjs", import.meta.url);
const { validateTarget, parseOptions, redact, parseCliRows, readReport, preflightSql, assertPreflight, migrationPlan, CONFIRMATION, EXPECTED_MIGRATION } = await import(harnessUrl.href);
const configured = (values: Record<string, string> = {}) => ({ ISOLATED_DATABASE_URL: "postgresql://synthetic:secret%40word@127.0.0.1:5432/customer_journey_test", ISOLATED_DATABASE_CONFIRMATION: CONFIRMATION, ...values });
const report = (values: Record<string, unknown> = {}) => ({ kind: "preflight", database: "customer_journey_test", expectedDatabase: "customer_journey_test", unfilteredRead: true, nonTestPartners: 0, nonTestClients: 0, migration: "20261117133444_customer_journey_lifecycle", appliedVersions: ["20261117030202", "20261117033546", "20261117043720", "20261117133444"], ...values });

test("harness configuration is blocked without an explicit isolated URL and exact confirmation", () => {
  assert.throws(() => validateTarget({}), /ISOLATED_DATABASE_URL is missing/);
  assert.throws(() => validateTarget({ ISOLATED_DATABASE_URL: configured().ISOLATED_DATABASE_URL }), /CONFIRMATION/);
  assert.throws(() => validateTarget(configured({ ISOLATED_DATABASE_CONFIRMATION: "yes" })), /CONFIRMATION/);
  assert.equal(validateTarget(configured()).database, "customer_journey_test");
});
test("system databases, ordinary runtime databases, encoded paths and connection overrides are rejected", () => {
  for (const database of ["postgres", "template0", "template1", "production", "normal_app", "customer_test%2Fpostgres", "customer_test?dbname=postgres", "customer_test?host=elsewhere", "customer_test?options=-crole=postgres"])
    assert.throws(() => validateTarget(configured({ ISOLATED_DATABASE_URL: `postgresql://synthetic:secret@localhost/${database}` })));
  const env = configured();
  assert.throws(() => validateTarget({ ...env, DATABASE_URL: env.ISOLATED_DATABASE_URL.replace("synthetic:secret%40word", "other:different") }), /runtime database/);
  assert.equal(validateTarget(configured({ ISOLATED_DATABASE_URL: "postgres://synthetic:secret@localhost/cj_acceptance?sslmode=disable&connect_timeout=5" })).database, "cj_acceptance");
});
test("remote addresses require the additional literal opt-in and localhost lookalikes are remote", () => {
  for (const host of ["db.example.invalid", "localhost.example.invalid", "127.0.0.1.example.invalid"])
    assert.throws(() => validateTarget(configured({ ISOLATED_DATABASE_URL: `postgres://synthetic:secret@${host}/cj_test` })), /ALLOW_REMOTE/);
  assert.equal(validateTarget(configured({ ISOLATED_DATABASE_URL: "postgres://synthetic:secret@db.example.invalid/cj_test", ISOLATED_DATABASE_ALLOW_REMOTE: "true" })).remote, true);
  assert.equal(validateTarget(configured({ ISOLATED_DATABASE_URL: "postgres://synthetic:secret@[::1]/cj_test" })).remote, false);
});
test("mode parsing never accepts arbitrary CLI targets or a writable preflight combination", () => {
  assert.deepEqual(parseOptions(["--concurrency", "--apply-migrations"]), { plan: false, preflight: false, apply: true, concurrency: true });
  for (const args of [["--linked"], ["--db-url", "anything"], ["--preflight", "--apply-migrations"], ["--plan", "--concurrency"], ["--concurrency", "--concurrency"]]) assert.throws(() => parseOptions(args));
});
test("credential redaction covers full URLs and encoded/plain password echoes", () => {
  const url = configured().ISOLATED_DATABASE_URL;
  const output = redact(`failed ${url} password=secret@word PGPASSWORD=secret%40word user=synthetic postgresql://other:another@host/runtime`, url);
  for (const forbidden of [url, "secret@word", "secret%40word", "another", "synthetic"]) assert.equal(output.includes(forbidden), false, forbidden);
});
test("CLI JSON parsing accepts explicit row envelopes and rejects missing, malformed or error output", () => {
  const rows = [{ cj_report: { kind: "acceptance", rolledBack: true } }];
  for (const value of [rows, { rows }, { data: { rows } }, [{ rows }], { results: [{ rows }] }]) assert.deepEqual(parseCliRows(JSON.stringify(value)), rows);
  for (const value of ["", "NOTICE\n[]", "{}", '{"error":"denied","rows":[]}', '[{"error":"denied"}]', '[[1]]']) assert.throws(() => parseCliRows(value));
  assert.deepEqual(readReport(JSON.stringify({ rows }), "acceptance"), rows[0].cj_report);
  assert.throws(() => readReport("[]", "acceptance"), /missing or duplicated/);
  assert.throws(() => readReport(JSON.stringify([...rows, ...rows]), "acceptance"), /missing or duplicated/);
});
test("read-only preflight and marker/ledger checks cannot infer acceptance from a schema label alone", () => {
  const target = validateTarget(configured());
  assert.match(preflightSql(target.database), /^begin read only;/);
  assert.doesNotMatch(preflightSql(target.database), /\b(insert|update|delete|create|alter|drop)\b/i);
  assert.doesNotThrow(() => assertPreflight(report(), target));
  for (const values of [{ nonTestPartners: 1 }, { nonTestClients: 1 }, { database: "postgres" }, { unfilteredRead: false }, { appliedVersions: ["not-a-version"] }])
    assert.throws(() => assertPreflight(report(values), target));
  const files = ["20261117030202_reviewed_business_authority.sql", "20261117033546_multi_application_workspace.sql", "20261117043720_owner_intake_adoption.sql", "20261117133444_customer_journey_lifecycle.sql", `${EXPECTED_MIGRATION}_approved_calendar_changes.sql`, "20261009014610_business_agent_activation.sql"];
  assert.deepEqual(migrationPlan(files, report()), [`${EXPECTED_MIGRATION}_approved_calendar_changes.sql`]);
  assert.throws(() => migrationPlan(files, report({ appliedVersions: [] })), /disagree/);
  assert.throws(() => migrationPlan(files, report({ migration: "20990101000000_newer" })), /newer/);
});
test("the actual default command blocks before CLI/database access and plan makes no PASS claim", async () => {
  let failure: { status?: number; stderr?: Buffer | string } | undefined;
  try { execFileSync(process.execPath, [fileURLToPath(harnessUrl)], { env: { PATH: process.env.PATH, NODE_ENV: "test" }, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (error) { failure = error as typeof failure; }
  assert.equal(failure?.status, 2);
  assert.match(String(failure?.stderr), /BLOCKED: ISOLATED_DATABASE_URL is missing/);
  const plan = execFileSync(process.execPath, [fileURLToPath(harnessUrl), "--plan"], { env: { PATH: process.env.PATH, NODE_ENV: "test" }, encoding: "utf8" });
  assert.match(plan, /PLAN ONLY.*SQL not executed/);
  assert.doesNotMatch(plan, /\bPASS\b/);
  const source = await readFile(harnessUrl, "utf8");
  assert.doesNotMatch(source, /spawn\(\s*["'](?:docker|psql|npx)["']/);
  assert.match(source, /shell: false/);
  assert.match(source, /cwd: work/);
  assert.doesNotMatch(source, /(?:import|require).*dotenv|readFile.*\.env/);
});
