import assert from "node:assert/strict";
import test from "node:test";

import { normalizeConnectorWorkerRelease } from "../lib/integrations/connector-worker-heartbeat.ts";

test("connector worker heartbeat accepts only Git release identifiers", () => {
  assert.equal(
    normalizeConnectorWorkerRelease(" ABCDEF1234567890 "),
    "abcdef1234567890",
  );
  assert.equal(normalizeConnectorWorkerRelease("main"), null);
  assert.equal(normalizeConnectorWorkerRelease("abcdef"), null);
  assert.equal(normalizeConnectorWorkerRelease(undefined), null);
});
