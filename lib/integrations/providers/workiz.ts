import { connectorHttpError } from "../connectors/errors.ts";
import type { CanonicalObjectType, CanonicalRecord, ConnectorAdapter, ConnectorPage, ConnectorPushInput } from "../connectors/types";
import { connectorPushPayload } from "../connectors/field-mappings.ts";

export type WorkizCredentials = { apiToken: string };

async function workizFetch(credentials: WorkizCredentials, path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.workiz.com/api/v1/${encodeURIComponent(credentials.apiToken)}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init.headers }, signal: init.signal ?? AbortSignal.timeout(15_000) });
  if (!response.ok) throw connectorHttpError("workiz", response);
  return response;
}

function workizRows(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  const data = (body ?? {}) as Record<string, unknown>;
  if (Array.isArray(data.data)) return data.data as Record<string, unknown>[];
  if (data.data && typeof data.data === "object") return Object.values(data.data as Record<string, unknown>).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  return [];
}

export function mapWorkizLead(source: Record<string, unknown>): CanonicalRecord {
  return { objectType: "lead", externalId: String(source.UUID ?? source.uuid ?? source.id ?? ""), updatedAt: typeof source.LastUpdated === "string" ? source.LastUpdated : null, data: { name: source.FirstName || source.LastName ? [source.FirstName, source.LastName].filter(Boolean).join(" ") : source.ClientName ?? null, first_name: source.FirstName ?? null, last_name: source.LastName ?? null, email: source.Email ?? null, phone: source.Phone ?? source.MobilePhone ?? null, status: typeof source.Status === "string" && source.Status.toLowerCase() === "new" ? "new" : source.Status ?? null, description: source.JobNotes ?? source.Notes ?? null }, source };
}

function mapWorkizJob(source: Record<string, unknown>): CanonicalRecord {
  return { objectType: "job", externalId: String(source.UUID ?? source.uuid ?? source.id ?? ""), updatedAt: typeof source.LastUpdated === "string" ? source.LastUpdated : null, data: { title: source.JobType ?? source.JobName ?? "Job", status: source.Status ?? null, start_at: source.StartDateTime ?? source.JobDateTime ?? null, end_at: source.EndDateTime ?? null, name: [source.FirstName, source.LastName].filter(Boolean).join(" ") || null, email: source.Email ?? null, phone: source.Phone ?? null }, source };
}

async function pull(credentials: WorkizCredentials, objectType: CanonicalObjectType): Promise<ConnectorPage> {
  const path = objectType === "lead" ? "/lead/all/" : objectType === "job" ? "/job/all/" : null;
  if (!path) throw new Error(`Workiz cannot pull ${objectType}.`);
  const rows = workizRows(await (await workizFetch(credentials, path)).json());
  return { records: rows.map(objectType === "lead" ? mapWorkizLead : mapWorkizJob), nextCursor: null };
}

async function push(credentials: WorkizCredentials, input: ConnectorPushInput) {
  if (input.objectType !== "lead" || input.operation !== "create") throw new Error(`Workiz cannot ${input.operation} ${input.objectType}.`);
  const body = connectorPushPayload(input.externalData, { FirstName: input.data.first_name ?? input.data.name, LastName: input.data.last_name ?? "", Phone: input.data.phone ?? "", Email: input.data.email ?? "", JobNotes: input.data.description ?? "" });
  const response = await workizFetch(credentials, "/lead/create/", { method: "POST", body: JSON.stringify(body) });
  const created = await response.json() as Record<string, unknown>;
  const data = (created.data ?? created) as Record<string, unknown>;
  return { externalObjectId: String(data.UUID ?? data.uuid ?? data.id ?? ""), source: created };
}

export const workizAdapter: ConnectorAdapter<WorkizCredentials> = {
  manifest: { key: "workiz", name: "Workiz", category: "field_service", description: "Leads and jobs for Workiz businesses.", authStrategy: "api_key", capabilities: ["lead.read", "lead.create", "job.read"], verificationStatus: "contract_verified", requestable: false, docsUrl: "https://developer.workiz.com/" },
  async testConnection(context) { try { await workizFetch(context.credentials, "/team/all/"); return { ok: true, detail: "Workiz connected. Leads and jobs are ready to sync." }; } catch (error) { return { ok: false, detail: error instanceof Error ? error.message : "Workiz verification failed." }; } },
  pullPage(context, objectType) { return pull(context.credentials, objectType); },
  pushRecord(context, input) { return push(context.credentials, input); },
};
