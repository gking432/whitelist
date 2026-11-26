import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";

import { getMetaOAuthClient, getMetaWebhookVerifyToken } from "@/lib/env";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import type { MetaCredentials } from "@/lib/integrations/providers/marketing-oauth";
import { retrieveMetaLead } from "@/lib/integrations/providers/meta";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enqueueInboundEvent, processInboundEventJobs } from "@/lib/integrations/inbound/queue";

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
  const raw = await request.text(); if (Buffer.byteLength(raw) > 256 * 1024) return NextResponse.json({ error: "Payload too large." }, { status: 413 }); if (!verify(raw, request.headers.get("x-hub-signature-256") ?? "")) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  let payload: { entry?: { id?: string; changes?: { field?: string; value?: { leadgen_id?: string } }[] }[] };
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid payload." }, { status: 400 }); }
  const admin = createSupabaseAdminClient(); if (!admin) return NextResponse.json({ error: "Unavailable." }, { status: 503 });
  let processed = 0;
  try {
  for (const entry of payload.entry ?? []) {
    if (!entry.id) continue;
    const { data: connection } = await admin.from("integration_connections").select("id, partner_id, client_id, status, provider:integration_providers!inner(provider_key)").eq("external_account_id", entry.id).eq("provider.provider_key", "meta").maybeSingle();
    if (!connection || connection.status !== "connected") continue;
    const credentials = await readProviderCredentials<MetaCredentials>(admin, connection.id); if (!credentials) continue;
    for (const change of entry.changes ?? []) {
      const leadId = change.field === "leadgen" ? change.value?.leadgen_id : null; if (!leadId) continue;
      const lead = await retrieveMetaLead(credentials, leadId); const data = fields(lead.field_data);
      const name = String(data.full_name ?? ([data.first_name, data.last_name].filter(Boolean).join(" ") || "Meta lead"));
      const eventData = { name, email: data.email ?? null, phone: data.phone_number ?? null, message: data.message ?? null, source: "meta_lead_ads", campaign: lead.campaign_id ?? null, ad_id: lead.ad_id ?? null };
      const receipt = await enqueueInboundEvent(admin, { partnerId: connection.partner_id, clientId: connection.client_id, connectionId: connection.id, eventType: "lead.created", idempotencyKey: leadId, data: eventData });
      after(() => processInboundEventJobs(admin, 1, receipt.eventId));
      processed += 1;
    }
  }
  } catch { return NextResponse.json({ error: "Lead could not be committed; retry delivery." }, { status: 503 }); }
  return NextResponse.json({ received: true, queued: processed });
}
