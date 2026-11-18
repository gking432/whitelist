export type ImportedRow = {
  id: string;
  connection_id: string;
  object_type: string;
  external_object_id: string;
  external_parent_id: string | null;
  canonical_data: Record<string, unknown>;
  external_updated_at: string | null;
  native_object_id: string | null;
  updated_at?: string | null;
  snapshot_observed_at?: string | null;
  created_at?: string | null;
  partner_id?: string;
  client_id?: string;
};
export { mapConnectedData, latestImportedRows, safeProviderLink } from "./record-mapper.ts";
