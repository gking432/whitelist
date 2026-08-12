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
  const requestedSessionId = request.nextUrl.searchParams.get("session");

  if (
    !/^[0-9a-f-]{36}$/i.test(connectionId) ||
    (requestedSessionId !== null &&
      !/^[0-9a-f-]{36}$/i.test(requestedSessionId))
  ) {
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
  const canonicalUrl = `${getAppUrl()}/api/integrations/inbound/twilio-voice/${connectionId}/status${requestedSessionId ? `?session=${encodeURIComponent(requestedSessionId)}` : ""}`;
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
  const callStatus = values.CallStatus?.trim().toLowerCase() ?? "";
  let sessionQuery = admin
    .from("call_sessions")
    .select("id, status, extracted, external_ref")
    .eq("connection_id", connectionId)
    .eq("provider", TWILIO_VOICE_PROVIDER);

  sessionQuery = requestedSessionId
    ? sessionQuery.eq("id", requestedSessionId)
    : sessionQuery.eq("external_ref", callSid);

  const { data: session } = await sessionQuery.maybeSingle();

  if (
    session &&
    requestedSessionId &&
    session.external_ref &&
    session.external_ref !== callSid
  ) {
    return rejectVoiceWebhook(409);
  }

  if (session && requestedSessionId && !session.external_ref && callSid) {
    await admin
      .from("call_sessions")
      .update({ external_ref: callSid })
      .eq("id", session.id)
      .is("external_ref", null);
  }

  if (session?.status === "in_progress" && callStatus === "completed") {
    after(async () => {
      // Twilio emits the status callback alongside the Media Stream stop.
      // Let the gateway's signed transcript deliveries drain first.
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await completeTextVoiceCall(admin, session.id, TWILIO_VOICE_PROVIDER);
    });
  } else if (
    session?.status === "in_progress" &&
    ["busy", "failed", "no-answer", "canceled"].includes(callStatus)
  ) {
    await admin
      .from("call_sessions")
      .update({
        status:
          callStatus === "no-answer" || callStatus === "busy"
            ? "abandoned"
            : "failed",
        ended_at: new Date().toISOString(),
        extracted: {
          ...((session.extracted as Record<string, unknown> | null) ?? {}),
          terminal_status: callStatus,
        },
      })
      .eq("id", session.id)
      .eq("status", "in_progress");
  }

  return twilioVoiceTwiml("");
}
