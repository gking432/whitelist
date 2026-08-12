import assert from "node:assert/strict";
import test from "node:test";

import { runJobs } from "../deploy/run-jobs.mjs";
import { normalizeSchedulerRelease } from "../lib/jobs/scheduler-heartbeat.ts";

test("scheduler release headers accept only bounded git identifiers", () => {
  assert.equal(normalizeSchedulerRelease("A".repeat(40)), "a".repeat(40));
  assert.equal(normalizeSchedulerRelease("not-a-sha"), null);
  assert.equal(normalizeSchedulerRelease(null), null);
});

test("job runner authenticates and identifies one production scheduler request", async (t) => {
  const originalFetch = globalThis.fetch;
  let request: {
    url: string;
    authorization: string | null;
    release: string | null;
  } | null = null;
  globalThis.fetch = (async (input, init) => {
    request = {
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
      release: new Headers(init?.headers).get("x-northstar-scheduler-release"),
    };
    return new Response(JSON.stringify({ retried: 2 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await runJobs({
    NORTHSTAR_APP_URL: "https://app.example.com/",
    CRON_SECRET: "scheduler-secret",
    RENDER_GIT_COMMIT: "a".repeat(40),
  });

  assert.deepEqual(result, { retried: 2 });
  assert.deepEqual(request, {
    url: "https://app.example.com/api/jobs/run",
    authorization: "Bearer scheduler-secret",
    release: "a".repeat(40),
  });
});

test("job runner rejects incomplete or unsuccessful invocations", async (t) => {
  await assert.rejects(runJobs({}), /NORTHSTAR_APP_URL and CRON_SECRET/);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    runJobs({
      NORTHSTAR_APP_URL: "https://app.example.com",
      CRON_SECRET: "scheduler-secret",
    }),
    /failed \(503\)/,
  );
});
