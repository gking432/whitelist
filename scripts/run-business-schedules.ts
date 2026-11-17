import { createClient } from "@supabase/supabase-js";
import { processBusinessSchedules } from "../lib/business/scheduler";
import { processAgentWork, scheduleAgentReviews } from "../lib/agents/runner";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (
    !url ||
    !key ||
    !["localhost", "127.0.0.1"].includes(new URL(url).hostname)
  ) {
    throw new Error(
      "The prototype worker requires the local Supabase environment.",
    );
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  console.log(
    "Business worker ready. Enabled schedules and agent assignments will prepare internal work when due.",
  );
  for (;;) {
    const [business, agents] = await Promise.allSettled([
      processBusinessSchedules(admin, 5),
      (async () => {
        await scheduleAgentReviews(admin, 5);
        return processAgentWork(admin, 5);
      })(),
    ]);
    if (
      business.status === "fulfilled" &&
      (business.value.completed || business.value.failed)
    )
      console.log(JSON.stringify({ businessSchedules: business.value }));
    if (
      agents.status === "fulfilled" &&
      (agents.value.processed || agents.value.blocked)
    )
      console.log(JSON.stringify({ agentWork: agents.value }));
    if (business.status === "rejected" || agents.status === "rejected")
      console.error(
        "A business worker could not finish. Saved work will be checked again in one minute.",
      );
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Prototype worker failed",
  );
  process.exitCode = 1;
});
