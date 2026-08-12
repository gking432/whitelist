import assert from "node:assert/strict";
import test from "node:test";

import { configuredConnectorWorkerPaths } from "../lib/integrations/connector-worker-config.ts";

test("connector worker configuration requires enabled absolute paths", () => {
  assert.equal(configuredConnectorWorkerPaths({}), null);
  assert.equal(
    configuredConnectorWorkerPaths({
      ENABLE_CODEX_CONNECTOR_WORKER: "true",
      CODEX_CONNECTOR_WORKSPACE_PATH: "relative/repository",
      CODEX_CONNECTOR_WORKTREE_ROOT: "/worktrees",
    }),
    null,
  );
  assert.deepEqual(
    configuredConnectorWorkerPaths({
      ENABLE_CODEX_CONNECTOR_WORKER: "true",
      CODEX_CONNECTOR_WORKSPACE_PATH: "/workspace",
      CODEX_CONNECTOR_WORKTREE_ROOT: "/worktrees",
    }),
    { workspace: "/workspace", worktreeRoot: "/worktrees" },
  );
});
