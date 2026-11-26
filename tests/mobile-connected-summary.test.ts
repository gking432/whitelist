import test from "node:test";
import assert from "node:assert/strict";
import { buildMobileSourceSummary, loadMobileConnectedSource } from "../lib/business/mobile-summary.ts";
import type { ConnectedData, SyncedInvoice } from "../lib/connections/types.ts";

const connected = (): ConnectedData => ({
  apps: [], messages: [], appointments: [], leads: [], invoices: [], payments: [],
  errors: [], limited: false, generatedAt: "2026-11-17T16:00:00Z",
});
const invoice = (values: Partial<SyncedInvoice> = {}): SyncedInvoice => ({
  id: "invoice", connectionId: "stripe", externalId: "in_1", account: "Service business", provider: "stripe", number: "INV-1",
  status: "open", currency: "USD", totalMinor: 5000, amountDueMinor: 5000, amountPaidMinor: 0, dueAt: null, updatedAt: null, href: null, ...values,
});

test("mobile uses the shared source snapshot without replacing its records or inventing balances", async () => {
  const data = connected();
  data.invoices = [invoice(), invoice({ id: "unknown", currency: null, amountDueMinor: null })];
  data.payments = [{ id: "payment", connectionId: "stripe", externalId: "pi_1", account: "Service business", provider: "stripe", status: "processing", currency: "USD", amountMinor: null, amountRefundedMinor: null, updatedAt: null, href: null }];
  data.leads = [{ id: "inquiry", connectionId: "form", externalId: "source-1", nativeId: null, account: "Website", provider: "generic_inbound_webhook", title: "Consultation inquiry", status: "new", preview: "Can you help with a consultation?", receivedAt: data.generatedAt, href: null }];
  const loaded = await loadMobileConnectedSource(async () => data);
  assert.equal(loaded.connectedData, data);
  const summary = buildMobileSourceSummary(loaded.connectedData, loaded.connectedDataError);
  assert.deepEqual(summary.counts, { inquiries: 1, invoices: 2, payments: 1 });
  assert.equal(summary.label, "1 form inquiry · 2 imported invoices · 1 payment record");
  assert.equal(loaded.connectedData?.invoices?.[1].amountDueMinor, null);
  assert.equal(loaded.connectedData?.payments?.[0].amountMinor, null);
  assert.equal(loaded.connectedData?.payments?.[0].amountRefundedMinor, null);
  assert.match(loaded.connectedData?.leads?.[0].preview || "", /consultation/);
});

test("a source outage stays separate from approval availability and reports unknown rather than zero", async () => {
  const sources = await loadMobileConnectedSource(async () => { throw new Error("private database diagnostics"); });
  assert.equal("error" in sources, false);
  assert.equal(sources.connectedData, undefined);
  assert.doesNotMatch(sources.connectedDataError || "", /private database diagnostics/);
  const summary = buildMobileSourceSummary(sources.connectedData, sources.connectedDataError);
  assert.equal(summary.visible, true);
  assert.equal(summary.counts, null);
  assert.equal(summary.label, "Updates unavailable");
  const inbox = { error: null, pendingCustomerCount: 2, ...sources };
  assert.equal(inbox.error, null);
  assert.equal(inbox.pendingCustomerCount, 2);
});

test("unused sources leave the specialized decision inbox free of empty summary sections", () => {
  assert.equal(buildMobileSourceSummary(connected()).visible, false);
  assert.equal(buildMobileSourceSummary().visible, false);
  const mailOnly = connected();
  mailOnly.apps = [{ id: "mail", name: "Mail", account: "owner@example.test", provider: "google_workspace", status: "connected", paused: false, readOnly: true, lastSyncedAt: mailOnly.generatedAt, syncing: false, error: null }];
  assert.equal(buildMobileSourceSummary(mailOnly).visible, false);
});

test("a prepared form with no submissions says waiting and preserves its paused or incomplete status", () => {
  const data = connected();
  data.apps = [{ id: "form", name: "Website intake", account: null, provider: "generic_inbound_webhook", status: "needs_attention", paused: true, readOnly: true, lastSyncedAt: null, syncing: false, error: null,
    streams: [{ key: "lead", status: "paused", lastSyncedAt: null, partial: false, detail: "Form intake is paused; no receipt has been verified." }] }];
  const summary = buildMobileSourceSummary(data);
  assert.equal(summary.visible, true);
  assert.equal(summary.hasRecords, false);
  assert.equal(summary.label, "Waiting for imported business records");
  assert.match(summary.notices.join(" "), /paused.*no receipt/);
  assert.doesNotMatch(summary.label, /all clear|connected successfully/i);
});

test("bounded snapshots label their counts as samples and retain current source warnings", () => {
  const data = connected();
  data.limited = true;
  data.invoices = [invoice()];
  data.errors = ["Some payment updates could not be checked."];
  const summary = buildMobileSourceSummary(data);
  assert.equal(summary.label, "Loaded sample: 1 imported invoice");
  assert.match(summary.notices.join(" "), /bounded.*complete records/);
  assert.match(summary.notices.join(" "), /payment updates could not be checked/);
  assert.equal(summary.generatedAt, data.generatedAt);
  assert.equal(buildMobileSourceSummary({ ...data, generatedAt: "invalid" }).generatedAt, null);
});
