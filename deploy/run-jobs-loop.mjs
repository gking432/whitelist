import { runJobs } from "./run-jobs.mjs";

const intervalMs = Number(process.env.JOB_RUN_INTERVAL_MS ?? 300_000);
if (!Number.isInteger(intervalMs) || intervalMs < 60_000 || intervalMs > 3_600_000) {
  throw new Error("JOB_RUN_INTERVAL_MS must be between 60000 and 3600000.");
}

let stopping = false;
let wake = null;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    wake?.();
  });
}

while (!stopping) {
  try {
    const result = await runJobs();
    console.log(
      JSON.stringify({
        ok: true,
        completed_at: new Date().toISOString(),
        result,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        ok: false,
        failed_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown job runner failure",
      }),
    );
  }

  if (stopping) break;
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, intervalMs);
    wake = () => {
      clearTimeout(timeout);
      resolve();
    };
  });
  wake = null;
}
