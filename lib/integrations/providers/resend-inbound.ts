import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyResendWebhookSignature(input: {
  rawBody: string;
  messageId: string | null;
  timestamp: string | null;
  signatures: string | null;
  secret: string;
  nowSeconds?: number;
}) {
  const timestamp = Number(input.timestamp);
  const now = input.nowSeconds ?? Date.now() / 1000;

  if (
    !input.messageId ||
    !input.timestamp ||
    !input.signatures ||
    !Number.isFinite(timestamp) ||
    Math.abs(now - timestamp) > 5 * 60
  ) {
    return false;
  }

  let key: Buffer;

  try {
    key = Buffer.from(input.secret.replace(/^whsec_/, ""), "base64");
  } catch {
    return false;
  }

  if (key.length === 0) return false;

  const expected = createHmac("sha256", key)
    .update(`${input.messageId}.${input.timestamp}.${input.rawBody}`)
    .digest();

  return input.signatures.split(" ").some((candidate) => {
    const [version, encoded] = candidate.split(",");
    if (version !== "v1" || !encoded) return false;

    const provided = Buffer.from(encoded, "base64");
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  });
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>|<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function firstMatch(value: string, pattern: RegExp) {
  return value.match(pattern)?.[1]?.trim() ?? null;
}

export function parseForwardedLeadEmail(input: {
  email: Record<string, unknown>;
  fallbackFrom?: string;
  fallbackSubject?: string;
}) {
  const body = text(input.email.text) || stripHtml(text(input.email.html));
  const subject =
    text(input.email.subject) || input.fallbackSubject || "Forwarded lead";

  return {
    name:
      firstMatch(body, /(?:name|customer|contact)\s*[:=-]\s*([^\n|,;]+)/i) ??
      firstMatch(input.fallbackFrom ?? "", /^([^<]+)/),
    email: firstMatch(body, /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i),
    phone: firstMatch(
      body,
      /(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/,
    ),
    message: body.slice(0, 4_000),
    title: subject,
    source: "forwarded_lead_email",
    medium: "email",
  };
}
