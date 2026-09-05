import type { SupabaseClient } from "@supabase/supabase-js";

import { getKnowledgeProfile } from "@/lib/knowledge/profile";
import {
  buildVoiceAgentInstructions,
  getRealtimeModel,
  getRealtimeVoice,
  type VoiceAgentContext,
} from "@/lib/voice/providers/openai-realtime";
import { toRealtimeTools, type VoiceToolContext } from "@/lib/voice/tools";

export type VoiceRuntimeBootstrap = {
  instructions: string;
  initialInstruction: string;
  model: string;
  voice: string;
  transcriptionModel: string;
  tools: Record<string, unknown>[];
  toolContext: VoiceToolContext;
  connectionId: string;
  providerCallRef: string | null;
};

export async function loadVoiceRuntimeBootstrap(
  admin: SupabaseClient,
  callSessionId: string,
  allowInactiveConnection = false,
): Promise<VoiceRuntimeBootstrap | null> {
  const { data: session } = await admin
    .from("call_sessions")
    .select(
      "id, partner_id, client_id, connection_id, provider, direction, status, disclosure_mode, matched_contact_id, external_ref, extracted",
    )
    .eq("id", callSessionId)
    .maybeSingle();

  if (
    !session ||
    !session.connection_id ||
    session.status !== "in_progress" ||
    session.provider !== "twilio_voice" ||
    session.extracted?.handling_mode !== "ai_answered"
  ) {
    return null;
  }

  const { data: connection } = await admin.from("integration_connections")
    .select("status, runtime_mode").eq("id", session.connection_id)
    .eq("client_id", session.client_id).eq("partner_id", session.partner_id).maybeSingle();
  if (!connection || (!allowInactiveConnection &&
    (connection.status !== "connected" || connection.runtime_mode !== "live"))) return null;

  const [{ data: client }, knowledge] = await Promise.all([
    admin
      .from("client_businesses")
      .select("name")
      .eq("id", session.client_id)
      .maybeSingle(),
    getKnowledgeProfile(admin, session.client_id),
  ]);

  if (!client) return null;

  let matchedContact: VoiceAgentContext["matchedContact"] = null;

  if (session.matched_contact_id) {
    const { data: contact } = await admin
      .from("crm_contacts")
      .select("first_name, last_name, phone, email, address")
      .eq("id", session.matched_contact_id)
      .eq("client_id", session.client_id)
      .maybeSingle();

    if (contact) {
      matchedContact = {
        name:
          [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
          null,
        phone: contact.phone,
        email: contact.email,
        address: contact.address,
      };
    }
  }

  const instructions = buildVoiceAgentInstructions({
    clientName: client.name,
    knowledge,
    disclosureMode:
      session.disclosure_mode === "off" ||
      session.disclosure_mode === "minimal"
        ? session.disclosure_mode
        : "explicit",
    matchedContact,
    direction: session.direction === "outbound" ? "outbound" : "inbound",
  });

  return {
    instructions,
    initialInstruction:
      session.direction === "outbound"
        ? `The customer just answered an outbound call from the business. Introduce yourself briefly, follow the disclosure instructions, and explain that you are calling about ${typeof session.extracted?.callback_reason === "string" ? session.extracted.callback_reason.replaceAll("_", " ") : "their recent request"}. Ask whether now is a good time, then wait.`
        : "The phone call just connected. Greet the caller now as the business's call answerer, following the disclosure instructions. Keep the greeting to one short sentence, then wait for the caller.",
    model: getRealtimeModel(),
    voice: getRealtimeVoice(),
    transcriptionModel:
      process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() ||
      "gpt-4o-mini-transcribe",
    tools: toRealtimeTools(),
    toolContext: {
      callSessionId: session.id,
      partnerId: session.partner_id,
      clientId: session.client_id,
      clientName: client.name,
    },
    connectionId: session.connection_id,
    providerCallRef: session.external_ref,
  };
}
