import {
  CANONICAL_OBJECT_TYPES,
  CONNECTOR_MAPPING_DIRECTIONS,
  CONNECTOR_MAPPING_TRANSFORMS,
  type CanonicalRecord,
  type ConnectorFieldMapping,
  type ConnectorMappingDirection,
  type ConnectorMappingTransform,
} from "./types.ts";

const FIELD_PATH_PATTERN =
  /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*){0,5}$/;
const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export class ConnectorFieldMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorFieldMappingError";
  }
}

export function validConnectorFieldPath(value: string) {
  return (
    value.length <= 128 &&
    FIELD_PATH_PATTERN.test(value) &&
    value.split(".").every((segment) => !FORBIDDEN_PATH_SEGMENTS.has(segment))
  );
}

export function validateConnectorFieldMapping(
  mapping: ConnectorFieldMapping,
): string[] {
  const issues: string[] = [];
  if (!CANONICAL_OBJECT_TYPES.includes(mapping.objectType)) {
    issues.push("Choose a valid object type.");
  }
  if (!CONNECTOR_MAPPING_DIRECTIONS.includes(mapping.direction)) {
    issues.push("Choose a valid mapping direction.");
  }
  if (!validConnectorFieldPath(mapping.nativeField)) {
    issues.push("The Northstar field path is invalid.");
  }
  if (!validConnectorFieldPath(mapping.externalField)) {
    issues.push("The provider field path is invalid.");
  }
  if (
    mapping.transformKey &&
    !CONNECTOR_MAPPING_TRANSFORMS.includes(mapping.transformKey)
  ) {
    issues.push("Choose a supported transform.");
  }
  return issues;
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function writePath(target: Record<string, unknown>, path: string, value: unknown) {
  const segments = path.split(".");
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[segments.at(-1)!] = value;
}

function missing(value: unknown) {
  return value === undefined || value === null || value === "";
}

function transformValue(
  value: unknown,
  transform: ConnectorMappingTransform | null | undefined,
) {
  if (!transform) return value;
  if (transform === "trim") return String(value).trim();
  if (transform === "lowercase") return String(value).trim().toLowerCase();
  if (transform === "uppercase") return String(value).trim().toUpperCase();
  if (transform === "phone_digits") return String(value).replace(/\D/g, "");
  if (transform === "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error("is not a valid number");
    return parsed;
  }
  if (transform === "boolean") {
    if (typeof value === "boolean") return value;
    const normalized = String(value).trim().toLowerCase();
    if (["true", "yes", "1", "on"].includes(normalized)) return true;
    if (["false", "no", "0", "off"].includes(normalized)) return false;
    throw new Error("is not a valid boolean");
  }
  const timestamp = new Date(String(value));
  if (Number.isNaN(timestamp.getTime())) throw new Error("is not a valid date");
  return timestamp.toISOString();
}

function mappedValue(
  mapping: ConnectorFieldMapping,
  source: Record<string, unknown>,
  sourcePath: string,
  targetPath: string,
) {
  const raw = readPath(source, sourcePath);
  const value = missing(raw) ? mapping.defaultValue : raw;
  if (missing(value)) {
    if (mapping.isRequired) {
      throw new ConnectorFieldMappingError(
        `Required mapping ${sourcePath} -> ${targetPath} has no value.`,
      );
    }
    return undefined;
  }
  try {
    return transformValue(value, mapping.transformKey);
  } catch (error) {
    throw new ConnectorFieldMappingError(
      `Mapping ${sourcePath} ${error instanceof Error ? error.message : "could not be transformed"}.`,
    );
  }
}

function applies(mapping: ConnectorFieldMapping, direction: Exclude<ConnectorMappingDirection, "both">) {
  return (
    mapping.isActive &&
    (mapping.direction === direction || mapping.direction === "both")
  );
}

export function applyPullFieldMappings(
  record: CanonicalRecord,
  mappings: readonly ConnectorFieldMapping[],
): CanonicalRecord {
  const data = structuredClone(record.data);
  for (const mapping of mappings) {
    if (mapping.objectType !== record.objectType || !applies(mapping, "pull")) {
      continue;
    }
    const value = mappedValue(
      mapping,
      record.source,
      mapping.externalField,
      mapping.nativeField,
    );
    if (value !== undefined) writePath(data, mapping.nativeField, value);
  }
  return { ...record, data };
}

export function applyPushFieldMappings(
  objectType: CanonicalRecord["objectType"],
  data: Record<string, unknown>,
  mappings: readonly ConnectorFieldMapping[],
) {
  const externalData: Record<string, unknown> = {};
  for (const mapping of mappings) {
    if (mapping.objectType !== objectType || !applies(mapping, "push")) continue;
    const value = mappedValue(
      mapping,
      data,
      mapping.nativeField,
      mapping.externalField,
    );
    if (value !== undefined) writePath(externalData, mapping.externalField, value);
  }
  return externalData;
}

function mergeObjects(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
) {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const current = target[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      mergeObjects(current as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = structuredClone(value);
    }
  }
  return target;
}

// Custom mapped fields are additive. Standard connector fields are merged last,
// so a mapping cannot override idempotency keys or other connector invariants.
export function connectorPushPayload(
  externalData: Record<string, unknown> | undefined,
  standardData: Record<string, unknown>,
) {
  return mergeObjects(
    mergeObjects({}, externalData ?? {}),
    standardData,
  );
}

export function connectorPushParams(
  externalData: Record<string, unknown> | undefined,
  standardData: Record<string, unknown>,
) {
  const params = new URLSearchParams();
  const append = (value: unknown, path: string) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => append(item, `${path}[${index}]`));
    } else if (typeof value === "object") {
      Object.entries(value as Record<string, unknown>).forEach(([key, item]) =>
        append(item, path ? `${path}[${key}]` : key),
      );
    } else {
      params.set(path, String(value));
    }
  };
  Object.entries(connectorPushPayload(externalData, standardData)).forEach(
    ([key, value]) => append(value, key),
  );
  return params;
}
