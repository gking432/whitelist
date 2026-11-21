import type { SupabaseClient } from "@supabase/supabase-js";
import { emitAssistantEvent } from "@/lib/assistant/events";
import { addTranscriptTurn, createCallSession, updateCallSessionExtracted } from "@/lib/voice/sessions";
import { enqueueVoiceFinalization } from "@/lib/voice/finalization";
import { runWorkflowsForEvent } from "@/lib/workflows/engine";
import { normalizePhoneWebhook, type ProviderKey } from "./phone-webhooks";
function object(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function string(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
async function findCall(admin: SupabaseClient, connectionId: string, externalRef: string | null) {
  if (!externalRef) return null;
  const { data } = await admin.from("call_sessions").select("id, status, partner_id, client_id").eq("connection_id", connectionId).eq("external_ref", externalRef).order("created_at", { ascending: false }).limit(1).maybeSingle().throwOnError();
  return data;
}
export async function processPhoneProviderEvent(admin: SupabaseClient, input: {
  event_id: string; partner_id: string; client_id: string; connection_id: string; data: Record<string, unknown>;
}) {
  const provider = input.data.provider as ProviderKey;
  const connectionId = input.connection_id;
  const event = normalizePhoneWebhook(provider, object(input.data.payload));
    let call = await findCall(admin, connectionId, event.externalRef);
    if (event.type.startsWith("call.") && !call) {
      const created = await createCallSession(admin, { partnerId: input.partner_id, clientId: input.client_id, connectionId, provider, direction: event.direction as "inbound" | "outbound", fromNumber: event.from, toNumber: event.to, externalRef: event.externalRef, handlingMode: "staff_assisted" });
      if (!created) throw new Error("Call session could not be created.");
      call = { id: created.callSessionId, status: "in_progress", partner_id: input.partner_id, client_id: input.client_id };
    }
    if (call && (event.type.includes("transcript") || Array.isArray(event.data.dialogue))) {
      const dialogue = Array.isArray(event.data.dialogue) ? event.data.dialogue.map(object) : [];
      for (let index = 0; index < dialogue.length; index += 1) {
        const turn = dialogue[index]; const content = string(turn.content);
        if (content) await addTranscriptTurn(admin, call.id, { role: turn.userId ? "staff" : "caller", content, sourceEventId: `${event.id}:${index}` });
      }
    }
    if (call && (event.type.includes("summary") || event.data.summary)) {
      await updateCallSessionExtracted(admin, call.id, { provider_summary: event.data.summary ?? null, provider_next_steps: event.data.nextSteps ?? null });
    }
    if (call && event.type === "call.completed" && call.status === "in_progress") await enqueueVoiceFinalization(admin, call.id);
    let runId: string | null = null;
    if (event.type === "message.received") {
      const text = string(event.data.text) ?? string(event.data.message) ?? string(event.data.subject);
      const result = await runWorkflowsForEvent(admin, { id: input.event_id, partnerId: input.partner_id, clientId: input.client_id, connectionId, eventType: "sms.received", data: { phone: event.from, message: text, source: provider } });
      await emitAssistantEvent({ partnerId: input.partner_id, clientId: input.client_id, eventType: "lead_detected", payload: { channel: "sms", phone: event.from, message: text, provider } });
      if (result.runs.some((run) => run.status === "failed")) throw new Error("Phone message workflow failed.");
      runId = result.runs[0]?.runId ?? null;
    }

  return runId;
}
