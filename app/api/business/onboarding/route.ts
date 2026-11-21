import { NextRequest, NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/auth/same-origin";
import { connectionsContextDecision } from "@/lib/connections/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAppUrl } from "@/lib/env";
import { OnboardingRequestSchema, OnboardingSaveResponseSchema, OnboardingSnapshotSchema } from "@/lib/business/onboarding-contract";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", Vary: "Cookie, X-Workstation-Scope" };
const error = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers });
async function context(request: NextRequest) {
  const decision = await connectionsContextDecision(true);
  if (decision.kind !== "ok") return { response: error(decision.kind === "denied" ? "Owner access is required to set up this business." : "Your saved setup is temporarily unavailable.", decision.kind === "denied" ? 403 : 503) };
  const ctx = decision.context;
  if (ctx.portal.access.role !== "client_owner" || ctx.portal.access.isImpersonating ||
      request.headers.get("X-Workstation-Scope") !== `${ctx.user.id}:${ctx.scope.clientId}`)
    return { response: error("Owner access is required to set up this business.", 403) };
  return { ctx };
}
function rpcError(code: string | undefined) {
  if (code === "42501") return error("Owner access is required to set up this business.", 403);
  if (code === "PT409") return error("Your setup changed elsewhere. Reload saved answers before continuing.", 409);
  if (code === "22023") return error("Check your answer and try again.", 422);
  return error("Your save could not be confirmed. Check saved answers before trying again.", 503);
}
export async function GET(request: NextRequest) {
  const access = await context(request);
  if (access.response) return access.response;
  try {
    const client = await createSupabaseServerClient();
    if (!client) return error("Your saved setup is temporarily unavailable.", 503);
    const result = await client.rpc("get_owner_onboarding", { p_client: access.ctx!.scope.clientId });
    if (result.error) return rpcError(result.error.code);
    const snapshot = OnboardingSnapshotSchema.safeParse(result.data);
    return snapshot.success ? NextResponse.json(snapshot.data, { headers }) : error("Your saved setup could not be loaded. Try again.", 503);
  } catch { return error("Your saved setup is temporarily unavailable.", 503); }
}
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request.headers.get("origin"), getAppUrl())) return error("Open this site directly before saving.", 403);
  if (Number(request.headers.get("content-length") ?? 0) > 16384) return error("Your answer is too long.", 413);
  const access = await context(request);
  if (access.response) return access.response;
  let input;
  try {
    const text = await request.text();
    if (text.length > 16384) return error("Your answer is too long.", 413);
    input = OnboardingRequestSchema.safeParse(JSON.parse(text));
  } catch { return error("Check your answer and try again.", 400); }
  if (!input.success) return error("Check your answer and try again.", 400);
  try {
    const client = await createSupabaseServerClient();
    if (!client) return error("Your saved setup is temporarily unavailable.", 503);
    const { key, revision, ...command } = input.data;
    const result = await client.rpc("save_owner_onboarding", { p_client: access.ctx!.scope.clientId, p_key: key, p_revision: revision, p_command: command });
    if (result.error) return rpcError(result.error.code);
    const saved = OnboardingSaveResponseSchema.safeParse(result.data);
    return saved.success ? NextResponse.json(saved.data, { headers }) : error("Your save could not be confirmed. Check saved answers before trying again.", 503);
  } catch { return error("Your save could not be confirmed. Check saved answers before trying again.", 503); }
}
