import assert from "node:assert/strict";
import test from "node:test";

import { runJobs } from "../deploy/run-jobs.mjs";

test("job runner authenticates one production scheduler request", async (t) => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; authorization: string | null } | null = null;
  globalThis.fetch = (async (input, init) => {
    request = {
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
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
  });

  assert.deepEqual(result, { retried: 2 });
  assert.deepEqual(request, {
    url: "https://app.example.com/api/jobs/run",
    authorization: "Bearer scheduler-secret",
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
