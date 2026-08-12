import { spawnSync } from "node:child_process";

import WebSocket from "ws";

const jobsImage = "northstar-jobs-verify";
const voiceImage = "northstar-voice-verify";
const connectorWorkerImage = "northstar-connector-worker-verify";
const voiceContainer = `northstar-voice-smoke-${process.pid}`;
const releaseSha = "1234567890abcdef1234567890abcdef12345678";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    const detail = options.capture
      ? `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
      : "";
    throw new Error(
      `${command} ${args.join(" ")} failed${detail ? `:\n${detail}` : "."}`,
    );
  }
  return result.stdout?.trim() ?? "";
}

function cleanup() {
  spawnSync("docker", ["rm", "--force", voiceContainer], { stdio: "ignore" });
  for (const image of [jobsImage, voiceImage, connectorWorkerImage]) {
    spawnSync("docker", ["image", "rm", "--force", image], {
      stdio: "ignore",
    });
  }
}

function verifyCommand(image, expected) {
  const command = run(
    "docker",
    ["image", "inspect", "--format", "{{json .Config.Cmd}}", image],
    { capture: true },
  );
  if (command !== JSON.stringify(expected)) {
    throw new Error(`${image} has unexpected command ${command}.`);
  }
}

async function waitForVoiceHealth(url) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      const health = await response.json();
      if (
        response.ok &&
        health.ok === true &&
        health.release === releaseSha
      ) {
        return;
      }
    } catch {
      // Container startup can take a moment on a cold Docker daemon.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const logs = run("docker", ["logs", voiceContainer], { capture: true });
  throw new Error(`Voice image did not become healthy.\n${logs}`);
}

async function verifyUnauthorizedStream(url) {
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(url.replace("http://", "ws://") + "/twilio");
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("Voice stream did not reject an unauthorized session."));
    }, 5_000);

    socket.once("open", () => {
      socket.send(
        JSON.stringify({
          event: "start",
          start: {
            customParameters: {
              callSessionId: "release-check",
              streamToken: "invalid",
            },
          },
        }),
      );
    });
    socket.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 1008) resolve();
      else
        reject(new Error(`Voice stream closed with unexpected code ${code}.`));
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

try {
  run("docker", [
    "build",
    "--file",
    "deploy/jobs.Dockerfile",
    "--tag",
    jobsImage,
    ".",
  ]);
  verifyCommand(jobsImage, ["node", "run-jobs.mjs"]);

  const missingConfig = spawnSync("docker", ["run", "--rm", jobsImage], {
    encoding: "utf8",
    stdio: "pipe",
  });
  const configOutput = `${missingConfig.stdout ?? ""}${missingConfig.stderr ?? ""}`;
  if (
    missingConfig.status === 0 ||
    !configOutput.includes("NORTHSTAR_APP_URL and CRON_SECRET are required")
  ) {
    throw new Error(
      "Jobs image did not enforce its required runtime configuration.",
    );
  }

  run("docker", [
    "build",
    "--file",
    "deploy/connector-worker.Dockerfile",
    "--tag",
    connectorWorkerImage,
    ".",
  ]);
  verifyCommand(connectorWorkerImage, [
    "node",
    "--experimental-strip-types",
    "services/connector-worker/worker.ts",
  ]);
  const missingWorkerConfig = spawnSync(
    "docker",
    ["run", "--rm", connectorWorkerImage],
    { encoding: "utf8", stdio: "pipe" },
  );
  const workerConfigOutput = `${missingWorkerConfig.stdout ?? ""}${missingWorkerConfig.stderr ?? ""}`;
  if (
    missingWorkerConfig.status === 0 ||
    !workerConfigOutput.includes(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required",
    )
  ) {
    throw new Error(
      "Connector-worker image did not enforce its required data configuration.",
    );
  }
  const workerStartup = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--env",
      "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:1",
      "--env",
      "SUPABASE_SERVICE_ROLE_KEY=release-check-service-key",
      "--env",
      "ENABLE_CODEX_CONNECTOR_WORKER=true",
      "--env",
      "CODEX_CONNECTOR_WORKSPACE_PATH=/workspace",
      "--env",
      "CODEX_CONNECTOR_WORKTREE_ROOT=/worktrees",
      "--env",
      "CONNECTOR_WORKER_ONCE=true",
      "--volume",
      `${process.cwd()}:/workspace`,
      "--tmpfs",
      "/worktrees:rw,uid=1000,gid=1000",
      connectorWorkerImage,
    ],
    { encoding: "utf8", stdio: "pipe" },
  );
  const workerStartupOutput = `${workerStartup.stdout ?? ""}${workerStartup.stderr ?? ""}`;
  if (
    workerStartup.status === 0 ||
    !workerStartupOutput.includes("connector_worker.started") ||
    !workerStartupOutput.includes("connector_worker.error") ||
    workerStartupOutput.includes("ERR_PACKAGE_PATH_NOT_EXPORTED") ||
    workerStartupOutput.includes("ERR_MODULE_NOT_FOUND")
  ) {
    throw new Error(
      `Connector-worker image did not reach its controlled runtime failure.\n${workerStartupOutput}`,
    );
  }

  run("docker", [
    "build",
    "--file",
    "services/voice-stream/Dockerfile",
    "--tag",
    voiceImage,
    ".",
  ]);
  verifyCommand(voiceImage, ["node", "server.cjs"]);
  run("docker", [
    "run",
    "--detach",
    "--name",
    voiceContainer,
    "--publish",
    "127.0.0.1::8081",
    "--env",
    "NORTHSTAR_APP_URL=https://release-check.example.test",
    "--env",
    "OPENAI_API_KEY=release-check-only",
    "--env",
    "VOICE_STREAM_SHARED_SECRET=release-check-shared-secret",
    "--env",
    `RELEASE_SHA=${releaseSha}`,
    voiceImage,
  ]);

  const binding = run("docker", ["port", voiceContainer, "8081/tcp"], {
    capture: true,
  });
  const port = binding.match(/:(\d+)$/)?.[1];
  if (!port)
    throw new Error(
      `Could not parse the voice container port from ${binding}.`,
    );
  const voiceUrl = `http://127.0.0.1:${port}`;
  await waitForVoiceHealth(voiceUrl);
  await verifyUnauthorizedStream(voiceUrl);

  console.log(
    "Service images verified: scheduler configuration, connector-worker startup, and voice release/health/authentication contracts pass.",
  );
} finally {
  cleanup();
}
