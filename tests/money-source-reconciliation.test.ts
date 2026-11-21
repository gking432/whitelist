import test from "node:test";
import assert from "node:assert/strict";
import type { ConnectedData, SyncedInvoice, SyncedPayment } from "../lib/connections/types.ts";
import { reconcileMoneySources, moneyEvidenceForSource } from "../lib/money/source-reconciliation.ts";
import { buildConnectedMoney } from "../lib/business/daily-brief.ts";

const invoice = (changes: Partial<SyncedInvoice> = {}): SyncedInvoice => ({
  id: "record-b", connectionId: "connection-b", externalId: "in_exact", provider: "stripe", accountId: "acct_exact", account: "Same label",
  number: "INV-42", status: "open", currency: "USD", amountDueMinor: 1200, amountPaidMinor: 300, totalMinor: 1500,
  dueAt: "2026-11-16T12:00:00Z", updatedAt: "2026-11-17T12:00:00Z", href: "https://invoice.stripe.com/i/source-b", ...changes,
});
const payment = (changes: Partial<SyncedPayment> = {}): SyncedPayment => ({
  id: "payment-b", connectionId: "connection-b", externalId: "pi_exact", provider: "stripe", accountId: "acct_exact", account: "Same label",
  status: "succeeded", currency: "USD", amountMinor: 1500, amountRefundedMinor: 0, updatedAt: "2026-11-17T12:00:00Z", href: "https://dashboard.stripe.com/payments/pi_exact", ...changes,
});
const data = (invoices: SyncedInvoice[], payments: SyncedPayment[] = []): ConnectedData => ({
  apps: [], messages: [], appointments: [], invoices, payments, limited: true, errors: [], generatedAt: "2026-11-17T13:00:00Z",
});

test("identical exact Stripe account/source imports collapse deterministically without changing inputs", () => {
  const records = [invoice(), invoice({ id: "record-a", connectionId: "connection-a", account: "Another label", updatedAt: "2026-11-17T12:30:00Z", href: "https://invoice.stripe.com/i/source-a", dueAt: "2026-11-16T12:00:00+00:00" })];
  const before = structuredClone(records), result = reconcileMoneySources(records, [payment(), payment({ id: "payment-a", connectionId: "connection-a" })]);
  assert.equal(result.invoices.length, 1); assert.equal(result.invoices[0].id, "record-a");
  assert.equal(result.payments.length, 1); assert.equal(result.payments[0].id, "payment-a");
  assert.equal(result.duplicateCount, 2); assert.equal(result.conflictCount, 0);
  assert.deepEqual(result.invoices[0].sourceRecords.map((source) => source.id), ["record-a", "record-b"]);
  assert.deepEqual(result.invoices[0].sourceRecords.map((source) => source.href), ["https://invoice.stripe.com/i/source-a", "https://invoice.stripe.com/i/source-b"]);
  assert.deepEqual(reconcileMoneySources([...records].reverse()).invoices, result.invoices);
  assert.deepEqual(records, before);
});

test("same labels or external IDs on verified different accounts never combine legitimate invoices", () => {
  const result = buildConnectedMoney(data([invoice(), invoice({ id: "another-account", connectionId: "connection-c", accountId: "acct_other" }),
    invoice({ id: "another-invoice", externalId: "in_other" }), invoice({ id: "another-provider", provider: "other_provider" })]));
  assert.equal(result.invoices.length, 4); assert.equal(result.duplicateCount, 0); assert.equal(result.conflictCount, 0);
  assert.equal(result.totals[0].amountMinor, 4800);
});

test("unknown account overlap across connections stays separate and cannot double-count a balance", () => {
  for (const records of [
    [invoice({ accountId: null }), invoice({ id: "unknown-peer", connectionId: "connection-c", accountId: null })],
    [invoice(), invoice({ id: "unknown-peer", connectionId: "connection-c", accountId: undefined })],
  ]) {
    const result = buildConnectedMoney(data(records));
    assert.equal(result.invoices.length, 2); assert.equal(result.totals.length, 0);
    assert.equal(result.invoices.every((row) => row.status === "source_conflict" && row.amountDueMinor === null), true);
    assert.equal(result.invoices.every((row) => row.sourceRecords.length === 1), true, "Unknown identities are not merged.");
    assert.match(result.sourceWarnings.join(" "), /overlapping balances are excluded/);
  }
  const single = buildConnectedMoney(data([invoice({ accountId: null })]));
  assert.equal(single.totals[0].amountMinor, 1200); assert.match(single.sourceWarnings.join(" "), /kept separate/);
  const distinct = buildConnectedMoney(data([invoice({ accountId: null }), invoice({ id: "unknown-other-invoice", connectionId: "connection-c", accountId: null, externalId: "in_other" })]));
  assert.equal(distinct.totals[0].amountMinor, 2400);
});

test("disagreeing invoice status, balance, paid, total, currency or due facts never select a settlement", () => {
  for (const changed of [{ status: "paid" }, { amountDueMinor: 1100 }, { amountPaidMinor: null }, { totalMinor: 2000 }, { currency: "JPY" }, { dueAt: null }] satisfies Partial<SyncedInvoice>[]) {
    const result = buildConnectedMoney(data([invoice(), invoice({ id: "conflict-a", connectionId: "connection-a", ...changed })]));
    assert.equal(result.invoices.length, 1); assert.equal(result.invoices[0].status, "source_conflict");
    assert.equal(result.invoices[0].amountDueMinor, null); assert.equal(result.invoices[0].amountPaidMinor, null); assert.equal(result.invoices[0].totalMinor, null);
    assert.equal(result.invoices[0].currency, null); assert.equal(result.invoices[0].dueAt, null);
    assert.equal(result.invoices[0].sourceRecords.length, 2); assert.equal(result.totals.length, 0); assert.equal(result.outstanding.length, 0);
    assert.match(result.invoices[0].sourceWarning!, /disagree/);
  }
});

test("conflicting payment or refund coverage stays unknown rather than choosing zero refunds", () => {
  for (const changed of [{ status: "failed" }, { currency: "EUR" }, { amountMinor: null }, { amountRefundedMinor: null }, { amountRefundedMinor: 100 }] satisfies Partial<SyncedPayment>[]) {
    const result = reconcileMoneySources([], [payment(), payment({ id: "payment-a", connectionId: "connection-a", ...changed })]);
    assert.equal(result.payments.length, 1); assert.equal(result.payments[0].status, "source_conflict");
    assert.equal(result.payments[0].amountMinor, null); assert.equal(result.payments[0].amountRefundedMinor, null);
    assert.equal(result.payments[0].sourceRecords.length, 2); assert.equal(result.conflictCount, 1);
  }
  const unverified = reconcileMoneySources([], [payment({ accountId: null }), payment({ id: "payment-a", connectionId: "connection-a" })]);
  assert.equal(unverified.payments.length, 2); assert.equal(unverified.payments.every((row) => row.amountMinor === null), true);
});

test("reconciled outstanding totals retain separate currencies and source unknowns", () => {
  const result = buildConnectedMoney(data([invoice(), invoice({ id: "record-a", connectionId: "connection-a" }),
    invoice({ id: "yen", externalId: "in_yen", currency: "JPY", amountDueMinor: 500 }),
    invoice({ id: "unknown", externalId: "in_unknown", amountDueMinor: null }),
    invoice({ id: "euro-a", externalId: "in_euro", currency: "EUR" }), invoice({ id: "euro-b", externalId: "in_euro", currency: "EUR", status: "paid" })]));
  assert.deepEqual(result.totals.map(({ currency, amountMinor, count }) => ({ currency, amountMinor, count })), [
    { currency: "JPY", amountMinor: 500, count: 1 }, { currency: "USD", amountMinor: 1200, count: 1 },
  ]);
  assert.equal(result.unknownDueCount, 1); assert.equal(result.duplicateCount, 1); assert.equal(result.conflictCount, 1);
});

test("shared manager evidence retains all source identities but reports each verified amount once", () => {
  const result = reconcileMoneySources([invoice(), invoice({ id: "record-a", connectionId: "connection-a" })], [payment(), payment({ id: "payment-a", connectionId: "connection-a" })]);
  const invoices = result.invoices.flatMap((group) => group.sourceRecords.map((source) => ({ sourceId: source.id, evidence: moneyEvidenceForSource(group, source.id) })));
  const payments = result.payments.flatMap((group) => group.sourceRecords.map((source) => ({ sourceId: source.id, evidence: moneyEvidenceForSource(group, source.id) })));
  assert.deepEqual(invoices.map((row) => row.sourceId), ["record-a", "record-b"]);
  assert.equal(invoices.reduce((sum, row) => sum + (row.evidence.amountDueMinor ?? 0), 0), 1200);
  assert.equal(payments.reduce((sum, row) => sum + (row.evidence.amountMinor ?? 0), 0), 1500);
  assert.equal(invoices[1].evidence.status, "duplicate_source");
  assert.equal(invoices[1].evidence.currency, null);
  assert.match(invoices[1].evidence.sourceWarning!, /record-a/);
  const conflict = reconcileMoneySources([invoice(), invoice({ id: "record-a", connectionId: "connection-a", status: "paid", amountDueMinor: 0 })]).invoices[0];
  assert.equal(moneyEvidenceForSource(conflict, "record-b").status, "source_conflict");
  assert.equal(moneyEvidenceForSource(conflict, "record-b").amountDueMinor, null);
});
