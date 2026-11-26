import { PersonalAssistantSaveSchema, PersonalAssistantScopeKeySchema, PersonalAssistantSnapshotSchema, type PersonalAssistantSave, type PersonalAssistantSnapshot } from "./preferences-contract.ts";

export class PersonalAssistantRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.name = "PersonalAssistantRequestError"; this.status = status; }
}
const uncertain = () => new PersonalAssistantRequestError(503, "The saved preference could not be confirmed. Reload it before trying again.");
const deadline = (signal?: AbortSignal) => signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
function scopeHeaders(scopeKey: string) {
  if (!PersonalAssistantScopeKeySchema.safeParse(scopeKey).success) throw new PersonalAssistantRequestError(403, "Reload this workspace before editing its private assistant preference.");
  return { "X-Workstation-Scope": scopeKey };
}
async function receipt(response: Response): Promise<PersonalAssistantSnapshot> {
  if (response.status === 403) throw new PersonalAssistantRequestError(403, "Your account cannot access this business preference. Sign in again or check your access.");
  if (response.status === 409) throw new PersonalAssistantRequestError(409, "This preference changed elsewhere. Reload the saved choice before saving.");
  if (response.status === 400 || response.status === 413) throw new PersonalAssistantRequestError(response.status, "Check your assistant choice before saving.");
  if (!response.ok || !response.body) throw uncertain();
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 8192) { await reader.cancel().catch(() => {}); throw uncertain(); }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(bytes); let offset = 0;
  for (const part of parts) { joined.set(part, offset); offset += part.byteLength; }
  return PersonalAssistantSnapshotSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)));
}
export async function loadPersonalAssistantPreference(scopeKey: string, signal?: AbortSignal, request: typeof fetch = fetch): Promise<PersonalAssistantSnapshot> {
  try {
    return await receipt(await request("/api/business/personal-assistant", { credentials: "same-origin", cache: "no-store", redirect: "error", headers: scopeHeaders(scopeKey), signal: deadline(signal) }));
  } catch (error) { if (error instanceof PersonalAssistantRequestError) throw error; throw uncertain(); }
}
export async function savePersonalAssistantPreference(scopeKey: string, input: PersonalAssistantSave, signal?: AbortSignal, request: typeof fetch = fetch): Promise<PersonalAssistantSnapshot> {
  const parsed = PersonalAssistantSaveSchema.safeParse(input);
  if (!parsed.success) throw new PersonalAssistantRequestError(400, "Check your assistant choice before saving.");
  try {
    const saved = await receipt(await request("/api/business/personal-assistant", { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/json", ...scopeHeaders(scopeKey) }, body: JSON.stringify(parsed.data), signal: deadline(signal) }));
    if (saved.preferences.answer !== parsed.data.settings.answer || saved.preferences.assistant !== parsed.data.settings.assistant || saved.preferences.revision !== parsed.data.revision + 1) throw uncertain();
    return saved;
  } catch (error) { if (error instanceof PersonalAssistantRequestError) throw error; throw uncertain(); }
}
