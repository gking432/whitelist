import { createHmac, timingSafeEqual } from "node:crypto";
export type InstagramMessagingCredentials = {
  accessToken: string;
  instagramAccountId: string;
  appSecret: string;
  verifyToken: string;
  apiVersion: string;
};
export function validInstagramCredentials(c: InstagramMessagingCredentials) {
  return (
    /^\d+$/.test(c.instagramAccountId) &&
    /^v\d{2}\.0$/.test(c.apiVersion) &&
    !!c.accessToken &&
    !!c.appSecret &&
    c.verifyToken.length >= 20
  );
}
export function verifyInstagramSignature(
  raw: string,
  signature: string,
  secret: string,
) {
  if (!/^sha256=[0-9a-f]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}
export function instagramReplyWindowOpen(timestamp: unknown, now = Date.now()) {
  const at = typeof timestamp === "string" ? Date.parse(timestamp) : NaN;
  return Number.isFinite(at) && at <= now + 300000 && at > now - 24 * 3600000;
}
export async function testInstagramConnection(
  credentials: InstagramMessagingCredentials,
) {
  if (!validInstagramCredentials(credentials))
    return {
      ok: false as const,
      detail:
        "Check the account ID, API version, access token, app secret and verify token (at least 20 characters).",
    };
  try {
    const res = await fetch(
      `https://graph.instagram.com/${credentials.apiVersion}/me?fields=user_id,username`,
      {
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok)
      return {
        ok: false as const,
        detail: "Instagram authorization could not be verified.",
      };
    const data = (await res.json()) as { user_id?: string; id?: string };
    if (String(data.user_id ?? data.id) !== credentials.instagramAccountId)
      return {
        ok: false as const,
        detail: "The token belongs to a different Instagram account.",
      };
    return {
      ok: true as const,
      detail:
        "Account verified. Configure the callback and subscribe to messages in your Meta app before enabling live replies.",
    };
  } catch {
    return { ok: false as const, detail: "Instagram could not be reached." };
  }
}
export async function sendInstagramText(
  credentials: InstagramMessagingCredentials,
  to: string,
  body: string,
) {
  if (
    !validInstagramCredentials(credentials) ||
    !/^\d+$/.test(to) ||
    !body.trim() ||
    body.length > 1000
  )
    throw new Error("Invalid Instagram message.");
  const response = await fetch(
    `https://graph.instagram.com/${credentials.apiVersion}/${credentials.instagramAccountId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recipient: { id: to }, message: { text: body } }),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok)
    throw new Error("Instagram did not confirm message acceptance.");
  const data = (await response.json()) as { message_id?: string };
  if (!data.message_id) throw new Error("Instagram message receipt missing.");
  return data.message_id;
}
