import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState } from "@/lib/auth/session";
import { loadClientPortal } from "@/lib/clients/portal";
import {
  canReadBusinessWorkspace,
  canWriteBusinessWorkspace,
} from "@/lib/business/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readConversations } from "@/lib/conversations/store";
import { processAgentWork } from "@/lib/agents/runner";
export const dynamic = "force-dynamic";
const Mutation = z.discriminatedUnion("action", [
  z
    .object({
      action: z.enum(["takeover", "resume", "close", "retry"]),
      id: z.uuid(),
      revision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal("link"),
      id: z.uuid(),
      revision: z.number().int().positive(),
      contactId: z.uuid(),
      reason: z.string().trim().min(8).max(1000),
    })
    .strict(),
  z
    .object({
      action: z.literal("reply"),
      id: z.uuid(),
      revision: z.number().int().positive(),
      body: z.string().trim().min(1).max(5000),
    })
    .strict(),
]);
async function context() {
  const { user } = await getAuthState();
  if (!user) return null;
  const portal = await loadClientPortal();
  return portal.kind === "ok" && canReadBusinessWorkspace(portal.access)
    ? { portal, user }
    : null;
}
export async function GET(request: NextRequest) {
  const ctx = await context();
  if (!ctx)
    return NextResponse.json(
      { error: "Owner access required." },
      { status: 403 },
    );
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "Data service unavailable." },
      { status: 503 },
    );
  const id = request.nextUrl.searchParams.get("id");
  if (id && !z.uuid().safeParse(id).success)
    return NextResponse.json(
      { error: "Invalid conversation." },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      await readConversations(
        admin,
        {
          partnerId: ctx.portal.client.partner_id,
          clientId: ctx.portal.client.id,
        },
        canWriteBusinessWorkspace(ctx.portal.access),
        id ?? undefined,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Conversations could not be loaded." },
      { status: 503 },
    );
  }
}
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const ctx = await context();
  if (!ctx || !canWriteBusinessWorkspace(ctx.portal.access))
    return NextResponse.json(
      { error: "Owner write access required." },
      { status: 403 },
    );
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "Data service unavailable." },
      { status: 503 },
    );
  const scope = {
    partnerId: ctx.portal.client.partner_id,
    clientId: ctx.portal.client.id,
  };
  try {
    const text = await request.text();
    if (text.length > 16000)
      return NextResponse.json(
        { error: "Request too large." },
        { status: 413 },
      );
    const input = Mutation.parse(JSON.parse(text));
    const args = {
      p_partner: scope.partnerId,
      p_client: scope.clientId,
      p_id: input.id,
      p_revision: input.revision,
      p_actor: ctx.user.id,
    };
    const result =
      input.action === "reply"
        ? await admin.rpc("propose_conversation_action", {
            ...args,
            p_kind: "reply",
            p_body: input.body,
          })
        : await admin.rpc("control_business_conversation", {
            ...args,
            p_action: input.action,
            ...(input.action === "link"
              ? { p_contact: input.contactId, p_reason: input.reason }
              : {}),
          });
    if (result.error)
      return NextResponse.json(
        {
          error:
            "This conversation changed or the action is unavailable. Refresh and review any existing approval.",
        },
        { status: 409 },
      );
    after(() => processAgentWork(admin, 2, scope));
    return NextResponse.json(
      {
        message:
          input.action === "reply"
            ? "Reply prepared. Review and approve it in Approvals."
            : "Conversation updated.",
        snapshot: await readConversations(admin, scope, true, input.id),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Check the fields and try again." },
      { status: 400 },
    );
  }
}
