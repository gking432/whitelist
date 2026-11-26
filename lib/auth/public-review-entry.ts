type PrivateSignInIntent = { next?: string; error?: string; agency?: string };
type CookieHint = { name: string; value: string };

/** Explicit parameters preserve the private sign-in flow, including empty
 * values. This does not validate a redirect target or confer authentication. */
export function hasPrivateSignInIntent({ next, error, agency }: PrivateSignInIntent): boolean {
  return [next, error, agency].some((value) => typeof value === "string");
}

/** Only the three exact entry paths participate; never APIs or private detail. */
export function publicReviewDestination(pathname: string): string | null {
  return pathname === "/" || pathname === "/client" || pathname === "/login" ? "/preview" : null;
}

/** Match the installed Supabase SDK's default storage key. In particular,
 * http://127.0.0.1 produces sb-127-auth-token, not sb-127.0.0.1-auth-token. */
export function supabaseAuthCookieName(configuredUrl?: string): string | null {
  if (!configuredUrl) return null;
  try {
    const url = new URL(configuredUrl);
    if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return `sb-${url.hostname.split(".")[0]}-auth-token`;
  } catch { return null; }
}

/** Cookie presence is only an optimistic routing hint. Even a well-shaped
 * carrier must go through server Auth and the existing private page checks.
 * Foreign projects, partial/mixed chunks and empty carriers are not hints. */
export function hasPossibleSessionCookie(cookies: readonly CookieHint[], configuredUrl?: string): boolean {
  const key = supabaseAuthCookieName(configuredUrl);
  if (!key) return false;
  const relevant = cookies.filter((cookie) => cookie.name === key || cookie.name.startsWith(`${key}.`));
  if (!relevant.length || relevant.some((cookie) => !cookie.value.trim()) || new Set(relevant.map((cookie) => cookie.name)).size !== relevant.length) return false;
  const full = relevant.filter((cookie) => cookie.name === key);
  if (full.length) return relevant.length === 1;
  const indices = relevant.map((cookie) => cookie.name.slice(key.length + 1));
  if (indices.some((index) => !/^(0|[1-9][0-9]*)$/.test(index) || !Number.isSafeInteger(Number(index)))) return false;
  return indices.map(Number).sort((a, b) => a - b).every((index, position) => index === position);
}
