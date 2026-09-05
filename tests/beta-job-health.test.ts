import assert from "node:assert/strict";
import test from "node:test";
import { summarizeJobResults } from "../lib/jobs/health.ts";

test("one failed queue must not produce an all-healthy scheduler heartbeat", () => {
  assert.equal(
    summarizeJobResults([
      ["delivery", { status: "fulfilled", value: { failed: 0 } }],
      ["inbound", { status: "fulfilled", value: { failed: 1 } }],
    ]).ok,
    false,
  );
});
test("worker rejection keeps independent results and does not expose raw error details", () => {
  const result = summarizeJobResults([
    ["delivery", { status: "fulfilled", value: { succeeded: 2 } }],
    [
      "retention",
      { status: "rejected", reason: new Error("secret diagnostic") },
    ],
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.workers.delivery, { succeeded: 2 });
  assert.equal(JSON.stringify(result).includes("secret diagnostic"), false);
});
