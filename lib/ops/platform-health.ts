import type { SupabaseClient } from "@supabase/supabase-js";

import { productionReadiness } from "./production-readiness.ts";
import { releaseId } from "./release-id.ts";
import {
  EXPECTED_SCHEMA_VERSION,
  schemaVersionIsCompatible,
} from "./schema-version.ts";

export const JOB_HEARTBEAT_MAX_AGE_MS = 15 * 60 * 1000;

export type ServiceHeartbeatStatus =
  | "ready"
  | "missing"
  | "stale"
  | "release_mismatch"
  | "release_unavailable";

export type PlatformHealthSnapshot = {
  ok: boolean;
  checks: {
    database: "ready" | "unavailable" | "not_configured";
    database_schema: "ready" | "outdated" | "unavailable";
    configuration: "ready" | "incomplete" | "not_enforced";
  };
  configuration_issue_count: number;
  latency_ms: number;
  timestamp: string;
  release: string | null;
  schema: {
    actual: string | null;
    expected: string;
  };
  services: {
    jobs: {
      status: ServiceHeartbeatStatus;
      release: string | null;
      last_success_at: string | null;
    };
  };
};

export function evaluateServiceHeartbeat(
  currentRelease: string | null,
  heartbeat: { release?: string | null; last_success_at?: string | null } | null,
  now = new Date(),
): ServiceHeartbeatStatus {
  if (!currentRelease) return "release_unavailable";
  if (!heartbeat?.release || !heartbeat.last_success_at) return "missing";
  if (!currentRelease.startsWith(heartbeat.release) && !heartbeat.release.startsWith(currentRelease)) {
    return "release_mismatch";
  }
  const heartbeatTime = Date.parse(heartbeat.last_success_at);
  if (
    !Number.isFinite(heartbeatTime) ||
    heartbeatTime > now.getTime() + 60_000 ||
    now.getTime() - heartbeatTime > JOB_HEARTBEAT_MAX_AGE_MS
  ) {
    return "stale";
  }
  return "ready";
}

export async function loadPlatformHealth(
  admin: SupabaseClient | null,
  options: {
    env?: Record<string, string | undefined>;
    now?: Date;
  } = {},
): Promise<PlatformHealthSnapshot> {
  const startedAt = Date.now();
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const readiness = productionReadiness(env);
  const configurationReady = !readiness.enforced || readiness.ready;
  const release = releaseId(env);

  if (!admin) {
    return {
      ok: false,
      checks: {
        database: "not_configured",
        database_schema: "unavailable",
        configuration: configurationReady ? "ready" : "incomplete",
      },
      configuration_issue_count: readiness.enforced ? readiness.issues.length : 0,
      latency_ms: Date.now() - startedAt,
      timestamp: now.toISOString(),
      release,
      schema: { actual: null, expected: EXPECTED_SCHEMA_VERSION },
      services: {
        jobs: {
          status: evaluateServiceHeartbeat(release, null, now),
          release: null,
          last_success_at: null,
        },
      },
    };
  }

  const [databaseResult, schemaResult, jobsResult] = await Promise.all([
    admin
      .from("integration_providers")
      .select("id", { head: true, count: "exact" })
      .limit(1),
    admin
      .from("platform_schema_state")
      .select("current_migration")
      .eq("singleton", true)
      .maybeSingle(),
    admin
      .from("platform_service_heartbeats")
      .select("release, last_success_at")
      .eq("service_key", "jobs")
      .maybeSingle(),
  ]);
  const actualSchema = schemaResult.data?.current_migration ?? null;
  const schemaReady =
    !schemaResult.error &&
    schemaVersionIsCompatible(actualSchema, EXPECTED_SCHEMA_VERSION);
  const jobsHeartbeat = jobsResult.data
    ? {
        release: jobsResult.data.release as string | null,
        last_success_at: jobsResult.data.last_success_at as string | null,
      }
    : null;

  return {
    ok: !databaseResult.error && schemaReady && configurationReady,
    checks: {
      database: databaseResult.error ? "unavailable" : "ready",
      database_schema: schemaReady ? "ready" : "outdated",
      configuration: readiness.enforced
        ? readiness.ready
          ? "ready"
          : "incomplete"
        : "not_enforced",
    },
    configuration_issue_count: readiness.enforced ? readiness.issues.length : 0,
    latency_ms: Date.now() - startedAt,
    timestamp: now.toISOString(),
    release,
    schema: { actual: actualSchema, expected: EXPECTED_SCHEMA_VERSION },
    services: {
      jobs: {
        status: evaluateServiceHeartbeat(release, jobsHeartbeat, now),
        release: jobsHeartbeat?.release ?? null,
        last_success_at: jobsHeartbeat?.last_success_at ?? null,
      },
    },
  };
}
