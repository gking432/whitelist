const appUrl = String(process.env.NORTHSTAR_APP_URL || "").replace(/\/$/, "");
const secret = process.env.CRON_SECRET || "";

if (!appUrl.startsWith("https://") || !secret) {
  throw new Error("NORTHSTAR_APP_URL and CRON_SECRET are required.");
}

const response = await fetch(`${appUrl}/api/jobs/run`, {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
  signal: AbortSignal.timeout(55_000),
});

if (!response.ok) {
  throw new Error(`Northstar job run failed (${response.status}).`);
}

const result = await response.json();
console.log(JSON.stringify({ ok: true, result }));
