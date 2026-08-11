import { NextResponse, type NextRequest } from "next/server";

import { processPendingActionJobs } from "@/lib/jobs/runner";
import { processPendingNotificationDeliveries } from "@/lib/notifications/delivery";
import { processPendingSupportNotifications } from "@/lib/support/notifications";
import { processConnectorSyncJobs } from "@/lib/integrations/connectors/sync-runner";

export const dynamic = "force-dynamic";

// Scheduler entry point for the durable-job runner. Guarded by CRON_SECRET
// (see .env.example): POST with Authorization: Bearer $CRON_SECRET.
// Wire it to Vercel Cron / any scheduler at a 1-5 minute interval.

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

  const [result, notifications, supportNotifications, connectorSync] = await Promise.all([
    processPendingActionJobs(20),
    processPendingNotificationDeliveries(20),
    processPendingSupportNotifications(20),
    processConnectorSyncJobs(20),
  ]);

  return NextResponse.json({ ok: true, ...result, notifications, supportNotifications, connectorSync });
}
