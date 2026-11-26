import type { WorkspaceCredentials } from "./workspace-oauth.ts";
import { CalendarReconciliationReadSchema, type CalendarReconciliationEvent, type CalendarReconciliationRead } from "../../scheduling/calendar-reconciliation-rules.ts";

export type GoogleCalendarReconciliationBinding = {
  provider: "google_workspace" | "google_calendar"; accountId: string; calendarId: string; eventId: string;
  operation: "cancel" | "reschedule"; attemptedAt: string;
};
export type CalendarReconciliationSession = { read(): Promise<CalendarReconciliationRead> };
type Dependencies = { fetch?: typeof fetch; now?: () => string; mintToken?: (credentials: WorkspaceCredentials) => Promise<string> };
const base = "https://www.googleapis.com/calendar/v3";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function sourceEvent(value: unknown): CalendarReconciliationEvent {
  const event = object(value), start = object(event.start), end = object(event.end);
  return { id: typeof event.id === "string" ? event.id : "", status: typeof event.status === "string" ? event.status : "unknown",
    etag: typeof event.etag === "string" ? event.etag : null, updated_at: typeof event.updated === "string" ? event.updated : null,
    slot: typeof start.dateTime === "string" && typeof end.dateTime === "string" ? { start_iso: start.dateTime, end_iso: end.dateTime } : null,
    organizer_self: object(event.organizer).self === true, recurring: !!event.recurringEventId || Array.isArray(event.recurrence),
    attendee_count: Array.isArray(event.attendees) ? event.attendees.length : 0, event_type: typeof event.eventType === "string" ? event.eventType : "default" };
}
function readConsent(credentials: WorkspaceCredentials, provider: GoogleCalendarReconciliationBinding["provider"]) {
  // Older grants omitted scope metadata. The API must still verify permission
  // and exact primary-calendar identity on each read; no write grant is inferred.
  if (!credentials.scope?.trim() && provider === "google_calendar") return;
  const grants = new Set((credentials.scope ?? "").split(/\s+/));
  const has = (suffix: string) => grants.has(`https://www.googleapis.com/auth/${suffix}`);
  if (!(has("calendar") || has("calendar.readonly") || has("calendar.calendarlist") || has("calendar.calendarlist.readonly")) ||
    !(has("calendar") || has("calendar.readonly") || has("calendar.events") || has("calendar.events.readonly") || has("calendar.events.owned") || has("calendar.events.owned.readonly")))
    throw new Error("Exact calendar read permission is unavailable. This saved result still needs source review.");
}

/** Read-only source session, deliberately separate from every mutation adapter.
 * Each observation re-verifies identity and current calendar ownership. */
export async function createGoogleCalendarReconciliationSession(credentials: WorkspaceCredentials, binding: GoogleCalendarReconciliationBinding, dependencies: Dependencies = {}): Promise<CalendarReconciliationSession> {
  if (!binding.accountId || !binding.calendarId || !binding.eventId || !Number.isFinite(Date.parse(binding.attemptedAt)))
    throw new Error("The exact calendar, event and saved attempt clock are required for reconciliation.");
  if (credentials.accountId && credentials.accountId !== binding.accountId) throw new Error("Stored calendar credentials belong to another account.");
  readConsent(credentials, binding.provider);
  const token = await (dependencies.mintToken ?? (async (stored) => {
    const { mintWorkspaceAccessToken } = await import("./workspace-oauth.ts");
    return mintWorkspaceAccessToken("google_workspace", stored);
  }))(credentials);
  const request = dependencies.fetch ?? fetch, now = dependencies.now ?? (() => new Date().toISOString());
  const get = async (url: string) => request(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(5_000),
    headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache", Accept: "application/json" } });
  const failure = (status: number) => new Error(`The exact Google calendar source could not be read (${status}). No calendar change was repeated.`);
  return { read: async () => {
    if (binding.provider === "google_workspace") {
      const response = await get("https://www.googleapis.com/oauth2/v2/userinfo");
      if (!response.ok) throw failure(response.status);
      const identity = object(await response.json());
      if (identity.id !== binding.accountId) throw new Error("The current Google authorization belongs to another account.");
    }
    const calendarResponse = await get(`${base}/users/me/calendarList/${encodeURIComponent(binding.calendarId)}`);
    if (!calendarResponse.ok) throw failure(calendarResponse.status);
    const calendar = object(await calendarResponse.json());
    if (typeof calendar.id !== "string" || !calendar.id || calendar.accessRole !== "owner" ||
      (binding.calendarId !== "primary" && calendar.id !== binding.calendarId) ||
      (binding.provider === "google_calendar" && (calendar.primary !== true || calendar.id !== binding.accountId)))
      throw new Error("The source is not the exact owned calendar recorded for this saved action.");
    const calendarId = calendar.id;
    const response = await get(`${base}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(binding.eventId)}`);
    if (![200, 404, 410].includes(response.status)) throw failure(response.status);
    const event = response.status === 200 ? sourceEvent(await response.json()) : null;
    let tombstone: CalendarReconciliationEvent | null = null, complete = false;
    if (binding.operation === "cancel" && [404, 410].includes(response.status)) {
      const params = new URLSearchParams({ showDeleted: "true", singleEvents: "false", updatedMin: binding.attemptedAt, maxResults: "2500" });
      const deleted = await get(`${base}/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
      if (!deleted.ok) throw failure(deleted.status);
      const body = object(await deleted.json());
      const matches = Array.isArray(body.items) ? body.items.filter((item) => object(item).id === binding.eventId) : [];
      complete = Array.isArray(body.items) && !body.nextPageToken && matches.length <= 1 && (!body.accessRole || body.accessRole === "owner");
      if (complete && matches.length === 1) tombstone = sourceEvent(matches[0]);
    }
    return CalendarReconciliationReadSchema.parse({ observed_at: now(), account_id: binding.accountId,
      requested_calendar_id: binding.calendarId, resolved_calendar_id: calendarId, calendar_access_role: "owner",
      event_id: binding.eventId, http_status: response.status, event, tombstone, tombstone_complete: complete });
  } };
}
