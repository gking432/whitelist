import { NextResponse, type NextRequest } from "next/server";

import { findConnectionByWidgetKey } from "@/lib/chat/widget";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { getKnowledgeProfile } from "@/lib/knowledge/profile";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Public: starts a website chat session for the client business that owns
// the widget key. Rate-limited per key + caller IP. Returns the greeting
// and AI disclosure so the widget is honest from the first pixel.

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ widgetKey: string }> },
) {
  const { widgetKey } = await params;
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  const rate = checkRateLimit(`widget-session:${widgetKey}:${ip}`);

  if (!rate.allowed) {
    return json(429, { error: "Too many chats started. Try again shortly." });
  }

  const admin = createSupabaseAdminClient();

  if (!admin) {
    return json(503, { error: "Chat is unavailable right now." });
  }

  const connection = await findConnectionByWidgetKey(admin, widgetKey);

  if (!connection) {
    return json(404, { error: "This chat widget is not active." });
  }

  const knowledge = await getKnowledgeProfile(admin, connection.client_id);
  const disclosure =
    knowledge?.ai_disclosure ??
    `Hi! I'm ${connection.client_name}'s AI assistant. I can answer questions and take your details — a human confirms everything.`;

  const { data: session, error } = await admin
    .from("chat_sessions")
    .insert({
      partner_id: connection.partner_id,
      client_id: connection.client_id,
      connection_id: connection.id,
      transcript: [
        {
          role: "assistant",
          content: `${disclosure} What can we help you with today?`,
          at: new Date().toISOString(),
        },
      ],
      message_count: 0,
    })
    .select("id")
    .single();

  if (error || !session) {
    return json(500, { error: "The chat session could not be started." });
  }

  return json(200, {
    session_id: session.id,
    client_name: connection.client_name,
    greeting: `${disclosure} What can we help you with today?`,
  });
}
