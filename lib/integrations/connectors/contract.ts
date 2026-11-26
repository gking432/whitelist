import {
  CANONICAL_OBJECT_TYPES,
  CONNECTOR_AUTH_STRATEGIES,
  CONNECTOR_OPERATIONS,
  CONNECTOR_VERIFICATION_STATUSES,
  type CanonicalRecord,
  type ConnectorAdapter,
  type ConnectorCapability,
  type ConnectorContractIssue,
  type ConnectorManifest,
} from "./types.ts";

const KEY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export function isConnectorCapability(
  value: string,
): value is ConnectorCapability {
  const [objectType, operation, extra] = value.split(".");

  return (
    !extra &&
    CANONICAL_OBJECT_TYPES.includes(
      objectType as (typeof CANONICAL_OBJECT_TYPES)[number],
    ) &&
    CONNECTOR_OPERATIONS.includes(
      operation as (typeof CONNECTOR_OPERATIONS)[number],
    )
  );
}

export function validateConnectorManifest(
  manifest: ConnectorManifest,
): ConnectorContractIssue[] {
  const issues: ConnectorContractIssue[] = [];

  if (!KEY_PATTERN.test(manifest.key)) {
    issues.push({
      field: "key",
      message: "Use a stable lowercase connector key with underscores.",
    });
  }
  if (!manifest.name.trim()) {
    issues.push({ field: "name", message: "Connector name is required." });
  }
  if (!manifest.category.trim()) {
    issues.push({ field: "category", message: "Category is required." });
  }
  if (!manifest.description.trim()) {
    issues.push({ field: "description", message: "Description is required." });
  }
  if (!CONNECTOR_AUTH_STRATEGIES.includes(manifest.authStrategy)) {
    issues.push({ field: "authStrategy", message: "Auth strategy is invalid." });
  }
  if (!CONNECTOR_VERIFICATION_STATUSES.includes(manifest.verificationStatus)) {
    issues.push({
      field: "verificationStatus",
      message: "Verification status is invalid.",
    });
  }

  const seen = new Set<string>();
  for (const capability of manifest.capabilities) {
    if (!isConnectorCapability(capability)) {
      issues.push({
        field: "capabilities",
        message: `Invalid capability: ${capability}`,
      });
    }
    if (seen.has(capability)) {
      issues.push({
        field: "capabilities",
        message: `Duplicate capability: ${capability}`,
      });
    }
    seen.add(capability);
  }

  if (
    manifest.verificationStatus !== "planned" &&
    manifest.verificationStatus !== "unavailable" &&
    manifest.verificationStatus !== "restricted" &&
    manifest.capabilities.length === 0
  ) {
    issues.push({
      field: "capabilities",
      message: "Available connectors must declare at least one capability.",
    });
  }

  return issues;
}

export function validateCanonicalRecord(
  record: CanonicalRecord,
): ConnectorContractIssue[] {
  const issues: ConnectorContractIssue[] = [];

  if (!CANONICAL_OBJECT_TYPES.includes(record.objectType)) {
    issues.push({ field: "objectType", message: "Object type is invalid." });
  }
  if (!record.externalId.trim()) {
    issues.push({ field: "externalId", message: "External id is required." });
  }
  if (!record.data || Array.isArray(record.data)) {
    issues.push({ field: "data", message: "Canonical data must be an object." });
  }
  if (!record.source || Array.isArray(record.source)) {
    issues.push({ field: "source", message: "Source payload must be an object." });
  }
  if (record.updatedAt && Number.isNaN(Date.parse(record.updatedAt))) {
    issues.push({ field: "updatedAt", message: "Updated timestamp is invalid." });
  }

  return issues;
}

export function validateConnectorAdapter(
  adapter: ConnectorAdapter,
): ConnectorContractIssue[] {
  const issues = validateConnectorManifest(adapter.manifest);
  const capabilities = new Set(adapter.manifest.capabilities);
  const hasPull = [...capabilities].some(
    (capability) =>
      capability.endsWith(".read") || capability.endsWith(".search"),
  );
  const hasPush = [...capabilities].some((capability) =>
    [".create", ".update", ".delete"].some((suffix) =>
      capability.endsWith(suffix),
    ),
  );
  const hasWebhooks = [...capabilities].some((capability) =>
    capability.endsWith(".webhook"),
  );

  if (hasPull && !adapter.pullPage) {
    issues.push({
      field: "pullPage",
      message: "Read/search capabilities require pullPage().",
    });
  }
  if (hasPush && !adapter.pushRecord) {
    issues.push({
      field: "pushRecord",
      message: "Create/update/delete capabilities require pushRecord().",
    });
  }
  if (hasWebhooks && !adapter.registerWebhooks) {
    issues.push({
      field: "registerWebhooks",
      message: "Webhook capabilities require registerWebhooks().",
    });
  }

  return issues;
}
