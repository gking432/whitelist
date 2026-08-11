import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { redactAuditValue } from "@/lib/audit/redact";
import { getMetaOAuthClient, getMetaWebhookVerifyToken } from "@/lib/env";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import type { MetaCredentials } from "@/lib/integrations/providers/marketing-oauth";
import { retrieveMetaLead } from "@/lib/integrations/providers/meta";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runWorkflowsForEvent } from "@/lib/workflows/engine";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode"); const challenge = request.nextUrl.searchParams.get("hub.challenge"); const token = request.nextUrl.searchParams.get("hub.verify_token");
  if (mode === "subscribe" && challenge && token && token === getMetaWebhookVerifyToken()) return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ error: "Verification failed." }, { status: 403 });
}

function verify(raw: string, signature: string) { const secret = getMetaOAuthClient()?.clientSecret; if (!secret || !signature.startsWith("sha256=")) return false; const expected = createHmac("sha256", secret).update(raw).digest("hex"); const provided = signature.slice(7); return Buffer.byteLength(expected) === Buffer.byteLength(provided) && timingSafeEqual(Buffer.from(expected), Buffer.from(provided)); }
function fields(value: unknown) { return Object.fromEntries((Array.isArray(value) ? value : []).map((raw) => { const field = raw as { name?: string; values?: unknown[] }; return [field.name ?? "field", field.values?.[0] ?? null]; })); }

export async function POST(request: NextRequest) {
  const rate = await checkRateLimit("meta:webhook"); if (!rate.allowed) return NextResponse.json({ error: "Rate limited." }, { status: 429 });
  const raw = await request.text(); if (!verify(raw, request.headers.get("x-hub-signature-256") ?? "")) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  let payload: { entry?: { id?: string; changes?: { field?: string; value?: { leadgen_id?: string } }[] }[] };
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid payload." }, { status: 400 }); }
  const admin = createSupabaseAdminClient(); if (!admin) return NextResponse.json({ error: "Unavailable." }, { status: 503 });
  let processed = 0;
  for (const entry of payload.entry ?? []) {
    if (!entry.id) continue;
    const { data: connection } = await admin.from("integration_connections").select("id, partner_id, client_id, status, provider:integration_providers!inner(provider_key)").eq("external_account_id", entry.id).eq("provider.provider_key", "meta").maybeSingle();
    if (!connection || connection.status !== "connected") continue;
    const credentials = await readProviderCredentials<MetaCredentials>(admin, connection.id); if (!credentials) continue;
    for (const change of entry.changes ?? []) {
      const leadId = change.field === "leadgen" ? change.value?.leadgen_id : null; if (!leadId) continue;
      const { data: duplicate } = await admin.from("integration_events").select("id").eq("connection_id", connection.id).eq("idempotency_key", leadId).maybeSingle(); if (duplicate) continue;
      const lead = await retrieveMetaLead(credentials, leadId); const data = fields(lead.field_data);
      const name = String(data.full_name ?? ([data.first_name, data.last_name].filter(Boolean).join(" ") || "Meta lead"));
      const eventData = { name, email: data.email ?? null, phone: data.phone_number ?? null, message: data.message ?? null, source: "meta_lead_ads", campaign: lead.campaign_id ?? null, ad_id: lead.ad_id ?? null };
      const { data: event } = await admin.from("integration_events").insert({ partner_id: connection.partner_id, client_id: connection.client_id, connection_id: connection.id, direction: "inbound", event_type: "lead.created", status: "received", idempotency_key: leadId, request_payload: redactAuditValue({ event_type: "lead.created", data: eventData }), redacted: true }).select("id").single();
      if (!event) continue;
      try { const result = await runWorkflowsForEvent(admin, { id: event.id, partnerId: connection.partner_id, clientId: connection.client_id, connectionId: connection.id, eventType: "lead.created", data: eventData }); await admin.from("integration_events").update({ status: "processed", workflow_run_id: result.runs[0]?.runId ?? null }).eq("id", event.id); await admin.from("integration_connections").update({ last_success_at: new Date().toISOString(), health_summary: "Receiving live Facebook and Instagram leads." }).eq("id", connection.id); processed += 1; } catch (error) { await admin.from("integration_events").update({ status: "failed", error_message: error instanceof Error ? error.message : "Lead processing failed." }).eq("id", event.id); }
    }
  }
  return NextResponse.json({ received: true, processed });
}
