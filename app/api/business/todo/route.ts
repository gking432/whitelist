import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState } from "@/lib/auth/session";
import { loadClientPortal } from "@/lib/clients/portal";
import { canReadBusinessWorkspace } from "@/lib/business/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { mutateTodo } from "@/lib/business/todo-mutations";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    );
  const { user } = await getAuthState();
  if (!user)
    return NextResponse.json(
      { error: "Sign in to change work." },
      { status: 403 },
    );
  const portal = await loadClientPortal();
  if (portal.kind !== "ok" || !canReadBusinessWorkspace(portal.access))
    return NextResponse.json(
      { error: "Business owner access required." },
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
    if (body.length > 4000)
      return NextResponse.json(
        { error: "Request is too large." },
        { status: 413 },
      );
    return NextResponse.json(
      await mutateTodo(admin, portal, JSON.parse(body)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError || error instanceof SyntaxError
            ? "Check the task and try again."
            : error instanceof Error
              ? error.message
              : "The task could not be saved.",
      },
      { status: 400 },
    );
  }
}
