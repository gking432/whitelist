export function toSafeNextPath(
  value: FormDataEntryValue | string | null | undefined,
  fallback = "/partner",
) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  return value;
}
