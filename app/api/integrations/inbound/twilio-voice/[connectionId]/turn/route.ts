import { after, type NextRequest } from "next/server";

import { getAppUrl } from "@/lib/env";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import type { TwilioCredentials } from "@/lib/integrations/providers/twilio";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { isSecretsEncryptionConfigured } from "@/lib/integrations/secrets";
import { verifyTwilioSignature } from "@/lib/integrations/twilio-signature";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  completeTextVoiceCall,
  runTextVoiceCallerTurn,
} from "@/lib/voice/simulate";
import {
  gatherTwiml,
  hangupTwiml,
  rejectVoiceWebhook,
  TWILIO_VOICE_PROVIDER,
} from "@/lib/voice/twilio-gather";

export const dynamic = "force-dynamic";

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
  const sessionId = request.nextUrl.searchParams.get("session") ?? "";
  const attempt = Math.max(
    0,
    Number.parseInt(request.nextUrl.searchParams.get("attempt") ?? "0", 10) ||
      0,
  );

  if (
    !/^[0-9a-f-]{36}$/i.test(connectionId) ||
    !/^[0-9a-f-]{36}$/i.test(sessionId)
  ) {
    return rejectVoiceWebhook(404);
  }

  const rate = checkRateLimit(`twilio-voice-turn:${sessionId}`);

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
      "id, status, provider:integration_providers!inner(provider_key)",
    )
    .eq("id", connectionId)
    .eq("provider.provider_key", "twilio")
    .maybeSingle();

  if (!connectionData || ["paused", "disabled"].includes(connectionData.status)) {
    return hangupTwiml("This phone assistant is no longer available.");
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
  const canonicalUrl =
    `${getAppUrl()}/api/integrations/inbound/twilio-voice/${connectionId}/turn` +
    `?session=${encodeURIComponent(sessionId)}&attempt=${attempt}`;
  const signature = request.headers.get("x-twilio-signature") ?? "";

  if (
    !signature ||
    !verifyTwilioSignature(
      credentials.authToken,
      canonicalUrl,
      values,
      signature,
    )
  ) {
    return rejectVoiceWebhook(403);
  }

  const callSid = values.CallSid?.trim() ?? "";
  const { data: session } = await admin
    .from("call_sessions")
    .select("id, status")
    .eq("id", sessionId)
    .eq("connection_id", connectionId)
    .eq("provider", TWILIO_VOICE_PROVIDER)
    .eq("external_ref", callSid)
    .maybeSingle();

  if (!session) {
    return rejectVoiceWebhook(404);
  }

  if (session.status !== "in_progress") {
    return hangupTwiml("Thanks for calling. Goodbye.");
  }

  const callerText = values.SpeechResult?.trim() ?? "";

  if (!callerText) {
    if (attempt >= 1) {
      after(() =>
        completeTextVoiceCall(admin, sessionId, TWILIO_VOICE_PROVIDER),
      );
      return hangupTwiml(
        "I could not hear a response. The team will see that you called. Goodbye.",
      );
    }

    return gatherTwiml({
      connectionId,
      callSessionId: sessionId,
      attempt: attempt + 1,
      speech: "Sorry, I did not catch that. Please say that again.",
    });
  }

  const result = await runTextVoiceCallerTurn(
    admin,
    sessionId,
    callerText,
    TWILIO_VOICE_PROVIDER,
  );

  if (!result.ok) {
    after(() =>
      completeTextVoiceCall(admin, sessionId, TWILIO_VOICE_PROVIDER),
    );
    return hangupTwiml(
      "I am having trouble right now. The team will see your call and follow up.",
    );
  }

  if (result.endCall) {
    after(() =>
      completeTextVoiceCall(admin, sessionId, TWILIO_VOICE_PROVIDER),
    );
    return hangupTwiml(result.reply);
  }

  return gatherTwiml({
    connectionId,
    callSessionId: sessionId,
    speech:
      result.reply ??
      "I saved that for the team. Is there anything else I should include?",
  });
}
