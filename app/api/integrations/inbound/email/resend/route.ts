import { NextResponse, type NextRequest } from "next/server";

import { redactAuditValue } from "@/lib/audit/redact";
import { getResendInboundConfig } from "@/lib/env";
import {
  parseForwardedLeadEmail,
  verifyResendWebhookSignature,
} from "@/lib/integrations/providers/resend-inbound";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runWorkflowsForEvent } from "@/lib/workflows/engine";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const config = getResendInboundConfig(); if (!config) return NextResponse.json({ error: "Unavailable." }, { status: 503 });
  const rate = await checkRateLimit("resend:inbound"); if (!rate.allowed) return NextResponse.json({ error: "Rate limited." }, { status: 429 });
  const raw = await request.text(); if (!verifyResendWebhookSignature({ rawBody: raw, messageId: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signatures: request.headers.get("svix-signature"), secret: config.webhookSecret })) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  let event: { type?: string; data?: { email_id?: string; to?: string[]; from?: string; subject?: string; message_id?: string } }; try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid payload." }, { status: 400 }); }
  if (event.type !== "email.received" || !event.data?.email_id) return NextResponse.json({ received: true });
  const recipient = event.data.to?.map((value) => value.toLowerCase()).find((value) => value.endsWith(`@${config.domain.toLowerCase()}`)); if (!recipient) return NextResponse.json({ received: true, routed: false });
  const admin = createSupabaseAdminClient(); if (!admin) return NextResponse.json({ error: "Unavailable." }, { status: 503 });
  const { data: connection } = await admin.from("integration_connections").select("id, partner_id, client_id, status, provider:integration_providers!inner(provider_key)").eq("external_account_id", recipient).eq("provider.provider_key", "universal_lead_email").maybeSingle();
  if (!connection || connection.status !== "connected") return NextResponse.json({ received: true, routed: false });
  const idempotencyKey = request.headers.get("svix-id") ?? event.data.email_id; const { data: duplicate } = await admin.from("integration_events").select("id").eq("connection_id", connection.id).eq("idempotency_key", idempotencyKey).maybeSingle(); if (duplicate) return NextResponse.json({ received: true, duplicate: true });
  const emailResponse = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(event.data.email_id)}`, { headers: { Authorization: `Bearer ${config.apiKey}` }, signal: AbortSignal.timeout(15_000) });
  if (!emailResponse.ok) return NextResponse.json({ error: "Email body retrieval failed." }, { status: 502 });
  const email = await emailResponse.json() as Record<string, unknown>; const eventData = parseForwardedLeadEmail({ email, fallbackFrom: event.data.from, fallbackSubject: event.data.subject });
  const { data: inserted } = await admin.from("integration_events").insert({ partner_id: connection.partner_id, client_id: connection.client_id, connection_id: connection.id, direction: "inbound", event_type: "lead.created", status: "received", idempotency_key: idempotencyKey, request_payload: redactAuditValue({ event_type: "lead.created", source_message_id: event.data.message_id ?? null, data: eventData }), redacted: true }).select("id").single();
  if (!inserted) return NextResponse.json({ error: "Lead could not be stored." }, { status: 500 });
  try { const result = await runWorkflowsForEvent(admin, { id: inserted.id, partnerId: connection.partner_id, clientId: connection.client_id, connectionId: connection.id, eventType: "lead.created", data: eventData }); await admin.from("integration_events").update({ status: "processed", workflow_run_id: result.runs[0]?.runId ?? null }).eq("id", inserted.id); await admin.from("integration_connections").update({ last_success_at: new Date().toISOString(), health_summary: "Receiving forwarded lead emails." }).eq("id", connection.id); return NextResponse.json({ received: true, routed: true }, { status: 202 }); } catch (error) { await admin.from("integration_events").update({ status: "failed", error_message: error instanceof Error ? error.message : "Lead processing failed." }).eq("id", inserted.id); return NextResponse.json({ error: "Lead processing failed." }, { status: 500 }); }
}
