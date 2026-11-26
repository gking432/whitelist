import { z } from "zod";
import { OnboardingRequestSchema, OnboardingSaveResponseSchema, OnboardingSnapshotSchema, type OnboardingRequest, type OnboardingSaveResponse, type OnboardingSnapshot } from "../../lib/business/onboarding-contract.ts";
import { PersonalAssistantScopeKeySchema } from "../../lib/personal-assistant/preferences-contract.ts";
import type { OwnerProvider } from "../../lib/connections/types.ts";

export class OnboardingRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.name = "OnboardingRequestError"; this.status = status; }
}
const uncertain = () => new OnboardingRequestError(503, "The saved result could not be confirmed. Reload saved setup before continuing.");
const deadline = (signal?: AbortSignal) => signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
export function onboardingScopeHeaders(scopeKey: string) {
  if (!PersonalAssistantScopeKeySchema.safeParse(scopeKey).success) throw new OnboardingRequestError(403, "Reload this business before continuing setup.");
  return { "X-Workstation-Scope": scopeKey };
}
async function json(response: Response, limit = 32768): Promise<unknown> {
  if (response.status === 403 || response.status === 401) throw new OnboardingRequestError(403, "Your access to this business changed. Sign in again to continue.");
  if (response.status === 409) throw new OnboardingRequestError(409, "Setup changed elsewhere. Reload saved setup; your unsaved text stays here.");
  if ([400, 413, 422].includes(response.status)) throw new OnboardingRequestError(response.status, "Check your answer before continuing.");
  if (!response.ok || !response.body) throw uncertain();
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > limit) { await reader.cancel().catch(() => {}); throw uncertain(); } chunks.push(part.value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
async function call(scopeKey: string, path: string, body: unknown, signal?: AbortSignal, request: typeof fetch = fetch, limit?: number) {
  try {
    return await json(await request(path, { credentials: "same-origin", cache: "no-store", redirect: "error", headers: { ...onboardingScopeHeaders(scopeKey), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }), signal: deadline(signal) }), limit);
  } catch (error) { if (error instanceof OnboardingRequestError) throw error; throw uncertain(); }
}
export async function loadBusinessOnboarding(scopeKey: string, signal?: AbortSignal, request: typeof fetch = fetch): Promise<OnboardingSnapshot> {
  try { return OnboardingSnapshotSchema.parse(await call(scopeKey, "/api/business/onboarding", undefined, signal, request)); }
  catch (error) { if (error instanceof OnboardingRequestError) throw error; throw uncertain(); }
}
export async function saveBusinessOnboarding(scopeKey: string, command: OnboardingRequest, signal?: AbortSignal, request: typeof fetch = fetch): Promise<OnboardingSaveResponse> {
  const parsed = OnboardingRequestSchema.safeParse(command);
  if (!parsed.success) throw new OnboardingRequestError(400, "Check your answer before continuing.");
  try {
    const saved = OnboardingSaveResponseSchema.parse(await call(scopeKey, "/api/business/onboarding", parsed.data, signal, request));
    if (saved.result.key !== parsed.data.key || saved.result.revision !== parsed.data.revision + 1 || saved.snapshot.progress.revision < saved.result.revision) throw uncertain();
    return saved;
  } catch (error) { if (error instanceof OnboardingRequestError) throw error; throw uncertain(); }
}

const Provider = z.object({ key: z.enum(["hubspot", "google_workspace", "microsoft_365", "stripe", "generic_inbound_webhook"]), label: z.string().min(1).max(100), setup: z.enum(["oauth", "operator", "token"]), available: z.boolean() });
const Account = z.object({ id: z.uuid(), name: z.string().max(200), provider: z.string().max(100), account: z.string().max(1000).nullable(), status: z.string().max(100), paused: z.boolean(), readOnly: z.boolean() });
const Connections = z.object({ apps: z.array(Account).max(100), providers: z.array(Provider).max(10), canWrite: z.boolean() });
export type WizardConnections = z.infer<typeof Connections>;
/** The server supplies an allowlisted neutral message, never a raw query. */
export function onboardingConnectionNotice(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 300 && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;
}
export async function loadOnboardingConnections(scopeKey: string, signal?: AbortSignal, request: typeof fetch = fetch): Promise<WizardConnections> {
  try { return Connections.parse(await call(scopeKey, "/api/connections", undefined, signal, request, 524288)); }
  catch (error) { if (error instanceof OnboardingRequestError) throw error; throw uncertain(); }
}
const Fact = z.object({ key: z.string().min(1).max(60), state: z.enum(["known", "unknown", "conflict"]), value: z.union([z.string().max(20000), z.array(z.string().max(1000)).max(30)]), reviewed: z.boolean() });
const Context = z.object({ revision: z.string().min(1).max(100), scope: z.object({ clientId: z.uuid(), partnerId: z.uuid() }), canWrite: z.boolean(), facts: z.array(Fact).max(20) });
export type WizardContext = z.infer<typeof Context>;
function parseContext(value: unknown, scopeKey: string) { const context = Context.parse(value); if (context.scope.clientId !== scopeKey.split(":")[1]) throw new OnboardingRequestError(403, "Your active business changed. Reload this workspace."); return context; }
export async function loadOnboardingContext(scopeKey: string, signal?: AbortSignal, request: typeof fetch = fetch): Promise<WizardContext> {
  try { return parseContext(await call(scopeKey, "/api/business/context", undefined, signal, request, 524288), scopeKey); }
  catch (error) { if (error instanceof OnboardingRequestError) throw error; throw uncertain(); }
}
export async function confirmOnboardingContext(scopeKey: string, key: string, revision: string, signal?: AbortSignal, request: typeof fetch = fetch): Promise<WizardContext> {
  try {
    const data = z.object({ result: z.object({ id: z.uuid(), revision: z.number().int().nonnegative(), message: z.string().min(1).max(4000), replayed: z.boolean(), cancelledWork: z.number().int().nonnegative() }), snapshot: Context }).parse(await call(scopeKey, "/api/business/context", { action: "review_context", key, expectedContextRevision: revision }, signal, request, 524288));
    const context = parseContext(data.snapshot, scopeKey), known = context.facts.filter(fact => fact.state === "known");
    if (context.revision !== revision || known.length === 0 || known.some(fact => !fact.reviewed)) throw uncertain();
    return context;
  } catch (error) { if (error instanceof OnboardingRequestError) throw error; throw uncertain(); }
}
/** Only a supported provider's actual authorization endpoint may leave setup. */
export function onboardingAuthorizationUrl(value: unknown, provider: OwnerProvider): string {
  if (typeof value !== "string") throw uncertain();
  let url: URL; try { url = new URL(value); } catch { throw uncertain(); }
  const valid = provider === "google_workspace" ? url.hostname === "accounts.google.com" && url.pathname === "/o/oauth2/v2/auth"
    : provider === "microsoft_365" ? url.hostname === "login.microsoftonline.com" && /^\/(common|organizations|[a-f0-9-]+)\/oauth2\/v2\.0\/authorize$/.test(url.pathname)
      : provider === "hubspot" ? url.hostname === "app.hubspot.com" && /^\/oauth\/(?:[0-9]+\/)?authorize$/.test(url.pathname) : false;
  if (!valid || url.protocol !== "https:" || url.port || url.username || url.password || url.hash) throw uncertain();
  return url.toString();
}
export async function startOnboardingConnection(scopeKey: string, provider: OwnerProvider, connectionId?: string, signal?: AbortSignal, request: typeof fetch = fetch): Promise<string> {
  // The fixed, server-allowlisted return target never comes from a URL query.
  if (!["google_workspace", "microsoft_365", "hubspot"].includes(provider) || connectionId !== undefined && !z.uuid().safeParse(connectionId).success) throw new OnboardingRequestError(400, "Choose a supported app account to connect.");
  try {
    const data = z.object({ url: z.string().max(10000) }).parse(await call(scopeKey, "/api/connections", { action: "connect", provider, ...(connectionId ? { connectionId } : {}), returnTo: "onboarding" }, signal, request));
    return onboardingAuthorizationUrl(data.url, provider);
  } catch (error) { if (error instanceof OnboardingRequestError) throw error; throw uncertain(); }
}
