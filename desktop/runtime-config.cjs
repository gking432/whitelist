const { isIP } = require("node:net");

function isNonPublicIpv4(host) {
  if (isIP(host) !== 4) return false;
  const [a, b] = host.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function normalizeAppUrl(value, allowLocalhost = false) {
  try {
    const parsed = new URL(String(value || "").trim());
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
    const isPrivate =
      isNonPublicIpv4(host) ||
      isIP(host) === 6 ||
      host.endsWith(".local") ||
      host.endsWith(".localhost");

    if (parsed.username || parsed.password) return null;
    if (!allowLocalhost && (isLocal || isPrivate)) return null;
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
