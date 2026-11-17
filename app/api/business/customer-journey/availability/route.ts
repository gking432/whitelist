import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { connectionsContext } from "@/lib/connections/context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { prepareCalendarChangeOffer, CalendarChangeError } from "@/lib/scheduling/calendar-change-proposals";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: NextRequest) {
  const context = await connectionsContext(true);
  if (!context) return NextResponse.json({ error: "Business owner write access is required." }, { status: 403, headers });
  const query = z.union([z.object({ leadId: z.uuid() }).strict(), z.object({ bookingApprovalId: z.uuid(), purpose: z.literal("time_change") }).strict()]).safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return NextResponse.json({ error: "Select customer work first." }, { status: 400, headers });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "The data service is unavailable." }, { status: 503, headers });
  if ("bookingApprovalId" in query.data) {
    try { return NextResponse.json(await prepareCalendarChangeOffer(admin, { ...context.scope, actorId: context.user.id }, query.data.bookingApprovalId), { headers }); }
    catch (error) { return NextResponse.json({ error: error instanceof CalendarChangeError ? error.message : "Replacement availability could not be fully checked. Try a fresh source review." }, { status: error instanceof CalendarChangeError ? error.status : 503, headers }); }
  }
  const result = await admin.from("agent_work_items").select("id,result,input,revision")
    .eq("partner_id", context.scope.partnerId).eq("client_id", context.scope.clientId).eq("source_lead_id", query.data.leadId)
    .eq("kind", "booking_request").in("status", ["waiting_approval", "blocked"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const offer = result.data?.result?.offer;
  if (result.error || !result.data || !offer || !Array.isArray(offer.slots) || !offer.expires_at || Date.parse(offer.expires_at) <= Date.now())
    return NextResponse.json({ error: "Scheduling has no current available-time offer. Refresh customer work or prepare fresh scheduling." }, { status: 409, headers });
  return NextResponse.json({ id: result.data.id, expiresAt: offer.expires_at, provider: offer.provider, timezone: offer.timezone,
    slots: offer.slots.map((slot: { start_iso: string; end_iso: string; label: string }) => ({ start_iso: slot.start_iso, end_iso: slot.end_iso, label: slot.label })),
    detail: "Real availability checked by scheduling. A selection needs approval and a final availability check; these times are not held." }, { headers });
}
