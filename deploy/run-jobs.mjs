import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function runJobs(env = process.env) {
  const appUrl = String(env.NORTHSTAR_APP_URL || "").replace(/\/$/, "");
  const secret = env.CRON_SECRET || "";
  const rawRelease = String(
    env.RENDER_GIT_COMMIT || env.GITHUB_SHA || env.RELEASE_SHA || "",
  ).trim().toLowerCase();
  const release = /^[a-f0-9]{7,64}$/.test(rawRelease) ? rawRelease : null;

  if (!appUrl.startsWith("https://") || !secret) {
    throw new Error("NORTHSTAR_APP_URL and CRON_SECRET are required.");
  }

  const response = await fetch(`${appUrl}/api/jobs/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(release ? { "X-Northstar-Scheduler-Release": release } : {}),
    },
    signal: AbortSignal.timeout(330_000),
  });

  if (!response.ok) {
    throw new Error(`Northstar job run failed (${response.status}).`);
  }

  return response.json();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = await runJobs();
  console.log(JSON.stringify({ ok: true, result }));
}
