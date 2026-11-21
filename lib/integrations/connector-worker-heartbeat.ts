import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { SupabaseClient } from "@supabase/supabase-js";

import { releaseId } from "../ops/release-id.ts";

const execFileAsync = promisify(execFile);

export function normalizeConnectorWorkerRelease(
  value: string | null | undefined,
) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^[a-f0-9]{7,64}$/.test(normalized) ? normalized : null;
}

export async function resolveConnectorWorkerRelease(
  repository: string,
  env: Record<string, string | undefined> = process.env,
) {
  const configured = releaseId(env);
  if (configured) return configured;

  const { stdout } = await execFileAsync("git", [
    "-c",
    `safe.directory=${repository}`,
    "-C",
    repository,
    "rev-parse",
    "HEAD",
  ]);
  return normalizeConnectorWorkerRelease(stdout);
}

export async function recordConnectorWorkerHeartbeat(
  admin: SupabaseClient,
  release: string,
  workerId: string,
) {
  const { error } = await admin.from("platform_service_heartbeats").upsert(
    {
      service_key: "connector_worker",
      release,
      instance_id: workerId,
      last_success_at: new Date().toISOString(),
    },
    { onConflict: "service_key" },
  );
  if (error) {
    throw new Error(
      `Connector-worker heartbeat could not be stored: ${error.message}`,
    );
  }
}
