import { NextResponse, type NextRequest } from "next/server";

import { processPendingActionJobs } from "@/lib/jobs/runner";
import { runOperationalRetention } from "@/lib/jobs/retention";
import { processPendingNotificationDeliveries } from "@/lib/notifications/delivery";
import { processPendingSupportNotifications } from "@/lib/support/notifications";
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
    return NextResponse.json({ error: "The data service is unavailable." }, { status: 503 });
  }

  const [result, notifications, supportNotifications, connectorSync, webhookRenewal, retention] = await Promise.all([
    processPendingActionJobs(20),
    processPendingNotificationDeliveries(20),
    processPendingSupportNotifications(20),
    processConnectorSyncJobs(20),
    renewExpiringConnectionWebhooks(admin, 20),
    runOperationalRetention(admin),
  ]);

  return NextResponse.json({ ok: true, ...result, notifications, supportNotifications, connectorSync, webhookRenewal, retention });
}
