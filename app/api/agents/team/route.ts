import { isSameOrigin } from "@/lib/auth/same-origin";
import { getAppUrl } from "@/lib/env";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState } from "@/lib/auth/session";
import { loadClientPortal } from "@/lib/clients/portal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  canReadBusinessWorkspace,
  canWriteBusinessWorkspace,
} from "@/lib/business/access";
import { readTeam } from "@/lib/agents/data";
import { mutateTeam } from "@/lib/agents/mutations";
export const dynamic = "force-dynamic";
async function context() {
  const { user } = await getAuthState();
  if (!user) return null;
  const portal = await loadClientPortal();
  return portal.kind === "ok" && canReadBusinessWorkspace(portal.access)
    ? portal
    : null;
}
export async function GET() {
  const portal = await context();
  if (!portal)
    return NextResponse.json(
      { error: "Business owner access is required." },
      { status: 403 },
    );
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "Data service unavailable." },
      { status: 503 },
    );
  try {
    return NextResponse.json(
      await readTeam(
        admin,
        { partnerId: portal.client.partner_id, clientId: portal.client.id },
        canWriteBusinessWorkspace(portal.access),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Agent team data could not be loaded." },
      { status: 503 },
    );
  }
}
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request.headers.get("origin"), getAppUrl()))
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    );
  if (Number(request.headers.get("content-length") ?? 0) > 16000)
    return NextResponse.json(
      { error: "Request is too large." },
      { status: 413 },
    );
  const portal = await context();
  if (!portal || !canWriteBusinessWorkspace(portal.access))
    return NextResponse.json(
      { error: "Business owner write access is required." },
      { status: 403 },
    );
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "Data service unavailable." },
      { status: 503 },
    );
  try {
    const body = await request.text();
    if (body.length > 16000)
      return NextResponse.json(
        { error: "Request is too large." },
        { status: 413 },
      );
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      return NextResponse.json({ error: "Send valid JSON." }, { status: 400 });
    }
    const result = await mutateTeam(admin, portal, input);
    return NextResponse.json(
      {
        ...result,
        snapshot: await readTeam(
          admin,
          { partnerId: portal.client.partner_id, clientId: portal.client.id },
          true,
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? "Check the fields and try again."
            : error instanceof Error
              ? error.message
              : "Team update failed.",
      },
      { status: 400 },
    );
  }
}
