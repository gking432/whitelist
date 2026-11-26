import { NextResponse, type NextRequest } from "next/server";
import { processConnectorSyncJobs } from "@/lib/integrations/connectors/sync-runner";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
// A separate scheduler can keep data fresh without running agent or customer-action queues.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "Scheduler not configured." },
      { status: 503 },
    );
  if (request.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const result = await processConnectorSyncJobs(8, { readOnly: true });
  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
export const POST = GET;
