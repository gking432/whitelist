import Stripe from "stripe";
import { normalizeStripeWebhookEvent } from "../integrations/providers/stripe.ts";

/** Signature verification uses the installed SDK locally and makes no API call. */
export function readStripeRecordEvent(body: string, signature: string, secret: string, expectedAccount: string | null, now: Date = new Date()) {
  const timestamps = signature.split(",").map((part) => /^t=(\d+)$/.exec(part.trim())).filter((match) => !!match);
  if (timestamps.length !== 1 || Math.abs(now.getTime() - Number(timestamps[0]![1]) * 1000) > 300000)
    throw new Error("The signing timestamp is outside its allowed window.");
  const event = Stripe.webhooks.constructEvent(body, signature, secret, 300, undefined, now.getTime());
  if (event.account && expectedAccount && event.account !== expectedAccount)
    throw new Error("The signed event belongs to a different connected account.");
  if (!event.id || !Number.isSafeInteger(event.created)) throw new Error("Invalid source event identity.");
  const records = normalizeStripeWebhookEvent({ type: event.type, created: event.created, data: { object: event.data.object as unknown as Record<string, unknown> } })
    .filter((record) => ["invoice", "payment"].includes(record.objectType));
  return { id: event.id, type: event.type, eventAt: new Date(event.created * 1000).toISOString(), records };
}
