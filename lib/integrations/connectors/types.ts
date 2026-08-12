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
  deleted?: boolean;
  externalParentId?: string | null;
  updatedAt?: string | null;
  data: Record<string, unknown>;
  source: Record<string, unknown>;
};

export const CONNECTOR_MAPPING_DIRECTIONS = ["pull", "push", "both"] as const;
export type ConnectorMappingDirection =
  (typeof CONNECTOR_MAPPING_DIRECTIONS)[number];

export const CONNECTOR_MAPPING_TRANSFORMS = [
  "trim",
  "lowercase",
  "uppercase",
  "phone_digits",
  "number",
  "boolean",
  "iso_datetime",
] as const;
export type ConnectorMappingTransform =
  (typeof CONNECTOR_MAPPING_TRANSFORMS)[number];

export type ConnectorFieldMapping = {
  id?: string;
  objectType: CanonicalObjectType;
  direction: ConnectorMappingDirection;
  nativeField: string;
  externalField: string;
  transformKey?: ConnectorMappingTransform | null;
  defaultValue?: unknown;
  isRequired: boolean;
  isActive: boolean;
};

export type ConnectorPage = {
  records: CanonicalRecord[];
  nextCursor: Record<string, unknown> | null;
  /**
   * True when nextCursor points to another page in the current sync round.
   * False when it is a durable checkpoint for the next polling round.
   * Omit for legacy adapters, where a non-null cursor means another page.
   */
  continueImmediately?: boolean;
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
  externalData?: Record<string, unknown>;
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
  secret?: string;
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
