import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeVoiceStreamUrl } from "../voice/stream-url.ts";
import {
  loadPlatformHealth,
  type PlatformHealthSnapshot,
} from "./platform-health.ts";

export type RuntimeActivationState = "ready" | "attention" | "waiting";

export type RuntimeActivationItem = {
  key: string;
  label: string;
  purpose: string;
  state: RuntimeActivationState;
  required: boolean;
  detail: string;
};

export type RuntimeActivation = {
  ready: boolean;
  complete: number;
  total: number;
  checkedAt: string;
  items: RuntimeActivationItem[];
};

type RuntimeEvidence = {
  health: PlatformHealthSnapshot;
  activeOwnerCount: number;
  ownerLookupFailed: boolean;
  passedPilotCount: number;
  liveProviderCount: number;
  pilotLookupFailed: boolean;
  voice: {
    reachable: boolean;
    release: string | null;
    detail?: string;
  };
};

function displayRelease(value: string | null) {
  return value ? value.slice(0, 12) : "unknown";
}

export function runtimeActivationFromEvidence(
  evidence: RuntimeEvidence,
): RuntimeActivation {
  const { health } = evidence;
  const jobsState = health.services.jobs.status;
  const connectorWorkerState = health.services.connector_worker.status;
  const jobsDetail = {
    ready: `Scheduler is current on release ${displayRelease(health.services.jobs.release)}; last successful run ${health.services.jobs.last_success_at ? new Date(health.services.jobs.last_success_at).toLocaleString() : "unknown"}.`,
    missing: "No successful scheduler heartbeat has been recorded for this deployment.",
    stale: `The last scheduler success is older than 15 minutes (${health.services.jobs.last_success_at ? new Date(health.services.jobs.last_success_at).toLocaleString() : "unknown"}).`,
    release_mismatch: `Scheduler release ${displayRelease(health.services.jobs.release)} does not match web release ${displayRelease(health.release)}.`,
    release_unavailable: "The web release identifier is unavailable. This check becomes authoritative after deployment.",
  }[jobsState];
  const voiceReleaseMatches = Boolean(
    health.release &&
      evidence.voice.release &&
      (health.release.startsWith(evidence.voice.release) ||
        evidence.voice.release.startsWith(health.release)),
  );
  const voiceReady = evidence.voice.reachable && voiceReleaseMatches;
  const connectorWorkerDetail = {
    ready: `Trusted connector worker is current on release ${displayRelease(health.services.connector_worker.release)}; last heartbeat ${health.services.connector_worker.last_success_at ? new Date(health.services.connector_worker.last_success_at).toLocaleString() : "unknown"}.`,
    missing: "No trusted connector-worker heartbeat has been recorded for this deployment.",
    stale: `The trusted connector worker has not checked in during the last 3 minutes (${health.services.connector_worker.last_success_at ? new Date(health.services.connector_worker.last_success_at).toLocaleString() : "unknown"}).`,
    release_mismatch: `Connector-worker release ${displayRelease(health.services.connector_worker.release)} does not match web release ${displayRelease(health.release)}.`,
    release_unavailable: "The web release identifier is unavailable. This check becomes authoritative after deployment.",
  }[connectorWorkerState];
  const pilotState: RuntimeActivationState = evidence.pilotLookupFailed
    ? "attention"
    : evidence.passedPilotCount === 0 && evidence.liveProviderCount === 0
      ? "waiting"
      : evidence.passedPilotCount > 0 && evidence.liveProviderCount > 0
        ? "ready"
        : "attention";
  const items: RuntimeActivationItem[] = [
    {
      key: "database_runtime",
      label: "Production database",
      purpose: "Proves the deployed server can read the production data service.",
      state: health.checks.database === "ready" ? "ready" : "attention",
      required: true,
      detail:
        health.checks.database === "ready"
          ? `Database responded in ${health.latency_ms} ms.`
          : "The deployed server cannot reach the configured database.",
    },
    {
      key: "schema_runtime",
      label: "Database migrations",
      purpose: "Proves production is running the schema required by this release.",
      state: health.checks.database_schema === "ready" ? "ready" : "attention",
      required: true,
      detail:
        health.checks.database_schema === "ready"
          ? `Schema ${health.schema.actual ?? "unknown"} satisfies this release.`
          : `Production schema ${health.schema.actual ?? "unknown"} must reach ${health.schema.expected}.`,
    },
    {
      key: "platform_owner_runtime",
      label: "Platform owner access",
      purpose: "Ensures at least one active owner can operate escalations and production releases.",
      state:
        !evidence.ownerLookupFailed && evidence.activeOwnerCount > 0
          ? "ready"
          : "attention",
      required: true,
      detail: evidence.ownerLookupFailed
        ? "Owner membership could not be verified."
        : evidence.activeOwnerCount > 0
          ? `${evidence.activeOwnerCount} active platform owner${evidence.activeOwnerCount === 1 ? "" : "s"} verified.`
          : "No active platform owner exists. Run the guarded owner bootstrap procedure.",
    },
    {
      key: "jobs_runtime",
      label: "Background scheduler",
      purpose: "Proves retries, notifications, connector sync, and cleanup are running on the deployed release.",
      state:
        jobsState === "ready"
          ? "ready"
          : jobsState === "release_unavailable"
            ? "waiting"
            : "attention",
      required: true,
      detail: jobsDetail,
    },
    {
      key: "voice_runtime",
      label: "Voice gateway",
      purpose: "Proves live call streaming and staff-assist transcription are running on the deployed release.",
      state: voiceReady
        ? "ready"
        : health.release
          ? "attention"
          : "waiting",
      required: true,
      detail: voiceReady
        ? `Voice gateway is healthy on release ${displayRelease(evidence.voice.release)}.`
        : evidence.voice.detail ??
          (evidence.voice.reachable
            ? `Voice release ${displayRelease(evidence.voice.release)} does not match web release ${displayRelease(health.release)}.`
            : "The voice gateway did not return a healthy response."),
    },
    {
      key: "connector_worker_runtime",
      label: "Codex connector worker",
      purpose: "Proves approved connector requests have an isolated trusted processor outside the public application.",
      state:
        connectorWorkerState === "ready"
          ? "ready"
          : connectorWorkerState === "release_unavailable"
            ? "waiting"
            : "attention",
      required: true,
      detail: connectorWorkerDetail,
    },
    {
      key: "provider_pilots_runtime",
      label: "Real-account provider pilots",
      purpose: "Tracks which connector contracts have passed a real managed-client pilot.",
      state: pilotState,
      required: false,
      detail: evidence.pilotLookupFailed
        ? "Provider pilot evidence could not be loaded."
        : pilotState === "attention"
          ? `Pilot state is inconsistent: ${evidence.passedPilotCount} passed and ${evidence.liveProviderCount} live verified. Review provider evidence before rollout.`
          : evidence.passedPilotCount > 0
          ? `${evidence.passedPilotCount} passed pilot${evidence.passedPilotCount === 1 ? "" : "s"}; ${evidence.liveProviderCount} provider${evidence.liveProviderCount === 1 ? "" : "s"} live verified.`
          : "No real-account provider pilot has passed yet. Start with the first managed client after hosting is active.",
    },
  ];
  const required = items.filter((item) => item.required);
  const complete = required.filter((item) => item.state === "ready").length;
  return {
    ready: complete === required.length,
    complete,
    total: required.length,
    checkedAt: health.timestamp,
    items,
  };
}

function voiceHealthUrl(input: string | undefined) {
  const normalized = normalizeVoiceStreamUrl(input);
  if (!normalized) return null;
  const url = new URL(normalized);
  if (url.protocol !== "wss:") return null;
  url.protocol = "https:";
  url.pathname = "/health";
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function loadVoiceEvidence(
  env: Record<string, string | undefined>,
  fetcher: typeof fetch,
) {
  const url = voiceHealthUrl(env.NORTHSTAR_VOICE_STREAM_URL);
  if (!url) {
    return { reachable: false, release: null, detail: "A public WSS voice gateway is not configured." };
  }
  try {
    const response = await fetcher(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const payload = (await response.json()) as { ok?: boolean; release?: string | null };
    return {
      reachable: response.ok && payload.ok === true,
      release: payload.release ?? null,
      detail:
        response.ok && payload.ok === true
          ? undefined
          : `Voice health returned HTTP ${response.status}.`,
    };
  } catch {
    return { reachable: false, release: null, detail: "The voice gateway health check could not be reached." };
  }
}

export async function loadRuntimeActivation(
  admin: SupabaseClient | null,
  options: {
    env?: Record<string, string | undefined>;
    now?: Date;
    fetcher?: typeof fetch;
  } = {},
): Promise<RuntimeActivation> {
  const env = options.env ?? process.env;
  const healthPromise = loadPlatformHealth(admin, { env, now: options.now });
  if (!admin) {
    const health = await healthPromise;
    return runtimeActivationFromEvidence({
      health,
      activeOwnerCount: 0,
      ownerLookupFailed: true,
      passedPilotCount: 0,
      liveProviderCount: 0,
      pilotLookupFailed: true,
      voice: await loadVoiceEvidence(env, options.fetcher ?? fetch),
    });
  }

  const [health, ownerResult, pilotResult, providerResult, voice] = await Promise.all([
    healthPromise,
    admin
      .from("memberships")
      .select("id", { head: true, count: "exact" })
      .eq("role", "platform_owner")
      .eq("status", "active"),
    admin
      .from("provider_live_pilots")
      .select("id", { head: true, count: "exact" })
      .eq("status", "passed"),
    admin
      .from("integration_providers")
      .select("id", { head: true, count: "exact" })
      .eq("connector_status", "live_verified"),
    loadVoiceEvidence(env, options.fetcher ?? fetch),
  ]);

  return runtimeActivationFromEvidence({
    health,
    activeOwnerCount: ownerResult.count ?? 0,
    ownerLookupFailed: Boolean(ownerResult.error),
    passedPilotCount: pilotResult.count ?? 0,
    liveProviderCount: providerResult.count ?? 0,
    pilotLookupFailed: Boolean(pilotResult.error || providerResult.error),
    voice,
  });
}
