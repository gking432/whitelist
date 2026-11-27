import { FirstOwnerValidationError, firstOwnerUuid, parseFirstOwnerRequest, type FirstOwnerBusiness } from "../../lib/auth/first-owner-rules.ts";

export const FIRST_OWNER_FIELDS = ["name", "description", "timezone"] as const;
export const FIRST_OWNER_DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
const maximumLength = 4096;
export type FirstOwnerDraft = { version: 1; scopeKey: string; requestKey: string; step: number; values: FirstOwnerBusiness; expiresAt: number };
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));

export function firstOwnerDraftKey(scopeKey: string): string | null {
  return firstOwnerUuid(scopeKey) ? `workstation:first-owner:v1:${scopeKey}` : null;
}
export function newFirstOwnerDraft(scopeKey: string, requestKey: string, now = Date.now(), detectedTimezone = ""): FirstOwnerDraft {
  // The device timezone is a suggestion the owner sees and can change before creating the business.
  const timezone = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(detectedTimezone) ? detectedTimezone.slice(0, 100) : "";
  return { version: 1, scopeKey, requestKey, step: 0, values: { name: "", description: "", timezone }, expiresAt: now + FIRST_OWNER_DRAFT_TTL_MS };
}
/** Partial answers are local drafts, never supplied business facts. */
export function parseFirstOwnerDraft(raw: string | null, scopeKey: string, now = Date.now()): FirstOwnerDraft | null {
  if (!raw || raw.length > maximumLength || !firstOwnerDraftKey(scopeKey) || !Number.isFinite(now)) return null;
  try {
    const value = object(JSON.parse(raw)), values = object(value?.values);
    if (!value || !values || !exactKeys(value, ["version", "scopeKey", "requestKey", "step", "values", "expiresAt"]) || !exactKeys(values, [...FIRST_OWNER_FIELDS]) ||
      value.version !== 1 || value.scopeKey !== scopeKey || !firstOwnerUuid(value.requestKey) || !Number.isInteger(value.step) || Number(value.step) < 0 || Number(value.step) > 2 ||
      typeof value.expiresAt !== "number" || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + FIRST_OWNER_DRAFT_TTL_MS ||
      typeof values.name !== "string" || values.name.length > 100 || /[\u0000-\u001f\u007f]/.test(values.name) ||
      typeof values.description !== "string" || values.description.length > 2000 || /[\u0000\u007f]/.test(values.description) ||
      typeof values.timezone !== "string" || values.timezone.length > 100 || /[\u0000-\u001f\u007f]/.test(values.timezone)) return null;
    return value as FirstOwnerDraft;
  } catch { return null; }
}
export function readFirstOwnerDraft(storage: DraftStorage | undefined, scopeKey: string, now = Date.now()): FirstOwnerDraft | null {
  const key = firstOwnerDraftKey(scopeKey);
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key), draft = parseFirstOwnerDraft(raw, scopeKey, now);
    if (raw && !draft) storage.removeItem(key);
    return draft;
  } catch { return null; }
}
export function writeFirstOwnerDraft(storage: DraftStorage | undefined, draft: FirstOwnerDraft, now = Date.now()): boolean {
  const key = firstOwnerDraftKey(draft.scopeKey), next = { ...draft, expiresAt: now + FIRST_OWNER_DRAFT_TTL_MS }, raw = JSON.stringify(next);
  if (!storage || !key || !parseFirstOwnerDraft(raw, draft.scopeKey, now)) return false;
  try { storage.setItem(key, raw); return true; } catch { return false; }
}
/** Called only after a guarded private workspace is rendered for this actor. */
export function clearFirstOwnerDraft(storage: DraftStorage | undefined, scopeKey: string): void {
  const key = firstOwnerDraftKey(scopeKey);
  if (storage && key) { try { storage.removeItem(key); } catch { /* A local draft is never an access credential. */ } }
}
export function clearFirstOwnerDraftAfterProvision(storage: DraftStorage | undefined, workspaceScopeKey: string): void {
  const parts = workspaceScopeKey.split(":");
  if (parts.length === 2 && parts.every(firstOwnerUuid)) clearFirstOwnerDraft(storage, parts[0]);
}
export function firstOwnerDraftErrors(draft: FirstOwnerDraft): Record<string, string> {
  try { parseFirstOwnerRequest({ key: draft.requestKey, business: draft.values }); return {}; }
  catch (error) { return error instanceof FirstOwnerValidationError ? error.fields : { key: "Reload setup before continuing." }; }
}
export function firstOwnerErrorStep(fields: Record<string, string> | undefined): number | null {
  if (fields?.key) return 0;
  const index = FIRST_OWNER_FIELDS.findIndex((field) => fields?.[field]);
  return index >= 0 ? index : null;
}
