import assert from "node:assert/strict";
import test from "node:test";
import { mapStripeInvoice, mapStripePayment, normalizeStripeWebhookEvent, stripeMinorUnits } from "../lib/integrations/providers/stripe.ts";

test("Stripe balances use remaining integer minor units in each original currency", () => {
  for (const currency of ["usd", "jpy", "kwd"]) {
    const record = mapStripeInvoice({ id: "in_fixture", currency, total: 1001, amount_due: 1001,
      amount_paid: 501, amount_remaining: 500, status: "open" });
    assert.equal(record.data.currency, currency.toUpperCase());
    assert.equal(record.data.amount_due_minor, 500);
    assert.equal(record.data.amount_original_due_minor, 1001);
  }
  assert.equal(stripeMinorUnits("12.50"), null);
  assert.equal(stripeMinorUnits(12.5), null);
  assert.equal(stripeMinorUnits(Number.MAX_SAFE_INTEGER + 1), null);
});
test("Stripe captured and refunded amounts remain distinct and raw secrets never enter source evidence", () => {
  const payment = mapStripePayment({ id: "pi_fixture", object: "payment_intent", amount: 3000, amount_received: 2000,
    currency: "usd", status: "succeeded", client_secret: "must-never-persist",
    latest_charge: { id: "ch_fixture", amount_captured: 2000, amount_refunded: 500 } });
  assert.equal(payment.data.amount_minor, 2000);
  assert.equal(payment.data.amount_requested_minor, 3000);
  assert.equal(payment.data.amount_refunded_minor, 500);
  assert.equal(payment.data.status, "partially_refunded");
  assert.equal(JSON.stringify(payment.source).includes("must-never-persist"), false);
  const unknown = mapStripePayment({ id: "pi_unknown", amount: 3000, latest_charge: "ch_unknown" });
  assert.equal(unknown.data.amount_minor, null);
  assert.equal(unknown.data.amount_refunded_minor, null);
});
test("charge refund events retain the PaymentIntent identity and actual event clock", () => {
  const [record] = normalizeStripeWebhookEvent({ type: "charge.refunded", created: 1000, data: { object: {
    id: "ch_fixture", object: "charge", payment_intent: "pi_fixture", created: 500,
    amount: 2000, amount_captured: 2000, amount_refunded: 2000, currency: "eur", status: "succeeded",
  } } });
  assert.equal(record.externalId, "pi_fixture");
  assert.equal(record.data.status, "refunded");
  assert.equal(record.data.source_event_at, new Date(1000 * 1000).toISOString());
  assert.equal(record.data.source_created_at, new Date(500 * 1000).toISOString());
  assert.equal(record.data.source_updated_at, null);
  assert.deepEqual(normalizeStripeWebhookEvent({ type: "refund.updated", created: 1000,
    data: { object: { id: "re_fixture", object: "refund", amount: 500 } } }), []);
});
