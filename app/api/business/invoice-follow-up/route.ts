import { NextResponse, type NextRequest } from "next/server";
import { connectionsContext } from "@/lib/connections/context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canWriteBusinessWorkspace } from "@/lib/business/access";
import { readInvoiceFollowupReview, executeInvoiceFollowupCommand, InvoiceFollowupError } from "@/lib/money/service";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: NextRequest) {
  const context = await connectionsContext();
  if (!context) return NextResponse.json({ error: "Business access is required." }, { status: 403, headers });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "The data service is unavailable." }, { status: 503, headers });
  try { return NextResponse.json(await readInvoiceFollowupReview(admin, context.scope, canWriteBusinessWorkspace(context.portal.access) && !context.portal.access.isImpersonating, Object.fromEntries(request.nextUrl.searchParams)), { headers }); }
  catch (error) { return NextResponse.json({ error: error instanceof InvoiceFollowupError ? error.message : "Invoice review could not be loaded. Refresh before deciding." }, { status: error instanceof InvoiceFollowupError ? error.status : 400, headers }); }
}
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers });
  const context = await connectionsContext(true);
  if (!context) return NextResponse.json({ error: "Business owner write access is required." }, { status: 403, headers });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "The data service is unavailable." }, { status: 503, headers });
  const body = await request.text();
  if (body.length > 6000) return NextResponse.json({ error: "Request too large." }, { status: 413, headers });
  try { return NextResponse.json({ result: await executeInvoiceFollowupCommand(admin, { ...context.scope, actorId: context.user.id }, JSON.parse(body)) }, { headers }); }
  catch (error) { return NextResponse.json({ error: error instanceof InvoiceFollowupError ? error.message : "The saved invoice decision could not be confirmed. Retry unchanged." }, { status: error instanceof InvoiceFollowupError ? error.status : 503, headers }); }
}
