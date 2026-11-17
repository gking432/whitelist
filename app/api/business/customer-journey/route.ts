import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { connectionsContext } from "@/lib/connections/context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readCustomerJourneys } from "@/lib/business/customer-journey-data";
import { executeJourneyCommand, JourneyCommandError } from "@/lib/business/customer-journey-commands";
import { canWriteBusinessWorkspace } from "@/lib/business/access";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const Filters = z.object({ leadId: z.uuid().optional(), conversationId: z.uuid().optional(), taskId: z.uuid().optional() }).strict();
export async function GET(request: NextRequest) {
  const context = await connectionsContext();
  if (!context) return NextResponse.json({ error: "Business access is required." }, { status: 403, headers });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "The data service is unavailable." }, { status: 503, headers });
  const filters = Filters.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!filters.success) return NextResponse.json({ error: "Select valid customer work." }, { status: 400, headers });
  try { return NextResponse.json(await readCustomerJourneys(admin, context.scope, canWriteBusinessWorkspace(context.portal.access) && !context.portal.access.isImpersonating, filters.data), { headers }); }
  catch { return NextResponse.json({ error: "Customer work could not be fully loaded. Refresh before deciding." }, { status: 503, headers }); }
}
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers });
  const context = await connectionsContext(true);
  if (!context) return NextResponse.json({ error: "Business owner write access is required." }, { status: 403, headers });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "The data service is unavailable." }, { status: 503, headers });
  const text = await request.text();
  if (text.length > 6000) return NextResponse.json({ error: "Request too large." }, { status: 413, headers });
  try { return NextResponse.json({ result: await executeJourneyCommand(admin, { ...context.scope, actorId: context.user.id, canWrite: true }, JSON.parse(text)) }, { headers }); }
  catch (error) { return NextResponse.json({ error: error instanceof JourneyCommandError ? error.message : "The saved result could not be confirmed. Retry unchanged." }, { status: error instanceof JourneyCommandError ? error.status : 503, headers }); }
}
