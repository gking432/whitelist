import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOrigin } from "@/lib/auth/same-origin";
import { getAppUrl } from "@/lib/env";
import { connectionsContext } from "@/lib/connections/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PersonalAssistantSaveSchema, personalAssistantSnapshot } from "@/lib/personal-assistant/preferences-contract";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", Vary: "Cookie" };
function failure(status: number, error: string) { return NextResponse.json({ error }, { status, headers }); }
async function context() { const value = await connectionsContext(); return value && !value.portal.access.isImpersonating ? value : null; }
function matchesRenderedScope(request: Request, ctx: NonNullable<Awaited<ReturnType<typeof context>>>) {
  return request.headers.get("x-workstation-scope") === `${ctx.user.id}:${ctx.scope.clientId}`;
}
function rpcFailure(code?: string) {
  if (code === "42501") return failure(403, "Business workspace access is required.");
  if (code === "PT409") return failure(409, "This preference changed elsewhere. Reload the saved choice before saving.");
  if (code === "22023") return failure(400, "Check your assistant choice before saving.");
  return failure(503, "The saved preference could not be confirmed. Reload it before trying again.");
}
async function boundedBody(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return null;
  const reader = request.body?.getReader(); if (!reader) return "";
  const parts: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 4096) { await reader.cancel().catch(() => {}); return null; }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(bytes); let offset = 0;
  for (const part of parts) { joined.set(part, offset); offset += part.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(joined);
}
export async function GET(request: Request) {
  try {
    const ctx = await context(); if (!ctx) return failure(403, "Business workspace access is required.");
    if (!matchesRenderedScope(request, ctx)) return failure(403, "Reload this workspace before accessing its private assistant preference.");
    const client = await createSupabaseServerClient(); if (!client) return rpcFailure();
    const result = await client.rpc("get_owner_personal_assistant", { p_client: ctx.scope.clientId });
    if (result.error) return rpcFailure(result.error.code);
    return NextResponse.json(personalAssistantSnapshot(result.data), { headers });
  } catch { return rpcFailure(); }
}
export async function POST(request: Request) {
  if (!isSameOrigin(request.headers.get("origin"), getAppUrl())) return failure(403, "Invalid request origin.");
  try {
    const ctx = await context(); if (!ctx) return failure(403, "Business workspace access is required.");
    if (!matchesRenderedScope(request, ctx)) return failure(403, "Reload this workspace before editing its private assistant preference.");
    let input;
    try {
      const text = await boundedBody(request); if (text === null) return failure(413, "Request too large.");
      input = PersonalAssistantSaveSchema.parse(JSON.parse(text));
    } catch (error) { if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError) return failure(400, "Check your assistant choice before saving."); throw error; }
    const client = await createSupabaseServerClient(); if (!client) return rpcFailure();
    const result = await client.rpc("save_owner_personal_assistant", { p_client: ctx.scope.clientId, p_key: input.key, p_revision: input.revision, p_settings: input.settings });
    if (result.error) return rpcFailure(result.error.code);
    // A malformed/lost post-commit receipt is uncertain, never a validation
    // rejection or an instruction to send the mutation again automatically.
    return NextResponse.json(personalAssistantSnapshot(result.data), { headers });
  } catch { return rpcFailure(); }
}
