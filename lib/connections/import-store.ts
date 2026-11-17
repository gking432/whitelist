import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalRecord } from "../integrations/connectors/types.ts";
import { validateCanonicalRecord } from "../integrations/connectors/contract.ts";

export type ImportScope = { partnerId: string; clientId: string; connectionId: string };
export type ImportVersion = { eventAt?: string; eventId?: string; observedAt?: string };
export type ImportRepository = { persist(scope: ImportScope, record: CanonicalRecord, version: ImportVersion): Promise<boolean> };
export async function applyOwnerImport(repository: ImportRepository, scope: ImportScope, records: CanonicalRecord[], version: ImportVersion) {
  if (!scope.partnerId || !scope.clientId || !scope.connectionId || records.length > 100)
    throw new Error("A bounded, account-scoped import is required.");
  for (const record of records) {
    if (validateCanonicalRecord(record).length || !["lead", "invoice", "payment", "message", "appointment"].includes(record.objectType))
      throw new Error("The imported record does not satisfy the supported source contract.");
  }
  let saved = 0;
  for (const record of records) if (await repository.persist(scope, record, version)) saved++;
  return { saved, ignored: records.length - saved };
}
export async function persistOwnerImportRecord(admin: SupabaseClient, scope: ImportScope, record: CanonicalRecord, version: ImportVersion = {}) {
  const observedAt = version.observedAt ?? (typeof record.data.observed_at === "string" ? record.data.observed_at : new Date().toISOString());
  const { data, error } = await admin.rpc("persist_owner_import_record", {
    p_partner: scope.partnerId, p_client: scope.clientId, p_connection: scope.connectionId,
    p_type: record.objectType, p_external: record.externalId, p_parent: record.externalParentId ?? null,
    p_data: record.deleted ? { deleted: true } : record.data,
    p_source: record.source, p_external_updated: record.updatedAt ?? null,
    p_observed: observedAt, p_event_at: version.eventAt ?? null, p_event_id: version.eventId ?? null,
  });
  if (error || typeof data !== "boolean") throw new Error("Imported records could not be committed. Retry the same source event.");
  return data;
}
