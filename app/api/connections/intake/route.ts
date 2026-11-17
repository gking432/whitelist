import { NextResponse, type NextRequest } from "next/server";
import { connectionsContext } from "@/lib/connections/context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readIntakeReview } from "@/lib/connections/intake-review";
import { adoptIntake, supabaseIntakeAdoptionRepository, IntakeAdoptionError } from "@/lib/connections/intake-adoption";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  const context = await connectionsContext(true);
  if (!context) return NextResponse.json({ error: "Business owner write access is required." }, { status: 403, headers: privateHeaders });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "The data service is unavailable." }, { status: 503, headers: privateHeaders });
  try {
    const query = Object.fromEntries(request.nextUrl.searchParams);
    return NextResponse.json(await readIntakeReview(admin, context.scope, query), { headers: privateHeaders });
  } catch {
    return NextResponse.json({ error: "The current inquiry or customer choices could not be loaded. Refresh and check the form source." }, { status: 409, headers: privateHeaders });
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: privateHeaders });
  const context = await connectionsContext(true);
  if (!context) return NextResponse.json({ error: "Business owner write access is required." }, { status: 403, headers: privateHeaders });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "The data service is unavailable." }, { status: 503, headers: privateHeaders });
  const body = await request.text();
  if (body.length > 4000) return NextResponse.json({ error: "Request too large." }, { status: 413, headers: privateHeaders });
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { return NextResponse.json({ error: "Invalid inquiry decision." }, { status: 400, headers: privateHeaders }); }
  // The service validates the exact command and confirms the persisted receipt;
  // tenant and actor are always supplied by the authenticated portal.
  try {
    const result = await adoptIntake(supabaseIntakeAdoptionRepository(admin), {
      ...context.scope, actorId: context.user.id, canWrite: true,
    }, raw);
    return NextResponse.json(result, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof IntakeAdoptionError)
      return NextResponse.json({ error: error.message }, { status: error.status, headers: privateHeaders });
    return NextResponse.json({ error: "The saved decision could not be confirmed. Retry the same choice before starting another." }, { status: 503, headers: privateHeaders });
  }
}
