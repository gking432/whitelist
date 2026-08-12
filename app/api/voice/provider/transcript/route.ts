import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { addTranscriptTurn } from "@/lib/voice/sessions";
import { analyzeStaffCall } from "@/lib/voice/staff-assist";
import { verifyVoiceStreamPayload } from "@/lib/voice/stream-signature";

export const dynamic = "force-dynamic";

const TranscriptSchema = z.object({
  call_session_id: z.string().uuid(),
  role: z.enum(["caller", "staff", "ai_assistant"]),
  text: z.string().trim().min(1).max(4_000),
  source_event_id: z.string().trim().min(1).max(200),
  occurred_at: z.string().datetime().optional(),
});

export async function POST(request: NextRequest) {
  const secret = process.env.VOICE_STREAM_SHARED_SECRET;

  if (!secret) {
    return NextResponse.json({ error: "Voice stream is not configured." }, { status: 503 });
  }

  const body = await request.text();
  const valid = verifyVoiceStreamPayload({
    secret,
    timestamp: request.headers.get("x-northstar-timestamp"),
    signature: request.headers.get("x-northstar-signature"),
    body,
  });

  if (!valid) {
    return NextResponse.json({ error: "Invalid voice stream signature." }, { status: 401 });
  }

  let input: z.infer<typeof TranscriptSchema>;

  try {
    input = TranscriptSchema.parse(JSON.parse(body));
  } catch {
    return NextResponse.json({ error: "Invalid transcript event." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  if (!admin) {
    return NextResponse.json({ error: "Data service unavailable." }, { status: 503 });
  }

  const { data: session } = await admin
    .from("call_sessions")
    .select("id, status, extracted")
    .eq("id", input.call_session_id)
    .eq("status", "in_progress")
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: "Active call not found." }, { status: 404 });
  }

  const inserted = await addTranscriptTurn(admin, input.call_session_id, {
    role: input.role,
    content: input.text,
    occurredAt: input.occurred_at,
    sourceEventId: input.source_event_id,
  });

  if (!inserted) {
    return NextResponse.json({ accepted: true, duplicate: true });
  }

  const assist =
    session.extracted?.handling_mode === "staff_assisted"
      ? await analyzeStaffCall(admin, input.call_session_id)
      : null;

  return NextResponse.json({ accepted: true, assist });
}
