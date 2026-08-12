export const EXPECTED_SCHEMA_VERSION =
  "20260812090000_connector_worker_runtime_heartbeat";

export function schemaVersionIsCompatible(
  actual: string | null | undefined,
  expected = EXPECTED_SCHEMA_VERSION,
) {
  return Boolean(
    actual &&
      /^\d{14}_[a-z0-9_]+$/.test(actual) &&
      /^\d{14}_[a-z0-9_]+$/.test(expected) &&
      actual.localeCompare(expected) >= 0,
  );
}
