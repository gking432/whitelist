import { NextResponse, type NextRequest } from "next/server";

import { redactAuditValue } from "@/lib/audit/redact";
import {
  generateChatReply,
  type SessionFields,
  type TranscriptTurn,
} from "@/lib/chat/assistant";
import { findConnectionByWidgetKey } from "@/lib/chat/widget";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { getKnowledgeProfile } from "@/lib/knowledge/profile";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runWorkflowsForEvent } from "@/lib/workflows/engine";

export const dynamic = "force-dynamic";

// Public: one visitor message in an existing chat session. The assistant
// answers ONLY from approved knowledge (AI with scripted fallback). When
// the conversation completes with contact details, it becomes a normal
// intake event: chat.conversation_completed → intake router → lead
// workflows → approvals → CRM sync — same rails as every other source.

const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 2000;

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

  let body: { session_id?: string; message?: string };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "Send JSON with session_id and message." });
  }

  const sessionId = body.session_id ?? "";
  const message = (body.message ?? "").trim().slice(0, MAX_MESSAGE_CHARS);

  if (!/^[0-9a-f-]{36}$/i.test(sessionId) || !message) {
    return json(400, { error: "Send JSON with session_id and message." });
  }

  const rate = checkRateLimit(`widget-message:${sessionId}`);

  if (!rate.allowed) {
    return json(429, { error: "Slow down a moment and try again." });
  }

  const admin = createSupabaseAdminClient();

  if (!admin) {
    return json(503, { error: "Chat is unavailable right now." });
  }

  const connection = await findConnectionByWidgetKey(admin, widgetKey);

  if (!connection) {
    return json(404, { error: "This chat widget is not active." });
  }

  const { data: session } = await admin
    .from("chat_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("connection_id", connection.id)
    .maybeSingle();

  if (!session) {
    return json(404, { error: "Chat session not found." });
  }

  if (session.status !== "active") {
    return json(409, {
      error: "This conversation is finished — the team has your details.",
    });
  }

  if (session.message_count >= MAX_MESSAGES) {
    return json(409, {
      error:
        "This conversation reached its length limit. The team will follow up with what you've shared.",
    });
  }

  const transcript = (
    Array.isArray(session.transcript) ? session.transcript : []
  ) as TranscriptTurn[];
  const fields: SessionFields = {
    visitor_name: session.visitor_name,
    visitor_phone: session.visitor_phone,
    visitor_email: session.visitor_email,
    visitor_address: session.visitor_address,
    service_need: session.service_need,
    urgency: session.urgency,
    appointment_preference: session.appointment_preference,
  };

  const knowledge = await getKnowledgeProfile(admin, connection.client_id);
  const now = new Date().toISOString();
  const visitorTurn: TranscriptTurn = {
    role: "visitor",
    content: message,
    at: now,
  };

  const { data: reply } = await generateChatReply({
    clientName: connection.client_name,
    knowledge,
    fields,
    transcript,
    visitorMessage: message,
    isFirstMessage: session.message_count === 0,
  });

  const assistantTurn: TranscriptTurn = {
    role: "assistant",
    content: reply.reply,
    at: new Date().toISOString(),
  };

  const merged = {
    visitor_name: session.visitor_name ?? reply.extracted.name,
    visitor_phone: session.visitor_phone ?? reply.extracted.phone,
    visitor_email: session.visitor_email ?? reply.extracted.email,
    visitor_address: session.visitor_address ?? reply.extracted.address,
    service_need: session.service_need ?? reply.extracted.service_need,
    urgency: session.urgency ?? reply.extracted.urgency,
    appointment_preference:
      session.appointment_preference ?? reply.extracted.appointment_preference,
  };

  const hasContact = Boolean(merged.visitor_phone || merged.visitor_email);
  const shouldComplete =
    (reply.conversation_complete || reply.handoff_requested) && hasContact;

  await admin
    .from("chat_sessions")
    .update({
      ...merged,
      transcript: [...transcript, visitorTurn, assistantTurn],
      message_count: session.message_count + 1,
      status: shouldComplete ? "completed" : "active",
    })
    .eq("id", sessionId);

  // Completed conversation with contact details → normal intake event.
  if (shouldComplete && !session.lead_event_id) {
    const eventData: Record<string, unknown> = {
      name: merged.visitor_name,
      phone: merged.visitor_phone,
      email: merged.visitor_email,
      address: merged.visitor_address,
      message: [
        merged.service_need ? `Service need: ${merged.service_need}` : null,
        merged.appointment_preference
          ? `Appointment preference: ${merged.appointment_preference}`
          : null,
        reply.handoff_requested ? "Visitor asked for a human." : null,
        `Website chat conversation (${session.message_count + 1} messages).`,
      ]
        .filter(Boolean)
        .join(" "),
      service_need: merged.service_need,
      urgency: merged.urgency,
      appointment_preference: merged.appointment_preference,
      channel: "web_chat",
      chat_session_id: sessionId,
    };

    const { data: insertedEvent } = await admin
      .from("integration_events")
      .insert({
        partner_id: connection.partner_id,
        client_id: connection.client_id,
        connection_id: connection.id,
        direction: "inbound",
        event_type: "chat.conversation_completed",
        status: "received",
        idempotency_key: `chat-session-${sessionId}`,
        request_payload: redactAuditValue({
          event_type: "chat.conversation_completed",
          data: eventData,
        }),
        redacted: true,
      })
      .select("id")
      .single();

    if (insertedEvent) {
      await admin
        .from("chat_sessions")
        .update({ lead_event_id: insertedEvent.id })
        .eq("id", sessionId);

      try {
        const engineResult = await runWorkflowsForEvent(admin, {
          id: insertedEvent.id,
          partnerId: connection.partner_id,
          clientId: connection.client_id,
          connectionId: connection.id,
          eventType: "chat.conversation_completed",
          data: eventData,
        });

        await admin
          .from("integration_events")
          .update({
            status: "processed",
            workflow_run_id: engineResult.runs[0]?.runId ?? null,
            response_payload: redactAuditValue({
              matched_instances: engineResult.matchedInstances,
              runs: engineResult.runs,
            }),
          })
          .eq("id", insertedEvent.id);

        await admin
          .from("integration_connections")
          .update({ last_success_at: new Date().toISOString() })
          .eq("id", connection.id);
      } catch (error) {
        await admin
          .from("integration_events")
          .update({
            status: "failed",
            error_code: "engine_failed",
            error_message:
              error instanceof Error
                ? error.message
                : "Workflow engine failed.",
          })
          .eq("id", insertedEvent.id);
      }
    }
  }

  return json(200, {
    reply: reply.reply,
    complete: shouldComplete,
  });
}
