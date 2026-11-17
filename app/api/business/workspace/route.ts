import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState } from "@/lib/auth/session";
import { loadClientPortal } from "@/lib/clients/portal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadBusinessSnapshot } from "@/lib/business/data";
import { canReadBusinessWorkspace } from "@/lib/business/access";
import { mutateBusinessWorkspace } from "@/lib/business/mutations";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
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
      { error: "Sign in with business owner access." },
      { status: 403 },
    );
  return NextResponse.json(await loadBusinessSnapshot(portal), {
    headers: { "Cache-Control": "no-store" },
  });
}
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin)
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    );
  if (Number(request.headers.get("content-length") ?? 0) > 100_000)
    return NextResponse.json(
      { error: "Request is too large." },
      { status: 413 },
    );
  const portal = await context();
  if (!portal)
    return NextResponse.json(
      { error: "Sign in with business owner access." },
      { status: 403 },
    );
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "Data service unavailable." },
      { status: 503 },
    );
  try {
    const text = await request.text();
    if (text.length > 100_000)
      return NextResponse.json(
        { error: "Request is too large." },
        { status: 413 },
      );
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "Send a valid JSON request." },
        { status: 400 },
      );
    }
    const result = await mutateBusinessWorkspace(admin, portal, input);
    return NextResponse.json(
      { ...result, snapshot: await loadBusinessSnapshot(portal) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues
            .map((i) => i.message)
            .slice(0, 3)
            .join(" ")
        : error instanceof Error
          ? error.message
          : "The change could not be saved.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
