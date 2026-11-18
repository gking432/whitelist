import { isSameOrigin } from "@/lib/auth/same-origin";
import { getAppUrl } from "@/lib/env";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState } from "@/lib/auth/session";
import { loadClientPortal } from "@/lib/clients/portal";
import { canReadBusinessWorkspace, canWriteBusinessWorkspace } from "@/lib/business/access";
import { readBusinessContext } from "@/lib/business/context-data";
import { BusinessCommandError } from "@/lib/business/context-commands";
import { executeContextCommand, supabaseCommandRepository } from "@/lib/business/context-command-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
async function context() {
  const { user } = await getAuthState();
  if (!user) return null;
  const portal = await loadClientPortal();
  return portal.kind === "ok" && canReadBusinessWorkspace(portal.access) ? portal : null;
}
export async function GET() {
  const portal = await context();
  if (!portal) return NextResponse.json({ error: "Business owner access is required." }, { status: 403, headers });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Data service unavailable." }, { status: 503, headers });
  try {
    return NextResponse.json(await readBusinessContext(admin, { partnerId: portal.client.partner_id, clientId: portal.client.id }, canWriteBusinessWorkspace(portal.access)), { headers });
  } catch {
    return NextResponse.json({ error: "Business context could not be loaded. Check the data service and current migration." }, { status: 503, headers });
  }
}
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request.headers.get("origin"), getAppUrl()))
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers });
  if (Number(request.headers.get("content-length") ?? 0) > 16000)
    return NextResponse.json({ error: "Request too large." }, { status: 413, headers });
  const portal = await context();
  if (!portal || !canWriteBusinessWorkspace(portal.access))
    return NextResponse.json({ error: "Business owner write access is required." }, { status: 403, headers });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Data service unavailable." }, { status: 503, headers });
  try {
    const body = await request.text();
    if (body.length > 16000) return NextResponse.json({ error: "Request too large." }, { status: 413, headers });
    const scope = { partnerId: portal.client.partner_id, clientId: portal.client.id };
    const result = await executeContextCommand(supabaseCommandRepository(admin), {
      ...scope, actorId: portal.user.id, canWrite: true,
    }, JSON.parse(body));
    // A refresh failure does not erase the durable command receipt. Retrying its
    // original key returns the same result rather than applying it twice.
    const snapshot = await readBusinessContext(admin, scope, true);
    return NextResponse.json({ result, snapshot }, { headers });
  } catch (error) {
    const status = error instanceof BusinessCommandError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503;
    const message = error instanceof BusinessCommandError ? error.message : status === 400 ? "Check the command and try again." : "The current result could not be loaded. Retry with the same request key.";
    return NextResponse.json({ error: message }, { status, headers });
  }
}
