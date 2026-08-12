import { readFileSync, readdirSync } from "node:fs";

function fail(message) {
  throw new Error(`Release topology verification failed: ${message}`);
}

const render = readFileSync("render.yaml", "utf8");
const jobsDockerfile = readFileSync("deploy/jobs.Dockerfile", "utf8");
const jobsRunner = readFileSync("deploy/run-jobs.mjs", "utf8");
const jobsLoop = readFileSync("deploy/run-jobs-loop.mjs", "utf8");
const productionCompose = readFileSync("docker-compose.production.yml", "utf8");
const healthRoute = readFileSync("app/api/health/route.ts", "utf8");
const schemaVersionSource = readFileSync("lib/ops/schema-version.ts", "utf8");
const voiceDockerfile = readFileSync(
  "services/voice-stream/Dockerfile",
  "utf8",
);
const desktopWorkflow = readFileSync(
  ".github/workflows/desktop-release.yml",
  "utf8",
);
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

const requiredRenderFragments = [
  "name: northstar-app",
  "healthCheckPath: /api/health",
  "name: northstar-jobs",
  'schedule: "*/5 * * * *"',
  "dockerfilePath: ./deploy/jobs.Dockerfile",
  "envVarKey: CRON_SECRET",
  "name: northstar-voice-stream",
  "dockerfilePath: ./services/voice-stream/Dockerfile",
  "healthCheckPath: /health",
  "envVarKey: OPENAI_API_KEY",
  "envVarKey: VOICE_STREAM_SHARED_SECRET",
  "envVarKey: RENDER_EXTERNAL_URL",
  "key: REQUIRE_PRODUCTION_READINESS",
  'value: "true"',
];

for (const fragment of requiredRenderFragments) {
  if (!render.includes(fragment)) fail(`render.yaml lacks ${fragment}`);
}

if (!jobsDockerfile.includes('CMD ["node", "run-jobs.mjs"]')) {
  fail("job service does not execute the scheduler client");
}
for (const fragment of [
  "/api/jobs/run",
  "Authorization: `Bearer ${secret}`",
  "AbortSignal.timeout(55_000)",
  "export async function runJobs",
]) {
  if (!jobsRunner.includes(fragment)) fail(`job runner lacks ${fragment}`);
}

for (const fragment of [
  'import { runJobs } from "./run-jobs.mjs"',
  "JOB_RUN_INTERVAL_MS",
  "const timeout = setTimeout(resolve, intervalMs)",
  "clearTimeout(timeout)",
]) {
  if (!jobsLoop.includes(fragment)) fail(`persistent job runner lacks ${fragment}`);
}

for (const fragment of [
  "jobs:",
  "dockerfile: deploy/jobs.Dockerfile",
  'command: ["node", "run-jobs-loop.mjs"]',
  "NORTHSTAR_APP_URL: https://${APP_DOMAIN}",
  "NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL}",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}",
]) {
  if (!productionCompose.includes(fragment)) {
    fail(`docker-compose.production.yml lacks ${fragment}`);
  }
}

const migrations = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort();
const latestMigration = migrations.at(-1)?.replace(/\.sql$/, "");
const declaredSchemaVersion = schemaVersionSource.match(
  /EXPECTED_SCHEMA_VERSION\s*=\s*"([^"]+)"/,
)?.[1];
if (!latestMigration || declaredSchemaVersion !== latestMigration) {
  fail(
    `EXPECTED_SCHEMA_VERSION (${declaredSchemaVersion ?? "missing"}) does not match latest migration (${latestMigration ?? "missing"})`,
  );
}
const latestMigrationSource = latestMigration
  ? readFileSync(`supabase/migrations/${latestMigration}.sql`, "utf8")
  : "";
if (
  !latestMigrationSource.includes("platform_schema_state") ||
  !latestMigrationSource.includes(`'${declaredSchemaVersion}'`)
) {
  fail("latest migration does not advance platform_schema_state");
}
if (
  !healthRoute.includes("database_schema") ||
  !healthRoute.includes("EXPECTED_SCHEMA_VERSION")
) {
  fail("application health does not enforce the current database schema");
}

if (!voiceDockerfile.includes('CMD ["node", "server.cjs"]')) {
  fail("voice service does not execute its WebSocket server");
}

if ((render.match(/envVarKey: RENDER_EXTERNAL_URL/g) ?? []).length < 4) {
  fail("Render service URLs are not fully self-wired");
}

for (const fragment of [
  "runs-on: macos-14",
  "runs-on: windows-latest",
  "-c.forceCodeSigning=true",
  "npm run verify:desktop-bundle",
  "MAC_CSC_LINK",
  "WIN_CSC_LINK",
]) {
  if (!desktopWorkflow.includes(fragment)) {
    fail(`desktop release workflow lacks ${fragment}`);
  }
}

for (const script of [
  "verify:production-env",
  "verify:security",
  "verify:restore",
  "verify:desktop-bundle",
  "verify:release-journey",
  "verify:web-image",
  "verify:service-images",
  "verify:release-images",
  "verify:hosted",
  "bootstrap:owner",
]) {
  if (!packageJson.scripts?.[script])
    fail(`package script ${script} is missing`);
}

console.log(
  "Release topology verified: schema-aware web health, Render and self-hosted five-minute jobs, voice stream, production readiness, and signed desktop workflows are wired.",
);
