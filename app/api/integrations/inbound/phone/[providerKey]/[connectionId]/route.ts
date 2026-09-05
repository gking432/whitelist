import { after, NextResponse, type NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { decryptSecret, safeEqualSecrets } from "@/lib/integrations/secrets";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enqueueInboundEvent, processInboundEventJobs } from "@/lib/integrations/inbound/queue";
import { PHONE_WEBHOOK_PROVIDERS, isRingCentralChallenge, normalizePhoneWebhook, verifyDialpadJwt, verifyOpenPhone, type ProviderKey } from "@/lib/integrations/inbound/phone-webhooks";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, { params }: { params: Promise<{ providerKey: string; connectionId: string }> }) {
  const { providerKey: rawProvider, connectionId } = await params;
  if (!PHONE_WEBHOOK_PROVIDERS.includes(rawProvider as ProviderKey) || !/^[0-9a-f-]{36}$/i.test(connectionId)) return NextResponse.json({ error: "Unknown endpoint." }, { status: 404 });
  const provider = rawProvider as ProviderKey;
  const rate = await checkRateLimit(`phone:${provider}:${connectionId}`);
  if (!rate.allowed) return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Unavailable." }, { status: 503 });
  const { data: connection } = await admin.from("integration_connections").select("id, partner_id, client_id, status, provider:integration_providers!inner(provider_key)").eq("id", connectionId).eq("provider.provider_key", provider).maybeSingle();
  if (!connection || ["paused", "disabled"].includes(connection.status)) return NextResponse.json({ error: "Unknown endpoint." }, { status: 404 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 256 * 1024) return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  const token = request.headers.get("validation-token");
  // Registration challenges have no payload; notifications carry the same header
  // and must pass the stored-token check and processing path below.
  if (provider === "ringcentral" && isRingCentralChallenge(raw, token)) return new NextResponse(null, { status: 200, headers: { "Validation-Token": token! } });
  const { data: secretRows } = await admin.from("integration_secrets").select("encrypted_value").eq("connection_id", connectionId).like("secret_kind", "provider_webhook_secret:%");
  const secrets = (secretRows ?? []).flatMap((row) => { try { return [decryptSecret(row.encrypted_value)]; } catch { return []; } });
  let payload: Record<string, unknown> | null = null;
  if (provider === "dialpad") payload = verifyDialpadJwt(raw, secrets);
  else {
    if (provider === "ringcentral" && !secrets.some((secret) => safeEqualSecrets(secret, token ?? ""))) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    if (provider === "openphone" && !verifyOpenPhone(raw, request.headers.get("openphone-signature") ?? "", secrets)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    try { const value = JSON.parse(raw); if (value && typeof value === "object" && !Array.isArray(value)) payload = value; } catch { /* invalid JSON */ }
  }
  if (!payload) return NextResponse.json({ error: "Unauthorized or invalid payload." }, { status: 401 });
  const event = normalizePhoneWebhook(provider, payload);
  try {
    const receipt = await enqueueInboundEvent(admin, { partnerId: connection.partner_id, clientId: connection.client_id, connectionId, eventType: event.type === "message.received" ? "sms.received" : event.type, idempotencyKey: event.id.slice(0,255), handler: "phone", data: { provider, payload } });
    after(() => processInboundEventJobs(admin, 1, receipt.eventId));
    return NextResponse.json({ event_id: receipt.eventId, duplicate: receipt.duplicate, status: receipt.status }, { status: 202 });
  } catch { return NextResponse.json({ error: "Event could not be committed." }, { status: 503 }); }
}
