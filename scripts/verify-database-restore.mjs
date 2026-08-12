import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sourceContainer = process.env.RESTORE_SOURCE_CONTAINER ?? "supabase_db_partner-platform";
const targetContainer = process.env.RESTORE_TARGET_CONTAINER ?? "northstar-restore-drill-verify";
const temporaryDirectory = mkdtempSync(join(tmpdir(), "northstar-restore-"));
const dumpPath = join(temporaryDirectory, "public.dump");
const authUsersPath = join(temporaryDirectory, "auth-users.sql");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    stdio: options.capture === false ? "inherit" : ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function dockerExec(container, args, options = {}) {
  return run("docker", ["exec", container, ...args], options);
}

function query(container, sql) {
  return dockerExec(container, ["psql", "-U", "postgres", "-d", "postgres", "-Atc", sql]).trim();
}

function sourcePostgresImage() {
  const configured = process.env.RESTORE_POSTGRES_IMAGE?.trim();
  if (configured) return configured;
  const image = run("docker", [
    "inspect",
    sourceContainer,
    "--format",
    "{{.Config.Image}}",
  ]).trim();
  if (!image) {
    throw new Error(`Could not determine the image used by ${sourceContainer}.`);
  }
  return image;
}

function removeTarget() {
  try {
    run("docker", ["rm", "-f", targetContainer]);
  } catch {
    // The disposable restore target may not exist yet.
  }
}

function waitForDatabase() {
  let consecutiveReadyChecks = 0;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      dockerExec(targetContainer, ["pg_isready", "-U", "postgres", "-d", "postgres"]);
      consecutiveReadyChecks += 1;
      if (consecutiveReadyChecks >= 5) {
        return;
      }
    } catch {
      consecutiveReadyChecks = 0;
    }
    run("sleep", ["1"]);
  }
  throw new Error("Disposable restore database did not remain ready within 90 seconds.");
}

function assertEqual(label, source, restored) {
  if (source !== restored) {
    throw new Error(`${label} mismatch: source=${source}, restored=${restored}`);
  }
}

try {
  run("docker", ["info"]);
  query(sourceContainer, "select 1");

  console.log(`Creating application-data backup from ${sourceContainer}...`);
  const dump = dockerExec(sourceContainer, [
    "pg_dump",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "--format=custom",
    "--schema=public",
    "--no-owner",
    "--no-acl",
  ], { encoding: null });
  writeFileSync(dumpPath, dump);

  // Public profile and membership rows reference auth.users. A disposable drill
  // only needs stable identities; managed Supabase restores the complete auth
  // schema and credentials as part of its own backup/PITR process.
  const authUsers = query(
    sourceContainer,
    `select format(
      'insert into auth.users (id, email, aud, role, created_at, updated_at) values (%L::uuid, %L, %L, %L, %L::timestamptz, %L::timestamptz) on conflict (id) do nothing;',
      id::text,
      email,
      coalesce(aud, 'authenticated'),
      coalesce(role, 'authenticated'),
      created_at::text,
      updated_at::text
    ) from auth.users order by id`,
  );
  writeFileSync(authUsersPath, `${authUsers}\n`, { mode: 0o600 });

  removeTarget();
  console.log(`Starting disposable restore target ${targetContainer}...`);
  const postgresImage = sourcePostgresImage();
  run("docker", [
    "run",
    "--detach",
    "--name",
    targetContainer,
    "--env",
    "POSTGRES_PASSWORD=restore-drill-only",
    "--env",
    "POSTGRES_DB=postgres",
    "--health-cmd",
    "pg_isready -U postgres -h localhost",
    "--health-interval",
    "2s",
    "--health-timeout",
    "2s",
    "--health-retries",
    "30",
    postgresImage,
  ]);
  waitForDatabase();

  run("docker", ["cp", dumpPath, `${targetContainer}:/tmp/public.dump`]);
  run("docker", ["cp", authUsersPath, `${targetContainer}:/tmp/auth-users.sql`]);
  dockerExec(targetContainer, [
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "drop schema if exists public cascade;",
  ]);

  console.log("Restoring schema, tenant identities, application data, and policies...");
  for (const section of ["pre-data", "data", "post-data"]) {
    if (section === "data") {
      dockerExec(targetContainer, [
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        "/tmp/auth-users.sql",
      ]);
    }
    dockerExec(targetContainer, [
      "pg_restore",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "--section",
      section,
      "--no-owner",
      "--no-acl",
      "--exit-on-error",
      "/tmp/public.dump",
    ]);
  }

  const sourceTables = query(
    sourceContainer,
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  ).split("\n").filter(Boolean);
  const restoredTables = query(
    targetContainer,
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  ).split("\n").filter(Boolean);
  assertEqual("public table inventory", sourceTables.join(","), restoredTables.join(","));

  for (const table of sourceTables) {
    const safeTable = `"${table.replaceAll('"', '""')}"`;
    assertEqual(
      `${table} row count`,
      query(sourceContainer, `select count(*) from public.${safeTable}`),
      query(targetContainer, `select count(*) from public.${safeTable}`),
    );
  }

  assertEqual(
    "public RLS policy count",
    query(sourceContainer, "select count(*) from pg_policies where schemaname = 'public'"),
    query(targetContainer, "select count(*) from pg_policies where schemaname = 'public'"),
  );
  assertEqual(
    "public function count",
    query(sourceContainer, "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'"),
    query(targetContainer, "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'"),
  );

  console.log(
    `Restore verified: ${sourceTables.length} tables, all row counts, RLS policies, and functions match.`,
  );
} finally {
  removeTarget();
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
