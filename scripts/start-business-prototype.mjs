import { spawn } from "node:child_process";
import { createRequire } from "node:module";

// One local command starts the UI and only the new internal business scheduler.
// It does not drain the existing external-message or purchase execution queues.
process.loadEnvFile(".env.local");
const localUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!localUrl || !["localhost", "127.0.0.1"].includes(new URL(localUrl).hostname)) {
  throw new Error("The prototype launcher requires .env.local pointing at local Supabase.");
}
const require = createRequire(import.meta.url);
const env = { ...process.env, APP_URL: "http://localhost:3210" };
const children = [
  spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3210"], { env, stdio: "inherit" }),
  spawn(process.execPath, ["--import", "tsx", "scripts/run-business-schedules.ts"], { env, stdio: "inherit" }),
];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
}
for (const child of children) {
  child.on("error", () => { console.error("A prototype process could not start."); stop(1); });
  child.on("exit", code => { if (!stopping) stop(code ?? 1); });
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
