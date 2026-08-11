function normalizeAppUrl(value, allowLocalhost = false) {
  try {
    const parsed = new URL(String(value || "").trim());
    const isLocal =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";

    if (parsed.username || parsed.password) return null;
    if (parsed.protocol !== "https:" && !(allowLocalhost && isLocal)) {
      return null;
    }

    parsed.hash = "";
    parsed.search = "";
    return parsed.origin;
  } catch {
    return null;
  }
}

module.exports = { normalizeAppUrl };
