import { createHmac, timingSafeEqual } from "node:crypto";

export function signVoiceStreamPayload(
  secret: string,
  timestamp: string,
  body: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

export function signVoiceStreamSession(
  secret: string,
  callSessionId: string,
): string {
  return createHmac("sha256", secret).update(callSessionId).digest("hex");
}

export function verifyVoiceStreamPayload(input: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  body: string;
  now?: number;
}): boolean {
  if (!input.timestamp || !input.signature) return false;

  const timestampMs = Number(input.timestamp);
  const now = input.now ?? Date.now();

  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(now - timestampMs) > 5 * 60 * 1_000
  ) {
    return false;
  }

  const expected = signVoiceStreamPayload(
    input.secret,
    input.timestamp,
    input.body,
  );
  const expectedBytes = Buffer.from(expected, "hex");
  const signatureBytes = Buffer.from(input.signature, "hex");

  return (
    expectedBytes.length === signatureBytes.length &&
    timingSafeEqual(expectedBytes, signatureBytes)
  );
}
