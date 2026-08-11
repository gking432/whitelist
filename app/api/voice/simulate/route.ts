import { NextResponse, type NextRequest } from "next/server";

import { getAuthState } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { isAccessError } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveVoiceOperatorAccess } from "@/lib/voice/access";
import {
  completeSimulatedCall,
  runSimulatedCallerTurn,
  startSimulatedCall,
} from "@/lib/voice/simulate";
import { isOpenAIRealtimeConfigured } from "@/lib/voice/providers/openai-realtime";

export const dynamic = "force-dynamic";

// Simulated voice call harness (docs/21). Exercises the FULL voice
// pipeline — instructions from approved knowledge, real tool execution
// (contacts, notes, slot proposals, approval-gated booking/message
// requests, escalation), transcript turns, AI summary, call.completed
// intake → workflows → approvals → CRM sync — with text standing in for
// audio. Session-authenticated with write access to the client.
//
// POST /api/voice/simulate
//   { action: "start",       client_id, from_number? }
//   { action: "caller_turn", call_session_id, text }
//   { action: "complete",    call_session_id }

const MAX_TEXT_CHARS = 2000;

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

export async function POST(request: NextRequest) {
  const authState = await getAuthState();

  if (!authState.user) {
    return json(401, { error: "Sign in to use the voice test harness." });
  }

  let body: {
    action?: string;
    client_id?: string;
    from_number?: string;
    call_session_id?: string;
    text?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "Send a JSON body with an action." });
  }

  const rate = checkRateLimit(`voice-simulate:${authState.user.id}`);

  if (!rate.allowed) {
    return json(429, { error: "Slow down a moment and try again." });
  }

  const admin = createSupabaseAdminClient();

  if (!admin) {
    return json(503, { error: "The data service is unavailable." });
  }

  // Resolve the client this request is about: from client_id on start,
  // from the call session afterwards — access is re-checked either way.
  let clientId: string;

  if (body.action === "start") {
    clientId = body.client_id ?? "";
  } else {
    const callSessionId = body.call_session_id ?? "";

    if (!isUuid(callSessionId)) {
      return json(400, { error: "Send the call_session_id." });
    }

    const { data: session } = await admin
      .from("call_sessions")
      .select("client_id")
      .eq("id", callSessionId)
      .maybeSingle();

    if (!session) {
      return json(404, { error: "Call session not found." });
    }

    clientId = session.client_id;
  }

  if (!isUuid(clientId)) {
    return json(400, { error: "Send the client_id." });
  }

  try {
    await resolveVoiceOperatorAccess(authState.user.id, clientId);
  } catch (error) {
    if (isAccessError(error)) {
      return json(error.code === "ACCESS_DENIED" ? 404 : 503, {
        error:
          error.code === "ACCESS_DENIED"
            ? "Client not found or inaccessible."
            : "Access checks are unavailable right now.",
      });
    }

    throw error;
  }

  if (body.action === "start") {
    const result = await startSimulatedCall(admin, {
      clientId,
      fromNumber: body.from_number?.trim() || null,
    });

    return result.ok
      ? json(200, {
          call_session_id: result.callSessionId,
          greeting: result.greeting,
          tools_used: result.toolsUsed,
          runtime: isOpenAIRealtimeConfigured() ? "openai" : "scripted",
          simulated: true,
        })
      : json(502, { error: result.error });
  }

  if (body.action === "caller_turn") {
    const text = (body.text ?? "").trim().slice(0, MAX_TEXT_CHARS);

    if (!text) {
      return json(400, { error: "Send the caller's text." });
    }

    const result = await runSimulatedCallerTurn(
      admin,
      body.call_session_id ?? "",
      text,
    );

    return result.ok
      ? json(200, {
          reply: result.reply,
          tools_used: result.toolsUsed,
          end_call: result.endCall,
          runtime: isOpenAIRealtimeConfigured() ? "openai" : "scripted",
          simulated: true,
        })
      : json(502, { error: result.error });
  }

  if (body.action === "complete") {
    const result = await completeSimulatedCall(
      admin,
      body.call_session_id ?? "",
    );

    return result.ok
      ? json(200, { report: result.report, simulated: true })
      : json(409, { error: result.error });
  }

  return json(400, {
    error: "action must be start, caller_turn, or complete.",
  });
}
