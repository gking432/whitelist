import assert from "node:assert/strict";
import test from "node:test";

import type { PlatformHealthSnapshot } from "../lib/ops/platform-health.ts";
import { runtimeActivationFromEvidence } from "../lib/ops/runtime-activation.ts";

function health(
  jobStatus: PlatformHealthSnapshot["services"]["jobs"]["status"] = "ready",
): PlatformHealthSnapshot {
  return {
    ok: true,
    checks: {
      database: "ready",
      database_schema: "ready",
      configuration: "ready",
    },
    configuration_issue_count: 0,
    latency_ms: 12,
    timestamp: "2026-08-12T12:00:00.000Z",
    release: "abcdef1234567890",
    schema: {
      actual: "20260812080000_guard_real_provider_pilot_evidence",
      expected: "20260812080000_guard_real_provider_pilot_evidence",
    },
    services: {
      jobs: {
        status: jobStatus,
        release: "abcdef1234567890",
        last_success_at: "2026-08-12T11:55:00.000Z",
      },
    },
  };
}

test("runtime activation proves required services independently of provider pilots", () => {
  const result = runtimeActivationFromEvidence({
    health: health(),
    activeOwnerCount: 1,
    ownerLookupFailed: false,
    passedPilotCount: 0,
    liveProviderCount: 0,
    pilotLookupFailed: false,
    voice: { reachable: true, release: "abcdef1234567890" },
  });
  assert.equal(result.ready, true);
  assert.equal(result.complete, result.total);
  assert.equal(
    result.items.find((item) => item.key === "provider_pilots_runtime")?.state,
    "waiting",
  );
});

test("runtime activation blocks stale jobs, missing owner, and mismatched voice", () => {
  const result = runtimeActivationFromEvidence({
    health: health("stale"),
    activeOwnerCount: 0,
    ownerLookupFailed: false,
    passedPilotCount: 1,
    liveProviderCount: 1,
    pilotLookupFailed: false,
    voice: { reachable: true, release: "1234567" },
  });
  assert.equal(result.ready, false);
  assert.equal(
    result.items.find((item) => item.key === "jobs_runtime")?.state,
    "attention",
  );
  assert.equal(
    result.items.find((item) => item.key === "platform_owner_runtime")?.state,
    "attention",
  );
  assert.equal(
    result.items.find((item) => item.key === "voice_runtime")?.state,
    "attention",
  );
});

test("runtime activation flags inconsistent provider promotion evidence", () => {
  const result = runtimeActivationFromEvidence({
    health: health(),
    activeOwnerCount: 1,
    ownerLookupFailed: false,
    passedPilotCount: 1,
    liveProviderCount: 0,
    pilotLookupFailed: false,
    voice: { reachable: true, release: "abcdef1234567890" },
  });
  assert.equal(
    result.items.find((item) => item.key === "provider_pilots_runtime")?.state,
    "attention",
  );
});
