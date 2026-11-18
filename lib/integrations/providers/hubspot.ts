// Server-side HubSpot reads. The generic adapter has no write capabilities.
import { createHash } from "node:crypto";
import { phoneSearchVariants } from "../../phone/normalize.ts";
import type { CanonicalObjectType, CanonicalRecord, ConnectorAdapter, ConnectorContext, ConnectorPage } from "../connectors/types.ts";
import type { HubSpotOAuthCredentials } from "./hubspot-oauth.ts";
import { ConnectorHttpError } from "../connectors/errors.ts";

export const HUBSPOT_BASE = "https://api.hubapi.com";
/** Existing callers retain the legacy credential type; it authorizes reads only. */
export type HubSpotCredentials = { privateAppToken: string; accountId?: string };
export type HubSpotProviderCredentials = HubSpotCredentials | HubSpotOAuthCredentials;
export type HubSpotContactFields = { email: string | null; phone: string | null; firstname: string | null; lastname: string | null; address: string | null };
export type HubSpotContactMatch = HubSpotContactFields & { id: string };
export type HubSpotReadSession = { accessToken: string; accountId: string; scopes: string[]; authType: "oauth" | "legacy_private" };
export type HubSpotReadOptions = { fetch?: typeof fetch; now?: () => string; expectedAccountId?: string };
export type HubSpotObject = "customer" | "lead" | "note";
type Row = Record<string, unknown>;
const object = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const clock = (v: unknown): v is string => typeof v === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
export const hubSpotId = (v: unknown): v is string => typeof v === "string" && /^\d{1,100}$/.test(v);
const identity = (v: unknown): string | null => hubSpotId(v) ? v : typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : null;
const text = (v: unknown): string | null => typeof v === "string" ? v : null;
const PROPERTIES = {
  customer: ["firstname", "lastname", "email", "phone", "address", "lifecyclestage", "lastmodifieddate", "hs_object_id"],
  lead: ["dealname", "amount", "dealstage", "pipeline", "closedate", "deal_currency_code", "hs_lastmodifieddate", "hs_object_id"],
  note: ["hs_note_body", "hs_timestamp", "hs_lastmodifieddate", "hs_object_id"],
} as const;
const PATH = { customer: "contacts", lead: "deals", note: "notes" } as const;
export class HubSpotError extends ConnectorHttpError {
  constructor(message: string, status: number) { super(message, status); this.name = "HubSpotError"; }
}
/** Never include a response body or token in diagnostics, follow redirects, or retry a write. */
export async function hubSpotRequest(session: Pick<HubSpotReadSession, "accessToken">, path: string, options: HubSpotReadOptions = {}, init: RequestInit = {}): Promise<Response> {
  if (!path.startsWith("/") || path.startsWith("//") || /[\r\n]/.test(path)) throw new HubSpotError("Invalid HubSpot resource path.", 400);
  return (options.fetch ?? fetch)(`${HUBSPOT_BASE}${path}`, { ...init, cache: "no-store", redirect: "error", signal: init.signal ?? AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json", ...init.headers } });
}
export async function hubSpotJson(response: Response): Promise<Row> {
  if (!response.ok) throw new HubSpotError(`HubSpot rejected the read request (${response.status}).`, response.status);
  const raw = await response.text();
  if (raw.length > 2_000_000) throw new HubSpotError("HubSpot returned an unbounded read response.", 502);
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new HubSpotError("HubSpot returned an incomplete object.", 502);
  return parsed as Row;
}
export async function verifyHubSpotReadSession(credentials: HubSpotProviderCredentials, options: HubSpotReadOptions = {}): Promise<HubSpotReadSession> {
  if ("authType" in credentials && credentials.authType === "oauth") {
    const { verifyHubSpotToken } = await import("./hubspot-oauth.ts");
    return verifyHubSpotToken(credentials, options);
  }
  if (!("privateAppToken" in credentials) || !credentials.privateAppToken) throw new HubSpotError("HubSpot read authorization is unavailable.", 401);
  const result = await hubSpotJson(await hubSpotRequest({ accessToken: credentials.privateAppToken }, "/oauth/v2/private-apps/get/access-token-info", options,
    { method: "POST", body: JSON.stringify({ tokenKey: credentials.privateAppToken }) }));
  const accountId = identity(result.hubId);
  if (!accountId || !Array.isArray(result.scopes) || result.scopes.some((v) => typeof v !== "string") ||
      (options.expectedAccountId && accountId !== options.expectedAccountId) || (credentials.accountId && credentials.accountId !== accountId))
    throw new HubSpotError("HubSpot token account or actual read permissions could not be verified.", 403);
  return { accessToken: credentials.privateAppToken, accountId, scopes: result.scopes as string[], authType: "legacy_private" };
}
export function hubSpotObjectPath(kind: HubSpotObject, id?: string): string {
  if (id !== undefined && !hubSpotId(id)) throw new HubSpotError("An exact HubSpot record ID is required.", 400);
  const params = new URLSearchParams({ properties: PROPERTIES[kind].join(",") });
  if (kind !== "customer") params.set("associations", "contacts");
  return `/crm/v3/objects/${PATH[kind]}${id === undefined ? "" : `/${encodeURIComponent(id)}`}?${params}`;
}
function selectedProperties(kind: HubSpotObject, source: Row): Record<string, string | null> {
  const raw = object(source.properties), result: Record<string, string | null> = {};
  for (const key of PROPERTIES[kind]) {
    const value = raw[key];
    if (value !== undefined && value !== null && (typeof value !== "string" || value.length > 20000)) throw new HubSpotError("A HubSpot property requires bounded source review.", 502);
    result[key] = text(value);
  }
  return result;
}
export function normalizeHubSpotRecord(kind: HubSpotObject, source: Row, accountId: string, observedAt: string): CanonicalRecord {
  if (!hubSpotId(accountId) || !hubSpotId(source.id) || typeof source.archived !== "boolean" || !clock(source.updatedAt) || !clock(observedAt))
    throw new HubSpotError("HubSpot omitted the exact account, record, archive state or source clock.", 502);
  const properties = selectedProperties(kind, source);
  if (properties.hs_object_id !== null && properties.hs_object_id !== source.id) throw new HubSpotError("HubSpot returned a merged or changed record identity.", 409);
  const archivedAt = clock(source.archivedAt) ? source.archivedAt : null;
  if (source.archived && !archivedAt) throw new HubSpotError("Archived HubSpot evidence has no archive clock.", 502);
  const updatedAt = archivedAt && Date.parse(archivedAt) > Date.parse(source.updatedAt) ? archivedAt : source.updatedAt;
  if (Date.parse(updatedAt) > Date.parse(observedAt) + 60_000) throw new HubSpotError("The HubSpot source clock is future-dated. Verify the account before importing it.", 502);
  const associations = object(object(source.associations).contacts);
  const entries = Array.isArray(associations.results) ? associations.results : [];
  const ids = entries.map((entry) => object(entry).id);
  if (entries.length > 1000 || ids.some((id) => !hubSpotId(id))) throw new HubSpotError("HubSpot association coverage is incomplete.", 502);
  const associated = kind === "customer" ? [] : [...new Set(ids as string[])].sort();
  const partial = kind !== "customer" && (!Array.isArray(associations.results) || !!object(associations.paging).next);
  const data: Row = { provider: "hubspot", portal_id: accountId, external_id: source.id, record_kind: PATH[kind], archived: source.archived,
    source_updated_at: updatedAt, archived_at: archivedAt, observed_at: observedAt, properties,
    associated_contact_ids: associated, associations_partial: partial };
  if (kind === "customer") Object.assign(data, { first_name: properties.firstname, last_name: properties.lastname, email: properties.email,
    phone: properties.phone, address: properties.address, lifecycle_stage: properties.lifecyclestage });
  else if (kind === "lead") Object.assign(data, { name: properties.dealname, title: properties.dealname, status: properties.dealstage,
    pipeline: properties.pipeline, amount: properties.amount, currency: properties.deal_currency_code, closed_at: properties.closedate });
  else Object.assign(data, { body: properties.hs_note_body, occurred_at: properties.hs_timestamp });
  return { objectType: kind, externalId: source.id, updatedAt, deleted: source.archived, data, source: { ...data } };
}
/** Observation refreshes do not change a source decision; actual provider facts do. */
export function hubSpotSourceFingerprint(record: Pick<CanonicalRecord, "objectType" | "externalId" | "updatedAt" | "deleted" | "data">): string {
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => [k, stable(value)])) : v;
  const keys = ["provider", "portal_id", "external_id", "record_kind", "archived", "source_updated_at", "archived_at", "properties", "associated_contact_ids", "associations_partial",
    "first_name", "last_name", "email", "phone", "address", "lifecycle_stage", "name", "title", "status", "pipeline", "amount", "currency", "closed_at", "body", "occurred_at"];
  const data = Object.fromEntries(keys.filter((key) => record.data[key] !== undefined).map((key) => [key, record.data[key]]));
  return createHash("sha256").update(JSON.stringify(stable({ objectType: record.objectType, externalId: record.externalId,
    updatedAt: clock(record.updatedAt) ? new Date(record.updatedAt).toISOString() : null, deleted: record.deleted === true, data }))).digest("hex");
}
export async function readHubSpotObject(session: HubSpotReadSession, kind: HubSpotObject, id: string, options: HubSpotReadOptions = {}): Promise<CanonicalRecord> {
  const row = await hubSpotJson(await hubSpotRequest(session, hubSpotObjectPath(kind, id), options));
  if (row.id !== id) throw new HubSpotError("HubSpot returned a different or merged record. Review its exact identity.", 409);
  return normalizeHubSpotRecord(kind, row, session.accountId, options.now?.() ?? new Date().toISOString());
}
export async function pullHubSpotPage(context: ConnectorContext<HubSpotProviderCredentials>, objectType: CanonicalObjectType, cursor: Record<string, unknown> | null, options: HubSpotReadOptions = {}): Promise<ConnectorPage> {
  if (!["customer", "lead", "note"].includes(objectType)) throw new HubSpotError("This HubSpot stream is unsupported.", 400);
  if (context.config.hubspot_owner_crm !== true || context.config.workspace_view_only !== true)
    throw new HubSpotError("Reconnect HubSpot through the owner flow before importing authoritative customer records.", 403);
  const kind = objectType as HubSpotObject;
  const expected = text(context.config.hubspot_account_id) ?? text(context.config.external_account_id) ?? ("accountId" in context.credentials ? context.credentials.accountId : undefined);
  if (!expected || !hubSpotId(expected)) throw new HubSpotError("Verify the exact HubSpot portal before importing records.", 403);
  const session = await verifyHubSpotReadSession(context.credentials, { ...options, expectedAccountId: expected });
  const required = kind === "lead" ? "crm.objects.deals.read" : "crm.objects.contacts.read";
  if (!session.scopes.includes(required)) throw new HubSpotError("This HubSpot stream has no verified read permission.", 403);
  if (cursor && (cursor.version !== 1 || !["active", "archived"].includes(String(cursor.phase)) ||
    (cursor.after !== undefined && (typeof cursor.after !== "string" || !cursor.after || cursor.after.length > 2000)) || Object.keys(cursor).some((key) => !["version", "phase", "after"].includes(key)))) throw new HubSpotError("Invalid HubSpot import cursor.", 400);
  const phase = cursor?.phase === "archived" ? "archived" : "active";
  const url = new URL(hubSpotObjectPath(kind), HUBSPOT_BASE); url.searchParams.set("limit", "100"); url.searchParams.set("archived", String(phase === "archived"));
  if (typeof cursor?.after === "string") url.searchParams.set("after", cursor.after);
  const page = await hubSpotJson(await hubSpotRequest(session, `${url.pathname}${url.search}`, options));
  if (!Array.isArray(page.results) || page.results.length > 100) throw new HubSpotError("HubSpot returned incomplete page coverage.", 502);
  const now = options.now?.() ?? new Date().toISOString();
  const records = page.results.map((row) => normalizeHubSpotRecord(kind, object(row), session.accountId, now));
  if (records.some((record) => record.deleted !== (phase === "archived"))) throw new HubSpotError("HubSpot returned conflicting archive phase evidence.", 502);
  if (page.paging !== undefined && (!page.paging || typeof page.paging !== "object" || Array.isArray(page.paging))) throw new HubSpotError("HubSpot returned invalid pagination; coverage remains incomplete.", 502);
  const nextValue = object(page.paging).next;
  if (nextValue !== undefined && nextValue !== null && (!nextValue || typeof nextValue !== "object" || Array.isArray(nextValue))) throw new HubSpotError("HubSpot returned invalid pagination; coverage remains incomplete.", 502);
  const next = object(nextValue);
  if (nextValue !== undefined && nextValue !== null) {
    if (typeof next.after !== "string" || !next.after || next.after.length > 2000 || next.after === cursor?.after) throw new HubSpotError("HubSpot returned invalid pagination; coverage remains incomplete.", 502);
    return { records, nextCursor: { version: 1, phase, after: next.after }, continueImmediately: true };
  }
  return { records, nextCursor: phase === "active" ? { version: 1, phase: "archived" } : null, continueImmediately: phase === "active" };
}
export async function testHubSpotConnection(credentials: HubSpotProviderCredentials, options: HubSpotReadOptions = {}) {
  try {
    const session = await verifyHubSpotReadSession(credentials, options);
    if (!session.scopes.includes("crm.objects.contacts.read")) throw new HubSpotError("Contact read permission is unavailable.", 403);
    await hubSpotJson(await hubSpotRequest(session, "/crm/v3/objects/contacts?limit=1", options));
    return { ok: true, detail: "HubSpot portal and contact read access verified. Create, update and note permissions are not established by this read check.", externalAccountId: session.accountId, externalAccountName: `HubSpot ${session.accountId}` };
  } catch { return { ok: false, detail: "HubSpot portal or contact read access could not be verified. Existing write authority was not changed." }; }
}
export const hubspotAdapter: ConnectorAdapter<HubSpotProviderCredentials> = {
  manifest: { key: "hubspot", name: "HubSpot", category: "crm", description: "Read exact HubSpot contacts, deals and notes with explicit archive coverage; customer records remain authoritative in HubSpot.", authStrategy: "oauth2",
    capabilities: ["customer.read", "lead.read", "note.read"], verificationStatus: "contract_verified", requestable: false, docsUrl: "https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/contacts/guide" },
  testConnection: (context) => testHubSpotConnection(context.credentials), pullPage: (context, type, cursor) => pullHubSpotPage(context, type, cursor),
};
/** Legacy read lookup is not authorization to merge or update an identity. */
export async function findHubSpotContact(token: string, fields: HubSpotContactFields): Promise<HubSpotContactMatch | null> {
  const searchBy = fields.email ? [{ property: "email", value: fields.email }] : fields.phone ? phoneSearchVariants(fields.phone).map((value) => ({ property: "phone", value })) : [];
  if (!searchBy.length) return null;
  const session = await verifyHubSpotReadSession({ privateAppToken: token });
  const result = await hubSpotJson(await hubSpotRequest(session, "/crm/v3/objects/contacts/search", {}, { method: "POST", body: JSON.stringify({
    filterGroups: searchBy.map((filter) => ({ filters: [{ propertyName: filter.property, operator: "EQ", value: filter.value }] })), properties: ["firstname", "lastname", "email", "phone", "address"], limit: 2 }) }));
  if (!Array.isArray(result.results) || result.results.length > 1 || object(result.paging).next) throw new HubSpotError("Multiple HubSpot records require an explicit identity review.", 409);
  const row = object(result.results[0]), props = object(row.properties);
  if (!hubSpotId(row.id)) return null;
  return { id: row.id, firstname: text(props.firstname), lastname: text(props.lastname), email: text(props.email), phone: text(props.phone), address: text(props.address) };
}
export type HubSpotSyncOutcome = { contactId: string; contactAction: "created" | "updated"; noteId: string | null };
export async function syncContactWithNote(_credentials: HubSpotCredentials, _fields: HubSpotContactFields, _noteBody: string, _beforeWrite?: () => Promise<void>): Promise<HubSpotSyncOutcome> {
  throw new HubSpotError("HubSpot writes require an explicit reviewed provider gateway decision. Email or phone lookup cannot authorize customer creation, updates or notes.", 409);
}
export function buildContactPayloadPreview(fields: HubSpotContactFields, noteBody: string): Record<string, unknown> {
  return { contact: { properties: Object.fromEntries(Object.entries(fields).filter(([, value]) => !!value)) }, note: { hs_note_body: noteBody } };
}
