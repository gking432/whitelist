export function normalizeReleaseVersion(value: string): string | null {
  const normalized = value.trim().slice(0, 80);
  if (!normalized || !/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(normalized)) {
    return null;
  }
  return normalized;
}

export function normalizeFeatureFlagKey(value: string): string | null {
  const normalized = value.trim().slice(0, 160);
  if (!normalized) return null;
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(normalized)
    ? normalized
    : null;
}

export function supportReleaseCanRollback(status: string | null | undefined) {
  return status === "released";
}
