import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthState } from "@/lib/auth/session";
import { resolveAssistantAccess } from "@/lib/assistant/access";
import { recordAuditEvent } from "@/lib/audit/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const Schema = z.object({ call_session_id: z.string().uuid(), action: z.enum(["claim", "release"]) });

export async function POST(request: NextRequest) {
  const auth = await getAuthState();
  if (!auth.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid call assignment." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Data service unavailable." }, { status: 503 });
  const { data: call } = await admin.from("call_sessions").select("id, client_id")
    .eq("id", parsed.data.call_session_id).eq("status", "in_progress").is("ended_at", null).maybeSingle();
  if (!call) return NextResponse.json({ error: "Active call not found." }, { status: 404 });
  let access;
  try { access = await resolveAssistantAccess(auth.user.id, call.client_id, "write"); }
  catch { return NextResponse.json({ error: "Call not accessible." }, { status: 404 }); }
  if (!access.role.startsWith("client_") || access.isImpersonating ||
    !access.visibleClientSections.includes("assistant")) {
    return NextResponse.json({ error: "A client employee with assistant access must handle this call." }, { status: 403 });
  }
  let query = admin.from("call_sessions").update({
    assigned_user_id: parsed.data.action === "claim" ? auth.user.id : null,
  }).eq("id", call.id).eq("status", "in_progress");
  query = parsed.data.action === "claim"
    ? query.or(`assigned_user_id.is.null,assigned_user_id.eq.${auth.user.id}`)
    : query.eq("assigned_user_id", auth.user.id);
  const { data: claimed, error } = await query.select("id").maybeSingle();
  if (error) return NextResponse.json({ error: "Assignment could not be saved." }, { status: 503 });
  if (!claimed) return NextResponse.json({ error: "Another employee is handling this call." }, { status: 409 });
  await recordAuditEvent({ actor: access, action: `voice.call_${parsed.data.action}ed`,
    targetType: "call_session", targetId: call.id, summary: `Employee ${parsed.data.action === "claim" ? "claimed" : "released"} a live call.` });
  return NextResponse.json({ ok: true });
}
