import test from "node:test";
import assert from "node:assert/strict";
import { mapConnectedData, type ImportedRow } from "../lib/connections/records.ts";
import { formatMinorMoney } from "../lib/connections/money.ts";
import type { ConnectedApp } from "../lib/connections/types.ts";

const now = "2026-11-17T12:00:00.000Z";
const app = (id: string, provider: string): ConnectedApp => ({ id, provider, name: provider, account: `${id}@example.com`, status: "connected", paused: false, readOnly: true, lastSyncedAt: now, syncing: false, error: null });
const row = (id: string, connection: string, kind: string, data: Record<string, unknown>, patch: Partial<ImportedRow> = {}): ImportedRow => ({ id, connection_id: connection, object_type: kind, external_object_id: id, external_parent_id: null, canonical_data: data, external_updated_at: now, native_object_id: null, updated_at: now, ...patch });

test("minor-unit formatting preserves ISO precision, Stripe exceptions and maximum safe integer cents exactly", () => {
  assert.equal(formatMinorMoney(1234, "USD"), "$12.34");
  assert.equal(formatMinorMoney(1234, "JPY"), "¥1,234");
  assert.match(formatMinorMoney(1234, "BHD")!, /1\.234$/);
  assert.match(formatMinorMoney(500, "ISK")!, /5$/);
  assert.equal(formatMinorMoney(501, "ISK"), null);
  assert.equal(formatMinorMoney(Number.MAX_SAFE_INTEGER, "USD"), "$90,071,992,547,409.91");
  assert.equal(formatMinorMoney(-Number.MAX_SAFE_INTEGER, "USD"), "-$90,071,992,547,409.91");
  assert.match(formatMinorMoney(Number.MAX_SAFE_INTEGER, "BHD")!, /9,007,199,254,740\.991$/);
  assert.equal(formatMinorMoney(-1, "USD"), "-$0.01");
  for (const amount of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(formatMinorMoney(amount, "USD"), null);
  assert.equal(formatMinorMoney(100, "ZZZ"), null);
  assert.equal(formatMinorMoney(null, "USD"), null);
});

test("Google and Microsoft account threads retain direction and current read state across duplicate updates", () => {
  const result = mapConnectedData([app("google", "google_workspace"), app("outlook", "microsoft_365")], [
    row("google-mail", "google", "message", { subject: "Gmail", labels: ["SENT"], is_read: true }, { external_parent_id: "same-thread" }),
    row("outlook-mail", "outlook", "message", { subject: "Outlook", sender: "person@example.com", folder: "inbox", inbox: true, direction: "inbound", is_read: false, received_at: now, html_url: "https://outlook.office.com/mail/inbox/id/source" }, { external_parent_id: "same-thread", updated_at: "2026-11-17T11:00:00Z" }),
    row("outlook-mail", "outlook", "message", { subject: "Outlook", sender: "person@example.com", folder: "inbox", inbox: true, direction: "inbound", is_read: true, received_at: now, html_url: "https://outlook.office.com/mail/inbox/id/source" }, { external_parent_id: "same-thread" }),
  ], now);
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages.find((m) => m.connectionId === "google")!.direction, "outbound");
  const outlook = result.messages.find((m) => m.connectionId === "outlook")!;
  assert.equal(outlook.unread, false);
  assert.equal(outlook.messageCount, 1);
  assert.equal(outlook.direction, "inbound");
  assert.match(outlook.href!, /^https:\/\/outlook\.office\.com/);
});

test("invoice balance and payment captures/refunds remain separate and replay does not duplicate or revive old state", () => {
  const result = mapConnectedData([app("stripe", "stripe")], [
    row("in_source", "stripe", "invoice", { currency: "jpy", status: "open", total_minor: 5000, amount_due_minor: 1000, amount_paid_minor: 4000, hosted_url: "https://invoice.stripe.com/i/source" }),
    row("pi_source", "stripe", "payment", { currency: "usd", status: "succeeded", amount_minor: 5000, amount_refunded_minor: 0 }, { updated_at: "2026-11-16T12:00:00Z" }),
    row("pi_source", "stripe", "payment", { currency: "usd", status: "partially_refunded", amount_minor: 5000, amount_refunded_minor: 2000, receipt_url: "https://pay.stripe.com/receipts/source" }),
    row("pi_pending", "stripe", "payment", { currency: "usd", status: "processing", amount: 5000, amount_minor: null }),
  ], now);
  assert.equal(result.invoices!.length, 1);
  assert.equal(result.invoices![0].amountDueMinor, 1000);
  assert.equal(result.invoices![0].currency, "JPY");
  assert.equal(result.payments!.length, 2);
  assert.equal(result.payments!.find((p) => p.externalId === "pi_source")!.amountRefundedMinor, 2000);
  assert.equal(result.payments!.find((p) => p.externalId === "pi_pending")!.amountMinor, null);
  assert.equal(result.payments![0].updatedAt, now);
});

test("intake preview is bounded and allowlisted while unsafe source links, unknown metadata and tombstones stay out", () => {
  const result = mapConnectedData([app("form", "generic_inbound_webhook"), app("stripe", "stripe"), app("outlook", "microsoft_365")], [
    row("form-question", "form", "lead", { title: "Service request", status: "new", description: "Question ".repeat(300), received_at: now, email: "private-contact@example.com", unknown_metadata: "private-internal-note", source_url: "https://evil.example" }),
    row("in_unsafe", "stripe", "invoice", { currency: "USD", status: "draft", total_minor: 100, amount_due_minor: null, hosted_url: "https://invoice.stripe.com@evil.example" }),
    row("deleted-event", "outlook", "appointment", { title: "Visit", status: "booked", start_at: now, end_at: "2026-11-17T13:00:00Z" }, { updated_at: "2026-11-16T12:00:00Z" }),
    row("deleted-event", "outlook", "appointment", { deleted: true }),
  ], now);
  assert.equal(result.leads![0].preview!.length, 1200);
  assert.equal(result.leads![0].href, null);
  assert.equal(result.invoices![0].href, null);
  assert.equal(result.appointments.length, 0);
  assert.equal(JSON.stringify(result).includes("private-contact"), false);
  assert.equal(JSON.stringify(result).includes("private-internal-note"), false);
});
