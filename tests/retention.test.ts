import assert from "node:assert/strict";
import test from "node:test";

import {
  operationalRetentionPolicy,
  runOperationalRetention,
} from "../lib/jobs/retention.ts";

const NOW = Date.parse("2026-08-11T12:00:00.000Z");

test("operational retention defaults to 90 days and clamps unsafe values", () => {
  assert.equal(operationalRetentionPolicy(undefined, NOW).retentionDays, 90);
  assert.equal(operationalRetentionPolicy("2", NOW).retentionDays, 30);
  assert.equal(operationalRetentionPolicy("900", NOW).retentionDays, 365);
  assert.equal(operationalRetentionPolicy("invalid", NOW).retentionDays, 90);
});

test("operational retention uses narrow tables, statuses, and cutoffs", async () => {
  const calls: Array<{ table: string; operation: string; args: unknown[] }> = [];
  const resultFor = (count: number) => ({ error: null, count });

  const admin = {
    from(table: string) {
      calls.push({ table, operation: "from", args: [] });
      const chain = {
        delete(options: unknown) {
          calls.push({ table, operation: "delete", args: [options] });
          return chain;
        },
        in(column: string, values: string[]) {
          calls.push({ table, operation: "in", args: [column, values] });
          return chain;
        },
        lt(column: string, value: string) {
          calls.push({ table, operation: "lt", args: [column, value] });
          return Promise.resolve(resultFor(table.length));
        },
      };
      return chain;
    },
  };

  const previous = process.env.OPERATIONAL_RETENTION_DAYS;
  process.env.OPERATIONAL_RETENTION_DAYS = "90";

  try {
    const result = await runOperationalRetention(admin as never);
    assert.equal(result.ok, true);
    assert.equal(result.retentionDays, 90);
  } finally {
    if (previous === undefined) delete process.env.OPERATIONAL_RETENTION_DAYS;
    else process.env.OPERATIONAL_RETENTION_DAYS = previous;
  }

  assert.deepEqual(
    calls.filter((call) => call.operation === "from").map((call) => call.table),
    [
      "api_rate_limit_windows",
      "client_connection_setup_sessions",
      "integration_sync_jobs",
    ],
  );
  assert.deepEqual(
    calls.find((call) => call.operation === "in")?.args,
    ["status", ["succeeded", "cancelled"]],
  );
  assert.deepEqual(
    calls.filter((call) => call.operation === "lt").map((call) => call.args[0]),
    ["window_started_at", "expires_at", "completed_at"],
  );
});
