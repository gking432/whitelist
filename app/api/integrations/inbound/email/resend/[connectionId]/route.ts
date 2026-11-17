import { after, NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import { verifyResendWebhookSignature } from "@/lib/integrations/providers/resend-inbound";
import type { EmailCredentials } from "@/lib/integrations/providers/email";
import {
  enqueueInboundEvent,
  processInboundEventJobs,
} from "@/lib/integrations/inbound/queue";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const id = (await params).connectionId;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return new NextResponse("Unavailable", { status: 404 });
  if (!(await checkRateLimit(`resend-conversation:${id}`)).allowed)
    return new NextResponse("Rate limited", { status: 429 });
  const admin = createSupabaseAdminClient();
  if (!admin) return new NextResponse("Unavailable", { status: 503 });
  const source = await admin
    .from("integration_connections")
    .select(
      "id,partner_id,client_id,status,provider:integration_providers!inner(provider_key)",
    )
    .eq("id", id)
    .eq("provider.provider_key", "resend")
    .maybeSingle();
  if (
    source.error ||
    !source.data ||
    !["connected", "needs_attention"].includes(source.data.status)
  )
    return new NextResponse("Unavailable", { status: 404 });
  const credentials = await readProviderCredentials<
    EmailCredentials & {
      inboundWebhookSecret?: string;
      inboundAddress?: string;
    }
  >(admin, id);
  if (!credentials?.inboundWebhookSecret || !credentials.inboundAddress)
    return new NextResponse("Receiving is not configured", { status: 503 });
  const raw = await request.text();
  if (raw.length > 100000)
    return new NextResponse("Too large", { status: 413 });
  if (
    !verifyResendWebhookSignature({
      rawBody: raw,
      messageId: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signatures: request.headers.get("svix-signature"),
      secret: credentials.inboundWebhookSecret,
    })
  )
    return new NextResponse("Rejected", { status: 403 });
  try {
    const event = JSON.parse(raw) as {
      type?: string;
      data?: { email_id?: string; to?: string[] };
    };
    if (event.type !== "email.received" || !event.data?.email_id)
      return NextResponse.json({ received: true });
    const response = await fetch(
      `https://api.resend.com/emails/receiving/${encodeURIComponent(event.data.email_id)}`,
      {
        headers: { Authorization: `Bearer ${credentials.apiKey}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      return new NextResponse("Email retrieval failed", { status: 502 });
    const email = (await response.json()) as {
      from?: string;
      to?: string[];
      text?: string;
      html?: string;
      subject?: string;
    };
    if (
      !email.to?.some(
        (to) => to.toLowerCase() === credentials.inboundAddress!.toLowerCase(),
      )
    )
      return new NextResponse("Wrong mailbox", { status: 403 });
    // Envelope identity is unverified until the owner links it. Never use an
    // email/phone mentioned inside the body to retrieve an existing customer.
    const sender =
      email.from?.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ?? email.from ?? "";
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(sender))
      return new NextResponse("Sender unavailable", { status: 400 });
    const body =
      email.text?.trim() ||
      "[Email has no plain-text body. Owner must review the original email.]";
    const receipt = await enqueueInboundEvent(admin, {
      partnerId: source.data.partner_id,
      clientId: source.data.client_id,
      connectionId: id,
      eventType: "email.received",
      idempotencyKey: event.data.email_id,
      data: {
        sender: sender.toLowerCase(),
        message: [email.subject, body]
          .filter(Boolean)
          .join("\n")
          .slice(0, 6000),
      },
    });
    after(() => processInboundEventJobs(admin, 1, receipt.eventId));
    return NextResponse.json({ received: true }, { status: 202 });
  } catch {
    return new NextResponse("Could not save email", { status: 503 });
  }
}
