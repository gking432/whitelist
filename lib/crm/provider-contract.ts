/** Provider-backed CRM records are read models, never independent writable customers. */
export const HUBSPOT_ACTIONS = ["contact.create", "note.create"] as const;
export type HubSpotOwnerPermission = typeof HUBSPOT_ACTIONS[number];
export type ConnectedCustomer = {
  id: string; connectionId: string; externalId: string; accountId: string; account: string;
  name: string; email: string | null; phone: string | null; lifecycleStage: string | null;
  archived: boolean; sourceUpdatedAt: string | null; observedAt: string | null; revision: string; href: string | null;
};
export type ConnectedCrmDeal = {
  id: string; connectionId: string; externalId: string; accountId: string; account: string;
  name: string; stage: string | null; pipeline: string | null; amount: string | null; currency: string | null;
  contactIds: string[]; associationsPartial: boolean; archived: boolean; sourceUpdatedAt: string | null; observedAt: string | null; href: string | null;
};
export type CrmGatewayPin = {
  crm_gateway_version: 1; provider: "hubspot"; operation: HubSpotOwnerPermission;
  owner_command_id: string; connection_id: string; account_id: string; grant_revision: string;
  authority_revision: number; source_record_id: string | null; source_updated_at: string | null;
  source_external_updated_at: string | null; external_id: string | null; source_fingerprint: string | null;
  properties: { firstname?: string; lastname?: string; email?: string; phone?: string; address?: string };
  note_body: string | null; new_identity_confirmed: boolean; source_run_id: string | null;
};
export type CrmGatewayReceipt = {
  version: 1; provider: "hubspot"; operation: HubSpotOwnerPermission; account_id: string;
  object_id: string; http_status: number; verified_at: string; source_updated_at: string | null;
  associated_contact_id: string | null; request_id: string | null;
};
export type CrmGatewayCommand = {
  action: "prepare_hubspot_change"; key: string; connectionId: string; expectedRevision: string;
  operation: HubSpotOwnerPermission; recordId?: string; expectedSourceRevision?: string;
  properties?: CrmGatewayPin["properties"]; note?: string; targetConfirmed: true; newIdentityConfirmed?: true;
  sourceRunId?: string;
};
export type CrmGatewayReview = {
  version: 1; connectionId: string; accountId: string; account: string; revision: string;
  canWrite: boolean; selectedCrm: boolean; actionsEnabled: boolean; permissions: HubSpotOwnerPermission[];
  contact: ConnectedCustomer | null; blockReason: string | null;
  existing: { approvalId: string; status: string; detail: string } | null;
  sourceRun?: { id: string; summary: string | null; eventType: string | null; templateKey: string | null; createdAt: string | null };
};
export type CrmGatewayDecisionReceipt = { id: string; approvalId: string; connectionId: string; message: string; replayed: boolean };
