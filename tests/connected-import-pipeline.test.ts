import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { normalizeOwnerIntake } from "../lib/connections/intake.ts";
import { readStripeRecordEvent } from "../lib/connections/stripe-events.ts";
import { applyOwnerImport, persistOwnerImportRecord } from "../lib/connections/import-store.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

const now = new Date("2026-11-17T03:30:00Z");
const scope = { partnerId: "partner", clientId: "business", connectionId: "source-account" };
const secret = "whsec_test_fixture_only";
function stripeEvent(type: string, data: Record<string, unknown>) {
  return JSON.stringify({ id: "evt_stable", object: "event", type, account: "acct_owner", created: now.getTime()/1000, data: { object: data } });
}
function signed(body: string, at = now.getTime()/1000) {
  return Stripe.webhooks.generateTestHeaderString({ payload: body, secret, timestamp: at });
}

test("form claims retain stable source identity without linking a known customer's records", () => {
  const record = normalizeOwnerIntake("form.submitted", { id: "submission-1", name: "Claimed owner", email: "known@example.test", message: "A question", source_url: "https://untrusted.example/path" }, now.toISOString());
  assert.equal(record.externalId, "submission-1");
  assert.equal(record.objectType, "lead");
  assert.equal(record.data.email, "known@example.test");
  assert.equal(record.data.source_url, null);
  assert.equal(record.data.native_id, undefined);
  assert.equal(record.data.received_at, now.toISOString());
});
test("form updates and deletion require source clocks and reject browser scope fields", () => {
  assert.throws(() => normalizeOwnerIntake("lead.updated", { id: "stable" }, now.toISOString()), /timestamp/);
  assert.throws(() => normalizeOwnerIntake("form.submitted", { id: "stable", client_id: "other" }, now.toISOString()));
  assert.throws(() => normalizeOwnerIntake("payment.created", { id: "stable" }, now.toISOString()), /Use form/);
  assert.throws(() => normalizeOwnerIntake("form.submitted", { id: "stable", submitted_at: "2026-12-01T00:00:00Z" }, now.toISOString()), /timestamp/);
  const deleted = normalizeOwnerIntake("lead.deleted", { id: "stable", updated_at: "2026-11-17T03:29:00Z" }, now.toISOString());
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.externalId, "stable");
  const update = normalizeOwnerIntake("lead.updated", { id: "stable", message: "Edited question", updated_at: "2026-11-17T03:29:00Z" }, now.toISOString());
  assert.equal(update.data.name, undefined);
  assert.equal(update.data.email, undefined);
  assert.equal(update.data.description, "Edited question");
  assert.equal(update.data.received_at, null);
});
test("signed invoice updates use the canonical persistence contract with account and event clock", async () => {
  const body = stripeEvent("invoice.paid", { id: "in_stable", object: "invoice", status: "paid", currency: "jpy", amount_remaining: 0, amount_paid: 1250, total: 1250 });
  const event = readStripeRecordEvent(body, signed(body), secret, "acct_owner", now);
  const writes: unknown[] = [];
  const result = await applyOwnerImport({ persist: async (...args) => { writes.push(args); return true; } }, scope, event.records, { eventAt: event.eventAt, eventId: event.id });
  assert.deepEqual(result, { saved: 1, ignored: 0 });
  assert.equal(event.records[0].externalId, "in_stable");
  assert.equal(event.records[0].data.amount_due_minor, 0);
  assert.equal(event.records[0].data.amount_paid_minor, 1250);
  assert.deepEqual((writes[0] as unknown[])[0], scope);
  assert.deepEqual((writes[0] as unknown[])[2], { eventAt: now.toISOString(), eventId: "evt_stable" });
});
test("Stripe signature checks reject expired, future, altered and wrong-account events", () => {
  const body = stripeEvent("invoice.updated", { id: "in_stable", object: "invoice" });
  assert.throws(() => readStripeRecordEvent(body, signed(body, now.getTime()/1000 - 301), secret, "acct_owner", now));
  assert.throws(() => readStripeRecordEvent(body, signed(body, now.getTime()/1000 + 301), secret, "acct_owner", now));
  assert.throws(() => readStripeRecordEvent(body + " ", signed(body), secret, "acct_owner", now));
  assert.throws(() => readStripeRecordEvent(body, signed(body), secret, "acct_another", now));
  assert.equal(readStripeRecordEvent(body, signed(body), secret, "acct_owner", now).id, "evt_stable");
});
test("refund updates retain the payment-intent identity and exact minor units", () => {
  const body = stripeEvent("charge.refunded", { id: "ch_one", object: "charge", payment_intent: "pi_stable", currency: "usd", captured: true, amount: 1000, amount_captured: 1000, amount_refunded: 400, status: "succeeded" });
  const event = readStripeRecordEvent(body, signed(body), secret, "acct_owner", now);
  assert.equal(event.records[0].externalId, "pi_stable");
  assert.equal(event.records[0].data.amount_refunded_minor, 400);
  assert.equal(event.records[0].data.status, "partially_refunded");
});
test("batches validate before persistence and ignored source versions are reported honestly", async () => {
  let calls = 0;
  const record = normalizeOwnerIntake("form.submitted", { id: "stable" }, now.toISOString());
  await assert.rejects(applyOwnerImport({ persist: async () => { calls++; return true; } }, scope, [record, { ...record, externalId: "" }], {}), /source contract/);
  assert.equal(calls, 0);
  assert.deepEqual(await applyOwnerImport({ persist: async () => false }, scope, [record], {}), { saved: 0, ignored: 1 });
});
test("production adapter binds tenant, account, source and observation clock in one RPC", async () => {
  const record = normalizeOwnerIntake("form.submitted", { id: "stable" }, now.toISOString());
  let args: Record<string, unknown> = {};
  const admin = { rpc: async (name: string, values: Record<string, unknown>) => { assert.equal(name, "persist_owner_import_record"); args = values; return { data: true, error: null }; } } as unknown as SupabaseClient;
  assert.equal(await persistOwnerImportRecord(admin, scope, record, { observedAt: now.toISOString(), eventAt: record.updatedAt!, eventId: "event-stable" }), true);
  assert.equal(args.p_partner, scope.partnerId);
  assert.equal(args.p_client, scope.clientId);
  assert.equal(args.p_connection, scope.connectionId);
  assert.equal(args.p_external, "stable");
  assert.equal(args.p_observed, now.toISOString());
  assert.equal(args.p_event_id, "event-stable");
});
