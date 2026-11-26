import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getAppUrl, getSupabasePublicEnv } from "../env.ts";
import { decryptSecret, encryptSecret, isSecretsEncryptionConfigured } from "../integrations/secrets.ts";
import { createSupabaseAuthCookieAdapter, normalizeSupabaseAuthCookies, supabaseAuthFetch } from "../supabase/auth-cookie-safety.ts";

export const GOOGLE_ONBOARDING_ATTEMPT_COOKIE = "workstation_google_onboarding_attempt";
export const GOOGLE_ONBOARDING_HANDOFF_COOKIE = "workstation_google_onboarding_handoff";
const TTL_MS = 10 * 60 * 1000;
const EPHEMERAL_STORAGE_KEY = "workstation-google-onboarding-ephemeral";
const uuid = z.uuid();
const common = { version: z.literal(1), attemptId: uuid, draftId: uuid, requestKey: uuid,
  issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative() };
const attemptSchema = z.object({ ...common, purpose: z.literal("google_onboarding_attempt"), verifier: z.string().min(32).max(256), priorActorId: uuid.nullable(), priorSessionId: uuid.nullable() }).strict()
  .refine((value) => (value.priorActorId === null) === (value.priorSessionId === null));
const handoffSchema = z.object({ ...common, actorId: uuid, sessionId: uuid }).strict();
const startSchema = z.object({ draftId: uuid, requestKey: uuid }).strict();
export type GoogleOnboardingHandoff = z.infer<typeof handoffSchema>;
type Attempt = z.infer<typeof attemptSchema>;
type Dependencies = { fetch?: typeof fetch; now?: () => number; randomUUID?: () => string };
type Failure = "denied" | "expired" | "changed" | "unavailable" | "failed";

/** Configuration availability only. This neither probes Google nor grants access. */
export function isGoogleOnboardingConfigured(): boolean {
  const env = getSupabasePublicEnv();
  if (process.env.GOOGLE_AUTH_ENABLED !== "true" || !env || !isSecretsEncryptionConfigured()) return false;
  try { return ["https:", "http:"].includes(new URL(env.url).protocol); } catch { return false; }
}

function current(value: { issuedAt: number; expiresAt: number }, now: number) {
  return Number.isSafeInteger(value.issuedAt) && Number.isSafeInteger(value.expiresAt) &&
    value.issuedAt <= now && value.expiresAt === value.issuedAt + TTL_MS && value.expiresAt > now;
}
function decode(value: string | undefined): unknown {
  if (!value || value.length > 4096 || !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return null;
  try { return JSON.parse(decryptSecret(value)); } catch { return null; }
}
export function readGoogleOnboardingHandoff(cookieValue: string | undefined, actorId: string, sessionId: string): GoogleOnboardingHandoff | null {
  const parsed = handoffSchema.safeParse(decode(cookieValue));
  return parsed.success && parsed.data.actorId === actorId && parsed.data.sessionId === sessionId && current(parsed.data, Date.now()) ? parsed.data : null;
}
export function clearGoogleOnboardingHandoff(response: NextResponse) {
  response.cookies.set(GOOGLE_ONBOARDING_HANDOFF_COOKIE, "", { ...cookieOptions, maxAge: 0 });
}
const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: TTL_MS / 1000 };
function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
function failJson(error: string, status: number) { return privateResponse(NextResponse.json({ error }, { status })); }
function originalCookieHygiene(request: NextRequest) {
  let updates: ReturnType<typeof normalizeSupabaseAuthCookies>["updates"] = [];
  try { const url = process.env.NEXT_PUBLIC_SUPABASE_URL; if (url) updates = normalizeSupabaseAuthCookies(url, request.cookies.getAll()).updates; } catch { /* Invalid configuration cannot establish an app session. */ }
  // Only the original carrier is normalized on failure. Never commit an SDK
  // refresh, replacement session or sign-out that occurred later in the flow.
  return (response: NextResponse) => { for (const cookie of updates) response.cookies.set(cookie.name, cookie.value, cookie.options); return response; };
}
function boundedTransport(transport: typeof fetch): typeof fetch {
  return async (input, init) => {
    const deadline = AbortSignal.timeout(15000);
    const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    try { return await transport(input, { ...init, signal }); }
    catch { throw new Error("Sign-in transport unavailable"); }
  };
}
/** Next16 normalizes loopback NextURL hosts to localhost, including .url.
 * Read the underlying standard Web Request URL without consuming its body.
 * A missing/incompatible getter fails closed; Host/Forwarded are never used. */
export function googleOnboardingRequestOrigin(request: Request): string | null {
  try {
    const getter = Object.getOwnPropertyDescriptor(Request.prototype, "url")?.get;
    const value: unknown = getter?.call(request);
    return typeof value === "string" ? new URL(value).origin : null;
  } catch { return null; }
}
function canonicalOrigin(request: NextRequest, requireOrigin: boolean) {
  try {
    const origin = new URL(getAppUrl()).origin;
    return googleOnboardingRequestOrigin(request) === origin && (!requireOrigin || request.headers.get("origin") === origin) ? origin : null;
  } catch { return null; }
}

/** The SDK may save the entire provider response. Its storage here is ephemeral,
 * never the SSR cookie adapter, and is discarded at the end of this request. */
function ephemeralClient(fetcher: typeof fetch, initial?: { key: string; value: string }) {
  const env = getSupabasePublicEnv()!;
  const values = new Map<string, string>(initial ? [[initial.key, initial.value]] : []);
  const client = createClient(env.url, env.anonKey, {
    auth: { storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } },
      storageKey: EPHEMERAL_STORAGE_KEY, flowType: "pkce", persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetcher },
  });
  return { client, verifier: () => [...values].find(([key]) => key.endsWith("-code-verifier")), clear: () => values.clear() };
}

/** Buffer all real SSR writes. Failed exchanges and setSession errors must not
 * delete or replace the browser's existing authenticated session. */
async function sessionClient(request: NextRequest, fetcher: typeof fetch) {
  const env = getSupabasePublicEnv()!;
  const jar = new Map(request.cookies.getAll().map((cookie) => [cookie.name, cookie.value]));
  const writes = new Map<string, { name: string; value: string; options: Parameters<NextResponse["cookies"]["set"]>[2] }>();
  const safeCookies = createSupabaseAuthCookieAdapter(env.url, {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (cookies) => { for (const cookie of cookies) { if (!cookie.value || cookie.options.maxAge === 0) jar.delete(cookie.name); else jar.set(cookie.name, cookie.value); writes.set(cookie.name, cookie); } },
  });
  const client = createServerClient(env.url, env.anonKey, {
    global: { fetch: supabaseAuthFetch(env.url, fetcher) },
    cookies: safeCookies,
  });
  return { client, commit: (response: NextResponse) => { for (const cookie of writes.values()) response.cookies.set(cookie.name, cookie.value, cookie.options); } };
}

async function verifiedIdentity(client: SupabaseClient, requireVerifiedEmail = false): Promise<{ actorId: string; sessionId: string } | null> {
  const saved = await client.auth.getSession();
  if (saved.error) throw new Error("Session unavailable");
  if (!saved.data.session) return null;
  const user = await client.auth.getUser(saved.data.session.access_token);
  // The cookie's user object is never identity evidence. Auth verifies the
  // access token, and the RPC checks its exact live session row.
  if (user.error || !user.data.user) throw new Error("Session unavailable");
  if (requireVerifiedEmail && (user.data.user.is_anonymous || !user.data.user.email_confirmed_at || !user.data.user.email?.trim())) throw new Error("Verified identity required");
  const actor = await client.rpc("current_session_actor");
  if (actor.error || actor.data !== user.data.user.id) throw new Error("Session unavailable");
  // Decode only after Auth + the live-session RPC have verified this token.
  // These claims bind continuity; decoding alone never authorizes a user.
  const claims: unknown = JSON.parse(Buffer.from(saved.data.session.access_token.split(".")[1], "base64url").toString("utf8"));
  const bound = z.object({ sub: uuid, session_id: uuid }).passthrough().parse(claims);
  if (bound.sub !== user.data.user.id) throw new Error("Session unavailable");
  return { actorId: user.data.user.id, sessionId: bound.session_id };
}

/** Fresh live-session evidence for the server's navigation/adoption decision.
 * It does not trust a cookie SID alone or expose an Auth token. */
export async function readGoogleOnboardingSessionId(client: SupabaseClient, actorId: string): Promise<string | null> {
  try {
    const identity = await verifiedIdentity(client, true);
    return identity?.actorId === actorId ? identity.sessionId : null;
  } catch { return null; }
}

async function smallJson(request: NextRequest): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !request.body) throw new Error("Invalid request");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 1024) { await reader.cancel(); throw new Error("Invalid request"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
}

export async function handleGoogleOnboardingStart(request: NextRequest, deps: Dependencies = {}) {
  const origin = canonicalOrigin(request, true);
  if (!origin) return failJson("origin_denied", 403);
  const hygiene = originalCookieHygiene(request);
  const failed = (error: string, status: number) => hygiene(failJson(error, status));
  if (request.method !== "POST" || request.nextUrl.pathname !== "/auth/google/start" || request.nextUrl.searchParams.size) return failed("invalid_request", 422);
  let input: z.infer<typeof startSchema>;
  try { input = startSchema.parse(await smallJson(request)); } catch { return failed("invalid_request", 422); }
  if (!isGoogleOnboardingConfigured()) return failed("google_unavailable", 503);
  const fetcher = boundedTransport(deps.fetch ?? fetch);
  const ephemeral = ephemeralClient(fetcher);
  try {
    const normal = await sessionClient(request, fetcher);
    const prior = await verifiedIdentity(normal.client);
    const now = (deps.now ?? Date.now)(), attemptId = (deps.randomUUID ?? randomUUID)();
    const callback = new URL("/auth/google/callback", origin);
    callback.searchParams.set("attempt", attemptId);
    const result = await ephemeral.client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: callback.href, scopes: "openid email profile", skipBrowserRedirect: true } });
    const verifier = ephemeral.verifier();
    if (result.error || !result.data.url || !verifier) return failed("google_unavailable", 503);
    const attempt: Attempt = { version: 1, purpose: "google_onboarding_attempt", attemptId, ...input, priorActorId: prior?.actorId ?? null, priorSessionId: prior?.sessionId ?? null, verifier: verifier[1], issuedAt: now, expiresAt: now + TTL_MS };
    const response = hygiene(privateResponse(NextResponse.json({ url: result.data.url })));
    response.cookies.set(GOOGLE_ONBOARDING_ATTEMPT_COOKIE, encryptSecret(JSON.stringify(attempt)), cookieOptions);
    clearGoogleOnboardingHandoff(response);
    normal.commit(response);
    return response;
  } catch { return failed("google_unavailable", 503); }
  finally { ephemeral.clear(); }
}

export async function handleGoogleOnboardingCallback(request: NextRequest, deps: Dependencies = {}) {
  const origin = canonicalOrigin(request, false);
  // Never use an untrusted Host as an OAuth return destination.
  if (!origin) return failJson("origin_denied", 403);
  const hygiene = originalCookieHygiene(request);
  const finish = (outcome: Failure | "return") => {
    const destination = new URL("/start", origin);
    destination.searchParams.set("google", outcome);
    const response = privateResponse(NextResponse.redirect(destination));
    response.cookies.set(GOOGLE_ONBOARDING_ATTEMPT_COOKIE, "", { ...cookieOptions, maxAge: 0 });
    return hygiene(response);
  };
  const query = request.nextUrl.searchParams;
  const allowed = ["attempt", "code", "error", "error_code", "error_description"];
  if (request.method !== "GET" || request.nextUrl.pathname !== "/auth/google/callback" ||
      [...query.keys()].some((key) => !allowed.includes(key) || query.getAll(key).length !== 1) ||
      !uuid.safeParse(query.get("attempt")).success || query.has("code") === query.has("error") ||
      ((query.has("error_code") || query.has("error_description")) && !query.has("error")) ||
      (query.has("error") && !/^[A-Za-z0-9_.-]{1,128}$/.test(query.get("error")!)) ||
      (query.has("error_code") && !/^[A-Za-z0-9_.-]{1,128}$/.test(query.get("error_code")!)) ||
      (query.get("error_description")?.length ?? 0) > 1024 || /[\u0000-\u001f\u007f]/.test(query.get("error_description") ?? "")) return finish("failed");
  if (!isGoogleOnboardingConfigured()) return finish("unavailable");
  const parsed = attemptSchema.safeParse(decode(request.cookies.get(GOOGLE_ONBOARDING_ATTEMPT_COOKIE)?.value));
  const attemptId = request.nextUrl.searchParams.get("attempt");
  if (!parsed.success || !current(parsed.data, (deps.now ?? Date.now)()) || parsed.data.attemptId !== attemptId) return finish("expired");
  if (request.nextUrl.searchParams.has("error")) return finish("denied");
  const code = request.nextUrl.searchParams.get("code");
  if (!code || code.length > 2048 || /[\u0000-\u0020\u007f]/.test(code)) return finish("failed");
  const fetcher = boundedTransport(deps.fetch ?? fetch), attempt = parsed.data;
  const ephemeral = ephemeralClient(fetcher, { key: `${EPHEMERAL_STORAGE_KEY}-code-verifier`, value: attempt.verifier });
  try {
    const normal = await sessionClient(request, fetcher);
    const prior = await verifiedIdentity(normal.client);
    if ((prior?.actorId ?? null) !== attempt.priorActorId || (prior?.sessionId ?? null) !== attempt.priorSessionId) return finish("changed");
    // Auth codes are single-use at GoTrue. Cookie retirement is not a cross-
    // request CAS: a copied old cookie can cause a failed replay exchange.
    const exchanged = await ephemeral.client.auth.exchangeCodeForSession(code);
    const session = exchanged.data.session, user = exchanged.data.user;
    if (exchanged.error || !session || !user || !uuid.safeParse(user.id).success || user.is_anonymous) return finish("failed");
    if (attempt.priorActorId !== null && attempt.priorActorId !== user.id) return finish("changed");
    if ((await verifiedIdentity(ephemeral.client, true))?.actorId !== user.id) return finish("failed");
    // Deliberately pass only the app Auth pair. Provider tokens must never enter
    // the real SSR SDK's cookie storage, including intermediate cookie writes.
    const persisted = await normal.client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    if (persisted.error || persisted.data.user?.id !== user.id || !persisted.data.user.email_confirmed_at || !persisted.data.user.email?.trim() || persisted.data.user.is_anonymous) return finish("failed");
    const persistedIdentity = await verifiedIdentity(normal.client, true);
    if (persistedIdentity?.actorId !== user.id) return finish("failed");
    const now = (deps.now ?? Date.now)();
    const handoff: GoogleOnboardingHandoff = { version: 1, attemptId: attempt.attemptId, draftId: attempt.draftId, requestKey: attempt.requestKey, actorId: user.id, sessionId: persistedIdentity.sessionId, issuedAt: now, expiresAt: now + TTL_MS };
    const response = finish("return");
    response.cookies.set(GOOGLE_ONBOARDING_HANDOFF_COOKIE, encryptSecret(JSON.stringify(handoff)), cookieOptions);
    normal.commit(response);
    return response;
  } catch { return finish("failed"); }
  finally { ephemeral.clear(); }
}
