import { pollEmbeddedInboxes, pollEmbeddedActionResults } from "@/lib/integrations/embedded/runtime";
import { produceNativeCrmLifecycleEvents } from "@/lib/crm/lifecycle";
import { NextResponse, type NextRequest } from "next/server";

import { summarizeJobResults } from "@/lib/jobs/health";
import { processPendingActionJobs } from "@/lib/jobs/runner";
import {
  normalizeSchedulerRelease,
  recordSchedulerHeartbeat,
} from "@/lib/jobs/scheduler-heartbeat";
import { runOperationalRetention } from "@/lib/jobs/retention";
import { processPendingNotificationDeliveries } from "@/lib/notifications/delivery";
import { processPendingSupportNotifications } from "@/lib/support/notifications";
import { processInboundEventJobs } from "@/lib/integrations/inbound/queue";
import { drainVoiceFinalizationJobs } from "@/lib/voice/finalization";
import { processConnectorSyncJobs } from "@/lib/integrations/connectors/sync-runner";
import { renewExpiringConnectionWebhooks } from "@/lib/integrations/connectors/webhook-runner";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Scheduler entry point for the durable-job runner. Guarded by CRON_SECRET
// (see .env.example): POST with Authorization: Bearer $CRON_SECRET.
// The Render Blueprint invokes it every five minutes; any bearer-authenticated
// scheduler can use the same contract on another host.

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on the server." },
      { status: 503 },
    );
  }

  const provided = request.headers.get("authorization") ?? "";

  if (provided !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();

  if (!admin) {
    return NextResponse.json(
      { error: "The data service is unavailable." },
      { status: 503 },
    );
  }

  // Produce before draining inbound work, while isolating producer failures so
  // unrelated deliveries and retention still get a chance to run.
  const [nativeLifecycle] = await Promise.allSettled([
    produceNativeCrmLifecycleEvents(admin, 50),
  ]);
  const batchSize = Math.max(
    1,
    Math.min(5, Number(process.env.JOB_BATCH_SIZE) || 3),
  );
  const names = [
    "actions",
    "notifications",
    "supportNotifications",
    "connectorSync",
    "webhookRenewal",
    "retention",
    "inbound",
    "voiceFinalization",
    "embeddedInboxes",
    "embeddedActions",
  ];
  const results = await Promise.allSettled([
    processPendingActionJobs(batchSize),
    processPendingNotificationDeliveries(batchSize),
    processPendingSupportNotifications(batchSize),
    processConnectorSyncJobs(batchSize),
    renewExpiringConnectionWebhooks(admin, batchSize),
    runOperationalRetention(admin),
    processInboundEventJobs(admin, batchSize),
    drainVoiceFinalizationJobs(admin, batchSize),
    pollEmbeddedInboxes(admin, batchSize),
    pollEmbeddedActionResults(admin, batchSize),
  ]);
  const summary = summarizeJobResults([
    ["nativeLifecycle", nativeLifecycle],
    ...results.map((result, index): [string, PromiseSettledResult<unknown>] => [
      names[index],
      result,
    ]),
  ]);

  const schedulerRelease = normalizeSchedulerRelease(
    request.headers.get("x-northstar-scheduler-release"),
  );
  if (summary.ok) await recordSchedulerHeartbeat(admin, schedulerRelease);

  return NextResponse.json(
    { ok: summary.ok, schedulerRelease, ...summary.workers },
    { status: summary.ok ? 200 : 503 },
  );
}
