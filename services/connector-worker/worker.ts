import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import { createClient } from "@supabase/supabase-js";

import { codexConnectorWorkerReady } from "../../lib/integrations/codex-worker.ts";
import {
  recordConnectorWorkerHeartbeat,
  resolveConnectorWorkerRelease,
} from "../../lib/integrations/connector-worker-heartbeat.ts";
import {
  configuredConnectorWorkerPaths,
  verifyConnectorWorkerWorkspace,
} from "../../lib/integrations/connector-worker-config.ts";
import {
  processNextConnectorTask,
  recoverStaleConnectorTasks,
} from "../../lib/integrations/connector-task-runner.ts";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
  );
}
if (!codexConnectorWorkerReady()) {
  throw new Error(
    "Enable the connector worker and configure its source checkout and worktree root.",
  );
}
const workerPaths = configuredConnectorWorkerPaths();
if (!workerPaths) {
  throw new Error("The connector worker paths are invalid.");
}
const { repository } = await verifyConnectorWorkerWorkspace(workerPaths);
const workerRelease = await resolveConnectorWorkerRelease(repository);
if (!workerRelease) {
  throw new Error("The connector worker could not identify its source release.");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const workerId = `${hostname()}-${randomUUID().slice(0, 8)}`;
const pollMs = Math.max(
  2_000,
  Math.min(60_000, Number(process.env.CODEX_CONNECTOR_POLL_MS ?? 10_000)),
);
const runOnce = process.env.CONNECTOR_WORKER_ONCE === "true";
let stopping = false;
let heartbeatInFlight: Promise<void> | null = null;

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const publishHeartbeat = async () => {
  if (heartbeatInFlight) return heartbeatInFlight;
  heartbeatInFlight = recordConnectorWorkerHeartbeat(
    admin,
    workerRelease,
    workerId,
  ).finally(() => {
    heartbeatInFlight = null;
  });
  return heartbeatInFlight;
};

const serviceHeartbeat = setInterval(() => {
  void publishHeartbeat().catch((error) => {
    console.error(
      JSON.stringify({
        event: "connector_worker.heartbeat_failed",
        message:
          error instanceof Error ? error.message : "Worker heartbeat failed.",
      }),
    );
  });
}, 60_000);
serviceHeartbeat.unref();

console.log(
  JSON.stringify({
    event: "connector_worker.started",
    workerId,
    release: workerRelease,
  }),
);

while (!stopping) {
  try {
    await publishHeartbeat();
    const recovery = await recoverStaleConnectorTasks(admin);
    if (recovery.requeued || recovery.failed) {
      console.log(
        JSON.stringify({ event: "connector_worker.recovered", ...recovery }),
      );
    }

    const result = await processNextConnectorTask(admin, workerId);
    if (result.status !== "idle") {
      console.log(
        JSON.stringify({
          event: "connector_worker.result",
          status: result.status,
          taskId: "taskId" in result ? result.taskId : null,
        }),
      );
    }
    if (runOnce) break;
    if (result.status === "idle") await sleep(pollMs);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "connector_worker.error",
        message: error instanceof Error ? error.message : "Worker loop failed.",
      }),
    );
    if (runOnce) process.exitCode = 1;
    if (runOnce) break;
    await sleep(pollMs);
  }
}

clearInterval(serviceHeartbeat);
console.log(JSON.stringify({ event: "connector_worker.stopped", workerId }));
