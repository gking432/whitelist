import { createHmac, timingSafeEqual } from "node:crypto";

// Twilio webhook signature validation (X-Twilio-Signature). Twilio signs
// the exact webhook URL plus the POST parameters, sorted by key and
// concatenated as key+value, HMAC-SHA1 with the account's auth token,
// base64-encoded. Pure module (no path aliases) so it is unit-testable.

export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join("");

  return createHmac("sha1", authToken).update(data).digest("base64");
}

export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean {
  const expected = computeTwilioSignature(authToken, url, params);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(signature);

  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}
