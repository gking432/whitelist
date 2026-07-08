import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { generateStructured, isAIConfigured } from "@/lib/ai/provider";
import type { AIExecutionInfo } from "@/lib/ai/schemas";
import { emitAssistantEvent } from "@/lib/assistant/events";
import { redactAuditValue } from "@/lib/audit/redact";
import {
  buildKnowledgeBlock,
  getKnowledgeProfile,
  KNOWLEDGE_GUARDRAILS,
} from "@/lib/knowledge/profile";
import { runWorkflowsForEvent } from "@/lib/workflows/engine";

// Call session lifecycle (docs/11 Phase 4, docs/20). Voice provider
// adapters call these three functions — createCallSession on ring/answer,
// addTranscriptTurn per utterance, completeCallSession on hangup — and
// everything downstream happens on Northstar's existing rails: AI summary
// with labeled fallback, caller matching, call.completed intake event →
// router → workflows → approvals → CRM sync, and assistant events for
// live popups. All functions take the service-role client and are safe to
// call from webhook handlers.

export const CallSummarySchema = z.object({
  // Short, clean note suitable for the CRM timeline — no filler.
  crm_note: z.string(),
  // Fuller internal summary for the run/audit trail.
  internal_summary: z.string(),
  extracted: z.object({
    name: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    service_need: z.string().nullable(),
    urgency: z.enum(["emergency", "high", "medium", "low"]).nullable(),
    appointment_preference: z.string().nullable(),
  }),
  follow_up_recommendation: z.string(),
});

export type CallSummary = z.infer<typeof CallSummarySchema>;

const CALL_SUMMARY_SYSTEM_PROMPT = `You summarize phone calls for a home service business's CRM.

${KNOWLEDGE_GUARDRAILS}

Rules:
- crm_note: 2-4 clean sentences a dispatcher can act on. No transcript quotes, no filler.
- internal_summary: fuller picture including tone/urgency reasoning.
- Extract contact/job fields only when the caller actually stated them; null otherwise.
- Never invent commitments the business did not make on the call.`;

export type TranscriptTurnInput = {
  role: "caller" | "staff" | "ai_assistant";
  content: string;
  occurredAt?: string;
};

export async function createCallSession(
  admin: SupabaseClient,
  input: {
    partnerId: string;
    clientId: string;
    connectionId?: string | null;
    provider?: string;
    direction?: "inbound" | "outbound";
    fromNumber?: string | null;
    toNumber?: string | null;
    externalRef?: string | null;
  },
): Promise<{ callSessionId: string } | null> {
  // Disclosure mode comes from the client's knowledge profile so the
  // adapter can honor it from the first ring.
  const knowledge = await getKnowledgeProfile(admin, input.clientId);

  // Caller matching by phone number against the built-in CRM.
  let matchedContactId: string | null = null;

  if (input.fromNumber) {
    const { data: match } = await admin
      .from("crm_contacts")
      .select("id")
      .eq("client_id", input.clientId)
      .eq("phone", input.fromNumber)
      .limit(1)
      .maybeSingle();

    matchedContactId = match?.id ?? null;
  }

  const { data: session, error } = await admin
    .from("call_sessions")
    .insert({
      partner_id: input.partnerId,
      client_id: input.clientId,
      connection_id: input.connectionId ?? null,
      provider: input.provider ?? "none",
      direction: input.direction ?? "inbound",
      from_number: input.fromNumber ?? null,
      to_number: input.toNumber ?? null,
      disclosure_mode: knowledge?.voice_disclosure_mode ?? "explicit",
      matched_contact_id: matchedContactId,
      external_ref: input.externalRef ?? null,
    })
    .select("id")
    .single();

  if (error || !session) {
    return null;
  }

  await emitAssistantEvent({
    partnerId: input.partnerId,
    clientId: input.clientId,
    eventType: "active_call_started",
    payload: {
      direction: input.direction ?? "inbound",
      from_number: input.fromNumber ?? null,
      matched_contact_id: matchedContactId,
    },
    callSessionId: session.id,
  });

  return { callSessionId: session.id };
}

export async function addTranscriptTurn(
  admin: SupabaseClient,
  callSessionId: string,
  turn: TranscriptTurnInput,
): Promise<void> {
  const { data: session } = await admin
    .from("call_sessions")
    .select("id, partner_id, client_id")
    .eq("id", callSessionId)
    .maybeSingle();

  if (!session) {
    return;
  }

  const { count } = await admin
    .from("call_transcript_turns")
    .select("id", { count: "exact", head: true })
    .eq("call_session_id", callSessionId);

  await admin.from("call_transcript_turns").insert({
    call_session_id: callSessionId,
    partner_id: session.partner_id,
    client_id: session.client_id,
    seq: (count ?? 0) + 1,
    role: turn.role,
    content: turn.content,
    occurred_at: turn.occurredAt ?? new Date().toISOString(),
  });

  await emitAssistantEvent({
    partnerId: session.partner_id,
    clientId: session.client_id,
    eventType: "transcript_turn_added",
    payload: { role: turn.role, seq: (count ?? 0) + 1 },
    callSessionId,
  });
}

function fallbackCallSummary(
  turns: { role: string; content: string }[],
): CallSummary {
  const callerText = turns
    .filter((turn) => turn.role === "caller")
    .map((turn) => turn.content)
    .join(" ")
    .slice(0, 400);

  return {
    crm_note: callerText
      ? `Call received. Caller said: ${callerText}`
      : "Call received; no transcript captured.",
    internal_summary:
      "Rule-based summary (AI unavailable). Review the full transcript for detail.",
    extracted: {
      name: null,
      phone: null,
      email: null,
      address: null,
      service_need: callerText || null,
      urgency: null,
      appointment_preference: null,
    },
    follow_up_recommendation:
      "Review the transcript and call the customer back.",
  };
}

// Hangup: summarize, match, persist, and hand off to the normal intake
// rails. Never throws.
export async function completeCallSession(
  admin: SupabaseClient,
  callSessionId: string,
): Promise<{ summary: CallSummary; ai: AIExecutionInfo } | null> {
  const { data: session } = await admin
    .from("call_sessions")
    .select("*")
    .eq("id", callSessionId)
    .maybeSingle();

  if (!session || session.status !== "in_progress") {
    return null;
  }

  const { data: turnsData } = await admin
    .from("call_transcript_turns")
    .select("role, content")
    .eq("call_session_id", callSessionId)
    .order("seq", { ascending: true })
    .limit(200);

  const turns = (turnsData ?? []) as { role: string; content: string }[];

  const { data: client } = await admin
    .from("client_businesses")
    .select("name")
    .eq("id", session.client_id)
    .maybeSingle();

  const clientName = client?.name ?? "the business";
  const knowledge = await getKnowledgeProfile(admin, session.client_id);

  let summary: CallSummary;
  let ai: AIExecutionInfo;

  if (!isAIConfigured() || turns.length === 0) {
    summary = fallbackCallSummary(turns);
    ai = { status: "fallback", reason: "not_configured" };
  } else {
    try {
      const transcriptText = turns
        .map((turn) => `${turn.role}: ${turn.content}`)
        .join("\n")
        .slice(0, 20_000);

      const result = await generateStructured({
        taskKey: "call_summary",
        system: CALL_SUMMARY_SYSTEM_PROMPT,
        user: `${buildKnowledgeBlock(clientName, knowledge)}

Call transcript (${session.direction} call for ${clientName}):
${transcriptText}

Summarize this call.`,
        schema: CallSummarySchema,
      });

      summary = result.data;
      ai = {
        status: "ai",
        provider: result.meta.provider,
        model: result.meta.model,
        latency_ms: result.meta.latencyMs,
      };
    } catch (error) {
      summary = fallbackCallSummary(turns);
      ai = {
        status: "fallback",
        reason: "ai_failed",
        error: error instanceof Error ? error.message : "AI request failed.",
      };
    }
  }

  await admin
    .from("call_sessions")
    .update({
      status: "completed",
      ended_at: new Date().toISOString(),
      summary: summary.internal_summary,
      crm_note: summary.crm_note,
      extracted: redactAuditValue(summary.extracted),
    })
    .eq("id", callSessionId);

  await emitAssistantEvent({
    partnerId: session.partner_id,
    clientId: session.client_id,
    eventType: "call_completed",
    payload: { ai_status: ai.status, direction: session.direction },
    callSessionId,
  });

  // The completed call becomes a normal intake event: router classifies
  // it, lead workflows run, approvals gate anything customer-facing, and
  // CRM sync posts the clean note (never the raw transcript).
  const eventData: Record<string, unknown> = {
    name: summary.extracted.name,
    phone: summary.extracted.phone ?? session.from_number,
    email: summary.extracted.email,
    address: summary.extracted.address,
    message: summary.crm_note,
    service_need: summary.extracted.service_need,
    urgency: summary.extracted.urgency,
    appointment_preference: summary.extracted.appointment_preference,
    channel: "phone",
    call_session_id: callSessionId,
  };

  const { data: insertedEvent } = await admin
    .from("integration_events")
    .insert({
      partner_id: session.partner_id,
      client_id: session.client_id,
      connection_id: session.connection_id,
      direction: "inbound",
      event_type: "call.completed",
      status: "received",
      idempotency_key: `call-session-${callSessionId}`,
      request_payload: redactAuditValue({
        event_type: "call.completed",
        data: eventData,
      }),
      redacted: true,
    })
    .select("id")
    .single();

  if (insertedEvent) {
    try {
      const engineResult = await runWorkflowsForEvent(admin, {
        id: insertedEvent.id,
        partnerId: session.partner_id,
        clientId: session.client_id,
        connectionId: session.connection_id,
        eventType: "call.completed",
        data: eventData,
      });

      await admin
        .from("integration_events")
        .update({
          status: "processed",
          workflow_run_id: engineResult.runs[0]?.runId ?? null,
        })
        .eq("id", insertedEvent.id);
    } catch (error) {
      await admin
        .from("integration_events")
        .update({
          status: "failed",
          error_code: "engine_failed",
          error_message:
            error instanceof Error ? error.message : "Workflow engine failed.",
        })
        .eq("id", insertedEvent.id);
    }
  }

  // Timeline note on the matched built-in CRM contact (note, not raw
  // transcript — the transcript stays in call_transcript_turns).
  if (session.matched_contact_id) {
    await admin.from("crm_timeline_entries").insert({
      partner_id: session.partner_id,
      client_id: session.client_id,
      contact_id: session.matched_contact_id,
      kind: "note",
      actor_type: "ai_assistant",
      title: "AI Assistant summarized a call",
      body: summary.crm_note,
    });
  }

  return { summary, ai };
}
