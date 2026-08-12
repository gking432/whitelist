import { readFileSync } from "node:fs";

function fail(message) {
  throw new Error(`Release topology verification failed: ${message}`);
}

const render = readFileSync("render.yaml", "utf8");
const jobsDockerfile = readFileSync("deploy/jobs.Dockerfile", "utf8");
const jobsRunner = readFileSync("deploy/run-jobs.mjs", "utf8");
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
]) {
  if (!jobsRunner.includes(fragment)) fail(`job runner lacks ${fragment}`);
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
  "verify:release-images",
]) {
  if (!packageJson.scripts?.[script])
    fail(`package script ${script} is missing`);
}

console.log(
  "Release topology verified: web health, five-minute jobs, voice stream, production readiness, and signed desktop workflows are wired.",
);
