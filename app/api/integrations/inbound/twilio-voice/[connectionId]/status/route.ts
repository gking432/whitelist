import { after, type NextRequest } from "next/server";

import { getAppUrl } from "@/lib/env";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import type { TwilioCredentials } from "@/lib/integrations/providers/twilio";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { isSecretsEncryptionConfigured } from "@/lib/integrations/secrets";
import { verifyTwilioSignature } from "@/lib/integrations/twilio-signature";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { completeTextVoiceCall } from "@/lib/voice/simulate";
import {
  rejectVoiceWebhook,
  TWILIO_VOICE_PROVIDER,
  twilioVoiceTwiml,
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

  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) {
    return rejectVoiceWebhook(404);
  }

  const rate = await checkRateLimit(`twilio-voice-status:${connectionId}`);

  if (!rate.allowed) {
    return rejectVoiceWebhook(429);
  }

  const admin = createSupabaseAdminClient();

  if (!admin || !isSecretsEncryptionConfigured()) {
    return rejectVoiceWebhook(503);
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
  const canonicalUrl = `${getAppUrl()}/api/integrations/inbound/twilio-voice/${connectionId}/status`;
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
    .eq("connection_id", connectionId)
    .eq("provider", TWILIO_VOICE_PROVIDER)
    .eq("external_ref", callSid)
    .maybeSingle();

  if (session?.status === "in_progress") {
    after(async () => {
      // Twilio emits the status callback alongside the Media Stream stop.
      // Let the gateway's signed transcript deliveries drain first.
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await completeTextVoiceCall(admin, session.id, TWILIO_VOICE_PROVIDER);
    });
  }

  return twilioVoiceTwiml("");
}
