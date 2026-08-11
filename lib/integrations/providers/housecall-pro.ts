import type { CanonicalObjectType, CanonicalRecord, ConnectorAdapter, ConnectorPage, ConnectorPushInput } from "../connectors/types";

export type HousecallProCredentials = { apiKey: string };
const BASE = "https://api.housecallpro.com";

async function hcpFetch(credentials: HousecallProCredentials, path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${credentials.apiKey}`, "Content-Type": "application/json", ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Housecall Pro API failed (${response.status}).`);
  return response;
}

function list(body: unknown, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  const record = (body ?? {}) as Record<string, unknown>;
  for (const key of keys) if (Array.isArray(record[key])) return record[key] as Record<string, unknown>[];
  return [];
}

export function mapHousecallCustomer(source: Record<string, unknown>): CanonicalRecord {
  const phones = Array.isArray(source.mobile_number) ? source.mobile_number : [];
  const addresses = Array.isArray(source.addresses) ? source.addresses : [];
  const address = (addresses[0] ?? {}) as Record<string, unknown>;
  return {
    objectType: "customer",
    externalId: String(source.id ?? ""),
    updatedAt: typeof source.updated_at === "string" ? source.updated_at : null,
    data: {
      first_name: source.first_name ?? null,
      last_name: source.last_name ?? null,
      name: [source.first_name, source.last_name].filter(Boolean).join(" ") || (source.company ?? null),
      email: source.email ?? null,
      phone: source.mobile_number ?? source.home_number ?? phones[0] ?? null,
      address: [address.street, address.city, address.state, address.zip].filter(Boolean).join(", ") || null,
    },
    source,
  };
}

function mapHousecallJob(source: Record<string, unknown>): CanonicalRecord {
  const schedule = (source.schedule ?? {}) as Record<string, unknown>;
  return {
    objectType: "job",
    externalId: String(source.id ?? ""),
    updatedAt: typeof source.updated_at === "string" ? source.updated_at : null,
    data: { title: source.name ?? source.description ?? "Job", status: source.work_status ?? source.status ?? null, start_at: schedule.scheduled_start ?? null, end_at: schedule.scheduled_end ?? null, customer_id: source.customer_id ?? null },
    source,
  };
}

async function pull(credentials: HousecallProCredentials, objectType: CanonicalObjectType, cursor: Record<string, unknown> | null): Promise<ConnectorPage> {
  const page = typeof cursor?.page === "number" ? cursor.page : 1;
  const path = objectType === "customer" ? `/customers?page=${page}&page_size=100` : objectType === "job" ? `/jobs?page=${page}&page_size=100` : null;
  if (!path) throw new Error(`Housecall Pro cannot pull ${objectType}.`);
  const body = await (await hcpFetch(credentials, path)).json() as Record<string, unknown>;
  const rows = list(body, objectType === "customer" ? ["customers", "data"] : ["jobs", "data"]);
  const totalPages = Number(body.total_pages ?? body.totalPages ?? page);
  return { records: rows.map(objectType === "customer" ? mapHousecallCustomer : mapHousecallJob), nextCursor: page < totalPages ? { page: page + 1 } : null };
}

async function push(credentials: HousecallProCredentials, input: ConnectorPushInput) {
  if (input.objectType !== "customer" || input.operation !== "create") throw new Error(`Housecall Pro cannot ${input.operation} ${input.objectType}.`);
  const response = await hcpFetch(credentials, "/customers", { method: "POST", body: JSON.stringify({ first_name: input.data.first_name ?? input.data.name, last_name: input.data.last_name ?? "", email: input.data.email ?? null, mobile_number: input.data.phone ?? null }) });
  const created = await response.json() as Record<string, unknown>;
  return { externalObjectId: String(created.id ?? ""), source: created };
}

export const housecallProAdapter: ConnectorAdapter<HousecallProCredentials> = {
  manifest: { key: "housecall_pro", name: "Housecall Pro", category: "field_service", description: "Customers and jobs for Housecall Pro businesses.", authStrategy: "api_key", capabilities: ["customer.read", "customer.create", "job.read"], verificationStatus: "contract_verified", requestable: false, docsUrl: "https://docs.housecallpro.com/" },
  async testConnection(context) {
    try {
      const body = await (await hcpFetch(context.credentials, "/customers?page=1&page_size=1")).json() as Record<string, unknown>;
      return { ok: true, detail: "Housecall Pro connected. Customers and jobs are ready to sync.", externalAccountName: typeof body.company_name === "string" ? body.company_name : undefined };
    } catch (error) { return { ok: false, detail: error instanceof Error ? error.message : "Housecall Pro verification failed." }; }
  },
  pullPage(context, objectType, cursor) { return pull(context.credentials, objectType, cursor); },
  pushRecord(context, input) { return push(context.credentials, input); },
};
