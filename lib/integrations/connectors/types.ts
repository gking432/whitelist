export const CANONICAL_OBJECT_TYPES = [
  "customer",
  "lead",
  "job",
  "appointment",
  "note",
  "message",
  "invoice",
  "payment",
  "campaign",
  "review",
] as const;

export type CanonicalObjectType = (typeof CANONICAL_OBJECT_TYPES)[number];

export const CONNECTOR_OPERATIONS = [
  "read",
  "search",
  "create",
  "update",
  "delete",
  "webhook",
] as const;

export type ConnectorOperation = (typeof CONNECTOR_OPERATIONS)[number];
export type ConnectorCapability =
  `${CanonicalObjectType}.${ConnectorOperation}`;

export const CONNECTOR_AUTH_STRATEGIES = [
  "none",
  "api_key",
  "oauth2",
  "basic",
  "managed",
  "webhook",
] as const;

export type ConnectorAuthStrategy =
  (typeof CONNECTOR_AUTH_STRATEGIES)[number];

export const CONNECTOR_VERIFICATION_STATUSES = [
  "unavailable",
  "planned",
  "contract_verified",
  "live_verified",
  "restricted",
] as const;

export type ConnectorVerificationStatus =
  (typeof CONNECTOR_VERIFICATION_STATUSES)[number];

export type ConnectorManifest = {
  key: string;
  name: string;
  category: string;
  description: string;
  authStrategy: ConnectorAuthStrategy;
  capabilities: readonly ConnectorCapability[];
  verificationStatus: ConnectorVerificationStatus;
  requestable: boolean;
  docsUrl?: string;
  webhookEvents?: readonly string[];
};

export type CanonicalRecord = {
  objectType: CanonicalObjectType;
  externalId: string;
  externalParentId?: string | null;
  updatedAt?: string | null;
  data: Record<string, unknown>;
  source: Record<string, unknown>;
};

export type ConnectorPage = {
  records: CanonicalRecord[];
  nextCursor: Record<string, unknown> | null;
};

export type ConnectorContext<TCredentials = unknown> = {
  connectionId: string;
  partnerId: string;
  clientId: string;
  credentials: TCredentials;
  config: Record<string, unknown>;
  signal?: AbortSignal;
};

export type ConnectorTestResult = {
  ok: boolean;
  detail: string;
  externalAccountId?: string;
  externalAccountName?: string;
};

export type ConnectorPushInput = {
  operation: "create" | "update" | "delete";
  objectType: CanonicalObjectType;
  nativeObjectId: string;
  externalObjectId?: string | null;
  data: Record<string, unknown>;
  idempotencyKey: string;
};

export type ConnectorPushResult = {
  externalObjectId: string;
  externalParentId?: string | null;
  updatedAt?: string | null;
  source?: Record<string, unknown>;
};

export type WebhookRegistration = {
  eventType: string;
  endpointUrl: string;
  externalRegistrationId?: string | null;
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type ConnectorAdapter<TCredentials = unknown> = {
  manifest: ConnectorManifest;
  testConnection(
    context: ConnectorContext<TCredentials>,
  ): Promise<ConnectorTestResult>;
  pullPage?(
    context: ConnectorContext<TCredentials>,
    objectType: CanonicalObjectType,
    cursor: Record<string, unknown> | null,
  ): Promise<ConnectorPage>;
  pushRecord?(
    context: ConnectorContext<TCredentials>,
    input: ConnectorPushInput,
  ): Promise<ConnectorPushResult>;
  registerWebhooks?(
    context: ConnectorContext<TCredentials>,
    endpointBaseUrl: string,
  ): Promise<WebhookRegistration[]>;
  removeWebhook?(
    context: ConnectorContext<TCredentials>,
    registration: WebhookRegistration,
  ): Promise<void>;
};

export type ConnectorContractIssue = {
  field: string;
  message: string;
};
