export const OWNER_PROVIDERS = ["google_workspace", "microsoft_365", "stripe", "generic_inbound_webhook"] as const;
export type OwnerProvider = (typeof OWNER_PROVIDERS)[number];
export type ConnectionProviderOption = {
  key: OwnerProvider;
  label: string;
  category: "mail_calendar" | "money" | "intake";
  setup: "oauth" | "operator" | "token";
  available: boolean;
  detail: string;
  capabilities: string[];
};
export type ConnectedStream = {
  key: string;
  status: "fresh" | "stale" | "missing" | "error" | "paused";
  lastSyncedAt: string | null;
  partial: boolean;
  detail: string;
};
export type ConnectedApp = {
  id: string;
  name: string;
  account: string | null;
  provider: string;
  status: string;
  paused: boolean;
  stale?: boolean;
  readOnly: boolean;
  sourceAccountId?: string | null;
  writePermissions?: { calendarWrite: boolean; emailSend: boolean };
  lastSyncedAt: string | null;
  syncing: boolean;
  error: string | null;
  streams?: ConnectedStream[];
  capabilities?: string[];
};
export type SyncedMessage = {
  id: string;
  connectionId: string;
  threadId: string;
  subject: string;
  from: string;
  preview: string;
  receivedAt: string | null;
  unread: boolean;
  inbox: boolean;
  account: string;
  href: string | null;
  messageCount: number;
  provider?: string;
  direction?: "inbound" | "outbound" | "unknown";
};
export type SyncedAppointment = {
  id: string;
  nativeId: string | null;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  account: string;
  href: string | null;
  connectionId?: string;
  provider?: string;
  status?: string;
};
export type SyncedLead = {
  id: string; connectionId: string; externalId: string; nativeId: string | null;
  account: string; provider: string; title: string; status: string;
  receivedAt: string | null; href: string | null; preview?: string;
};
export type SyncedInvoice = {
  id: string; connectionId: string; externalId: string; account: string; provider: string; accountId?: string | null;
  number: string | null; status: string; currency: string | null;
  totalMinor: number | null; amountDueMinor: number | null; amountPaidMinor: number | null;
  dueAt: string | null; updatedAt: string | null; href: string | null;
};
export type SyncedPayment = {
  id: string; connectionId: string; externalId: string; account: string; provider: string; accountId?: string | null;
  status: string; currency: string | null; amountMinor: number | null;
  amountRefundedMinor: number | null; updatedAt: string | null; href: string | null;
};
export type ConnectedData = {
  apps: ConnectedApp[];
  messages: SyncedMessage[];
  appointments: SyncedAppointment[];
  limited: boolean;
  errors: string[];
  generatedAt: string;
  leads?: SyncedLead[];
  invoices?: SyncedInvoice[];
  payments?: SyncedPayment[];
};
export type ConnectionsSnapshot = ConnectedData & {
  googleAvailable: boolean;
  canWrite: boolean;
  providers?: ConnectionProviderOption[];
};
