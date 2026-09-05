import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const PHONE_WEBHOOK_PROVIDERS = ["ringcentral", "dialpad", "openphone"] as const;
export type ProviderKey = (typeof PHONE_WEBHOOK_PROVIDERS)[number];

function secureEqualBuffer(expected: Buffer, provided: Buffer) {
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function verifyDialpadJwt(raw: string, secrets: string[]) {
  const [header, payload, signature, extra] = raw.trim().split(".");
  if (!header || !payload || !signature || extra) return null;
  try {
    const parsedHeader = JSON.parse(Buffer.from(header, "base64url").toString()) as { alg?: string };
    if (parsedHeader.alg !== "HS256") return null;
    const valid = secrets.some((secret) => secureEqualBuffer(createHmac("sha256", secret).update(`${header}.${payload}`).digest(), Buffer.from(signature, "base64url")));
    if (!valid) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>;
    if (typeof decoded.exp === "number" && decoded.exp * 1000 < Date.now() - 60_000) return null;
    return decoded;
  } catch { return null; }
}

export function verifyOpenPhone(raw: string, header: string, secrets: string[]) {
  for (const candidate of header.split(",")) {
    const [scheme, version, timestamp, digest] = candidate.trim().split(";");
    if (scheme !== "hmac" || version !== "1" || !timestamp || !digest) continue;
    const timestampMs = Number(timestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60_000) continue;
    const valid = secrets.some((secret) => {
      try {
        const calculated = createHmac("sha256", Buffer.from(secret, "base64")).update(`${timestamp}.${raw}`).digest();
        return secureEqualBuffer(calculated, Buffer.from(digest, "base64"));
      } catch { return false; }
    });
    if (valid) return true;
  }
  return false;
}

function object(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function string(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }

export function normalizePhoneWebhook(provider: ProviderKey, payload: Record<string, unknown>) {
  if (provider === "openphone") {
    const data = object(object(payload.data).object);
    const type = string(payload.type) ?? string(data.object) ?? "unknown";
    const participants = Array.isArray(data.participants) ? data.participants.filter((value): value is string => typeof value === "string") : [];
    const direction = data.direction === "outgoing" ? "outbound" : "inbound";
    return { type, id: string(payload.id) ?? `${type}:${string(data.id) ?? string(data.callId) ?? createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`, externalRef: string(data.callId) ?? string(data.id), from: type.startsWith("message") ? string(data.from) : direction === "inbound" ? participants[0] ?? null : null, to: type.startsWith("message") ? (Array.isArray(data.to) ? string(data.to[0]) : string(data.to)) : direction === "outbound" ? participants[0] ?? null : null, direction, data };
  }
  if (provider === "ringcentral") {
    const body = object(payload.body);
    const parties = Array.isArray(body.parties) ? body.parties.map(object) : [];
    const party = parties.find((value) => value.direction === "Inbound") ?? parties[0] ?? {};
    const from = object(party.from);
    const to = object(party.to);
    const event = string(payload.event) ?? "";
    const state = string(object(party.status).code) ?? string(body.status) ?? "";
    const isMessage = event.includes("message-store") || Boolean(body.messageStatus) || Boolean(body.subject);
    const type = isMessage ? "message.received" : /ring/i.test(state) ? "call.ringing" : /disconnected|gone|finished/i.test(state) ? "call.completed" : "call.updated";
    return { type, id: string(payload.uuid) ?? `${type}:${string(body.telephonySessionId) ?? string(body.id) ?? createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`, externalRef: string(body.telephonySessionId) ?? string(body.sessionId) ?? string(body.id), from: string(from.phoneNumber) ?? string(object(body.from).phoneNumber), to: string(to.phoneNumber) ?? string(object(body.to).phoneNumber), direction: party.direction === "Outbound" ? "outbound" : "inbound", data: body };
  }
  const event = object(payload.event);
  const state = string(payload.call_state) ?? string(payload.state) ?? string(event.state) ?? "";
  const isMessage = Boolean(payload.text) || Boolean(payload.message) || string(payload.event_type)?.includes("sms");
  const type = isMessage ? "message.received" : /ring/i.test(state) ? "call.ringing" : /hangup|completed|ended/i.test(state) ? "call.completed" : "call.updated";
  return { type, id: string(payload.event_id) ?? string(payload.id) ?? `${type}:${string(payload.call_id) ?? createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`, externalRef: string(payload.call_id) ?? string(event.call_id) ?? string(payload.id), from: string(payload.external_number) ?? string(payload.from_number) ?? string(payload.from), to: string(payload.internal_number) ?? string(payload.to_number) ?? string(payload.to), direction: payload.direction === "outbound" ? "outbound" : "inbound", data: payload };
}


export function isRingCentralChallenge(rawBody: string, validationToken: string | null) {
  return Boolean(validationToken) && rawBody.length === 0;
}
