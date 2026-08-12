import type { CanonicalObjectType, CanonicalRecord, ConnectorAdapter, ConnectorPage, ConnectorPushInput } from "../connectors/types";
import { connectorPushParams } from "../connectors/field-mappings.ts";

export type StripeCredentials = { apiKey: string };
const BASE = "https://api.stripe.com/v1";

async function stripeFetch(credentials: StripeCredentials, path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${credentials.apiKey}`, "Content-Type": "application/x-www-form-urlencoded", ...init.headers }, signal: init.signal ?? AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Stripe API failed (${response.status}).`);
  return response;
}

function iso(epoch: unknown) { return typeof epoch === "number" ? new Date(epoch * 1000).toISOString() : null; }
function mapStripeCustomer(source: Record<string, unknown>): CanonicalRecord { return { objectType: "customer", externalId: String(source.id ?? ""), updatedAt: iso(source.created), data: { name: source.name ?? null, email: source.email ?? null, phone: source.phone ?? null, balance: source.balance ?? null, currency: source.currency ?? null }, source }; }
function mapStripeInvoice(source: Record<string, unknown>): CanonicalRecord { return { objectType: "invoice", externalId: String(source.id ?? ""), updatedAt: iso(source.created), data: { number: source.number ?? null, customer_id: source.customer ?? null, total: source.total ?? null, amount_due: source.amount_due ?? null, amount_paid: source.amount_paid ?? null, currency: source.currency ?? null, status: source.status ?? null, due_date: iso(source.due_date), hosted_url: source.hosted_invoice_url ?? null }, source }; }
function mapStripePayment(source: Record<string, unknown>): CanonicalRecord { return { objectType: "payment", externalId: String(source.id ?? ""), updatedAt: iso(source.created), data: { customer_id: source.customer ?? null, amount: source.amount ?? null, currency: source.currency ?? null, status: source.status ?? null, description: source.description ?? null }, source }; }

async function pull(credentials: StripeCredentials, objectType: CanonicalObjectType, cursor: Record<string, unknown> | null): Promise<ConnectorPage> {
  const config = objectType === "customer" ? ["/customers", mapStripeCustomer] as const : objectType === "invoice" ? ["/invoices", mapStripeInvoice] as const : objectType === "payment" ? ["/payment_intents", mapStripePayment] as const : null;
  if (!config) throw new Error(`Stripe cannot pull ${objectType}.`);
  const after = typeof cursor?.after === "string" ? cursor.after : null;
  const body = await (await stripeFetch(credentials, `${config[0]}?limit=100${after ? `&starting_after=${encodeURIComponent(after)}` : ""}`)).json() as { data?: Record<string, unknown>[]; has_more?: boolean };
  const rows = body.data ?? [];
  return { records: rows.map(config[1]), nextCursor: body.has_more && rows.length ? { after: String(rows.at(-1)?.id ?? "") } : null };
}

async function push(credentials: StripeCredentials, input: ConnectorPushInput) {
  if (input.objectType === "customer" && input.operation === "create") {
    const params = connectorPushParams(input.externalData, { name: input.data.name, email: input.data.email, phone: input.data.phone, metadata: { northstar_id: input.nativeObjectId } });
    const created = await (await stripeFetch(credentials, "/customers", { method: "POST", headers: { "Idempotency-Key": input.idempotencyKey }, body: params })).json() as Record<string, unknown>;
    return { externalObjectId: String(created.id ?? ""), source: created };
  }
  if (input.objectType === "payment" && input.operation === "create") {
    const amount = Number(input.data.amount ?? 0);
    if (!Number.isInteger(amount) || amount < 50) throw new Error("Stripe payment link amount must be an integer in cents.");
    const params = connectorPushParams(input.externalData, { line_items: [{ price_data: { currency: String(input.data.currency ?? "usd"), unit_amount: amount, product_data: { name: String(input.data.description ?? "Service payment") } }, quantity: 1 }], metadata: { northstar_id: input.nativeObjectId } });
    const created = await (await stripeFetch(credentials, "/payment_links", { method: "POST", headers: { "Idempotency-Key": input.idempotencyKey }, body: params })).json() as Record<string, unknown>;
    return { externalObjectId: String(created.id ?? ""), source: created };
  }
  throw new Error(`Stripe cannot ${input.operation} ${input.objectType}.`);
}

export const stripeAdapter: ConnectorAdapter<StripeCredentials> = {
  manifest: { key: "stripe", name: "Stripe", category: "payments", description: "Customers, invoices, payments, and payment links from Stripe.", authStrategy: "api_key", capabilities: ["customer.read", "customer.create", "invoice.read", "payment.read", "payment.create"], verificationStatus: "contract_verified", requestable: false, docsUrl: "https://docs.stripe.com/api" },
  async testConnection(context) { try { const account = await (await stripeFetch(context.credentials, "/account")).json() as Record<string, unknown>; return { ok: true, detail: "Stripe connected. Customers, invoices, payments, and payment links are ready.", externalAccountId: String(account.id ?? ""), externalAccountName: String((account.business_profile as Record<string, unknown> | undefined)?.name ?? account.email ?? "Stripe account") }; } catch (error) { return { ok: false, detail: error instanceof Error ? error.message : "Stripe verification failed." }; } },
  pullPage(context, objectType, cursor) { return pull(context.credentials, objectType, cursor); },
  pushRecord(context, input) { return push(context.credentials, input); },
};
