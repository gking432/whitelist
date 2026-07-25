import type { NextRequest } from "next/server";

import { redactAuditValue } from "@/lib/audit/redact";
import { getAppUrl } from "@/lib/env";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import type { TwilioCredentials } from "@/lib/integrations/providers/twilio";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { isSecretsEncryptionConfigured } from "@/lib/integrations/secrets";
import { verifyTwilioSignature } from "@/lib/integrations/twilio-signature";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  startTextVoiceCall,
} from "@/lib/voice/simulate";
import {
  gatherTwiml,
  hangupTwiml,
  rejectVoiceWebhook,
  TWILIO_VOICE_PROVIDER,
} from "@/lib/voice/twilio-gather";

export const dynamic = "force-dynamic";

type TwilioConnection = {
  id: string;
  partner_id: string;
  client_id: string;
  status: string;
  runtime_mode: string;
};

function formValues(form: FormData): Record<string, string> {
  const values: Record<string, string> = {};

  for (const [key, value] of form.entries()) {
    if (typeof value === "string") values[key] = value;
  }

  return values;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) {
    return rejectVoiceWebhook(404);
  }

  const rate = checkRateLimit(`inbound-twilio-voice:${connectionId}`);

  if (!rate.allowed) {
    return rejectVoiceWebhook(429);
  }

  const admin = createSupabaseAdminClient();

  if (!admin || !isSecretsEncryptionConfigured()) {
    return rejectVoiceWebhook(503);
  }

  const { data: connectionData } = await admin
    .from("integration_connections")
    .select(
      "id, partner_id, client_id, status, runtime_mode, provider:integration_providers!inner(provider_key)",
    )
    .eq("id", connectionId)
    .eq("provider.provider_key", "twilio")
    .maybeSingle();
  const connection = connectionData as TwilioConnection | null;

  if (!connection) {
    return rejectVoiceWebhook(404);
  }

  if (connection.status === "paused" || connection.status === "disabled") {
    return hangupTwiml(
      "This phone assistant is temporarily unavailable. Please try again later.",
    );
  }

  const credentials = await readProviderCredentials<TwilioCredentials>(
    admin,
    connectionId,
  );

  if (!credentials?.authToken) {
    return rejectVoiceWebhook(401);
  }

  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return rejectVoiceWebhook(400);
  }

  const values = formValues(form);
  const webhookUrl = `${getAppUrl()}/api/integrations/inbound/twilio-voice/${connectionId}`;
  const signature = request.headers.get("x-twilio-signature") ?? "";

  if (
    !signature ||
    !verifyTwilioSignature(
      credentials.authToken,
      webhookUrl,
      values,
      signature,
    )
  ) {
    return rejectVoiceWebhook(403);
  }

  const callSid = values.CallSid?.trim();

  if (!callSid) {
    return rejectVoiceWebhook(400);
  }

  const { data: existing } = await admin
    .from("call_sessions")
    .select("id, status")
    .eq("connection_id", connectionId)
    .eq("provider", TWILIO_VOICE_PROVIDER)
    .eq("external_ref", callSid)
    .maybeSingle();

  if (existing?.status === "in_progress") {
    return gatherTwiml({
      connectionId,
      callSessionId: existing.id,
      speech: "How can I help today?",
    });
  }

  if (existing) {
    return hangupTwiml("Thanks for calling. Goodbye.");
  }

  const started = await startTextVoiceCall(admin, {
    clientId: connection.client_id,
    provider: TWILIO_VOICE_PROVIDER,
    connectionId,
    fromNumber: values.From ?? null,
    toNumber: values.To ?? credentials.fromNumber ?? null,
    externalRef: callSid,
  });

  if (!started.ok) {
    await admin.from("integration_events").insert({
      partner_id: connection.partner_id,
      client_id: connection.client_id,
      connection_id: connectionId,
      direction: "inbound",
      event_type: "call.started",
      status: "failed",
      external_object_type: "twilio_call",
      external_object_id: callSid,
      error_code: "voice_start_failed",
      error_message: started.error,
      redacted: true,
    });

    return hangupTwiml(
      "The phone assistant is unavailable. The team has been notified.",
    );
  }

  await admin.from("integration_events").insert({
    partner_id: connection.partner_id,
    client_id: connection.client_id,
    connection_id: connectionId,
    direction: "inbound",
    event_type: "call.started",
    status: "processed",
    idempotency_key: callSid,
    external_object_type: "twilio_call",
    external_object_id: callSid,
    request_payload: redactAuditValue({
      from: values.From ?? null,
      to: values.To ?? null,
      runtime_mode: connection.runtime_mode,
    }),
    response_payload: {
      call_session_id: started.callSessionId,
      voice_runtime: process.env.OPENAI_API_KEY ? "openai" : "scripted",
    },
    redacted: true,
  });

  return gatherTwiml({
    connectionId,
    callSessionId: started.callSessionId,
    speech: started.greeting,
  });
}
