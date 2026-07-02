const SENSITIVE_KEY_PARTS = [
  "authorization",
  "cookie",
  "encrypted_value",
  "password",
  "secret",
  "token",
  "api_key",
  "apikey",
  "access_key",
  "refresh",
];

const REDACTED = "[redacted]";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase();

  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

export function redactAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactAuditValue(item));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveKey(key) ? REDACTED : redactAuditValue(entry),
    ]),
  );
}
