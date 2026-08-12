import type { SupabaseClient } from "@supabase/supabase-js";

import { redactAuditValue } from "@/lib/audit/redact";
import { getAppUrl } from "@/lib/env";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import {
  completeTwilioCall,
  createOutboundCall,
  type TwilioCredentials,
} from "@/lib/integrations/providers/twilio";
import { toE164Phone } from "@/lib/phone/normalize";
import {
  createCallSession,
  updateCallSessionExtracted,
} from "@/lib/voice/sessions";
import { signVoiceStreamSession } from "@/lib/voice/stream-signature";
import { normalizeVoiceStreamUrl } from "@/lib/voice/stream-url";
import { buildAiStreamTwimlDocument } from "@/lib/voice/twiml-xml";

export type OutboundCallbackReason =
  "lead_callback" | "reschedule" | "reminder";

export type OutboundCallbackResult =
  | { ok: true; callSessionId: string; callSid: string }
  | { ok: false; error: string };

export async function startOutboundAiCallback(
  admin: SupabaseClient,
  input: {
    partnerId: string;
    clientId: string;
    contactId: string;
    reason: OutboundCallbackReason;
    authorizedByUserId: string;
  },
): Promise<OutboundCallbackResult> {
  const streamUrl = normalizeVoiceStreamUrl(
    process.env.NORTHSTAR_VOICE_STREAM_URL,
  );
  const streamSecret = process.env.VOICE_STREAM_SHARED_SECRET?.trim();

  if (!streamUrl || !streamSecret || !process.env.OPENAI_API_KEY?.trim()) {
    return { ok: false, error: "Live AI phone service is not configured." };
  }

  const [{ data: contact }, { data: connectionData }] = await Promise.all([
    admin
      .from("crm_contacts")
      .select("id, phone")
      .eq("id", input.contactId)
      .eq("client_id", input.clientId)
      .maybeSingle(),
    admin
      .from("integration_connections")
      .select(
        "id, status, runtime_mode, provider:integration_providers!inner(provider_key)",
      )
      .eq("partner_id", input.partnerId)
      .eq("client_id", input.clientId)
      .eq("status", "connected")
      .eq("runtime_mode", "live")
      .eq("provider.provider_key", "twilio")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const connection = connectionData as { id: string } | null;
  const toNumber = toE164Phone(contact?.phone);
  if (!toNumber) {
    return { ok: false, error: "This contact needs a valid phone number." };
  }
  if (!connection) {
    return {
      ok: false,
      error: "Connect a live Twilio number before placing AI callbacks.",
    };
  }

  const credentials = await readProviderCredentials<TwilioCredentials>(
    admin,
    connection.id,
  );
  if (
    !credentials?.accountSid ||
    !credentials.authToken ||
    !credentials.fromNumber
  ) {
    return {
      ok: false,
      error: "The live Twilio connection is missing credentials.",
    };
  }

  const created = await createCallSession(admin, {
    partnerId: input.partnerId,
    clientId: input.clientId,
    connectionId: connection.id,
    provider: "twilio_voice",
    direction: "outbound",
    fromNumber: credentials.fromNumber,
    toNumber,
    contactPhone: toNumber,
    handlingMode: "ai_answered",
  });
  if (!created)
    return {
      ok: false,
      error: "The outbound call session could not be created.",
    };

  await updateCallSessionExtracted(admin, created.callSessionId, {
    callback_reason: input.reason,
    authorized_by_user_id: input.authorizedByUserId,
  });

  const statusUrl = `${getAppUrl()}/api/integrations/inbound/twilio-voice/${connection.id}/status?session=${encodeURIComponent(created.callSessionId)}`;
  const turnUrl = `${getAppUrl()}/api/integrations/inbound/twilio-voice/${connection.id}/turn?session=${encodeURIComponent(created.callSessionId)}&attempt=0`;
  const twiml = buildAiStreamTwimlDocument({
    actionUrl: turnUrl,
    callSessionId: created.callSessionId,
    streamUrl,
    streamToken: signVoiceStreamSession(streamSecret, created.callSessionId),
    fallbackSpeech:
      "I'm sorry, the live assistant was interrupted. How can I help today?",
  });

  try {
    const call = await createOutboundCall(credentials, {
      to: toNumber,
      twiml,
      statusCallbackUrl: statusUrl,
    });
    const { error: referenceError } = await admin
      .from("call_sessions")
      .update({ external_ref: call.callSid })
      .eq("id", created.callSessionId);
    if (referenceError) {
      await completeTwilioCall(credentials, call.callSid).catch(
        () => undefined,
      );
      throw new Error(
        "The call started, but its carrier reference could not be saved.",
      );
    }
    await admin.from("integration_events").insert({
      partner_id: input.partnerId,
      client_id: input.clientId,
      connection_id: connection.id,
      direction: "outbound",
      event_type: "call.started",
      status: "processed",
      idempotency_key: call.callSid,
      external_object_type: "twilio_call",
      external_object_id: call.callSid,
      request_payload: redactAuditValue({
        to: toNumber,
        reason: input.reason,
        authorized_by_user_id: input.authorizedByUserId,
      }),
      response_payload: {
        call_session_id: created.callSessionId,
        twilio_status: call.status,
        voice_runtime: "openai_realtime_stream",
      },
      redacted: true,
    });
    return {
      ok: true,
      callSessionId: created.callSessionId,
      callSid: call.callSid,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Twilio could not place the call.";
    await admin
      .from("call_sessions")
      .update({ status: "failed", ended_at: new Date().toISOString() })
      .eq("id", created.callSessionId);
    await admin.from("integration_events").insert({
      partner_id: input.partnerId,
      client_id: input.clientId,
      connection_id: connection.id,
      direction: "outbound",
      event_type: "call.started",
      status: "failed",
      error_code: "outbound_call_failed",
      error_message: message,
      redacted: true,
    });
    return { ok: false, error: message };
  }
}
