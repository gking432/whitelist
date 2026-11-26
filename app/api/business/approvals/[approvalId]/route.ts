import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState } from "@/lib/auth/session";
import { isSameOrigin } from "@/lib/auth/same-origin";
import { getAppUrl } from "@/lib/env";
import { isAccessError, requirePrimaryClientAccess } from "@/lib/permissions/access";
import { CLIENT_APPROVER_ROLES } from "@/lib/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveApprovalItem } from "@/lib/approvals/resolve";
import { OWNER_APPROVAL_BODY_BYTES, OwnerApprovalCommandSchema, OwnerApprovalResultSchema, type OwnerApprovalCommand, type OwnerApprovalResult } from "@/lib/approvals/owner-command";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
function failure(httpStatus: OwnerApprovalResult["httpStatus"], message: string) {
  return NextResponse.json({ status: "error", httpStatus, message }, { status: httpStatus, headers });
}
async function bodyText(request: Request): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > OWNER_APPROVAL_BODY_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  let bytes = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > OWNER_APPROVAL_BODY_BYTES) { try { await reader.cancel(); } catch { /* Still reject the oversized request. */ } return null; }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(joined); }
  catch { throw new SyntaxError("Invalid approval JSON encoding."); }
}

export async function POST(request: Request, context: { params: Promise<{ approvalId: string }> }) {
  if (!isSameOrigin(request.headers.get("origin"), getAppUrl())) return failure(403, "Invalid request origin.");
  const { approvalId } = await context.params;
  if (!z.uuid().safeParse(approvalId).success) return failure(400, "Choose a valid approval item.");
  try {
    const { user } = await getAuthState();
    if (!user) return failure(403, "Sign in to resolve approvals.");
    const access = await requirePrimaryClientAccess(user.id, CLIENT_APPROVER_ROLES);
    if (!access.clientId || !access.canResolveApprovals) return failure(403, "Your account cannot resolve approvals.");
    let command: OwnerApprovalCommand;
    try {
      const text = await bodyText(request);
      if (text === null) return failure(413, "The approval decision is too large.");
      command = OwnerApprovalCommandSchema.parse(JSON.parse(text));
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) return failure(400, "Check the decision, edited content and note before submitting.");
      throw error;
    }
    const supabase = access.isImpersonating && access.impersonationMode === "sandbox_full"
      ? createSupabaseAdminClient() : await createSupabaseServerClient();
    if (!supabase) return failure(503, "The data service is unavailable.");
    try {
      const result = OwnerApprovalResultSchema.parse(await resolveApprovalItem({ supabase, access, approvalId, clientId: access.clientId, ...command }));
      return NextResponse.json(result, { status: result.httpStatus, headers });
    } catch {
      // Resolution may already be committed. Never replay it after losing its receipt.
      return failure(503, "The decision could not be confirmed. Refresh approvals and check Action history before deciding again.");
    }
  } catch (error) {
    if (isAccessError(error)) return failure(error.code === "ACCESS_DENIED" ? 403 : 503,
      error.code === "ACCESS_DENIED" ? "Your account cannot resolve approvals." : "Approvals are unavailable right now.");
    return failure(503, "The decision could not be confirmed. Refresh approvals and check Action history before deciding again.");
  }
}
