import test from "node:test";
import assert from "node:assert/strict";
import { invoiceFollowupEligibilityBlock, invoiceFollowupSourceBlock, readInvoiceFollowupPin } from "../lib/money/eligibility.ts";
import type { InvoiceFollowupPin } from "../lib/money/contract.ts";

const now = "2026-11-17T12:00:00Z", due = "2026-11-16T12:00:00Z", uuid = "16dfb2ae-6162-40b8-ad94-3a31b0c81f47";
const facts = () => ({ status: "open", livemode: true, collection_method: "send_invoice", customer_id: "cus_reviewed", amount_due_minor: 501,
  amount_paid_minor: 500, total_minor: 1001, currency: "USD", due_date: due, hosted_url: "https://invoice.stripe.com/i/exact", number: "INV-41" });
function pin(): InvoiceFollowupPin {
  return { invoice_followup_version: 1, money_review_id: uuid, source_record_id: uuid, source_updated_at: now, source_external_updated_at: null,
    stripe_connection_id: uuid, stripe_account_id: "acct_reviewed", invoice_id: "in_exact", stripe_customer_id: "cus_reviewed",
    amount_due_minor: 501, amount_paid_minor: 500, total_minor: 1001, currency: "USD", due_at: due, collection_method: "send_invoice",
    hosted_invoice_url: "https://invoice.stripe.com/i/exact", invoice_number: "INV-41", contact_id: uuid, contact_updated_at: now,
    channel: "email", to: "owner-verified@example.test", connection_id: uuid, authority_revision: 5, customer_activity_id: null,
    customer_activity_at: null, conversation_id: uuid, conversation_revision: 7 };
}
test("only current live manually payable overdue invoices with known integer balances qualify", () => {
  assert.equal(invoiceFollowupEligibilityBlock(facts(), now), null);
  for (const patch of [{ status: "paid" }, { status: "void" }, { status: "uncollectible" }, { status: "draft" }, { deleted: true },
    { livemode: false }, { collection_method: "charge_automatically" }, { amount_due_minor: 0 }, { amount_due_minor: 5.01 },
    { amount_due_minor: "501" }, { amount_paid_minor: null }, { total_minor: Number.MAX_SAFE_INTEGER + 1 }, { currency: "ZZZ" },
    { due_date: "2026-11-18T12:00:00Z" }, { due_date: null }, { customer_id: null }, { hosted_url: "https://invoice.stripe.com.evil.test/i" }])
    assert.ok(invoiceFollowupEligibilityBlock({ ...facts(), ...patch }, now), JSON.stringify(patch));
});
test("settlement, partial payment and changed invoice identity or terms invalidate the original review", () => {
  assert.equal(invoiceFollowupSourceBlock(pin(), facts(), now), null);
  for (const patch of [{ customer_id: "cus_other" }, { amount_due_minor: 500 }, { amount_paid_minor: 501 }, { total_minor: 1002 },
    { currency: "EUR" }, { due_date: "2026-11-15T12:00:00Z" }, { hosted_url: "https://invoice.stripe.com/i/other" }, { number: "OTHER" },
    { status: "paid", amount_due_minor: 0, amount_refunded_minor: 500 }])
    assert.ok(invoiceFollowupSourceBlock(pin(), { ...facts(), ...patch }, now), JSON.stringify(patch));
});
test("malformed financial, recipient and provenance markers cannot fall back to generic delivery", () => {
  assert.deepEqual(readInvoiceFollowupPin(pin()), pin());
  for (const patch of [{ invoice_followup_version: 2 }, { channel: "sms" }, { stripe_connection_id: "other" }, { money_review_id: null },
    { amount_due_minor: Number.MAX_SAFE_INTEGER + 1 }, { currency: "usd" }, { source_external_updated_at: "yesterday" },
    { conversation_id: null }, { conversation_revision: -1 }, { customer_activity_id: uuid, customer_activity_at: null },
    { to: "other@example.test\r\nBcc: hidden@example.test" }, { hosted_invoice_url: "javascript:alert(1)" }])
    assert.equal(readInvoiceFollowupPin({ ...pin(), ...patch }), null, JSON.stringify(patch));
});
