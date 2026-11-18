import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionJobRecord } from "../lib/jobs/record.ts";
import { invoiceFollowupDeliveryBlock } from "../lib/money/guard.ts";
import { mapStripeInvoice, readRestrictedStripeInvoice } from "../lib/integrations/providers/stripe.ts";
import { sendGoogleWorkspaceEmail } from "../lib/integrations/providers/google-workspace.ts";
import { ActionSuppressedError, runActionPreflight } from "../lib/jobs/action-preflight.ts";

const now = "2026-11-17T12:00:00Z", uuid = "16dfb2ae-6162-40b8-ad94-3a31b0c81f47";
const invoice = () => ({ id: "in_exact", object: "invoice", status: "open", livemode: true, collection_method: "send_invoice", customer: "cus_reviewed",
  amount_remaining: 501, amount_paid: 500, total: 1001, currency: "usd", due_date: Date.parse("2026-11-16T12:00:00Z") / 1000,
  hosted_invoice_url: "https://invoice.stripe.com/i/exact", number: "INV-41" });
function job(): ActionJobRecord {
  return { id: uuid, partner_id: uuid, client_id: uuid, connection_id: uuid, approval_id: uuid, workflow_run_id: null, kind: "email.send",
    status: "processing", attempt_count: 1, last_error: null, last_attempt_at: now, created_at: now,
    payload: { invoice_followup_version: 1, money_review_id: uuid, source_record_id: uuid, source_updated_at: now, source_external_updated_at: null,
      stripe_connection_id: uuid, stripe_account_id: "acct_reviewed", invoice_id: "in_exact", stripe_customer_id: "cus_reviewed", amount_due_minor: 501,
      amount_paid_minor: 500, total_minor: 1001, currency: "USD", due_at: "2026-11-16T12:00:00Z", collection_method: "send_invoice",
      hosted_invoice_url: "https://invoice.stripe.com/i/exact", invoice_number: "INV-41", contact_id: uuid, contact_updated_at: now, channel: "email",
      to: "owner-verified@example.test", connection_id: uuid, authority_revision: 5, customer_activity_id: null, customer_activity_at: null,
      conversation_id: uuid, conversation_revision: 7 } };
}
function admin(check: (count: number) => unknown) {
  let calls = 0;
  return { value: { rpc: async (name: string, params: Record<string, unknown>) => {
    assert.equal(name, "invoice_followup_action_check"); assert.equal(params.p_approval, uuid); assert.equal(params.p_job, uuid);
    return { data: check(++calls), error: null };
  } } as unknown as SupabaseClient, count: () => calls };
}
test("SQL source/owner denial prevents even a restricted Stripe read", async () => {
  const db = admin(() => ({ allowed: false, reason: "Customer requested human handling." })); let reads = 0;
  const reason = await invoiceFollowupDeliveryBlock(db.value, job(), { now: () => now, readInvoice: async () => { reads++; return {}; } });
  assert.equal(reason, "Customer requested human handling."); assert.equal(reads, 0); assert.equal(db.count(), 1);
});
test("a changed permission, customer response or paid source during the remote read stops delivery", async () => {
  const db = admin((count) => ({ allowed: count === 1, reason: "The owner paused the team during the invoice read." }));
  assert.match((await invoiceFollowupDeliveryBlock(db.value, job(), { now: () => now, readInvoice: async () => mapStripeInvoice(invoice()).data }))!, /paused/);
  assert.equal(db.count(), 2);
  const paid = admin(() => ({ allowed: true }));
  assert.match((await invoiceFollowupDeliveryBlock(paid.value, job(), { now: () => now,
    readInvoice: async () => mapStripeInvoice({ ...invoice(), status: "paid", amount_remaining: 0 }).data }))!, /no longer open/);
});
test("every final preflight rechecks exact source before and after remote reads; accepted outcomes cannot retry", async () => {
  const db = admin(() => ({ allowed: true })); let reads = 0;
  const deps = { now: () => now, readInvoice: async () => { reads++; return mapStripeInvoice(invoice()).data; } };
  assert.equal(await invoiceFollowupDeliveryBlock(db.value, job(), deps), null);
  assert.equal(await invoiceFollowupDeliveryBlock(db.value, job(), deps), null);
  assert.equal(reads, 2); assert.equal(db.count(), 4);
  for (const status of ["succeeded", "uncertain", "provider_pending"]) assert.ok(await invoiceFollowupDeliveryBlock(db.value, { ...job(), status }, deps));
  assert.equal(reads, 2);
  assert.ok(await invoiceFollowupDeliveryBlock(db.value, { ...job(), payload: { money_review_id: uuid } }, deps));
});
test("an invoice paid while email token refresh is awaited never reaches the real email adapter write", async () => {
  const db = admin(() => ({ allowed: true })), original = globalThis.fetch;
  let paid = false, writes = 0;
  const deps = { now: () => now, readInvoice: async () => mapStripeInvoice(paid ? { ...invoice(), status: "paid", amount_remaining: 0 } : invoice()).data };
  assert.equal(await invoiceFollowupDeliveryBlock(db.value, job(), deps), null);
  globalThis.fetch = async (url) => {
    if (String(url).includes("oauth2.googleapis.com")) { paid = true; return Response.json({ access_token: "synthetic-token" }); }
    writes++; return Response.json({ id: "must-not-send" });
  };
  try {
    await assert.rejects(sendGoogleWorkspaceEmail({ clientId: "synthetic", clientSecret: "synthetic", refreshToken: "synthetic", scope: "https://www.googleapis.com/auth/gmail.send" },
      { to: "owner-verified@example.test", subject: "Reviewed invoice", body: "Reviewed one-off reminder", idempotencyKey: uuid },
      () => runActionPreflight(() => invoiceFollowupDeliveryBlock(db.value, job(), deps))), ActionSuppressedError);
    assert.equal(writes, 0);
  } finally { globalThis.fetch = original; }
});
test("restricted invoice observations make only account-bound GETs and retain actual minor units", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Response.json(calls.length === 1 ? { id: "acct_reviewed", object: "account" } : invoice());
  }) as typeof fetch;
  const result = await readRestrictedStripeInvoice({ apiKey: "rk_live_synthetic", accessMode: "read_only" }, { accountId: "acct_reviewed", invoiceId: "in_exact" }, { fetch: fetcher, now: () => now });
  assert.deepEqual(calls.map((call) => call.url), ["https://api.stripe.com/v1/account", "https://api.stripe.com/v1/invoices/in_exact"]);
  assert.ok(calls.every((call) => call.init?.method === "GET" && call.init.cache === "no-store" && call.init.redirect === "error" && !call.init.body));
  assert.equal(result.invoice.data.amount_due_minor, 501); assert.equal(result.invoice.data.collection_method, "send_invoice");
  assert.equal(result.invoice.data.livemode, true); assert.equal(result.observedAt, now);
});
test("wrong keys/accounts/invoices or unavailable reads never become evidence", async () => {
  for (const credentials of [{ apiKey: "sk_live_synthetic", accessMode: "read_only" as const }, { apiKey: "rk_test_synthetic", accessMode: "read_only" as const }, { apiKey: "rk_live_synthetic" }]) {
    let reads = 0;
    await assert.rejects(readRestrictedStripeInvoice(credentials, { accountId: "acct_reviewed", invoiceId: "in_exact" }, { fetch: async () => { reads++; return Response.json({}); } }));
    assert.equal(reads, 0);
  }
  for (const response of [{ id: "acct_other", object: "account" }, { id: "acct_reviewed", object: "not_account" }]) {
    let reads = 0;
    await assert.rejects(readRestrictedStripeInvoice({ apiKey: "rk_live_synthetic", accessMode: "read_only" }, { accountId: "acct_reviewed", invoiceId: "in_exact" }, {
      fetch: async () => { reads++; return Response.json(response); } }));
    assert.equal(reads, 1);
  }
  let reads = 0;
  await assert.rejects(readRestrictedStripeInvoice({ apiKey: "rk_live_synthetic", accessMode: "read_only" }, { accountId: "acct_reviewed", invoiceId: "in_exact" }, {
    fetch: async () => Response.json(++reads === 1 ? { id: "acct_reviewed", object: "account" } : { ...invoice(), id: "in_other" }) }));
  await assert.rejects(readRestrictedStripeInvoice({ apiKey: "rk_live_synthetic", accessMode: "read_only" }, { accountId: "acct_reviewed", invoiceId: "in_exact" }, {
    fetch: async () => new Response("Unavailable", { status: 503 }) }), /could not be verified/);
  const broken = admin(() => null); let readsAfterBrokenCheck = 0;
  await assert.rejects(invoiceFollowupDeliveryBlock(broken.value, job(), { readInvoice: async () => { readsAfterBrokenCheck++; return {}; } }), /could not be verified/);
  assert.equal(readsAfterBrokenCheck, 0);
});
