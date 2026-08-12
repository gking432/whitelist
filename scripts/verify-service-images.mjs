import { spawnSync } from "node:child_process";

import WebSocket from "ws";

const jobsImage = "northstar-jobs-verify";
const voiceImage = "northstar-voice-verify";
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
  for (const image of [jobsImage, voiceImage]) {
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
    "Service images verified: scheduler configuration and voice release/health/authentication contracts pass.",
  );
} finally {
  cleanup();
}
