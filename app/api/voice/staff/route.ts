import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getAuthState } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { isAccessError } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveVoiceOperatorAccess } from "@/lib/voice/access";
import {
  addTranscriptTurn,
  completeCallSession,
  createCallSession,
} from "@/lib/voice/sessions";
import { analyzeStaffCall } from "@/lib/voice/staff-assist";

export const dynamic = "force-dynamic";

const RequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    client_id: z.string().uuid(),
    from_number: z.string().trim().min(7).max(40),
    to_number: z.string().trim().max(40).optional(),
  }),
  z.object({
    action: z.literal("turn"),
    call_session_id: z.string().uuid(),
    role: z.enum(["caller", "staff"]),
    text: z.string().trim().min(1).max(4_000),
  }),
  z.object({
    action: z.literal("complete"),
    call_session_id: z.string().uuid(),
  }),
]);

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthState();

  if (!auth.user) {
    return json(401, { error: "Sign in to operate the phone assistant." });
  }

  const rate = await checkRateLimit(`staff-voice:${auth.user.id}`);

  if (!rate.allowed) {
    return json(429, { error: "Slow down a moment and try again." });
  }

  let input: z.infer<typeof RequestSchema>;

  try {
    input = RequestSchema.parse(await request.json());
  } catch {
    return json(400, { error: "The staff-call request was invalid." });
  }

  const admin = createSupabaseAdminClient();

  if (!admin) {
    return json(503, { error: "The data service is unavailable." });
  }

  let clientId = input.action === "start" ? input.client_id : null;
  let session:
    | {
        id: string;
        client_id: string;
        partner_id: string;
        matched_contact_id: string | null;
      }
    | null = null;

  if (input.action !== "start") {
    const { data } = await admin
      .from("call_sessions")
      .select("id, client_id, partner_id, matched_contact_id")
      .eq("id", input.call_session_id)
      .maybeSingle();
    session = data;
    clientId = data?.client_id ?? null;
  }

  if (!clientId) {
    return json(404, { error: "Call session not found." });
  }

  try {
    await resolveVoiceOperatorAccess(auth.user.id, clientId);
  } catch (error) {
    if (isAccessError(error)) {
      return json(error.code === "ACCESS_DENIED" ? 404 : 503, {
        error:
          error.code === "ACCESS_DENIED"
            ? "Call session not found."
            : "Access checks are unavailable.",
      });
    }

    throw error;
  }

  if (input.action === "start") {
    const { data: client } = await admin
      .from("client_businesses")
      .select("partner_id")
      .eq("id", input.client_id)
      .maybeSingle();

    if (!client) return json(404, { error: "Client not found." });

    const created = await createCallSession(admin, {
      partnerId: client.partner_id,
      clientId: input.client_id,
      provider: "staff_assisted",
      direction: "inbound",
      fromNumber: input.from_number,
      toNumber: input.to_number ?? null,
      handlingMode: "staff_assisted",
    });

    if (!created) {
      return json(500, { error: "The call session could not be created." });
    }

    const { data: createdSession } = await admin
      .from("call_sessions")
      .select("matched_contact_id, extracted")
      .eq("id", created.callSessionId)
      .maybeSingle();

    return json(200, {
      call_session_id: created.callSessionId,
      matched_contact_id: createdSession?.matched_contact_id ?? null,
      caller_resolution:
        createdSession?.extracted?.caller_resolution ?? null,
    });
  }

  if (!session) return json(404, { error: "Call session not found." });

  if (input.action === "turn") {
    await addTranscriptTurn(admin, input.call_session_id, {
      role: input.role,
      content: input.text,
    });
    const assist = await analyzeStaffCall(admin, input.call_session_id);

    return json(200, {
      call_session_id: input.call_session_id,
      assist,
    });
  }

  const completed = await completeCallSession(admin, input.call_session_id);

  if (!completed) {
    return json(409, { error: "The call was already completed." });
  }

  return json(200, {
    call_session_id: input.call_session_id,
    completed: true,
    summary: completed.summary,
    ai: completed.ai,
  });
}
