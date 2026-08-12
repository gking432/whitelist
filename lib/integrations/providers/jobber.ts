import type { CanonicalObjectType, CanonicalRecord, ConnectorAdapter, ConnectorPage, ConnectorPushInput } from "../connectors/types";
import type { JobberCredentials } from "./jobber-oauth";
import { connectorPushPayload } from "../connectors/field-mappings.ts";

const ENDPOINT = "https://api.getjobber.com/api/graphql";
const API_VERSION = "2025-04-16";

async function graph(credentials: JobberCredentials, query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${credentials.accessToken}`, "X-JOBBER-GRAPHQL-VERSION": API_VERSION, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Jobber API failed (${response.status}).`);
  const body = await response.json() as { data?: Record<string, unknown>; errors?: { message?: string }[] };
  if (body.errors?.length) throw new Error(`Jobber rejected the request: ${body.errors[0]?.message ?? "GraphQL error"}`);
  return body.data ?? {};
}

export function mapJobberClient(source: Record<string, unknown>): CanonicalRecord {
  const name = (source.name ?? {}) as Record<string, unknown>;
  const emails = Array.isArray(source.emails) ? source.emails : [];
  const phones = Array.isArray(source.phones) ? source.phones : [];
  return { objectType: "customer", externalId: String(source.id ?? ""), data: { name: [name.first, name.last].filter(Boolean).join(" ") || (source.companyName ?? null), first_name: name.first ?? null, last_name: name.last ?? null, email: (emails[0] as Record<string, unknown> | undefined)?.address ?? null, phone: (phones[0] as Record<string, unknown> | undefined)?.number ?? null }, source };
}

function mapJobberJob(source: Record<string, unknown>): CanonicalRecord {
  return { objectType: "job", externalId: String(source.id ?? ""), data: { title: source.title ?? `Job ${source.jobNumber ?? ""}`.trim(), status: source.jobStatus ?? null, customer_id: (source.client as Record<string, unknown> | undefined)?.id ?? null }, source };
}

async function pull(credentials: JobberCredentials, objectType: CanonicalObjectType, cursor: Record<string, unknown> | null): Promise<ConnectorPage> {
  const after = typeof cursor?.after === "string" ? cursor.after : null;
  if (objectType === "customer") {
    const data = await graph(credentials, `query Clients($after: String) { clients(first: 100, after: $after) { nodes { id name { first last } companyName emails { address } phones { number } } pageInfo { hasNextPage endCursor } } }`, { after });
    const collection = (data.clients ?? {}) as { nodes?: Record<string, unknown>[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string } };
    return { records: (collection.nodes ?? []).map(mapJobberClient), nextCursor: collection.pageInfo?.hasNextPage && collection.pageInfo.endCursor ? { after: collection.pageInfo.endCursor } : null };
  }
  if (objectType === "job") {
    const data = await graph(credentials, `query Jobs($after: String) { jobs(first: 100, after: $after) { nodes { id jobNumber title jobStatus client { id } } pageInfo { hasNextPage endCursor } } }`, { after });
    const collection = (data.jobs ?? {}) as { nodes?: Record<string, unknown>[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string } };
    return { records: (collection.nodes ?? []).map(mapJobberJob), nextCursor: collection.pageInfo?.hasNextPage && collection.pageInfo.endCursor ? { after: collection.pageInfo.endCursor } : null };
  }
  throw new Error(`Jobber cannot pull ${objectType}.`);
}

async function push(credentials: JobberCredentials, input: ConnectorPushInput) {
  if (input.objectType !== "customer" || input.operation !== "create") throw new Error(`Jobber cannot ${input.operation} ${input.objectType}.`);
  const variables = connectorPushPayload(input.externalData, { clientProperties: { firstName: input.data.first_name ?? input.data.name, lastName: input.data.last_name ?? "", emails: input.data.email ? [{ address: input.data.email, primary: true }] : [], phones: input.data.phone ? [{ number: input.data.phone, primary: true }] : [] } });
  const data = await graph(credentials, `mutation CreateClient($input: ClientCreateInput!) { clientCreate(input: $input) { client { id } userErrors { message path } } }`, { input: variables });
  const result = (data.clientCreate ?? {}) as { client?: { id?: string }; userErrors?: { message?: string }[] };
  if (result.userErrors?.length) throw new Error(result.userErrors[0]?.message ?? "Jobber client creation failed.");
  return { externalObjectId: result.client?.id ?? "", source: result as unknown as Record<string, unknown> };
}

export const jobberAdapter: ConnectorAdapter<JobberCredentials> = {
  manifest: { key: "jobber", name: "Jobber", category: "field_service", description: "Clients and jobs for Jobber businesses.", authStrategy: "oauth2", capabilities: ["customer.read", "customer.create", "job.read"], verificationStatus: "contract_verified", requestable: false, docsUrl: "https://developer.getjobber.com/docs/" },
  async testConnection(context) { try { const data = await graph(context.credentials, "query Account { account { id name } }"); const account = (data.account ?? {}) as { id?: string; name?: string }; return { ok: true, detail: "Jobber connected. Clients and jobs are ready to sync.", externalAccountId: account.id, externalAccountName: account.name }; } catch (error) { return { ok: false, detail: error instanceof Error ? error.message : "Jobber verification failed." }; } },
  pullPage(context, objectType, cursor) { return pull(context.credentials, objectType, cursor); },
  pushRecord(context, input) { return push(context.credentials, input); },
};
