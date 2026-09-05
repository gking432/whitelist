export function normalizeVoiceStreamUrl(input: string | null | undefined) {
  const raw = input?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol === "https:") url.protocol = "wss:";
    if (url.protocol === "http:") url.protocol = "ws:";
    if (url.protocol !== "wss:" && url.protocol !== "ws:") return null;
    if (url.pathname === "/") url.pathname = "/twilio";
    return url.toString();
  } catch {
    return null;
  }
}
