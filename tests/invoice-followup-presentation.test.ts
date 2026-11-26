import test from "node:test";
import assert from "node:assert/strict";
import type { InvoiceFollowupReview } from "../lib/money/contract.ts";
import { buildInvoiceFollowupCommand, invoiceReviewTime, invoiceSourceHref, readInvoiceFollowupReceipt, readInvoiceFollowupReview } from "../lib/money/presentation.ts";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const binding = { recordId: id(1), connectionId: id(2) };
const review: InvoiceFollowupReview = {
  version: 1, canWrite: true, eligible: true, blockReason: null, recipientCoverageComplete: true, existing: null,
  invoice: { id: id(1), connectionId: id(2), externalId: "in_exact", revision: "opaque-invoice-source-r3", account: "Connected account", number: "INV-42", status: "open",
    currency: "JPY", amountDueMinor: 2000, totalMinor: 3000, dueAt: "2026-11-16T15:00:00Z", href: "https://invoice.stripe.com/i/source", observedAt: "2026-11-17T15:00:00Z" },
  recipients: [{ conversationId: id(3), contactId: id(4), name: "Owner verified customer", email: "customer@example.test", account: "Selected mailbox", revision: "conversation-r7" }],
};

test("source review is bound to the exact record/account and preserves unknown financial facts", () => {
  assert.deepEqual(readInvoiceFollowupReview(review, binding), review);
  for (const changed of [{ ...review, invoice: { ...review.invoice, id: id(8) } }, { ...review, invoice: { ...review.invoice, connectionId: id(8) } },
    { ...review, invoice: { ...review.invoice, amountDueMinor: 2.5 } }, { ...review, invoice: { ...review.invoice, totalMinor: Number.MAX_SAFE_INTEGER + 1 } },
    { ...review, recipients: [{ ...review.recipients[0], revision: "" }] }])
    assert.throws(() => readInvoiceFollowupReview(changed, binding), /exact invoice review/);
  const unknown = { ...review, eligible: false, invoice: { ...review.invoice, amountDueMinor: null, totalMinor: null, currency: null, observedAt: null } };
  assert.equal(readInvoiceFollowupReview(unknown, binding).invoice.amountDueMinor, null);
  assert.equal(readInvoiceFollowupReview({ ...review, eligible: false, invoice: { ...review.invoice, totalMinor: -100 } }, binding).invoice.totalMinor, -100, "A source credit remains visible for manual review.");
});

test("reminder preparation requires a deliberate current verified conversation and both independent confirmations", () => {
  const recipient = review.recipients[0], values = { recipient, identityConfirmed: true, outreachPermissionConfirmed: true };
  assert.deepEqual(buildInvoiceFollowupCommand(review, "prepare_invoice_followup", id(5), values), {
    action: "prepare_invoice_followup", key: id(5), targetId: id(1), connectionId: id(2), expectedRevision: review.invoice.revision,
    recipientConversationId: id(3), expectedRecipientRevision: recipient.revision, identityConfirmed: true, outreachPermissionConfirmed: true,
  });
  for (const changed of [{ ...values, recipient: null }, { ...values, identityConfirmed: false }, { ...values, outreachPermissionConfirmed: false },
    { ...values, recipient: { ...recipient, revision: "old-conversation" } }, { ...values, recipient: { ...recipient, contactId: id(9) } }])
    assert.throws(() => buildInvoiceFollowupCommand(review, "prepare_invoice_followup", id(5), changed), /Choose a verified conversation/);
  assert.throws(() => buildInvoiceFollowupCommand({ ...review, eligible: false, blockReason: "Source is partial." }, "prepare_invoice_followup", id(5), values), /Source is partial/);
  assert.throws(() => buildInvoiceFollowupCommand({ ...review, canWrite: false }, "prepare_invoice_followup", id(5), values), /Owner write access/);
});

test("handoffs require explicit source review without carrying recipient or outreach authority", () => {
  const command = buildInvoiceFollowupCommand({ ...review, eligible: false }, "handoff_invoice_followup", id(5), {
    sourceReviewed: true, note: "  Check the disputed balance.  ", recipient: review.recipients[0], identityConfirmed: true, outreachPermissionConfirmed: true,
  });
  assert.deepEqual(command, { action: "handoff_invoice_followup", key: id(5), targetId: id(1), connectionId: id(2), expectedRevision: review.invoice.revision, note: "Check the disputed balance." });
  assert.equal("recipientConversationId" in command, false);
  assert.equal("outreachPermissionConfirmed" in command, false);
  assert.throws(() => buildInvoiceFollowupCommand(review, "handoff_invoice_followup", id(5), { note: "Check source" }), /Review the source/);
  assert.throws(() => buildInvoiceFollowupCommand(review, "handoff_invoice_followup", id(5), { sourceReviewed: true, note: "x".repeat(2001) }), /2,000/);
  assert.equal("note" in buildInvoiceFollowupCommand(review, "handoff_invoice_followup", id(5), { sourceReviewed: true }), false);
});

test("only a correlated durable receipt confirms saving, including an exact replay", () => {
  const receipt = { id: id(8), sourceRecordId: id(1), taskId: id(9), approvalId: id(10), replayed: true, message: "Existing reminder approval saved." };
  assert.deepEqual(readInvoiceFollowupReceipt(receipt, id(1)), receipt);
  for (const changed of [null, {}, { ...receipt, sourceRecordId: id(2) }, { ...receipt, taskId: null }, { ...receipt, approvalId: "not-an-id" }, { ...receipt, message: "" }, { ...receipt, replayed: "true" }])
    assert.throws(() => readInvoiceFollowupReceipt(changed, id(1)), /receipt was not confirmed/);
  assert.equal(readInvoiceFollowupReceipt({ ...receipt, approvalId: null }, id(1)).approvalId, null);
});

test("source links reject credentials and executable schemes, and unknown times remain explicit", () => {
  assert.equal(invoiceSourceHref("https://invoice.stripe.com/i/source"), "https://invoice.stripe.com/i/source");
  for (const href of ["javascript:alert(1)", "http://invoice.stripe.com/i/source", "https://user:password@invoice.stripe.com", "/client/money", null])
    assert.equal(invoiceSourceHref(href), null);
  assert.equal(invoiceReviewTime(null, "UTC"), null);
  assert.equal(invoiceReviewTime("unknown", "UTC"), null);
  assert.match(invoiceReviewTime(review.invoice.observedAt, "invalid-zone")!, /UTC$/);
});
