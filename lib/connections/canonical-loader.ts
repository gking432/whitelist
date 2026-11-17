import type { SupabaseClient } from "@supabase/supabase-js";
import { latestImportedRows, mapConnectedData, type ImportedRow } from "./records.ts";
import { OWNER_PROVIDERS, type ConnectedApp, type ConnectedStream } from "./types.ts";

export type OwnerConnectionRow = {
  id: string; partner_id: string; client_id: string; display_name: string;
  external_account_name?: string | null; status: string; runtime_mode: string;
  config?: Record<string, unknown> | null;
  provider: { provider_key: string; capabilities?: string[] } | { provider_key: string; capabilities?: string[] }[] | null;
};
export type OwnerStreamRow = {
  partner_id: string; client_id: string; connection_id: string; stream_key: string;
  cursor_value: Record<string, unknown> | null; last_completed_at: string | null;
  status: string; last_error: string | null;
};
export const OWNER_STREAMS: Record<string, readonly string[]> = {
  google_workspace: ["message", "appointment"], microsoft_365: ["message", "appointment"],
  stripe: ["invoice", "payment"], generic_inbound_webhook: ["lead"],
};
export const connectionProvider = (row: OwnerConnectionRow) => (Array.isArray(row.provider) ? row.provider[0] : row.provider)?.provider_key ?? "";
type Scope = { partnerId: string; clientId: string };
type QueryResult = { data: unknown; error: unknown };
type Batch = { objectType: string; rows: ImportedRow[]; hasMore: boolean; limit: number };
const list = <T>(value: unknown) => Array.isArray(value) ? value as T[] : [];
const validDate = (value: string | null | undefined) => !!value && Number.isFinite(Date.parse(value));
const paging = (cursor: Record<string, unknown> | null) => !!(cursor?.pageToken || cursor?.nextLink || cursor?.after || cursor?.starting_after || cursor?.has_more === true);

/** Internal server loader shared by owner views and manager context. Raw canonical rows never form an API response. */
export async function loadConnectedRecords(admin: SupabaseClient, scope: Scope, options: {
  connections?: OwnerConnectionRow[]; recordLimit?: number; nativeAppointmentIds?: string[]; clock?: () => Date;
} = {}) {
  const generatedAt = (options.clock?.() ?? new Date()).toISOString();
  const limit = Math.max(1, Math.min(options.recordLimit ?? 1000, 1000));
  const connectionResult: QueryResult = options.connections ? { data: options.connections, error: null } : await admin.from("integration_connections")
    .select("id,partner_id,client_id,display_name,external_account_name,status,runtime_mode,config,provider:integration_providers!inner(provider_key,capabilities)")
    .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).in("provider.provider_key", [...OWNER_PROVIDERS])
    .order("created_at").limit(101);
  const allConnections = list<OwnerConnectionRow>(connectionResult.data).filter((c) => (OWNER_PROVIDERS as readonly string[]).includes(connectionProvider(c)));
  for (const row of allConnections) if (row.partner_id !== scope.partnerId || row.client_id !== scope.clientId) throw new Error("Connected data does not belong to this workspace.");
  const connections = allConnections.slice(0, 100);
  const ids = connections.map((c) => c.id), visible = connections.filter((c) => ["connected", "needs_attention"].includes(c.status));
  const scoped = (table: string, columns: string) => admin.from(table).select(columns)
    .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).in("connection_id", ids);
  const empty: QueryResult = { data: [], error: null };
  const canonicalColumns = "id,partner_id,client_id,connection_id,object_type,external_object_id,external_parent_id,canonical_data,external_updated_at,native_object_id,updated_at,created_at";
  const sourceIds = (type: string) => visible.filter((c) => OWNER_STREAMS[connectionProvider(c)]?.includes(type)).map((c) => c.id);
  const read = (type: string) => admin.from("integration_canonical_records").select(canonicalColumns)
    .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).in("connection_id", sourceIds(type)).eq("object_type", type);
  const since = new Date(Date.parse(generatedAt) - 31 * 86400000).toISOString();
  const until = new Date(Date.parse(generatedAt) + 33 * 86400000).toISOString();
  const [statesResult, jobsResult, mail, calendar, leads, invoices, payments, linkedCalendar] = await Promise.all([
    ids.length ? scoped("integration_sync_states", "partner_id,client_id,connection_id,stream_key,cursor_value,last_completed_at,status,last_error").order("connection_id").order("stream_key").limit(1001) : Promise.resolve(empty),
    ids.length ? scoped("integration_sync_jobs", "connection_id,status,object_type").in("status", ["queued", "running", "failed", "dead_letter"]).eq("direction", "pull").in("object_type", ["message", "appointment", "lead", "invoice", "payment"]).limit(1001) : Promise.resolve(empty),
    sourceIds("message").length ? read("message").gte("external_updated_at", since).order("updated_at", { ascending: false }).limit(limit + 1) : Promise.resolve(empty),
    sourceIds("appointment").length ? read("appointment").gte("canonical_data->>start_at", since.slice(0, 10)).lt("canonical_data->>start_at", until.slice(0, 10)).order("canonical_data->>start_at").limit(limit + 1) : Promise.resolve(empty),
    sourceIds("lead").length ? read("lead").order("updated_at", { ascending: false }).limit(limit + 1) : Promise.resolve(empty),
    sourceIds("invoice").length ? read("invoice").order("updated_at", { ascending: false }).limit(limit + 1) : Promise.resolve(empty),
    sourceIds("payment").length ? read("payment").order("updated_at", { ascending: false }).limit(limit + 1) : Promise.resolve(empty),
    sourceIds("appointment").length && options.nativeAppointmentIds?.length ? read("appointment").in("native_object_id", options.nativeAppointmentIds.slice(0, 1000)).order("updated_at", { ascending: false }).limit(limit + 1) : Promise.resolve(empty),
  ]);
  const calendarRows = latestImportedRows([...list<ImportedRow>(linkedCalendar.data), ...list<ImportedRow>(calendar.data)]);
  const batches: Batch[] = [
    { objectType: "message", rows: list<ImportedRow>(mail.data), hasMore: list(mail.data).length > limit, limit },
    { objectType: "appointment", rows: calendarRows, hasMore: calendarRows.length > limit || list(calendar.data).length > limit || list(linkedCalendar.data).length > limit, limit },
    ...[["lead", leads], ["invoice", invoices], ["payment", payments]].map(([objectType, result]) => ({ objectType: objectType as string, rows: list<ImportedRow>((result as QueryResult).data), hasMore: list((result as QueryResult).data).length > limit, limit })),
  ].map((batch) => ({ ...batch, rows: latestImportedRows(batch.rows).slice(0, limit) }));
  const rows = batches.flatMap((batch) => batch.rows);
  for (const row of rows) if (row.partner_id !== scope.partnerId || row.client_id !== scope.clientId) throw new Error("Imported records do not belong to this workspace.");
  const states = list<OwnerStreamRow>(statesResult.data).slice(0, 1000), jobs = list<{ connection_id: string; status: string; object_type: string }>(jobsResult.data).slice(0, 1000);
  const apps: ConnectedApp[] = connections.map((c) => {
    const provider = connectionProvider(c), eventBased = provider === "generic_inbound_webhook";
    const streams: ConnectedStream[] = (OWNER_STREAMS[provider] ?? []).map((key) => {
      const state = states.find((s) => s.connection_id === c.id && s.stream_key === key), work = jobs.filter((j) => j.connection_id === c.id && j.object_type === key);
      const partial = eventBased || paging(state?.cursor_value ?? null) || !!batches.find((b) => b.objectType === key)?.hasMore;
      const status = c.runtime_mode === "paused" || state?.status === "paused" ? "paused"
        : c.status === "needs_attention" || state?.last_error || state?.status === "failing" || work.some((j) => ["failed", "dead_letter"].includes(j.status)) ? "error"
          : !validDate(state?.last_completed_at) ? "missing"
            : Date.parse(state!.last_completed_at!) > Date.parse(generatedAt) || (!eventBased && Date.parse(generatedAt) - Date.parse(state!.last_completed_at!) > 45 * 60000) || paging(state?.cursor_value ?? null) ? "stale" : "fresh";
      return { key, status, lastSyncedAt: state?.last_completed_at ?? null, partial,
        detail: eventBased ? "Only received form events are available; earlier submissions and undelivered events are not established."
          : status === "fresh" ? partial ? "Recently synced; only a bounded or paged sample is loaded." : "This stream completed recently within its supported import window."
            : status === "missing" ? "No complete import has been verified for this stream." : status === "paused" ? "Import is paused; saved records may be outdated." : status === "error" ? "This stream needs connection or import attention." : "Import is delayed or still processing pages." };
    });
    const times = streams.map((s) => s.lastSyncedAt).filter((s): s is string => validDate(s));
    const completed = times.length === streams.length && streams.length ? times.sort()[0] : null;
    return { id: c.id, name: c.display_name || provider, provider, account: c.external_account_name ?? null,
      status: c.status, paused: c.runtime_mode === "paused", readOnly: c.config?.workspace_view_only === true || ["stripe", "generic_inbound_webhook"].includes(provider),
      lastSyncedAt: completed, stale: streams.some((s) => ["stale", "missing", "error", "paused"].includes(s.status)),
      syncing: streams.some((s) => s.partial && !eventBased) || jobs.some((j) => j.connection_id === c.id && j.status === "running"),
      error: streams.some((s) => s.status === "error") ? "A connection stream needs attention. Refresh or reconnect the account." : null,
      streams, capabilities: (OWNER_STREAMS[provider] ?? []).map((key) => `${key}.read`) };
  });
  const data = mapConnectedData(apps, rows, generatedAt);
  data.limited = allConnections.length > 100 || list(statesResult.data).length > 1000 || list(jobsResult.data).length > 1000 || batches.some((b) => b.hasMore);
  data.errors = [connectionResult.error && "Connected apps could not be checked.", statesResult.error && "Sync status could not be checked.", jobsResult.error && "Import progress could not be checked.",
    ...[[mail, "Email"], [calendar, "Calendar"], [linkedCalendar, "Linked calendar"], [leads, "Intake"], [invoices, "Invoices"], [payments, "Payments"]].map(([result, label]) => (result as QueryResult).error && `${label} could not be loaded.`)].filter((v): v is string => !!v);
  return { data, apps, rows, states, batches, connections, generatedAt };
}

export async function readConnectedData(admin: SupabaseClient, scope: Scope, clock?: () => Date) {
  return (await loadConnectedRecords(admin, scope, { clock })).data;
}
