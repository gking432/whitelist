import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState } from "@/lib/auth/session";
import { loadClientPortal } from "@/lib/clients/portal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  canReadBusinessWorkspace,
  canWriteBusinessWorkspace,
} from "@/lib/business/access";
import {
  ActivationInput,
  applyActivation,
  readActivation,
  recheckWorkspace,
} from "@/lib/activation/service";
import { startActivationOAuth } from "@/lib/activation/oauth";

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
  const portal = await context(),
    admin = createSupabaseAdminClient();
  if (!portal)
    return NextResponse.json(
      { error: "Business owner access required." },
      { status: 403 },
    );
  if (!admin)
    return NextResponse.json(
      { error: "Data service unavailable." },
      { status: 503 },
    );
  try {
    return NextResponse.json(
      await readActivation(
        admin,
        { partnerId: portal.client.partner_id, clientId: portal.client.id },
        canWriteBusinessWorkspace(portal.access),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Assistant setup could not be loaded." },
      { status: 503 },
    );
  }
}
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    );
  if (Number(request.headers.get("content-length") ?? 0) > 16000)
    return NextResponse.json({ error: "Request too large." }, { status: 413 });
  const portal = await context(),
    admin = createSupabaseAdminClient();
  if (!portal || !canWriteBusinessWorkspace(portal.access))
    return NextResponse.json(
      { error: "Business owner write access required." },
      { status: 403 },
    );
  if (!admin)
    return NextResponse.json(
      { error: "Data service unavailable." },
      { status: 503 },
    );
  const scope = {
    partnerId: portal.client.partner_id,
    clientId: portal.client.id,
  };
  try {
    const body = await request.text();
    if (body.length > 16000)
      return NextResponse.json(
        { error: "Request too large." },
        { status: 413 },
      );
    const input = z
      .discriminatedUnion("action", [
        ActivationInput,
        z.object({ action: z.literal("connect") }).strict(),
        z.object({ action: z.literal("check") }).strict(),
      ])
      .parse(JSON.parse(body));
    if (input.action === "connect") {
      if (portal.access.isImpersonating)
        return NextResponse.json(
          { error: "Sign in as the business owner to authorize an account." },
          { status: 403 },
        );
      const flow = await startActivationOAuth(admin, scope, portal.user.id);
      const response = NextResponse.json(
        { url: flow.url },
        { headers: { "Cache-Control": "no-store" } },
      );
      response.cookies.set(flow.cookieName, flow.cookie, {
        httpOnly: true,
        secure: request.nextUrl.protocol === "https:",
        sameSite: "lax",
        path: "/",
        maxAge: 900,
      });
      return response;
    }
    if (input.action === "save") {
      const { action: _action, revision, ...choices } = input;
      await applyActivation(admin, scope, revision, choices);
    } else await recheckWorkspace(admin, scope);
    return NextResponse.json(
      {
        snapshot: await readActivation(admin, scope, true),
        message:
          input.action === "save"
            ? "Setup saved. See the checks below for what is ready."
            : "Account access checked.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? "Choose an assistant and at least one customer channel."
            : error instanceof SyntaxError
              ? "Send valid JSON."
              : error instanceof Error
                ? error.message
                : "Setup could not be saved.",
      },
      { status: 400 },
    );
  }
}
