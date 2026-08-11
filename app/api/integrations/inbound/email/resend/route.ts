import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { redactAuditValue } from "@/lib/audit/redact";
import { getResendInboundConfig } from "@/lib/env";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runWorkflowsForEvent } from "@/lib/workflows/engine";

export const dynamic = "force-dynamic";

function verifySvix(raw: string, request: NextRequest, secret: string) {
  const id = request.headers.get("svix-id"); const timestamp = request.headers.get("svix-timestamp"); const signatures = request.headers.get("svix-signature");
  if (!id || !timestamp || !signatures || Math.abs(Date.now() / 1000 - Number(timestamp)) > 5 * 60) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64"); const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${raw}`).digest();
  return signatures.split(" ").some((candidate) => { const [version, encoded] = candidate.split(","); if (version !== "v1" || !encoded) return false; const provided = Buffer.from(encoded, "base64"); return provided.length === expected.length && timingSafeEqual(provided, expected); });
}

function text(value: unknown) { return typeof value === "string" ? value : ""; }
function stripHtml(value: string) { return value.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim(); }
function firstMatch(value: string, pattern: RegExp) { return value.match(pattern)?.[1]?.trim() ?? null; }

export async function POST(request: NextRequest) {
  const config = getResendInboundConfig(); if (!config) return NextResponse.json({ error: "Unavailable." }, { status: 503 });
  const rate = await checkRateLimit("resend:inbound"); if (!rate.allowed) return NextResponse.json({ error: "Rate limited." }, { status: 429 });
  const raw = await request.text(); if (!verifySvix(raw, request, config.webhookSecret)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  let event: { type?: string; data?: { email_id?: string; to?: string[]; from?: string; subject?: string; message_id?: string } }; try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid payload." }, { status: 400 }); }
  if (event.type !== "email.received" || !event.data?.email_id) return NextResponse.json({ received: true });
  const recipient = event.data.to?.map((value) => value.toLowerCase()).find((value) => value.endsWith(`@${config.domain.toLowerCase()}`)); if (!recipient) return NextResponse.json({ received: true, routed: false });
  const admin = createSupabaseAdminClient(); if (!admin) return NextResponse.json({ error: "Unavailable." }, { status: 503 });
  const { data: connection } = await admin.from("integration_connections").select("id, partner_id, client_id, status, provider:integration_providers!inner(provider_key)").eq("external_account_id", recipient).eq("provider.provider_key", "universal_lead_email").maybeSingle();
  if (!connection || connection.status !== "connected") return NextResponse.json({ received: true, routed: false });
  const idempotencyKey = request.headers.get("svix-id") ?? event.data.email_id; const { data: duplicate } = await admin.from("integration_events").select("id").eq("connection_id", connection.id).eq("idempotency_key", idempotencyKey).maybeSingle(); if (duplicate) return NextResponse.json({ received: true, duplicate: true });
  const emailResponse = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(event.data.email_id)}`, { headers: { Authorization: `Bearer ${config.apiKey}` }, signal: AbortSignal.timeout(15_000) });
  if (!emailResponse.ok) return NextResponse.json({ error: "Email body retrieval failed." }, { status: 502 });
  const email = await emailResponse.json() as Record<string, unknown>; const body = text(email.text) || stripHtml(text(email.html)); const subject = text(email.subject) || event.data.subject || "Forwarded lead";
  const eventData = { name: firstMatch(body, /(?:name|customer|contact)\s*[:=-]\s*([^\n|,;]+)/i) ?? firstMatch(event.data.from ?? "", /^([^<]+)/), email: firstMatch(body, /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i), phone: firstMatch(body, /(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/), message: body.slice(0, 4_000), title: subject, source: "forwarded_lead_email", medium: "email" };
  const { data: inserted } = await admin.from("integration_events").insert({ partner_id: connection.partner_id, client_id: connection.client_id, connection_id: connection.id, direction: "inbound", event_type: "lead.created", status: "received", idempotency_key: idempotencyKey, request_payload: redactAuditValue({ event_type: "lead.created", source_message_id: event.data.message_id ?? null, data: eventData }), redacted: true }).select("id").single();
  if (!inserted) return NextResponse.json({ error: "Lead could not be stored." }, { status: 500 });
  try { const result = await runWorkflowsForEvent(admin, { id: inserted.id, partnerId: connection.partner_id, clientId: connection.client_id, connectionId: connection.id, eventType: "lead.created", data: eventData }); await admin.from("integration_events").update({ status: "processed", workflow_run_id: result.runs[0]?.runId ?? null }).eq("id", inserted.id); await admin.from("integration_connections").update({ last_success_at: new Date().toISOString(), health_summary: "Receiving forwarded lead emails." }).eq("id", connection.id); return NextResponse.json({ received: true, routed: true }, { status: 202 }); } catch (error) { await admin.from("integration_events").update({ status: "failed", error_message: error instanceof Error ? error.message : "Lead processing failed." }).eq("id", inserted.id); return NextResponse.json({ error: "Lead processing failed." }, { status: 500 }); }
}
