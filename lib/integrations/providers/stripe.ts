import { connectorHttpError } from "../connectors/errors.ts";
import type { CanonicalObjectType, CanonicalRecord, ConnectorAdapter, ConnectorPage, ConnectorPushInput } from "../connectors/types";
import { connectorPushParams } from "../connectors/field-mappings.ts";

export type StripeCredentials = { apiKey: string; webhookSecret?: string; accessMode?: "read_only" };
const BASE = "https://api.stripe.com/v1";

async function stripeFetch(credentials: StripeCredentials, path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE}${path}`, { ...init, redirect: "error", headers: { Authorization: `Bearer ${credentials.apiKey}`, "Content-Type": "application/x-www-form-urlencoded", ...init.headers }, signal: init.signal ?? AbortSignal.timeout(15_000) });
  if (!response.ok) throw connectorHttpError("stripe", response);
  return response;
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const id = (value: unknown): string | null => typeof value === "string" ? value : typeof object(value).id === "string" ? String(object(value).id) : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
/** Stripe amounts already use each currency's minor unit; never multiply by 100. */
export function stripeMinorUnits(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}
function iso(epoch: unknown): string | null {
  if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 0) return null;
  const date = new Date(epoch * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
const currency = (value: unknown) => typeof value === "string" && /^[a-z]{3}$/i.test(value) ? value.toUpperCase() : null;
function latestTime(...values: unknown[]): string | null {
  const timestamps = values.map(iso).filter((v): v is string => !!v).sort();
  return timestamps.at(-1) ?? null;
}
function safeSource(source: Record<string, unknown>, data: Record<string, unknown>) {
  // PaymentIntent raw payloads can include client_secret and payment details.
  return { id: id(source.id), object: text(source.object), livemode: source.livemode === true, ...data };
}
function withClock(record: CanonicalRecord, source: Record<string, unknown>, options: { observedAt?: string; eventAt?: string } = {}): CanonicalRecord {
  const data = { ...record.data, source_created_at: iso(source.created), source_updated_at: record.data.source_updated_at ?? null,
    ...(options.observedAt ? { observed_at: options.observedAt } : {}),
    ...(options.eventAt ? { source_event_at: options.eventAt } : {}) };
  return { ...record, updatedAt: options.eventAt ?? record.updatedAt, data, source: safeSource(source, data) };
}
export function mapStripeCustomer(source: Record<string, unknown>): CanonicalRecord {
  const data = { name: text(source.name), email: text(source.email), phone: text(source.phone),
    balance_minor: stripeMinorUnits(source.balance), balance: stripeMinorUnits(source.balance), currency: currency(source.currency), source_updated_at: null };
  return { objectType: "customer", externalId: id(source.id) ?? "", deleted: source.deleted === true,
    updatedAt: iso(source.created), data, source: safeSource(source, data) };
}
export function mapStripeInvoice(source: Record<string, unknown>): CanonicalRecord {
  const transitions = object(source.status_transitions);
  const updatedAt = latestTime(transitions.finalized_at, transitions.paid_at, transitions.voided_at, transitions.marked_uncollectible_at);
  const data = {
    number: text(source.number), customer_id: id(source.customer),
    total_minor: stripeMinorUnits(source.total), amount_due_minor: stripeMinorUnits(source.amount_remaining),
    amount_original_due_minor: stripeMinorUnits(source.amount_due), amount_paid_minor: stripeMinorUnits(source.amount_paid),
    total: stripeMinorUnits(source.total), amount_due: stripeMinorUnits(source.amount_due),
    amount_remaining: stripeMinorUnits(source.amount_remaining), amount_paid: stripeMinorUnits(source.amount_paid),
    currency: currency(source.currency), status: text(source.status) ?? "unknown",
    due_date: iso(source.due_date), hosted_url: text(source.hosted_invoice_url),
    source_updated_at: updatedAt,
  };
  return { objectType: "invoice", externalId: id(source.id) ?? "", deleted: source.deleted === true,
    updatedAt: updatedAt ?? iso(source.created), data, source: safeSource(source, data) };
}
function paymentStatus(providerStatus: string | null, received: number | null, refunded: number | null): string {
  if (refunded !== null && refunded > 0) return received !== null && received > 0 && refunded >= received ? "refunded" : "partially_refunded";
  return providerStatus ?? "unknown";
}
export function mapStripePayment(source: Record<string, unknown>): CanonicalRecord {
  const charge = object(source.latest_charge);
  const received = stripeMinorUnits(source.amount_received) ?? stripeMinorUnits(charge.amount_captured);
  const refunded = stripeMinorUnits(charge.amount_refunded) ?? (source.latest_charge === null && received === 0 ? 0 : null);
  const refunds = object(charge.refunds);
  const refundTimes = (Array.isArray(refunds.data) ? refunds.data : []).map((r) => object(r).created);
  const providerStatus = text(source.status);
  const data = {
    customer_id: id(source.customer), amount_minor: received, amount_requested_minor: stripeMinorUnits(source.amount),
    amount_refunded_minor: refunded, amount: stripeMinorUnits(source.amount), amount_received: received,
    amount_refunded: refunded, refunds_known: refunded !== null,
    currency: currency(source.currency), status: paymentStatus(providerStatus, received, refunded), provider_status: providerStatus,
    description: text(source.description), charge_id: id(source.latest_charge), receipt_url: text(charge.receipt_url),
    source_updated_at: latestTime(source.canceled_at, ...refundTimes),
  };
  return { objectType: "payment", externalId: id(source.id) ?? "", externalParentId: id(source.customer),
    updatedAt: latestTime(source.created, source.canceled_at, ...refundTimes), data, source: safeSource(source, data) };
}
export function mapStripeChargePayment(source: Record<string, unknown>): CanonicalRecord {
  const received = stripeMinorUnits(source.amount_captured) ?? (source.captured === true ? stripeMinorUnits(source.amount) : null);
  const refunded = stripeMinorUnits(source.amount_refunded);
  const providerStatus = text(source.status);
  const refunds = object(source.refunds);
  const refundTimes = (Array.isArray(refunds.data) ? refunds.data : []).map((r) => object(r).created);
  const data = {
    customer_id: id(source.customer), amount_minor: received, amount_requested_minor: stripeMinorUnits(source.amount),
    amount_refunded_minor: refunded, amount: stripeMinorUnits(source.amount), amount_received: received,
    amount_refunded: refunded, refunds_known: refunded !== null,
    currency: currency(source.currency), status: paymentStatus(providerStatus, received, refunded), provider_status: providerStatus,
    description: text(source.description), charge_id: id(source.id), receipt_url: text(source.receipt_url),
    source_updated_at: latestTime(...refundTimes),
  };
  return { objectType: "payment", externalId: id(source.payment_intent) ?? id(source.id) ?? "",
    externalParentId: id(source.customer), updatedAt: latestTime(source.created, ...refundTimes), data, source: safeSource(source, data) };
}

/** Verify webhook signatures before calling. Never infer refund totals from a single refund. */
export function normalizeStripeWebhookEvent(event: {
  type: string; created: number; data: { object: Record<string, unknown> };
}): CanonicalRecord[] {
  const source = event.data.object, eventAt = iso(event.created);
  if (!eventAt || !id(source.id)) return [];
  let record: CanonicalRecord | null = null;
  if (event.type.startsWith("invoice.") && source.object === "invoice") record = mapStripeInvoice(source);
  else if (event.type.startsWith("payment_intent.") && source.object === "payment_intent") record = mapStripePayment(source);
  else if (["charge.refunded", "charge.succeeded", "charge.updated"].includes(event.type) && source.object === "charge") record = mapStripeChargePayment(source);
  else if (event.type.startsWith("customer.") && source.object === "customer") record = mapStripeCustomer(source);
  if (!record) return [];
  return [withClock({ ...record, deleted: record.deleted || event.type.endsWith(".deleted") }, source, { eventAt })];
}

async function pull(credentials: StripeCredentials, objectType: CanonicalObjectType, cursor: Record<string, unknown> | null): Promise<ConnectorPage> {
  const config = objectType === "customer" ? ["/customers", mapStripeCustomer] as const : objectType === "invoice" ? ["/invoices", mapStripeInvoice] as const : objectType === "payment" ? ["/payment_intents", mapStripePayment] as const : null;
  if (!config) throw new Error(`Stripe cannot pull ${objectType}.`);
  const params = new URLSearchParams({ limit: "100" });
  if (typeof cursor?.after === "string") params.set("starting_after", cursor.after);
  if (objectType === "payment") params.append("expand[]", "data.latest_charge");
  const observedAt = new Date().toISOString(); // Captured BEFORE request, independent from provider modification times.
  const body = await (await stripeFetch(credentials, `${config[0]}?${params}`)).json() as { data?: Record<string, unknown>[]; has_more?: boolean };
  if (!Array.isArray(body.data)) throw new Error("Stripe returned an incomplete record list.");
  const rows = body.data;
  return { records: rows.map((source) => withClock(config[1](source), source, { observedAt })),
    nextCursor: body.has_more && rows.length ? { after: String(rows.at(-1)?.id ?? "") } : null,
    continueImmediately: body.has_more === true && rows.length > 0 };
}

async function push(credentials: StripeCredentials, input: ConnectorPushInput) {
  if (credentials.accessMode === "read_only") throw new Error("This Stripe connection is read-only.");
  if (input.objectType === "customer" && input.operation === "create") {
    const params = connectorPushParams(input.externalData, { name: input.data.name, email: input.data.email, phone: input.data.phone, metadata: { northstar_id: input.nativeObjectId } });
    const created = await (await stripeFetch(credentials, "/customers", { method: "POST", headers: { "Idempotency-Key": input.idempotencyKey }, body: params })).json() as Record<string, unknown>;
    return { externalObjectId: String(created.id ?? ""), source: created };
  }
  if (input.objectType === "payment" && input.operation === "create") {
    const amount = Number(input.data.amount ?? 0);
    if (!Number.isInteger(amount) || amount < 50) throw new Error("Stripe payment link amount must be an integer in minor units.");
    const params = connectorPushParams(input.externalData, { line_items: [{ price_data: { currency: String(input.data.currency ?? "usd"), unit_amount: amount, product_data: { name: String(input.data.description ?? "Service payment") } }, quantity: 1 }], metadata: { northstar_id: input.nativeObjectId } });
    const created = await (await stripeFetch(credentials, "/payment_links", { method: "POST", headers: { "Idempotency-Key": input.idempotencyKey }, body: params })).json() as Record<string, unknown>;
    return { externalObjectId: String(created.id ?? ""), source: created };
  }
  throw new Error(`Stripe cannot ${input.operation} ${input.objectType}.`);
}

export const stripeAdapter: ConnectorAdapter<StripeCredentials> = {
  manifest: { key: "stripe", name: "Stripe", category: "payments", description: "Read customer, invoice and payment snapshots from Stripe; amounts remain in original currency minor units.", authStrategy: "api_key", capabilities: ["customer.read", "invoice.read", "payment.read"], verificationStatus: "contract_verified", requestable: false, docsUrl: "https://docs.stripe.com/api", webhookEvents: ["invoice.*", "payment_intent.*", "charge.refunded", "charge.succeeded", "charge.updated"] },
  async testConnection(context) { try { const account = await (await stripeFetch(context.credentials, "/account")).json() as Record<string, unknown>; return { ok: true, detail: "Stripe account access checked. Invoice/payment read permissions are verified by their imports.", externalAccountId: String(account.id ?? ""), externalAccountName: String((account.business_profile as Record<string, unknown> | undefined)?.name ?? account.email ?? "Stripe account") }; } catch (error) { return { ok: false, detail: error instanceof Error ? error.message : "Stripe verification failed." }; } },
  pullPage(context, objectType, cursor) { return pull(context.credentials, objectType, cursor); },
  pushRecord(context, input) { return push(context.credentials, input); },
};
