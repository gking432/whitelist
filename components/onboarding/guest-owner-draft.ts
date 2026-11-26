import { FirstOwnerValidationError, firstOwnerUuid, parseFirstOwnerRequest, type FirstOwnerBusiness } from "../../lib/auth/first-owner-rules.ts";

export const GUEST_OWNER_DRAFT_KEY = "workstation:guest-owner:v1";
export const GUEST_OWNER_DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
export const GUEST_OWNER_FIELDS = ["name", "description", "timezone"] as const;
export type GuestOwnerStep = 0 | 1 | 2 | 3;
export type GuestOwnerDraft = { version: 1; draftId: string; requestKey: string; step: GuestOwnerStep; values: FirstOwnerBusiness; expiresAt: number };
export type GuestOwnerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));

/** A local identifier binds a later handoff, never an actor or permission. */
export function newGuestOwnerDraft(draftId: string, requestKey: string, now = Date.now()): GuestOwnerDraft {
  if (!firstOwnerUuid(draftId) || !firstOwnerUuid(requestKey) || !Number.isSafeInteger(now)) throw new Error("Start a new setup draft before continuing.");
  return { version: 1, draftId, requestKey, step: 0, values: { name: "", description: "", timezone: "" }, expiresAt: now + GUEST_OWNER_DRAFT_TTL_MS };
}
export function parseGuestOwnerDraft(raw: string | null, now = Date.now()): GuestOwnerDraft | null {
  if (!raw || raw.length > 16384 || !Number.isSafeInteger(now)) return null;
  try {
    const draft = object(JSON.parse(raw)), values = object(draft?.values);
    if (!draft || !values || !exact(draft, ["version", "draftId", "requestKey", "step", "values", "expiresAt"]) || !exact(values, GUEST_OWNER_FIELDS) ||
      draft.version !== 1 || !firstOwnerUuid(draft.draftId) || !firstOwnerUuid(draft.requestKey) || !Number.isInteger(draft.step) || Number(draft.step) < 0 || Number(draft.step) > 3 ||
      typeof draft.expiresAt !== "number" || !Number.isSafeInteger(draft.expiresAt) || draft.expiresAt <= now || draft.expiresAt > now + GUEST_OWNER_DRAFT_TTL_MS ||
      typeof values.name !== "string" || values.name.length > 100 || /[\u0000-\u001f\u007f]/.test(values.name) ||
      typeof values.description !== "string" || values.description.length > 2000 || /[\u0000\u007f]/.test(values.description) ||
      typeof values.timezone !== "string" || values.timezone.length > 100 || /[\u0000-\u001f\u007f]/.test(values.timezone)) return null;
    return draft as GuestOwnerDraft;
  } catch { return null; }
}
export function readGuestOwnerDraft(storage: GuestOwnerStorage | undefined, now = Date.now()): GuestOwnerDraft | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(GUEST_OWNER_DRAFT_KEY), draft = parseGuestOwnerDraft(raw, now);
    if (raw && !draft) storage.removeItem(GUEST_OWNER_DRAFT_KEY);
    return draft;
  } catch { return null; }
}
export function writeGuestOwnerDraft(storage: GuestOwnerStorage | undefined, draft: GuestOwnerDraft, now = Date.now()): boolean {
  if (!storage) return false;
  try {
    const raw = JSON.stringify({ ...draft, expiresAt: now + GUEST_OWNER_DRAFT_TTL_MS });
    if (!parseGuestOwnerDraft(raw, now)) return false;
    storage.setItem(GUEST_OWNER_DRAFT_KEY, raw); return true;
  } catch { return false; }
}
/** Conditional removal cannot erase a newer anonymous draft after a handoff. */
export function clearGuestOwnerDraft(storage: GuestOwnerStorage | undefined, expected?: Pick<GuestOwnerDraft, "draftId" | "requestKey">, now = Date.now()): boolean {
  if (!storage) return false;
  try {
    if (expected) {
      const current = parseGuestOwnerDraft(storage.getItem(GUEST_OWNER_DRAFT_KEY), now);
      if (!current || current.draftId !== expected.draftId || current.requestKey !== expected.requestKey) return false;
    }
    storage.removeItem(GUEST_OWNER_DRAFT_KEY); return true;
  } catch { return false; }
}
export function guestOwnerDraftErrors(draft: GuestOwnerDraft): Record<string, string> {
  try { parseFirstOwnerRequest({ key: draft.requestKey, business: draft.values }); return {}; }
  catch (error) { return error instanceof FirstOwnerValidationError ? error.fields : { key: "Reload setup before continuing." }; }
}

const unavailable = () => new Error("Google sign-in could not be started. Your answers stay in this tab. Try again when you are ready.");
export function guestGoogleAuthorizationUrl(value: unknown, supabaseUrl: string | undefined): string {
  try {
    if (typeof value !== "string" || value.length > 10000 || !supabaseUrl) throw unavailable();
    const expected = new URL(supabaseUrl), url = new URL(value);
    if (expected.username || expected.password || expected.hash || expected.search || expected.pathname !== "/" ||
      !(expected.protocol === "https:" || expected.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(expected.hostname)) ||
      url.origin !== expected.origin || url.pathname !== "/auth/v1/authorize" || url.username || url.password || url.hash ||
      url.searchParams.getAll("provider").length !== 1 || url.searchParams.get("provider") !== "google") throw unavailable();
    return url.toString();
  } catch { throw unavailable(); }
}
/** One explicit start only. Neither business answers nor identity tokens leave this client. */
export async function startGuestGoogleAuthorization(input: Pick<GuestOwnerDraft, "draftId" | "requestKey">, supabaseUrl: string | undefined, signal?: AbortSignal, request: typeof fetch = fetch): Promise<string> {
  if (!object(input) || !exact(input, ["draftId", "requestKey"]) || !firstOwnerUuid(input.draftId) || !firstOwnerUuid(input.requestKey)) throw unavailable();
  try {
    const response = await request("/auth/google/start", { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    if (!response.ok || !response.body) throw unavailable();
    const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 16384) { await reader.cancel().catch(() => {}); throw unavailable(); } parts.push(part.value); }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    const value = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (!value || !exact(value, ["url"])) throw unavailable();
    return guestGoogleAuthorizationUrl(value.url, supabaseUrl);
  } catch { throw unavailable(); }
}
