import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectionsContext } from "@/lib/connections/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadWorkspacePersonalization } from "@/lib/business/workspace-preferences-data";
import { defaultWorkspacePreferences } from "@/lib/business/workspace-preferences";
import { WORKSPACE_MODULES } from "@/lib/business/workspace-preferences-contract";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const moduleSchema = z.enum(WORKSPACE_MODULES);
const base = { requestKey: z.uuid(), revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) };
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reset"), ...base }).strict(),
  z.object({ action: z.literal("save"), ...base,
    displayName: z.string().trim().min(1).max(60).regex(/^[^\p{Cc}]+$/u).nullable(),
    order: z.array(moduleSchema).length(4).refine(a => new Set(a).size === 4),
    pinned: z.array(moduleSchema).max(4).refine(a => new Set(a).size === a.length),
  }).strict(),
  z.object({ action: z.literal("activity"), module: moduleSchema }).strict(),
]);
function error(message: string, status: number) { return NextResponse.json({ error: message }, { status, headers }); }
async function context() {
  const ctx = await connectionsContext();
  return ctx && !ctx.portal.access.isImpersonating ? ctx : null;
}
export async function GET() {
  const ctx = await context();
  if (!ctx) return error("Business workspace access is required.", 403);
  const snapshot = await loadWorkspacePersonalization(ctx.portal);
  return snapshot.available ? NextResponse.json(snapshot, { headers }) : error("Your preferences could not be loaded. Try again.", 503);
}
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return error("Invalid request origin.", 403);
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return error("Request too large.", 413);
  const ctx = await context();
  if (!ctx) return error("Business workspace access is required.", 403);
  const client = await createSupabaseServerClient();
  if (!client) return error("The data service is unavailable.", 503);
  try {
    const text = await request.text();
    if (text.length > 4096) return error("Request too large.", 413);
    const input = command.parse(JSON.parse(text));
    if (input.action === "activity") {
      const result = await client.rpc("record_owner_workspace_activity", { p_client: ctx.scope.clientId, p_module: input.module });
      if (result.error) return error("Workspace activity could not be recorded.", result.error.code === "42501" ? 403 : 503);
      return NextResponse.json({ ok: true }, { headers });
    }
    const defaults = defaultWorkspacePreferences();
    const settings = input.action === "reset"
      ? { displayName: defaults.displayName, order: defaults.order, pinned: defaults.pinned }
      : { displayName: input.displayName, order: input.order, pinned: input.pinned };
    const result = await client.rpc("save_owner_workspace_preferences", {
      p_client: ctx.scope.clientId, p_key: input.requestKey, p_revision: input.revision, p_settings: settings,
    });
    if (result.error) {
      if (result.error.code === "40001") return error("Your preferences changed elsewhere. Reload saved preferences before saving.", 409);
      if (result.error.code === "42501") return error("Business workspace access is required.", 403);
      if (result.error.code === "22023") return error("Check your name and Today preferences.", 400);
      return error("Your save could not be confirmed. Retry the same change.", 503);
    }
    return NextResponse.json({ snapshot: result.data }, { headers });
  } catch (e) {
    return error(e instanceof z.ZodError || e instanceof SyntaxError ? "Check your name and Today preferences." : "Your save could not be confirmed. Retry the same change.", e instanceof z.ZodError || e instanceof SyntaxError ? 400 : 503);
  }
}
