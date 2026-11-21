import test from "node:test";
import assert from "node:assert/strict";
import { connectionControls, providerConnectLabel } from "../components/business/connection-controls.ts";
import { buildConnectedMoney, connectedStreamWarnings, type DailyBriefData } from "../lib/business/daily-brief.ts";
import { buildFocusBrief } from "../lib/business/focus-brief.ts";
import { EMPTY_PROFILE } from "../lib/business/types.ts";
import type { ConnectedApp, ConnectedData, ConnectionProviderOption, SyncedInvoice } from "../lib/connections/types.ts";

const app = (values: Partial<ConnectedApp> = {}): ConnectedApp => ({
  id: "connection", name: "Account", account: null, provider: "generic_inbound_webhook", status: "needs_attention",
  paused: false, readOnly: true, lastSyncedAt: null, syncing: false, error: null, ...values,
});
const option = (values: Partial<ConnectionProviderOption> = {}): ConnectionProviderOption => ({
  key: "generic_inbound_webhook", label: "Website form", category: "intake", setup: "token", available: true, detail: "", capabilities: [], ...values,
});
const connected = (): ConnectedData => ({ apps: [], messages: [], appointments: [], leads: [], invoices: [], payments: [], errors: [], limited: false, generatedAt: "2026-11-17T12:00:00Z" });
const invoice = (values: Partial<SyncedInvoice> = {}): SyncedInvoice => ({
  id: "invoice", connectionId: "stripe", externalId: "in_1", account: "Shop", provider: "stripe", number: "INV-1", status: "open", currency: "USD",
  totalMinor: 1000, amountDueMinor: 500, amountPaidMinor: 500, dueAt: null, updatedAt: null, href: null, ...values,
});

test("prepared form accounts can pause before their first receipt and never enter OAuth", () => {
  const controls = connectionControls(app(), option());
  assert.equal(controls.canPause, true);
  assert.equal(controls.reconnect, false);
  assert.equal(controls.canRefresh, false);
  assert.equal(controls.secureSetup, false);
  assert.equal(controls.disconnect, true);
  assert.equal(connectionControls(app({ paused: true }), option()).canPause, true);
});
test("Stripe attention state exposes secure recovery and pause while blocking premature refresh", () => {
  const controls = connectionControls(app({ provider: "stripe", readOnly: false }), option({ key: "stripe", setup: "operator", category: "money" }));
  assert.equal(controls.secureSetup, true);
  assert.equal(controls.canPause, true);
  assert.equal(controls.canRefresh, false);
  assert.equal(controls.reconnect, false);
});
test("email accounts retain explicit reconnect and can add another account without adopting agent credentials", () => {
  const provider = option({ key: "microsoft_365", setup: "oauth", category: "mail_calendar", label: "Microsoft" });
  const account = app({ provider: "microsoft_365", status: "connected", account: "owner@example.test" });
  assert.equal(connectionControls(account, provider).reconnect, true);
  assert.equal(providerConnectLabel(provider, [account]), "Connect another account");
  assert.equal(providerConnectLabel(provider, []), "Connect Microsoft");
  assert.equal(connectionControls({ ...account, readOnly: false }, provider).managed, false);
});
test("money totals separate currencies, omit draft/paid balances and keep unknown balances explicit", () => {
  const data = connected();
  data.invoices = [invoice(), invoice({ id: "jpy", currency: "JPY", amountDueMinor: 200 }),
    invoice({ id: "draft", status: "draft", amountDueMinor: 99000 }), invoice({ id: "paid", status: "paid", amountDueMinor: 99000 }),
    invoice({ id: "unknown", amountDueMinor: null }), invoice({ id: "unknown-currency", currency: null })];
  data.payments = [{ id: "payment", externalId: "pi_1", connectionId: "stripe", account: "Shop", provider: "stripe", currency: "USD", status: "succeeded", amountMinor: 100000, amountRefundedMinor: null, updatedAt: null, href: null }];
  const money = buildConnectedMoney(data);
  assert.deepEqual(money.totals.map((total) => [total.currency, total.amountMinor]), [["JPY", 200], ["USD", 500]]);
  assert.equal(money.unknownDueCount, 2);
  assert.equal(money.payments[0].amountRefundedMinor, null);
  assert.equal(money.invoices.length, 6);
});
test("unsafe monetary sums remain unavailable instead of becoming rounded totals", () => {
  const data = connected();
  data.invoices = [invoice({ amountDueMinor: Number.MAX_SAFE_INTEGER }), invoice({ id: "second", amountDueMinor: 5 })];
  assert.equal(buildConnectedMoney(data).totals[0].amountMinor, null);
});
test("source warnings stay scoped to the stream shown in the owner view", () => {
  const data = connected();
  data.apps = [app({ provider: "microsoft_365", streams: [{ key: "message", status: "stale", lastSyncedAt: null, partial: false, detail: "Mail is stale" }] }),
    app({ id: "stripe", provider: "stripe", streams: [{ key: "invoice", status: "fresh", lastSyncedAt: data.generatedAt, partial: false, detail: "Current invoice import" }] })];
  assert.deepEqual(connectedStreamWarnings(data, ["invoice"]), []);
  assert.deepEqual(connectedStreamWarnings(data, ["message"]), ["Account: Mail is stale"]);
});
test("Today includes populated imported money and intake sections with safe navigation and no fabricated actions", () => {
  const source = connected();
  source.invoices = [invoice({ href: "javascript:alert(1)" })];
  source.leads = [{ id: "lead", externalId: "source-1", nativeId: null, connectionId: "form", account: "Website", provider: "generic_inbound_webhook", title: "Consultation inquiry", status: "new", receivedAt: source.generatedAt, href: null }];
  const data: DailyBriefData = {
    workspace: { clientName: "Business", clientId: "client", workspaceScopeKey: "owner:client", profileRevision: null, profile: EMPTY_PROFILE, records: [], installs: [], events: [], contacts: [], connections: [], pendingCustomerApprovals: 0, aiConfigured: false, canWrite: true, isTestAccount: true, setupRequired: false, error: null },
    connectedData: source, displayName: null, timeZone: "UTC", generatedAt: source.generatedAt, tasks: [], appointments: [], approvals: [], conversations: [], work: [], teamStatus: "paused",
    counts: { tasks: 0, approvals: 0, conversations: 0, blockedWork: 0 }, errors: [], limited: false,
  };
  const focus = buildFocusBrief(data);
  assert.equal(focus.sections.find((section) => section.key === "connected-invoices")?.rows[0].href, "/client/money");
  assert.equal(focus.sections.find((section) => section.key === "intake")?.rows[0].label, "Saved inquiry");
  assert.equal(focus.sections.some((section) => section.key === "todo"), false);
  source.invoices = []; source.leads = [];
  assert.deepEqual(buildFocusBrief(data).sections, []);
});
