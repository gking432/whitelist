import { connectorHttpError } from "../connectors/errors.ts";
import type { CanonicalObjectType, CanonicalRecord, ConnectorAdapter, ConnectorPage, ConnectorPushInput } from "../connectors/types";
import type { QuickBooksCredentials } from "./commerce-oauth";
import { connectorPushPayload } from "../connectors/field-mappings.ts";

const BASE = "https://quickbooks.api.intuit.com/v3/company";

async function qboFetch(credentials: QuickBooksCredentials, path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE}/${encodeURIComponent(credentials.realmId)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${credentials.accessToken}`, Accept: "application/json", "Content-Type": "application/json", ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw connectorHttpError("quickbooks-online", response);
  return response;
}

function qboName(source: Record<string, unknown>) {
  return String(source.DisplayName ?? source.FullyQualifiedName ?? source.CompanyName ?? "");
}

export function mapQuickBooksCustomer(source: Record<string, unknown>): CanonicalRecord {
  const email = source.PrimaryEmailAddr as Record<string, unknown> | undefined;
  const phone = source.PrimaryPhone as Record<string, unknown> | undefined;
  return { objectType: "customer", externalId: String(source.Id ?? ""), updatedAt: (source.MetaData as Record<string, unknown> | undefined)?.LastUpdatedTime as string | undefined, data: { name: qboName(source), first_name: source.GivenName ?? null, last_name: source.FamilyName ?? null, email: email?.Address ?? null, phone: phone?.FreeFormNumber ?? null, balance: source.Balance ?? null }, source };
}

function mapQuickBooksInvoice(source: Record<string, unknown>): CanonicalRecord {
  const customer = source.CustomerRef as Record<string, unknown> | undefined;
  return { objectType: "invoice", externalId: String(source.Id ?? ""), updatedAt: (source.MetaData as Record<string, unknown> | undefined)?.LastUpdatedTime as string | undefined, data: { number: source.DocNumber ?? null, customer_id: customer?.value ?? null, customer_name: customer?.name ?? null, total: source.TotalAmt ?? null, balance: source.Balance ?? null, due_date: source.DueDate ?? null, status: Number(source.Balance ?? 0) <= 0 ? "paid" : "open" }, source };
}

function mapQuickBooksPayment(source: Record<string, unknown>): CanonicalRecord {
  const customer = source.CustomerRef as Record<string, unknown> | undefined;
  return { objectType: "payment", externalId: String(source.Id ?? ""), updatedAt: (source.MetaData as Record<string, unknown> | undefined)?.LastUpdatedTime as string | undefined, data: { customer_id: customer?.value ?? null, customer_name: customer?.name ?? null, amount: source.TotalAmt ?? null, date: source.TxnDate ?? null, reference: source.PaymentRefNum ?? null, status: "succeeded" }, source };
}

const ENTITY_BY_TYPE = { customer: "Customer", invoice: "Invoice", payment: "Payment" } as const;

async function pull(credentials: QuickBooksCredentials, objectType: CanonicalObjectType, cursor: Record<string, unknown> | null): Promise<ConnectorPage> {
  if (!(objectType in ENTITY_BY_TYPE)) throw new Error(`QuickBooks cannot pull ${objectType}.`);
  const start = typeof cursor?.start === "number" ? cursor.start : 1;
  const entity = ENTITY_BY_TYPE[objectType as keyof typeof ENTITY_BY_TYPE];
  const query = `select * from ${entity} startposition ${start} maxresults 100`;
  const body = await (await qboFetch(credentials, `/query?query=${encodeURIComponent(query)}&minorversion=75`)).json() as { QueryResponse?: Record<string, unknown> };
  const rows = Array.isArray(body.QueryResponse?.[entity]) ? body.QueryResponse?.[entity] as Record<string, unknown>[] : [];
  const mapper = objectType === "customer" ? mapQuickBooksCustomer : objectType === "invoice" ? mapQuickBooksInvoice : mapQuickBooksPayment;
  return { records: rows.map(mapper), nextCursor: rows.length === 100 ? { start: start + rows.length } : null };
}

async function push(credentials: QuickBooksCredentials, input: ConnectorPushInput) {
  if (input.objectType !== "customer" || input.operation !== "create") throw new Error(`QuickBooks cannot ${input.operation} ${input.objectType}.`);
  const body = connectorPushPayload(input.externalData, { DisplayName: input.data.name ?? [input.data.first_name, input.data.last_name].filter(Boolean).join(" "), GivenName: input.data.first_name ?? undefined, FamilyName: input.data.last_name ?? undefined, PrimaryEmailAddr: input.data.email ? { Address: input.data.email } : undefined, PrimaryPhone: input.data.phone ? { FreeFormNumber: input.data.phone } : undefined });
  const created = await (await qboFetch(credentials, `/customer?minorversion=75&requestid=${encodeURIComponent(input.idempotencyKey)}`, { method: "POST", body: JSON.stringify(body) })).json() as { Customer?: Record<string, unknown> };
  return { externalObjectId: String(created.Customer?.Id ?? ""), source: created.Customer };
}

export const quickBooksOnlineAdapter: ConnectorAdapter<QuickBooksCredentials> = {
  manifest: { key: "quickbooks_online", name: "QuickBooks Online", category: "accounting", description: "Customers, invoices, and payments from QuickBooks Online.", authStrategy: "oauth2", capabilities: ["customer.read", "invoice.read", "payment.read"], verificationStatus: "contract_verified", requestable: false, docsUrl: "https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api" },
  async testConnection(context) {
    try {
      const body = await (await qboFetch(context.credentials, `/companyinfo/${encodeURIComponent(context.credentials.realmId)}?minorversion=75`)).json() as { CompanyInfo?: Record<string, unknown> };
      return { ok: true, detail: "QuickBooks connected. Customers, invoices, and payments are ready to sync.", externalAccountId: context.credentials.realmId, externalAccountName: String(body.CompanyInfo?.CompanyName ?? "QuickBooks company") };
    } catch (error) { return { ok: false, detail: error instanceof Error ? error.message : "QuickBooks verification failed." }; }
  },
  pullPage(context, objectType, cursor) { return pull(context.credentials, objectType, cursor); },
  pushRecord(context, input) { return push(context.credentials, input); },
};
