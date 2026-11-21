import { NextRequest, NextResponse } from "next/server";
import { findConnectionByWidgetKey } from "@/lib/chat/widget";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
export const dynamic = "force-dynamic";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ widgetKey: string }> },
) {
  const { widgetKey } = await params;
  const sessionId = request.nextUrl.searchParams.get("session_id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(sessionId))
    return NextResponse.json({ error: "Session required." }, { status: 400 });
  const rate = await checkRateLimit(`widget-updates:${sessionId}`, {
    limit: 30,
    windowSeconds: 60,
  });
  if (!rate.allowed)
    return NextResponse.json({ error: "Please wait." }, { status: 429 });
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json({ error: "Chat unavailable." }, { status: 503 });
  const connection = await findConnectionByWidgetKey(admin, widgetKey);
  if (!connection)
    return NextResponse.json({ error: "Chat unavailable." }, { status: 404 });
  const session = await admin
    .from("chat_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("connection_id", connection.id)
    .maybeSingle();
  if (session.error || !session.data)
    return NextResponse.json(
      { error: "Session unavailable." },
      { status: 404 },
    );
  const c = await admin
    .from("business_conversations")
    .select("id,state")
    .eq("connection_id", connection.id)
    .eq("partner_id", connection.partner_id)
    .eq("client_id", connection.client_id)
    .eq("channel", "website_chat")
    .eq("external_thread_id", sessionId)
    .maybeSingle();
  if (c.error)
    return NextResponse.json({ error: "Chat unavailable." }, { status: 503 });
  if (!c.data)
    return NextResponse.json(
      { messages: [], complete: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  const messages = await admin
    .from("business_conversation_messages")
    .select("id,direction,body,created_at")
    .eq("conversation_id", c.data.id)
    .eq("partner_id", connection.partner_id)
    .eq("client_id", connection.client_id)
    .in("status", ["received", "sent"])
    .order("created_at")
    .limit(100);
  if (messages.error)
    return NextResponse.json({ error: "Chat unavailable." }, { status: 503 });
  return NextResponse.json(
    { messages: messages.data, complete: c.data.state === "closed" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
