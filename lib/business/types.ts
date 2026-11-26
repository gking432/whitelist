export const BUSINESS_AREAS = [
  "home",
  "marketing",
  "sourcing",
  "purchasing",
  "operations",
  "customers",
  "automations",
  "business",
  "approvals",
] as const;
export type BusinessArea = (typeof BUSINESS_AREAS)[number];
export const RECORD_KINDS = [
  "campaign",
  "opportunity",
  "supplier",
  "product",
  "purchase",
  "job",
  "knowledge",
  "brief",
  "quote",
  "invoice",
  "goal",
] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];
export type RecordStatus =
  | "draft"
  | "needs_approval"
  | "approved"
  | "rejected"
  | "in_progress"
  | "blocked"
  | "completed"
  | "ordered"
  | "received"
  | "published"
  | "paid"
  | "archived";
export type RecordData = Record<string, string | number | boolean | null>;
export type BusinessRecord = {
  id: string;
  kind: RecordKind;
  title: string;
  body: string;
  status: RecordStatus;
  data: RecordData;
  revision: number;
  source_record_id: string | null;
  created_at: string;
  updated_at: string;
};
export type BusinessProfile = {
  description: string;
  industry: string;
  goals: string[];
  services: string;
  audience: string;
  tone: string;
  hours: string;
  policies: string;
  currency: string;
  website: string;
};
export const EMPTY_PROFILE: BusinessProfile = {
  description: "",
  industry: "general",
  goals: [],
  services: "",
  audience: "",
  tone: "Friendly and helpful",
  hours: "",
  policies: "",
  currency: "USD",
  website: "",
};
export type BusinessInstall = {
  recipe_key: string;
  status: "enabled" | "paused";
  schedule_enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
};
export type BusinessEvent = {
  id: string;
  record_id: string | null;
  action: string;
  summary: string;
  created_at: string;
};
export type BusinessContact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
};
export type BusinessConnection = {
  id: string;
  display_name: string;
  status: string;
  runtime_mode: string;
  provider: {
    provider_key: string;
    category: string;
    display_name: string;
  } | null;
};
export type BusinessSnapshot = {
  clientName: string;
  clientId: string;
  profile: BusinessProfile;
  /** Opaque combined raw-profile/knowledge CAS token. Null means unavailable. */
  profileRevision: string | null;
  workspaceScopeKey: string;
  records: BusinessRecord[];
  installs: BusinessInstall[];
  events: BusinessEvent[];
  contacts: BusinessContact[];
  connections: BusinessConnection[];
  pendingCustomerApprovals: number;
  aiConfigured: boolean;
  canWrite: boolean;
  isTestAccount: boolean;
  setupRequired: boolean;
  error: string | null;
};
export type MutationResult = {
  ok: boolean;
  message: string;
  recordId?: string;
  profileReceipt?: BusinessProfileSaveReceipt;
};
export type BusinessProfileSaveReceipt = { id: string; key: string; revision: string; replayed: boolean; cancelledWork: number };
export type BusinessProfileSaveCommand = { action: "save_profile"; requestKey: string; expectedRevision: string; profile: BusinessProfile };
/** No raw RPC diagnostic or undocumented field becomes a saved receipt. */
export function parseBusinessProfileSaveReceipt(value: unknown, expectedKey: string): BusinessProfileSaveReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>, uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (Object.keys(row).length !== 5 || !["id", "key", "revision", "replayed", "cancelledWork"].every(key => Object.hasOwn(row, key)) || typeof row.id !== "string" || !uuid.test(row.id) || row.key !== expectedKey || !uuid.test(expectedKey) || typeof row.revision !== "string" || row.revision.length < 1 || row.revision.length > 80 || typeof row.replayed !== "boolean" || !Number.isSafeInteger(row.cancelledWork) || Number(row.cancelledWork) < 0) return null;
  return { id: row.id, key: expectedKey, revision: row.revision, replayed: row.replayed, cancelledWork: Number(row.cancelledWork) };
}
