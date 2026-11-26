import { after, NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/integrations/secrets";
import { readStripeRecordEvent } from "@/lib/connections/stripe-events";
import { enqueueInboundEvent, processInboundEventJobs } from "@/lib/integrations/inbound/queue";
import { checkRateLimit } from "@/lib/integrations/rate-limit";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function POST(request: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return NextResponse.json({ error: "Unknown endpoint." }, { status: 404, headers });
  if (Number(request.headers.get("content-length") ?? 0) > 1_000_000) return new NextResponse(null, { status: 413 });
  const rate = await checkRateLimit(`stripe-records:${connectionId}`);
  if (!rate.allowed) return new NextResponse(null, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Data service unavailable." }, { status: 503, headers });
  const account = await admin.from("integration_connections")
    .select("id,partner_id,client_id,status,runtime_mode,external_account_id,provider:integration_providers!inner(provider_key)")
    .eq("id", connectionId).eq("provider.provider_key", "stripe").maybeSingle();
  if (account.error) return NextResponse.json({ error: "Data service unavailable." }, { status: 503, headers });
  if (!account.data) return NextResponse.json({ error: "Unknown endpoint." }, { status: 404, headers });
  const connection = account.data;
  const credentials = await admin.from("integration_secrets").select("encrypted_value")
    .eq("partner_id", connection.partner_id).eq("client_id", connection.client_id)
    .eq("connection_id", connection.id).eq("secret_kind", "provider_credentials").maybeSingle();
  let secret: string;
  try {
    const stored = JSON.parse(decryptSecret(credentials.data?.encrypted_value ?? ""));
    if (credentials.error || typeof stored.webhookSecret !== "string" || !stored.webhookSecret.startsWith("whsec_")) throw new Error();
    secret = stored.webhookSecret;
  } catch {
    return NextResponse.json({ error: "This account's signed-event endpoint is not configured. Polling is configured separately." }, { status: 503, headers });
  }
  const body = await request.text();
  if (Buffer.byteLength(body) > 1_000_000) return new NextResponse(null, { status: 413 });
  let event: ReturnType<typeof readStripeRecordEvent>;
  try { event = readStripeRecordEvent(body, request.headers.get("stripe-signature") ?? "", secret, connection.external_account_id); }
  catch { return NextResponse.json({ error: "Invalid signature or source account." }, { status: 400, headers }); }
  if (!["connected", "needs_attention"].includes(connection.status) || connection.runtime_mode === "paused")
    return NextResponse.json({ error: "Source account is paused or disconnected. Retry after restoring the account." }, { status: 409, headers });
  if (!event.records.length) return NextResponse.json({ received: true, imported: false }, { headers });
  try {
    const receipt = await enqueueInboundEvent(admin, {
      partnerId: connection.partner_id, clientId: connection.client_id, connectionId: connection.id,
      handler: "records", eventType: event.type, idempotencyKey: event.id,
      data: { records: event.records, event_at: event.eventAt, source_event_id: event.id },
    });
    after(() => processInboundEventJobs(admin, 1, receipt.eventId));
    return NextResponse.json({ received: true, eventId: receipt.eventId, duplicate: receipt.duplicate, status: receipt.status }, { status: 202, headers });
  } catch { return NextResponse.json({ error: "Event could not be saved. Retry the same signed event." }, { status: 503, headers }); }
}
