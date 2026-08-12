import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateServiceHeartbeat,
  JOB_HEARTBEAT_MAX_AGE_MS,
} from "../lib/ops/platform-health.ts";

const release = "abcdef1234567890";
const now = new Date("2026-08-12T12:00:00.000Z");

test("service heartbeat requires the deployed release and a recent success", () => {
  assert.equal(
    evaluateServiceHeartbeat(
      release,
      { release, last_success_at: "2026-08-12T11:55:00.000Z" },
      now,
    ),
    "ready",
  );
  assert.equal(
    evaluateServiceHeartbeat(
      release,
      { release: "1234567", last_success_at: "2026-08-12T11:55:00.000Z" },
      now,
    ),
    "release_mismatch",
  );
});

test("service heartbeat rejects missing, stale, and future evidence", () => {
  assert.equal(evaluateServiceHeartbeat(release, null, now), "missing");
  assert.equal(
    evaluateServiceHeartbeat(
      release,
      {
        release,
        last_success_at: new Date(
          now.getTime() - JOB_HEARTBEAT_MAX_AGE_MS - 1,
        ).toISOString(),
      },
      now,
    ),
    "stale",
  );
  assert.equal(
    evaluateServiceHeartbeat(
      release,
      { release, last_success_at: "2026-08-12T12:02:00.000Z" },
      now,
    ),
    "stale",
  );
  assert.equal(evaluateServiceHeartbeat(null, null, now), "release_unavailable");
});
