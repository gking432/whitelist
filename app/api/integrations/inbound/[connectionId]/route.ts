import { after, NextResponse, type NextRequest } from "next/server";

import { redactAuditValue } from "@/lib/audit/redact";
import {
  decryptSecret,
  isSecretsEncryptionConfigured,
  safeEqualSecrets,
} from "@/lib/integrations/secrets";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enqueueInboundEvent, processInboundEventJobs } from "@/lib/integrations/inbound/queue";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;
const TOKEN_HEADER = "x-webhook-token";

type ConnectionRow = {
  id: string;
  partner_id: string;
  client_id: string;
  display_name: string;
  status: string;
  error_count: number;
  provider: { provider_key: string; supports_inbound: boolean } | null;
};

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

// Rejected attempts are logged without credentials or raw payloads so the
// partner can investigate misconfigured senders safely.
async function logRejectedEvent(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  connection: ConnectionRow,
  errorCode: string,
  errorMessage: string,
  eventType = "unknown",
) {
  await supabase.from("integration_events").insert({
    partner_id: connection.partner_id,
    client_id: connection.client_id,
    connection_id: connection.id,
    direction: "inbound",
    event_type: eventType,
    status: "rejected",
    error_code: errorCode,
    error_message: errorMessage,
    redacted: true,
  });

  await supabase
    .from("integration_connections")
    .update({
      last_failure_at: new Date().toISOString(),
      error_count: connection.error_count + 1,
    })
    .eq("id", connection.id);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) {
    return json(404, { error: "Unknown endpoint." });
  }

  const rate = await checkRateLimit(`inbound:${connectionId}`);

  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  const supabase = createSupabaseAdminClient();

  if (!supabase || !isSecretsEncryptionConfigured()) {
    return json(503, { error: "Webhook intake is not configured." });
  }

  const { data: connectionData, error: connectionError } = await supabase
    .from("integration_connections")
    .select(
      "id, partner_id, client_id, display_name, status, error_count, provider:integration_providers(provider_key, supports_inbound)",
    )
    .eq("id", connectionId)
    .maybeSingle();

  const connection = connectionData as ConnectionRow | null;

  // Any inbound-capable provider (generic webhook, web chat intake, future
  // channel providers) shares this secured intake path.
  if (
    connectionError ||
    !connection ||
    !connection.provider?.supports_inbound
  ) {
    return json(404, { error: "Unknown endpoint." });
  }

  // Authenticate before anything else; never log the provided value.
  const providedToken = request.headers.get(TOKEN_HEADER) ?? "";

  const { data: secretRow } = await supabase
    .from("integration_secrets")
    .select("encrypted_value")
    .eq("connection_id", connectionId)
    .eq("secret_kind", "webhook_token")
    .maybeSingle();

  if (!secretRow) {
    await logRejectedEvent(
      supabase,
      connection,
      "credential_missing",
      "No credential is configured for this connection.",
    );

    return json(401, { error: "Unauthorized." });
  }

  let expectedToken: string;

  try {
    expectedToken = decryptSecret(secretRow.encrypted_value);
  } catch {
    await logRejectedEvent(
      supabase,
      connection,
      "credential_unreadable",
      "The stored credential could not be read. Rotate the credential.",
    );

    return json(401, { error: "Unauthorized." });
  }

  if (!providedToken || !safeEqualSecrets(expectedToken, providedToken)) {
    await logRejectedEvent(
      supabase,
      connection,
      "invalid_token",
      "A request was rejected because its credential did not match.",
    );

    return json(401, { error: "Unauthorized." });
  }

  if (connection.status === "paused" || connection.status === "disabled") {
    await logRejectedEvent(
      supabase,
      connection,
      "connection_inactive",
      `The connection is ${connection.status}; the event was not processed.`,
    );

    return json(409, { error: `Connection is ${connection.status}.` });
  }

  const rawBody = await request.text();

  if (rawBody.length > MAX_BODY_BYTES) {
    await logRejectedEvent(
      supabase,
      connection,
      "payload_too_large",
      "The request payload exceeded the 64KB limit.",
    );

    return json(413, { error: "Payload too large." });
  }

  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    await logRejectedEvent(
      supabase,
      connection,
      "invalid_json",
      "The request body was not valid JSON.",
    );

    return json(400, { error: "Body must be valid JSON." });
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    await logRejectedEvent(
      supabase,
      connection,
      "invalid_envelope",
      "The request body must be a JSON object.",
    );

    return json(400, { error: "Body must be a JSON object." });
  }

  const envelope = payload as Record<string, unknown>;
  const eventType =
    typeof envelope.event_type === "string" ? envelope.event_type.trim() : "";

  if (!eventType) {
    await logRejectedEvent(
      supabase,
      connection,
      "missing_event_type",
      "The event envelope is missing the required event_type field.",
    );

    return json(400, { error: "event_type is required." });
  }

  const idempotencyKey =
    typeof envelope.idempotency_key === "string" &&
    envelope.idempotency_key.trim().length > 0
      ? envelope.idempotency_key.trim().slice(0, 255)
      : null;

  const data =
    typeof envelope.data === "object" &&
    envelope.data !== null &&
    !Array.isArray(envelope.data)
      ? (envelope.data as Record<string, unknown>)
      : {};

  try {
    const receipt = await enqueueInboundEvent(supabase, {
      partnerId: connection.partner_id, clientId: connection.client_id, connectionId,
      eventType, idempotencyKey: idempotencyKey ?? createHash("sha256").update(rawBody).digest("hex"), data,
    });
    after(() => processInboundEventJobs(supabase, 1, receipt.eventId));
    return json(202, { event_id: receipt.eventId, duplicate: receipt.duplicate, status: receipt.status });
  } catch {
    return json(503, { error: "The event could not be committed to the processing queue." });
  }
}
