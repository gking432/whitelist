import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

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

async function openSourceSnapshot() {
  const child = spawn(
    "docker",
    [
      "exec",
      "-i",
      sourceContainer,
      "psql",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const lines = createInterface({ input: child.stdout });
  const queuedLines = [];
  const waitingLines = [];
  let stderr = "";
  let exited = false;
  let exitError = null;

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  lines.on("line", (line) => {
    const waiter = waitingLines.shift();
    if (waiter) waiter.resolve(line);
    else queuedLines.push(line);
  });
  child.on("exit", (code, signal) => {
    exited = true;
    if (code !== 0) {
      exitError = new Error(
        `Source snapshot session exited with ${signal ?? `code ${code}`}: ${stderr.trim()}`,
      );
    }
    while (waitingLines.length > 0) {
      const waiter = waitingLines.shift();
      waiter.reject(exitError ?? new Error("Source snapshot session ended unexpectedly."));
    }
  });

  function nextLine() {
    if (queuedLines.length > 0) return Promise.resolve(queuedLines.shift());
    if (exited) {
      return Promise.reject(exitError ?? new Error("Source snapshot session ended unexpectedly."));
    }
    return new Promise((resolve, reject) => waitingLines.push({ resolve, reject }));
  }

  let queryNumber = 0;
  async function scalar(sql) {
    queryNumber += 1;
    const marker = `__RESTORE_SNAPSHOT_${queryNumber}__`;
    child.stdin.write(
      `select '${marker}' || encode(convert_to(coalesce((${sql})::text, ''), 'UTF8'), 'hex');\n`,
    );
    while (true) {
      const line = await nextLine();
      if (line.startsWith(marker)) {
        return Buffer.from(line.slice(marker.length), "hex").toString("utf8");
      }
    }
  }

  child.stdin.write(
    "begin transaction isolation level repeatable read read only;\n" +
      "select '__RESTORE_SNAPSHOT_ID__' || pg_export_snapshot();\n",
  );
  let snapshotId = "";
  while (!snapshotId) {
    const line = await nextLine();
    if (line.startsWith("__RESTORE_SNAPSHOT_ID__")) {
      snapshotId = line.slice("__RESTORE_SNAPSHOT_ID__".length);
    }
  }

  return {
    snapshotId,
    scalar,
    async close() {
      if (exited) {
        if (exitError) throw exitError;
        return;
      }
      child.stdin.end("commit;\n");
      await new Promise((resolve, reject) => {
        child.once("exit", (code, signal) => {
          if (code === 0) resolve();
          else {
            reject(
              new Error(
                `Source snapshot session exited with ${signal ?? `code ${code}`}: ${stderr.trim()}`,
              ),
            );
          }
        });
      });
    },
  };
}

// Permission fidelity matters for the narrow authenticated wrappers/private
// provisioning functions. Compare API-role grants across both app schemas.
const functionGrantsSql = `select coalesce(string_agg(grant_row,E'\n' order by grant_row),'') from (
 select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||case when a.grantee=0 then 'PUBLIC' else r.rolname end||':'||a.privilege_type||':'||a.is_grantable::text as grant_row
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 left join pg_roles r on r.oid=a.grantee where n.nspname in ('public','owner_onboarding') and (a.grantee=0 or r.rolname in ('anon','authenticated','service_role'))
) grants`;

const schemaGrantsSql = `select coalesce(string_agg(grant_row,E'\n' order by grant_row),'') from (
 select n.nspname||':'||case when a.grantee=0 then 'PUBLIC' else r.rolname end||':'||a.privilege_type||':'||a.is_grantable::text as grant_row
 from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a left join pg_roles r on r.oid=a.grantee
 where n.nspname in ('public','owner_onboarding') and (a.grantee=0 or r.rolname in ('anon','authenticated','service_role'))
) grants`;

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

  const sourceSnapshot = await openSourceSnapshot();
  let sourceTables;
  const sourceRowCounts = new Map();
  let sourcePolicyCount;
  let sourceFunctionCount;
  let sourcePrivateFunctionCount;
  let sourceFunctionGrants;
  let sourceSchemaGrants;
  let authUsers;
  try {
    console.log(`Creating application-data backup from ${sourceContainer}...`);
    const dump = dockerExec(sourceContainer, [
      "pg_dump",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "--format=custom",
      "--schema=public",
      "--schema=owner_onboarding",
      "--no-owner",
      `--snapshot=${sourceSnapshot.snapshotId}`,
    ], { encoding: null });
    writeFileSync(dumpPath, dump);

    sourceTables = (
      await sourceSnapshot.scalar(
        "select string_agg(tablename, E'\\n' order by tablename) from pg_tables where schemaname = 'public'",
      )
    ).split("\n").filter(Boolean);
    for (const table of sourceTables) {
      const safeTable = `"${table.replaceAll('"', '""')}"`;
      sourceRowCounts.set(
        table,
        await sourceSnapshot.scalar(`select count(*) from public.${safeTable}`),
      );
    }
    sourcePolicyCount = await sourceSnapshot.scalar(
      "select count(*) from pg_policies where schemaname = 'public'",
    );
    sourceFunctionCount = await sourceSnapshot.scalar(
      "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'",
    );

    sourcePrivateFunctionCount = await sourceSnapshot.scalar("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='owner_onboarding'");
    sourceFunctionGrants = await sourceSnapshot.scalar(functionGrantsSql);
    sourceSchemaGrants = await sourceSnapshot.scalar(schemaGrantsSql);

    // Public profile and membership rows reference auth.users. A disposable
    // drill only needs stable identities; managed Supabase restores the complete
    // auth schema and credentials through its own backup/PITR process.
    authUsers = await sourceSnapshot.scalar(
      `select string_agg(format(
        'insert into auth.users (id, email, aud, role, created_at, updated_at) values (%L::uuid, %L, %L, %L, %L::timestamptz, %L::timestamptz) on conflict (id) do nothing;',
        id::text,
        email,
        coalesce(aud, 'authenticated'),
        coalesce(role, 'authenticated'),
        created_at::text,
        updated_at::text
      ), E'\\n' order by id) from auth.users`,
    );
  } finally {
    await sourceSnapshot.close();
  }
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
      "--exit-on-error",
      "/tmp/public.dump",
    ]);
  }

  const restoredTables = query(
    targetContainer,
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  ).split("\n").filter(Boolean);
  assertEqual("public table inventory", sourceTables.join(","), restoredTables.join(","));

  for (const table of sourceTables) {
    const safeTable = `"${table.replaceAll('"', '""')}"`;
    assertEqual(
      `${table} row count`,
      sourceRowCounts.get(table),
      query(targetContainer, `select count(*) from public.${safeTable}`),
    );
  }

  assertEqual(
    "public RLS policy count",
    sourcePolicyCount,
    query(targetContainer, "select count(*) from pg_policies where schemaname = 'public'"),
  );
  assertEqual(
    "public function count",
    sourceFunctionCount,
    query(targetContainer, "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'"),
  );

  assertEqual("private owner onboarding function count", sourcePrivateFunctionCount,
    query(targetContainer, "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='owner_onboarding'"));
  assertEqual("application API function execution grants", sourceFunctionGrants, query(targetContainer, functionGrantsSql));
  assertEqual("application API schema grants", sourceSchemaGrants, query(targetContainer, schemaGrantsSql));

  console.log(
    `Restore verified: ${sourceTables.length} tables, all row counts, RLS policies, and functions match.`,
  );
} finally {
  removeTarget();
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
