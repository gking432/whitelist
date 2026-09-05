import { after, NextResponse, type NextRequest } from "next/server";

import { getResendInboundConfig } from "@/lib/env";
import {
  parseForwardedLeadEmail,
  verifyResendWebhookSignature,
} from "@/lib/integrations/providers/resend-inbound";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enqueueInboundEvent, processInboundEventJobs } from "@/lib/integrations/inbound/queue";

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
  const idempotencyKey = event.data.email_id;
  const emailResponse = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(event.data.email_id)}`, { headers: { Authorization: `Bearer ${config.apiKey}` }, signal: AbortSignal.timeout(15_000) });
  if (!emailResponse.ok) return NextResponse.json({ error: "Email body retrieval failed." }, { status: 502 });
  const email = await emailResponse.json() as Record<string, unknown>; const eventData = parseForwardedLeadEmail({ email, fallbackFrom: event.data.from, fallbackSubject: event.data.subject });
  try {
    const receipt = await enqueueInboundEvent(admin, { partnerId: connection.partner_id, clientId: connection.client_id, connectionId: connection.id, eventType: "lead.created", idempotencyKey, data: eventData });
    after(() => processInboundEventJobs(admin, 1, receipt.eventId));
    return NextResponse.json({ event_id: receipt.eventId, duplicate: receipt.duplicate, status: receipt.status }, { status: 202 });
  } catch { return NextResponse.json({ error: "Lead could not be committed." }, { status: 503 }); }
}
