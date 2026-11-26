import { isSameOrigin } from "@/lib/auth/same-origin";
import { getAppUrl } from "@/lib/env";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState } from "@/lib/auth/session";
import { loadClientPortal } from "@/lib/clients/portal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadBusinessSnapshot } from "@/lib/business/data";
import { canReadBusinessWorkspace } from "@/lib/business/access";
import { BusinessProfileSaveError, mutateBusinessWorkspace } from "@/lib/business/mutations";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
async function context(request: NextRequest) {
  const { user } = await getAuthState();
  if (!user) return null;
  const portal = await loadClientPortal();
  const suppliedScope = request.headers.get("X-Workstation-Scope");
  return portal.kind === "ok" && portal.user.id === user.id && canReadBusinessWorkspace(portal.access) && (!suppliedScope || suppliedScope === `${user.id}:${portal.client.id}`)
    ? portal
    : null;
}
export async function GET(request: NextRequest) {
  const portal = await context(request);
  if (!portal)
    return NextResponse.json(
      { error: "Sign in with business owner access." },
      { status: 403 },
    );
  try { return NextResponse.json(await loadBusinessSnapshot(portal), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Business settings are temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!isSameOrigin(origin, getAppUrl()))
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    );
  if (Number(request.headers.get("content-length") ?? 0) > 100_000)
    return NextResponse.json(
      { error: "Request is too large." },
      { status: 413 },
    );
  const portal = await context(request);
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
  let profileSave = false;
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
    profileSave = input !== null && typeof input === "object" && "action" in input && input.action === "save_profile";
    if (profileSave && request.headers.get("X-Workstation-Scope") !== `${portal.user.id}:${portal.client.id}`)
      return NextResponse.json({ error: "Your active account or business changed. Reload before saving." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    const result = await mutateBusinessWorkspace(admin, portal, input);
    return NextResponse.json(
      { ...result, snapshot: await loadBusinessSnapshot(portal) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (profileSave) return NextResponse.json({ error: error instanceof BusinessProfileSaveError ? error.message : "The save could not be confirmed. Retry the same change or reload saved settings." }, { status: error instanceof BusinessProfileSaveError ? error.status : 503, headers: { "Cache-Control": "no-store" } });
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
