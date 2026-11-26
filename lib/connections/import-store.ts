import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalRecord } from "../integrations/connectors/types.ts";
import { validateCanonicalRecord } from "../integrations/connectors/contract.ts";
import { ConnectorHttpError } from "../integrations/connectors/errors.ts";

export type ImportScope = { partnerId: string; clientId: string; connectionId: string };
export type ImportVersion = { eventAt?: string; eventId?: string; observedAt?: string };
export type ImportRepository = { persist(scope: ImportScope, record: CanonicalRecord, version: ImportVersion): Promise<boolean> };
function validHubSpotImport(record: CanonicalRecord): boolean {
  return record.data.provider === "hubspot" && ["customer", "lead", "note"].includes(record.objectType) &&
    typeof record.data.portal_id === "string" && /^\d{1,100}$/.test(record.data.portal_id) && record.data.external_id === record.externalId &&
    typeof record.data.archived === "boolean" && record.data.archived === (record.deleted === true) &&
    typeof record.updatedAt === "string" && Number.isFinite(Date.parse(record.updatedAt));
}
export async function applyOwnerImport(repository: ImportRepository, scope: ImportScope, records: CanonicalRecord[], version: ImportVersion) {
  if (!scope.partnerId || !scope.clientId || !scope.connectionId || records.length > 100)
    throw new Error("A bounded, account-scoped import is required.");
  for (const record of records) {
    if (validateCanonicalRecord(record).length || (record.data.provider === "hubspot" ? !validHubSpotImport(record)
      : !["lead", "invoice", "payment", "message", "appointment"].includes(record.objectType)))
      throw new Error("The imported record does not satisfy the supported source contract.");
  }
  let saved = 0;
  for (const record of records) if (await repository.persist(scope, record, version)) saved++;
  return { saved, ignored: records.length - saved };
}
export async function persistOwnerImportRecord(admin: SupabaseClient, scope: ImportScope, record: CanonicalRecord, version: ImportVersion = {}) {
  if (record.data.provider === "hubspot" && !validHubSpotImport(record)) throw new Error("An exact verified HubSpot import is required.");
  const observedAt = version.observedAt ?? (typeof record.data.observed_at === "string" ? record.data.observed_at : new Date().toISOString());
  const { data, error } = await admin.rpc("persist_owner_import_record", {
    p_partner: scope.partnerId, p_client: scope.clientId, p_connection: scope.connectionId,
    p_type: record.objectType, p_external: record.externalId, p_parent: record.externalParentId ?? null,
    p_data: record.deleted ? record.data.provider === "hubspot" ? { ...record.data, deleted: true } : { deleted: true } : record.data,
    p_source: record.source, p_external_updated: record.updatedAt ?? null,
    p_observed: observedAt, p_event_at: version.eventAt ?? null, p_event_id: version.eventId ?? null,
  });
  if (error || typeof data !== "boolean") throw new Error("Imported records could not be committed. Retry the same source event.");
  if (!data && record.data.provider === "hubspot") {
    // A rejected equal-clock conflicting source version is distinct from an
    // obsolete event. Preserve SQL's failing coverage instead of letting the
    // executor commit the next cursor and clear its conflict evidence.
    const state = await admin.from("integration_sync_states").select("status,last_error")
      .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).eq("connection_id", scope.connectionId)
      .eq("stream_key", record.objectType).maybeSingle();
    if (state.error || state.data?.status === "failing" && state.data.last_error)
      throw new ConnectorHttpError("HubSpot source versions conflict or their coverage could not be verified. Review the exact source before continuing this stream.", 409);
  }
  return data;
}
