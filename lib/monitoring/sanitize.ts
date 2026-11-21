import { createHash } from "node:crypto";

const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\b(?:sk|rk|pk|whk|re|pat)-?[A-Za-z0-9_-]{12,}\b/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g,
];

export function sanitizeMonitoringText(
  value: unknown,
  maxLength = 4_000,
): string | null {
  if (typeof value !== "string") return null;

  let sanitized = value.replace(/https?:\/\/[^\s?#]+\?[^\s#]*/gi, (url) =>
    url.split("?")[0] ?? url,
  );

  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[redacted]");
  }

  const trimmed = sanitized.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

export function monitoringFingerprint(input: {
  source: string;
  errorName?: string | null;
  message: string;
  routePath?: string | null;
  digest?: string | null;
}): string {
  return createHash("sha256")
    .update(
      [
        input.source,
        input.errorName ?? "Error",
        input.message,
        input.routePath ?? "",
        input.digest ?? "",
      ].join("\n"),
    )
    .digest("hex");
}

export function monitoringPath(value: unknown): string | null {
  const text = sanitizeMonitoringText(value, 500);
  if (!text) return null;

  try {
    return new URL(text, "https://monitoring.invalid").pathname.slice(0, 500);
  } catch {
    return text.split("?")[0]?.slice(0, 500) ?? null;
  }
}
