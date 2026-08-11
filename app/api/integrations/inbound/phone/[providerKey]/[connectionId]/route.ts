import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { redactAuditValue } from "@/lib/audit/redact";
import { emitAssistantEvent } from "@/lib/assistant/events";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { decryptSecret, safeEqualSecrets } from "@/lib/integrations/secrets";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { addTranscriptTurn, completeCallSession, createCallSession, updateCallSessionExtracted } from "@/lib/voice/sessions";
import { runWorkflowsForEvent } from "@/lib/workflows/engine";

export const dynamic = "force-dynamic";
const PROVIDERS = ["ringcentral", "dialpad", "openphone"] as const;
type ProviderKey = (typeof PROVIDERS)[number];

function secureEqualBuffer(expected: Buffer, provided: Buffer) {
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function verifyDialpadJwt(raw: string, secrets: string[]) {
  const [header, payload, signature, extra] = raw.trim().split(".");
  if (!header || !payload || !signature || extra) return null;
  try {
    const parsedHeader = JSON.parse(Buffer.from(header, "base64url").toString()) as { alg?: string };
    if (parsedHeader.alg !== "HS256") return null;
    const valid = secrets.some((secret) => secureEqualBuffer(createHmac("sha256", secret).update(`${header}.${payload}`).digest(), Buffer.from(signature, "base64url")));
    if (!valid) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>;
    if (typeof decoded.exp === "number" && decoded.exp * 1000 < Date.now() - 60_000) return null;
    return decoded;
  } catch { return null; }
}

function verifyOpenPhone(raw: string, header: string, secrets: string[]) {
  for (const candidate of header.split(",")) {
    const [scheme, version, timestamp, digest] = candidate.trim().split(";");
    if (scheme !== "hmac" || version !== "1" || !timestamp || !digest) continue;
    const timestampMs = Number(timestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60_000) continue;
    const valid = secrets.some((secret) => {
      try {
        const calculated = createHmac("sha256", Buffer.from(secret, "base64")).update(`${timestamp}.${raw}`).digest();
        return secureEqualBuffer(calculated, Buffer.from(digest, "base64"));
      } catch { return false; }
    });
    if (valid) return true;
  }
  return false;
}

function object(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function string(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }

function normalize(provider: ProviderKey, payload: Record<string, unknown>) {
  if (provider === "openphone") {
    const data = object(object(payload.data).object);
    const type = string(payload.type) ?? string(data.object) ?? "unknown";
    const participants = Array.isArray(data.participants) ? data.participants.filter((value): value is string => typeof value === "string") : [];
    const direction = data.direction === "outgoing" ? "outbound" : "inbound";
    return { type, id: string(payload.id) ?? `${type}:${string(data.id) ?? string(data.callId) ?? Date.now()}`, externalRef: string(data.callId) ?? string(data.id), from: type.startsWith("message") ? string(data.from) : direction === "inbound" ? participants[0] ?? null : null, to: type.startsWith("message") ? (Array.isArray(data.to) ? string(data.to[0]) : string(data.to)) : direction === "outbound" ? participants[0] ?? null : null, direction, data };
  }
  if (provider === "ringcentral") {
    const body = object(payload.body);
    const parties = Array.isArray(body.parties) ? body.parties.map(object) : [];
    const party = parties.find((value) => value.direction === "Inbound") ?? parties[0] ?? {};
    const from = object(party.from);
    const to = object(party.to);
    const event = string(payload.event) ?? "";
    const state = string(object(party.status).code) ?? string(body.status) ?? "";
    const isMessage = event.includes("message-store") || Boolean(body.messageStatus) || Boolean(body.subject);
    const type = isMessage ? "message.received" : /ring/i.test(state) ? "call.ringing" : /disconnected|gone|finished|answered/i.test(state) ? "call.completed" : "call.updated";
    return { type, id: string(payload.uuid) ?? `${type}:${string(body.telephonySessionId) ?? string(body.id) ?? Date.now()}`, externalRef: string(body.telephonySessionId) ?? string(body.sessionId) ?? string(body.id), from: string(from.phoneNumber) ?? string(body.from), to: string(to.phoneNumber) ?? string(body.to), direction: party.direction === "Outbound" ? "outbound" : "inbound", data: body };
  }
  const event = object(payload.event);
  const state = string(payload.call_state) ?? string(payload.state) ?? string(event.state) ?? "";
  const isMessage = Boolean(payload.text) || Boolean(payload.message) || string(payload.event_type)?.includes("sms");
  const type = isMessage ? "message.received" : /ring/i.test(state) ? "call.ringing" : /hangup|completed|ended/i.test(state) ? "call.completed" : "call.updated";
  return { type, id: string(payload.event_id) ?? string(payload.id) ?? `${type}:${string(payload.call_id) ?? Date.now()}`, externalRef: string(payload.call_id) ?? string(event.call_id) ?? string(payload.id), from: string(payload.external_number) ?? string(payload.from_number) ?? string(payload.from), to: string(payload.internal_number) ?? string(payload.to_number) ?? string(payload.to), direction: payload.direction === "outbound" ? "outbound" : "inbound", data: payload };
}

async function findCall(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, connectionId: string, externalRef: string | null) {
  if (!externalRef) return null;
  const { data } = await admin.from("call_sessions").select("id, status, partner_id, client_id").eq("connection_id", connectionId).eq("external_ref", externalRef).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ providerKey: string; connectionId: string }> }) {
  const { providerKey: rawProvider, connectionId } = await params;
  if (!PROVIDERS.includes(rawProvider as ProviderKey) || !/^[0-9a-f-]{36}$/i.test(connectionId)) return NextResponse.json({ error: "Unknown endpoint." }, { status: 404 });
  const provider = rawProvider as ProviderKey;
  const validationToken = request.headers.get("validation-token");
  if (provider === "ringcentral" && validationToken) return new NextResponse(null, { status: 200, headers: { "Validation-Token": validationToken } });
  const rate = await checkRateLimit(`phone:${provider}:${connectionId}`);
  if (!rate.allowed) return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Unavailable." }, { status: 503 });
  const { data: connection } = await admin.from("integration_connections").select("id, partner_id, client_id, status, provider:integration_providers!inner(provider_key)").eq("id", connectionId).eq("provider.provider_key", provider).maybeSingle();
  if (!connection || ["paused", "disabled"].includes(connection.status)) return NextResponse.json({ error: "Unknown endpoint." }, { status: 404 });
  const { data: secretRows } = await admin.from("integration_secrets").select("encrypted_value").eq("connection_id", connectionId).like("secret_kind", "provider_webhook_secret:%");
  const secrets = (secretRows ?? []).flatMap((row) => { try { return [decryptSecret(row.encrypted_value)]; } catch { return []; } });
  const raw = await request.text();
  if (raw.length > 256 * 1024) return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  let payload: Record<string, unknown> | null = null;
  if (provider === "dialpad") payload = verifyDialpadJwt(raw, secrets);
  else {
    if (provider === "ringcentral" && !secrets.some((secret) => safeEqualSecrets(secret, request.headers.get("validation-token") ?? ""))) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    if (provider === "openphone" && !verifyOpenPhone(raw, request.headers.get("openphone-signature") ?? "", secrets)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    try { payload = object(JSON.parse(raw)); } catch { payload = null; }
  }
  if (!payload) return NextResponse.json({ error: "Unauthorized or invalid payload." }, { status: 401 });
  const event = normalize(provider, payload);
  const { data: existing } = await admin.from("integration_events").select("id").eq("connection_id", connectionId).eq("direction", "inbound").eq("idempotency_key", event.id).maybeSingle();
  if (existing) return NextResponse.json({ event_id: existing.id, duplicate: true });
  const { data: inserted, error: insertError } = await admin.from("integration_events").insert({ partner_id: connection.partner_id, client_id: connection.client_id, connection_id: connection.id, direction: "inbound", event_type: event.type === "message.received" ? "sms.received" : event.type, status: "received", idempotency_key: event.id.slice(0, 255), request_payload: redactAuditValue({ provider, event_type: event.type, data: event.data }), redacted: true }).select("id").single();
  if (insertError || !inserted) return NextResponse.json({ error: "Event could not be stored." }, { status: 500 });
  try {
    let call = await findCall(admin, connectionId, event.externalRef);
    if (event.type.startsWith("call.") && !call) {
      const created = await createCallSession(admin, { partnerId: connection.partner_id, clientId: connection.client_id, connectionId, provider, direction: event.direction as "inbound" | "outbound", fromNumber: event.from, toNumber: event.to, externalRef: event.externalRef, handlingMode: "staff_assisted" });
      if (created) call = { id: created.callSessionId, status: "in_progress", partner_id: connection.partner_id, client_id: connection.client_id };
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
    if (call && event.type === "call.completed" && call.status === "in_progress") await completeCallSession(admin, call.id);
    if (event.type === "message.received") {
      const text = string(event.data.text) ?? string(event.data.message) ?? string(event.data.subject);
      const result = await runWorkflowsForEvent(admin, { id: inserted.id, partnerId: connection.partner_id, clientId: connection.client_id, connectionId, eventType: "sms.received", data: { phone: event.from, message: text, source: provider } });
      await emitAssistantEvent({ partnerId: connection.partner_id, clientId: connection.client_id, eventType: "lead_detected", payload: { channel: "sms", phone: event.from, message: text, provider } });
      await admin.from("integration_events").update({ workflow_run_id: result.runs[0]?.runId ?? null }).eq("id", inserted.id);
    }
    await admin.from("integration_events").update({ status: "processed" }).eq("id", inserted.id);
    await admin.from("integration_connections").update({ status: "connected", last_success_at: new Date().toISOString(), health_summary: "Receiving live phone events." }).eq("id", connectionId);
    return NextResponse.json({ event_id: inserted.id, processed: true }, { status: 202 });
  } catch (error) {
    await admin.from("integration_events").update({ status: "failed", error_code: "processing_failed", error_message: error instanceof Error ? error.message : "Phone event processing failed." }).eq("id", inserted.id);
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }
}
