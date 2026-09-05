import assert from "node:assert/strict";
import test from "node:test";

import {
  connectorTaskRetryDelayMinutes,
  connectorTaskStaleBefore,
} from "../lib/integrations/connector-task-runner.ts";

test("connector worker retries use bounded exponential delays", () => {
  assert.equal(connectorTaskRetryDelayMinutes(1), 1);
  assert.equal(connectorTaskRetryDelayMinutes(2), 2);
  assert.equal(connectorTaskRetryDelayMinutes(3), 4);
  assert.equal(connectorTaskRetryDelayMinutes(20), 60);
});

test("connector worker stale cutoff uses the lease duration", () => {
  assert.equal(
    connectorTaskStaleBefore(new Date("2026-08-12T12:00:00.000Z"), 30),
    "2026-08-12T11:30:00.000Z",
  );
});
