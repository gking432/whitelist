const localPath = (value: unknown): value is string => {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    // Reject encoded separators/control characters too, including nested URL
    // encodings that another redirect handler could decode a second time.
    let path = value;
    for (let i = 0; i < 3; i++) {
      const decoded = decodeURIComponent(path);
      if (decoded.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(decoded)) return false;
      if (decoded === path) break;
      path = decoded;
    }
    return new URL(value, "https://workspace.invalid").origin === "https://workspace.invalid";
  } catch { return false; }
};
export function toSafeNextPath(
  value: FormDataEntryValue | string | null | undefined,
  fallback = "/start",
) {
  return localPath(value) ? value : localPath(fallback) ? fallback : "/start";
}
