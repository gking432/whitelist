import { NextResponse, type NextRequest } from "next/server";

import { getAuthState } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { getKnowledgeProfile } from "@/lib/knowledge/profile";
import { isAccessError } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveVoiceOperatorAccess } from "@/lib/voice/access";
import {
  buildVoiceAgentInstructions,
  isOpenAIRealtimeConfigured,
  mintRealtimeClientSecret,
} from "@/lib/voice/providers/openai-realtime";
import { createCallSession } from "@/lib/voice/sessions";
import { toRealtimeTools } from "@/lib/voice/tools";

export const dynamic = "force-dynamic";

// Mint an ephemeral OpenAI Realtime session for a browser test call
// (docs/21). Session-authenticated (partner operator or client member with
// write access); the OpenAI API key never leaves the server — the response
// carries only a short-lived client secret. A call_sessions row is created
// up front so the WebRTC client can stream transcript turns into the same
// pipeline a phone bridge will use.
//
// POST /api/voice/realtime/session  { client_id: "<uuid>" }

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const authState = await getAuthState();

  if (!authState.user) {
    return json(401, { error: "Sign in to start a voice session." });
  }

  let body: { client_id?: string };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "Send JSON with client_id." });
  }

  const clientId = body.client_id ?? "";

  if (!/^[0-9a-f-]{36}$/i.test(clientId)) {
    return json(400, { error: "Send JSON with client_id." });
  }

  const rate = checkRateLimit(`voice-mint:${authState.user.id}`);

  if (!rate.allowed) {
    return json(429, { error: "Slow down a moment and try again." });
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

  if (!isOpenAIRealtimeConfigured()) {
    return json(503, {
      error:
        "OpenAI Realtime is not configured — set OPENAI_API_KEY on the server.",
    });
  }

  const admin = createSupabaseAdminClient();

  if (!admin) {
    return json(503, { error: "The data service is unavailable." });
  }

  const { data: client } = await admin
    .from("client_businesses")
    .select("id, name, partner_id")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) {
    return json(404, { error: "Client not found or inaccessible." });
  }

  const created = await createCallSession(admin, {
    partnerId: client.partner_id,
    clientId,
    provider: "openai_realtime",
    direction: "inbound",
    handlingMode: "ai_answered",
  });

  if (!created) {
    return json(500, { error: "The call session could not be created." });
  }

  const [{ data: callSession }, knowledge] = await Promise.all([
    admin
      .from("call_sessions")
      .select(
        "matched_contact:crm_contacts(first_name, last_name, phone, email, address)",
      )
      .eq("id", created.callSessionId)
      .maybeSingle(),
    getKnowledgeProfile(admin, clientId),
  ]);
  const match = callSession?.matched_contact as unknown as
    | {
        first_name: string | null;
        last_name: string | null;
        phone: string | null;
        email: string | null;
        address: string | null;
      }
    | null;
  const instructions = buildVoiceAgentInstructions({
    clientName: client.name,
    knowledge,
    disclosureMode: knowledge?.voice_disclosure_mode ?? "explicit",
    matchedContact: match
      ? {
          name:
            [match.first_name, match.last_name].filter(Boolean).join(" ") ||
            null,
          phone: match.phone,
          email: match.email,
          address: match.address,
        }
      : null,
    direction: "inbound",
  });

  const mint = await mintRealtimeClientSecret({
    instructions,
    tools: toRealtimeTools(),
  });

  if (!mint.ok) {
    await admin
      .from("call_sessions")
      .update({ status: "failed", ended_at: new Date().toISOString() })
      .eq("id", created.callSessionId);

    return json(502, { error: mint.error });
  }

  return json(200, {
    call_session_id: created.callSessionId,
    client_secret: mint.clientSecret,
    webrtc_url: mint.webrtcUrl,
    realtime_api: mint.api,
    model: mint.model,
  });
}
