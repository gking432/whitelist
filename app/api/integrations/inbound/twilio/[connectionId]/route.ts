import { NextResponse, type NextRequest } from "next/server";

import { redactAuditValue } from "@/lib/audit/redact";
import { getAppUrl } from "@/lib/env";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import type { TwilioCredentials } from "@/lib/integrations/providers/twilio";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { isSecretsEncryptionConfigured } from "@/lib/integrations/secrets";
import { verifyTwilioSignature } from "@/lib/integrations/twilio-signature";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runWorkflowsForEvent } from "@/lib/workflows/engine";

export const dynamic = "force-dynamic";

// Twilio inbound SMS webhook. Point the Twilio phone number's "A message
// comes in" webhook at:
//   {APP_URL}/api/integrations/inbound/twilio/{connectionId}
// (HTTP POST). Requests are authenticated with Twilio's own
// X-Twilio-Signature (HMAC-SHA1 over URL + params with the account auth
// token) — no extra header can be configured in Twilio's console, so the
// signature IS the credential. Replies flow into the intake router as
// sms.received events, closing the conversation loop.

// Twilio expects TwiML back; an empty <Response/> means "no auto-reply".
function twiml(status = 200): NextResponse {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    status,
    headers: { "Content-Type": "text/xml" },
  });
}

function reject(status: number): NextResponse {
  return NextResponse.json({ error: "Rejected." }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) {
    return reject(404);
  }

  const rate = await checkRateLimit(`inbound-twilio:${connectionId}`);

  if (!rate.allowed) {
    return reject(429);
  }

  const supabase = createSupabaseAdminClient();

  if (!supabase || !isSecretsEncryptionConfigured()) {
    return reject(503);
  }

  const { data: connectionData } = await supabase
    .from("integration_connections")
    .select(
      "id, partner_id, client_id, status, error_count, provider:integration_providers!inner(provider_key)",
    )
    .eq("id", connectionId)
    .eq("provider.provider_key", "twilio")
    .maybeSingle();

  const connection = connectionData as {
    id: string;
    partner_id: string;
    client_id: string;
    status: string;
    error_count: number;
  } | null;

  if (!connection) {
    return reject(404);
  }

  const logRejected = async (errorCode: string, errorMessage: string) => {
    await supabase.from("integration_events").insert({
      partner_id: connection.partner_id,
      client_id: connection.client_id,
      connection_id: connection.id,
      direction: "inbound",
      event_type: "sms.received",
      status: "rejected",
      error_code: errorCode,
      error_message: errorMessage,
      redacted: true,
    });
  };

  if (connection.status === "paused" || connection.status === "disabled") {
    await logRejected(
      "connection_inactive",
      `The connection is ${connection.status}; the inbound SMS was not processed.`,
    );

    return twiml();
  }

  const credentials = await readProviderCredentials<TwilioCredentials>(
    supabase,
    connectionId,
  );

  if (!credentials?.authToken) {
    await logRejected(
      "credential_missing",
      "No Twilio credentials are stored for this connection.",
    );

    return reject(401);
  }

  // Twilio posts application/x-www-form-urlencoded.
  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    await logRejected("invalid_body", "The request body was not form-encoded.");

    return reject(400);
  }

  const formParams: Record<string, string> = {};

  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      formParams[key] = value;
    }
  }

  // The signature covers the exact URL Twilio was configured with. We
  // reconstruct it from the canonical app URL so proxies cannot spoof it.
  const webhookUrl = `${getAppUrl()}/api/integrations/inbound/twilio/${connectionId}`;
  const signature = request.headers.get("x-twilio-signature") ?? "";

  if (
    !signature ||
    !verifyTwilioSignature(
      credentials.authToken,
      webhookUrl,
      formParams,
      signature,
    )
  ) {
    await logRejected(
      "invalid_signature",
      "A request was rejected because its Twilio signature did not match.",
    );

    return reject(403);
  }

  const messageSid = formParams.MessageSid ?? formParams.SmsSid ?? null;
  const from = formParams.From ?? "";
  const body = formParams.Body ?? "";

  if (messageSid) {
    const { data: existing } = await supabase
      .from("integration_events")
      .select("id")
      .eq("connection_id", connectionId)
      .eq("idempotency_key", messageSid)
      .eq("direction", "inbound")
      .maybeSingle();

    if (existing) {
      return twiml();
    }
  }

  const eventData: Record<string, unknown> = {
    phone: from,
    message: body,
    to_number: formParams.To ?? null,
    channel: "sms",
    message_sid: messageSid,
  };

  const { data: insertedEvent, error: insertError } = await supabase
    .from("integration_events")
    .insert({
      partner_id: connection.partner_id,
      client_id: connection.client_id,
      connection_id: connection.id,
      direction: "inbound",
      event_type: "sms.received",
      status: "received",
      idempotency_key: messageSid,
      external_object_type: "twilio_message",
      external_object_id: messageSid,
      request_payload: redactAuditValue({ event_type: "sms.received", data: eventData }),
      redacted: true,
    })
    .select("id")
    .single();

  if (insertError || !insertedEvent) {
    // Unique violation: concurrent duplicate delivery already handled it.
    if (insertError?.code === "23505") {
      return twiml();
    }

    return reject(500);
  }

  try {
    const engineResult = await runWorkflowsForEvent(supabase, {
      id: insertedEvent.id,
      partnerId: connection.partner_id,
      clientId: connection.client_id,
      connectionId: connection.id,
      eventType: "sms.received",
      data: eventData,
    });

    await supabase
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

    await supabase
      .from("integration_connections")
      .update({ last_success_at: new Date().toISOString() })
      .eq("id", connection.id);
  } catch (error) {
    await supabase
      .from("integration_events")
      .update({
        status: "failed",
        error_code: "engine_failed",
        error_message:
          error instanceof Error ? error.message : "Workflow engine failed.",
      })
      .eq("id", insertedEvent.id);
  }

  return twiml();
}
