import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";

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

// Reject all non-global address space, including IPv4-mapped IPv6. Host names
// are also resolved and pinned immediately before the request below.
export function isBlockedAddress(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host) === 4) {
    const [a, b, c] = host.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113);
  }
  if (isIP(host) === 6) {
    // Only globally routable IPv6 unicast (2000::/3), excluding documentation,
    // transition/tunnel ranges. Mapped IPv4, ULA, link-local and multicast fail.
    const normalized = new URL(`http://[${host}]`).hostname.slice(1, -1);
    const first = parseInt(normalized.split(":")[0], 16);
    return !Number.isFinite(first) || first < 0x2000 || first > 0x3fff || normalized.startsWith("2001:db8:") ||
      normalized.startsWith("2001:0:") || normalized.startsWith("2001::") || normalized.startsWith("2002:");
  }
  return true;
}

export function isBlockedDestination(destinationUrl: string): boolean {
  try {
    const parsed = new URL(destinationUrl);
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
      (parsed.port && parsed.port !== "443") || !host || host === "localhost" ||
      host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
    const literal = host.replace(/^\[|\]$/g, "");
    return Boolean(isIP(literal)) && isBlockedAddress(literal);
  } catch { return true; }
}

export async function resolvePublicDestination(
  destinationUrl: string,
  resolver: (hostname: string) => Promise<{ address: string; family: number }[]> =
    async (hostname) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          lookup(hostname, { all: true, verbatim: true }),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new OutboundWebhookError("Destination DNS lookup timed out.", null)), 5_000);
          }),
        ]);
      } finally { if (timer) clearTimeout(timer); }
    },
) {
  if (isBlockedDestination(destinationUrl)) throw new OutboundWebhookError("Destination must be public HTTPS on port 443.", null);
  const url = new URL(destinationUrl);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const records = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolver(host);
  if (!records.length || records.some((record) => isBlockedAddress(record.address))) {
    throw new OutboundWebhookError("Destination resolved to a non-public address.", null);
  }
  return { url, address: records[0].address, family: records[0].family };
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

  const destination = await resolvePublicDestination(input.destinationUrl);
  // Use the validated IP directly for the socket while retaining Host and TLS
  // hostname verification. No second DNS lookup and no redirect following.
  const status = await new Promise<number>((resolve, reject) => {
    const req = httpsRequest(destination.url, {
      method: "POST",
      agent: false,
      lookup: (_hostname, _options, callback) => {
        if (typeof _options === "object" && _options.all) {
          callback(null, [{ address: destination.address, family: destination.family }]);
        } else {
          callback(null, destination.address, destination.family);
        }
      },
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(rawBody),
        "X-Northstar-Signature": signWebhookBody(input.signingSecret, rawBody),
      },
      signal: AbortSignal.timeout(15_000),
    }, (response) => {
      const code = response.statusCode ?? 502;
      response.on("error", () => {});
      response.destroy();
      if (code < 200 || code >= 300) {
        reject(new OutboundWebhookError(`Destination returned ${code}; redirects are not followed.`, code));
      } else resolve(code);
    });
    req.on("error", () => reject(new OutboundWebhookError("Webhook delivery failed; reconcile the destination before retrying.", null)));
    req.end(rawBody);
  });
  return { status };
}
