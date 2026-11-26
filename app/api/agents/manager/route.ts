import { isSameOrigin } from "@/lib/auth/same-origin";
import { getAppUrl } from "@/lib/env";
import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState } from "@/lib/auth/session";
import { loadClientPortal } from "@/lib/clients/portal";
import {
  canReadBusinessWorkspace,
  canWriteBusinessWorkspace,
} from "@/lib/business/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readManagerChat } from "@/lib/agents/manager-chat";
import { mutateTeam } from "@/lib/agents/mutations";
import { processAgentWork } from "@/lib/agents/runner";

export const dynamic = "force-dynamic";
const Message = z.object({
  action: z.literal("request"),
  request: z.string().trim().min(5).max(2000),
  key: z.uuid(),
}).strict();

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
    return NextResponse.json({ error: "Business access required." }, { status: 403 });
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json({ error: "Data service unavailable." }, { status: 503 });
  try {
    return NextResponse.json(
      await readManagerChat(
        admin,
        { partnerId: portal.client.partner_id, clientId: portal.client.id },
        canWriteBusinessWorkspace(portal.access),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Manager chat could not be loaded." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request.headers.get("origin"), getAppUrl()))
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const portal = await context();
  if (!portal || !canWriteBusinessWorkspace(portal.access))
    return NextResponse.json({ error: "Business owner access required." }, { status: 403 });
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json({ error: "Data service unavailable." }, { status: 503 });
  try {
    const body = await request.text();
    if (body.length > 8000)
      return NextResponse.json({ error: "Message is too large." }, { status: 413 });
    const input = Message.parse(JSON.parse(body));
    const scope = { partnerId: portal.client.partner_id, clientId: portal.client.id };
    const result = await mutateTeam(admin, portal, input);
    after(() => processAgentWork(admin, 2, scope));
    return NextResponse.json(
      { id: result.id, snapshot: await readManagerChat(admin, scope, true) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof z.ZodError || error instanceof SyntaxError
        ? "Check the message and try again."
        : error instanceof Error ? error.message : "Message could not be sent." },
      { status: 400 },
    );
  }
}
