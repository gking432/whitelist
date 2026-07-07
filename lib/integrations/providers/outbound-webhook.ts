import { createHmac } from "node:crypto";

// Generic outbound webhook delivery — the CRM fallback when a client's
// system has no native adapter. Northstar POSTs a signed JSON envelope to
// the connection's destination URL; the receiving system verifies the
// X-Northstar-Signature header (base64 HMAC-SHA256 of the raw body with
// the connection's signing secret).

export class OutboundWebhookError extends Error {
  status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "OutboundWebhookError";
    this.status = status;
  }
}

// Block obviously-internal destinations. HTTPS is already enforced at
// connection creation; this stops localhost/private-range IP literals.
export function isBlockedDestination(destinationUrl: string): boolean {
  let parsed: URL;

  try {
    parsed = new URL(destinationUrl);
  } catch {
    return true;
  }

  if (parsed.protocol !== "https:") {
    return true;
  }

  const host = parsed.hostname.toLowerCase();

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }

  // IPv4 literal checks for loopback/private/link-local/metadata ranges.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);

  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];

    if (
      a === 127 ||
      a === 10 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    ) {
      return true;
    }
  }

  // IPv6 loopback/link-local literals.
  if (host === "::1" || host.startsWith("[::1]") || host.startsWith("fe80")) {
    return true;
  }

  return false;
}

export function signWebhookBody(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}

export async function deliverOutboundWebhook(input: {
  destinationUrl: string;
  signingSecret: string;
  eventType: string;
  data: Record<string, unknown>;
}): Promise<{ status: number }> {
  if (isBlockedDestination(input.destinationUrl)) {
    throw new OutboundWebhookError(
      "The destination URL is not allowed (must be public HTTPS).",
      null,
    );
  }

  const rawBody = JSON.stringify({
    event_type: input.eventType,
    sent_at: new Date().toISOString(),
    data: input.data,
  });

  const response = await fetch(input.destinationUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Northstar-Signature": signWebhookBody(input.signingSecret, rawBody),
    },
    body: rawBody,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new OutboundWebhookError(
      `The destination responded with status ${response.status}.`,
      response.status,
    );
  }

  return { status: response.status };
}
