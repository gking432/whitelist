import { redactAuditValue } from "@/lib/audit/redact";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Live assistant event contract (docs/18). One append-only feed per client
// that assistant surfaces consume: the web console and desktop tray read it
// via GET /api/assistant/events (polling); a future browser extension or
// CRM-native overlay can subscribe to the same contract (SSE/WebSocket is
// the documented next step). Emission is best-effort — an event-log
// failure must never break the action that caused it.

export const ASSISTANT_EVENT_TYPES = [
  "active_call_started",
  "transcript_turn_added",
  "lead_detected",
  "appointment_intent_detected",
  "draft_ready",
  "approval_needed",
  "booking_proposed",
  "crm_sync_completed",
  "escalation_needed",
  "call_completed",
] as const;

export type AssistantEventType = (typeof ASSISTANT_EVENT_TYPES)[number];

export type AssistantEventRecord = {
  id: string;
  event_type: AssistantEventType;
  payload: Record<string, unknown>;
  workflow_run_id: string | null;
  approval_id: string | null;
  call_session_id: string | null;
  created_at: string;
};

export async function emitAssistantEvent(input: {
  partnerId: string;
  clientId: string;
  eventType: AssistantEventType;
  payload?: Record<string, unknown>;
  workflowRunId?: string | null;
  approvalId?: string | null;
  callSessionId?: string | null;
}): Promise<void> {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return;
  }

  try {
    await admin.from("assistant_events").insert({
      partner_id: input.partnerId,
      client_id: input.clientId,
      event_type: input.eventType,
      payload: redactAuditValue(input.payload ?? {}),
      workflow_run_id: input.workflowRunId ?? null,
      approval_id: input.approvalId ?? null,
      call_session_id: input.callSessionId ?? null,
    });
  } catch {
    // Best-effort by contract.
  }
}
