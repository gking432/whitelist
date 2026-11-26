import { after, NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import {
  verifyInstagramSignature,
  type InstagramMessagingCredentials,
} from "@/lib/integrations/providers/instagram-messaging";
import {
  enqueueInboundEvent,
  processInboundEventJobs,
} from "@/lib/integrations/inbound/queue";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
async function source(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data, error } = await admin
    .from("integration_connections")
    .select(
      "id,partner_id,client_id,status,provider:integration_providers!inner(provider_key)",
    )
    .eq("id", id)
    .eq("provider.provider_key", "instagram_messaging")
    .maybeSingle();
  if (error || !data || !["connected", "needs_attention"].includes(data.status))
    return null;
  const credentials =
    await readProviderCredentials<InstagramMessagingCredentials>(admin, id);
  return credentials ? { admin, connection: data, credentials } : null;
}
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const ctx = await source((await params).connectionId);
  if (!ctx) return new NextResponse("Unavailable", { status: 404 });
  const token = Buffer.from(
      request.nextUrl.searchParams.get("hub.verify_token") ?? "",
    ),
    expected = Buffer.from(ctx.credentials.verifyToken);
  if (
    request.nextUrl.searchParams.get("hub.mode") !== "subscribe" ||
    token.length !== expected.length ||
    !timingSafeEqual(token, expected)
  )
    return new NextResponse("Rejected", { status: 403 });
  return new NextResponse(
    request.nextUrl.searchParams.get("hub.challenge") ?? "",
    { headers: { "Content-Type": "text/plain" } },
  );
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const id = (await params).connectionId;
  if (!(await checkRateLimit(`instagram-inbound:${id}`)).allowed)
    return new NextResponse("Rate limited", { status: 429 });
  const ctx = await source(id);
  if (!ctx) return new NextResponse("Unavailable", { status: 404 });
  const raw = await request.text();
  if (raw.length > 100000)
    return new NextResponse("Too large", { status: 413 });
  if (
    !verifyInstagramSignature(
      raw,
      request.headers.get("x-hub-signature-256") ?? "",
      ctx.credentials.appSecret,
    )
  )
    return new NextResponse("Rejected", { status: 403 });
  try {
    const event = JSON.parse(raw) as {
      object?: string;
      entry?: {
        id?: string;
        messaging?: {
          sender?: { id: string };
          recipient?: { id: string };
          timestamp?: number;
          message?: {
            mid?: string;
            text?: string;
            is_echo?: boolean;
            attachments?: unknown[];
          };
        }[];
      }[];
    };
    if (event.object !== "instagram")
      return NextResponse.json({ received: true });
    const eventIds: string[] = [];
    for (const entry of event.entry ?? [])
      for (const m of entry.messaging ?? []) {
        if (
          m.message?.is_echo ||
          !m.message?.mid ||
          m.recipient?.id !== ctx.credentials.instagramAccountId ||
          !m.sender?.id ||
          !m.timestamp
        )
          continue;
        const text =
          m.message.text ??
          (m.message.attachments?.length
            ? "[Customer sent an attachment. Owner review required.]"
            : "");
        if (!text) continue;
        const receipt = await enqueueInboundEvent(ctx.admin, {
          partnerId: ctx.connection.partner_id,
          clientId: ctx.connection.client_id,
          connectionId: id,
          eventType: "instagram.message",
          idempotencyKey: m.message.mid,
          data: {
            sender: m.sender.id,
            message: text.slice(0, 6000),
            occurred_at: new Date(m.timestamp).toISOString(),
          },
        });
        eventIds.push(receipt.eventId);
      }
    after(async () => {
      for (const eventId of eventIds)
        await processInboundEventJobs(ctx.admin, 1, eventId);
    });
    return NextResponse.json({ received: true });
  } catch {
    return new NextResponse("Could not save event", { status: 503 });
  }
}
