import { createChunks, DEFAULT_COOKIE_OPTIONS, stringFromBase64URL, stringToBase64URL, type CookieOptions } from "@supabase/ssr";

export type AuthCookiePair = { name: string; value: string };
export type AuthCookieWrite = AuthCookiePair & { options: CookieOptions };
type CookieSource = { getAll(): AuthCookiePair[]; setAll(cookies: AuthCookieWrite[]): void };

function authKey(url: string) { return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`; }
function isAuthCarrier(name: string, key: string) { return name === key || name.startsWith(`${key}.`); }
function withoutProviderTokens(value: Record<string, unknown>) {
  const clean = { ...value };
  delete clean.provider_token;
  delete clean.provider_refresh_token;
  return clean;
}

/** Storage hygiene only. Neither decoding nor normalizing a cookie authenticates
 * its user; fresh Auth and the existing live-session checks remain required. */
export function normalizeSupabaseAuthCookies(url: string, cookies: readonly AuthCookiePair[]): { cookies: AuthCookiePair[]; updates: AuthCookieWrite[] } {
  const key = authKey(url), existing = cookies.filter(cookie => isAuthCarrier(cookie.name, key));
  if (!existing.length) return { cookies: [...cookies], updates: [] };
  const unrelated = cookies.filter(cookie => !isAuthCarrier(cookie.name, key));
  const retire = () => ({ cookies: unrelated, updates: [...new Set(existing.map(cookie => cookie.name))].map(name => ({ name, value: "", options: { ...DEFAULT_COOKIE_OPTIONS, maxAge: 0 } })) });
  // Empty deletion tombstones are not session data. Every nonempty carrier
  // must be unambiguous: one base OR a complete unique sequence from chunk0.
  if (new Set(existing.map(cookie => cookie.name)).size !== existing.length) return retire();
  const present = existing.filter(cookie => cookie.value);
  const base = present.filter(cookie => cookie.name === key), chunks = present.filter(cookie => cookie.name !== key);
  if (!present.length || base.length && chunks.length) return retire();
  let raw: string;
  if (base.length === 1) raw = base[0].value;
  else {
    if (chunks.some(cookie => !/^(0|[1-9][0-9]*)$/.test(cookie.name.slice(key.length + 1)))) return retire();
    const ordered = [...chunks].sort((a, b) => Number(a.name.slice(key.length + 1)) - Number(b.name.slice(key.length + 1)));
    if (ordered.some((cookie, index) => cookie.name !== `${key}.${index}`)) return retire();
    raw = ordered.map(cookie => cookie.value).join("");
  }
  let value: unknown;
  try {
    let json = raw;
    if (raw.startsWith("base64-")) {
      const encoded = raw.slice(7);
      if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return retire();
      json = stringFromBase64URL(encoded);
      if (stringToBase64URL(json) !== encoded) return retire();
    }
    value = JSON.parse(json);
  } catch { return retire(); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return retire();
  const session = value as Record<string, unknown>;
  if (typeof session.access_token !== "string" || !session.access_token || typeof session.refresh_token !== "string" || !session.refresh_token || typeof session.expires_at !== "number" || !Number.isFinite(session.expires_at)) return retire();
  const clean = createChunks(key, `base64-${stringToBase64URL(JSON.stringify(withoutProviderTokens(value as Record<string, unknown>)))}`);
  if (existing.length === clean.length && clean.every(cookie => existing.some(old => old.name === cookie.name && old.value === cookie.value))) return { cookies: [...cookies], updates: [] };
  const names = new Set(clean.map(cookie => cookie.name));
  const removed = existing.filter(cookie => !names.has(cookie.name));
  return {
    cookies: [...unrelated, ...clean],
    updates: [...removed.map(cookie => ({ name: cookie.name, value: "", options: { ...DEFAULT_COOKIE_OPTIONS, maxAge: 0 } })), ...clean.map(cookie => ({ ...cookie, options: { ...DEFAULT_COOKIE_OPTIONS } }))],
  };
}

/** Normalize before the SDK reads; stage a clean replacement immediately even
 * if no SDK save occurs. Normalize SDK batches before any real cookie writer. */
export function createSupabaseAuthCookieAdapter(url: string, source: CookieSource) {
  const initial = normalizeSupabaseAuthCookies(url, source.getAll());
  if (initial.updates.length) source.setAll(initial.updates);
  return {
    getAll() { return normalizeSupabaseAuthCookies(url, source.getAll()).cookies; },
    setAll(writes: AuthCookieWrite[]) {
      const prior = source.getAll(), merged = new Map(prior.map(cookie => [cookie.name, cookie.value]));
      for (const cookie of writes) { if (!cookie.value || cookie.options.maxAge === 0) merged.delete(cookie.name); else merged.set(cookie.name, cookie.value); }
      const normalized = normalizeSupabaseAuthCookies(url, [...merged].map(([name, value]) => ({ name, value })));
      if (!normalized.updates.length) { source.setAll(writes); return; }
      const key = authKey(url), final = new Map(normalized.cookies.map(cookie => [cookie.name, cookie.value]));
      const planned = new Map<string, AuthCookieWrite>();
      // Include deletions requested by the SDK, including old chunks it already
      // removed from its new batch. No raw credential-bearing batch is written.
      for (const cookie of writes) planned.set(cookie.name, { ...cookie, value: final.get(cookie.name) ?? "", options: final.has(cookie.name) ? cookie.options : { ...cookie.options, maxAge: 0 } });
      for (const cookie of prior) if (isAuthCarrier(cookie.name, key) && !final.has(cookie.name)) planned.set(cookie.name, { name: cookie.name, value: "", options: { ...DEFAULT_COOKIE_OPTIONS, maxAge: 0 } });
      for (const cookie of normalized.updates) planned.set(cookie.name, cookie);
      source.setAll([...planned.values()].sort((a, b) => Number(Boolean(a.value)) - Number(Boolean(b.value))));
    },
  };
}

/** Token exchange, OTP verification and refresh all reach _saveSession. Remove
 * provider credentials before the installed SDK receives successful Auth JSON. */
export function supabaseAuthFetch(supabaseUrl: string, transport: typeof fetch = globalThis.fetch): typeof fetch {
  const auth = new URL("auth/v1/", `${supabaseUrl.trim().replace(/\/+$/, "")}/`);
  return async (input, init) => {
    const response = await transport(input, init);
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!response.ok || url.origin !== auth.origin || !url.pathname.startsWith(auth.pathname)) return response;
    let value: unknown;
    try { value = await response.clone().json(); } catch { return response; }
    if (!value || typeof value !== "object" || Array.isArray(value) || (!Object.hasOwn(value, "provider_token") && !Object.hasOwn(value, "provider_refresh_token"))) return response;
    const headers = new Headers(response.headers);
    headers.delete("content-length"); headers.delete("content-encoding"); headers.delete("transfer-encoding");
    return new Response(JSON.stringify(withoutProviderTokens(value as Record<string, unknown>)), { status: response.status, statusText: response.statusText, headers });
  };
}
