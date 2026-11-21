import type { ActivationCheck, ActivationPlan } from "./types.ts";
import { computeOpenSlots } from "../scheduling/slots.ts";
import { googleAccountCanAct, googleCredentialsCanAct, googleScopeAllows } from "../connections/google-permissions.ts";
import type { WorkspaceCredentials, WorkspaceProviderKey } from "../integrations/providers/workspace-oauth.ts";

export function activationStatus(
  plan: ActivationPlan | null,
  checks: ActivationCheck[],
) {
  if (!plan) return "not_started" as const;
  if (plan.status === "paused") return "paused" as const;
  return checks.length > 0 && checks.every((check) => check.ready)
    ? ("running" as const)
    : ("needs_attention" as const);
}

export function workspacePermissions(provider: string, scope: string, credentials?: WorkspaceCredentials, config?: Record<string, unknown>) {
  const granted = new Set(scope.toLowerCase().split(/\s+/));
  const selected = (channel: "email" | "calendar") => !credentials ? true :
    googleCredentialsCanAct(credentials, channel === "calendar" ? "calendar.write" : "email.send") &&
    (credentials.accessMode !== "owner_selected" && config?.workspace_view_only !== true || googleAccountCanAct(config, channel));
  return provider === "google_workspace"
    ? {
        email:
          (granted.has("https://www.googleapis.com/auth/gmail.readonly") ||
            granted.has("https://www.googleapis.com/auth/gmail.modify") ||
            granted.has("https://mail.google.com/")) &&
          googleScopeAllows(scope, "email.send") && selected("email"),
        calendar: googleScopeAllows(scope, "calendar.write") && selected("calendar"),
      }
    : {
        email: credentials?.accessMode === undefined && config?.workspace_view_only !== true && granted.has("mail.read") && granted.has("mail.send"),
        calendar: credentials?.accessMode === undefined && config?.workspace_view_only !== true && granted.has("calendars.readwrite"),
      };
}

/** Read-only probes of selected capabilities. No email, event or contact is
 * created to test consent. Dependencies make the provider boundary testable. */
export async function probeWorkspaceAccess(provider: WorkspaceProviderKey, credentials: WorkspaceCredentials, options: {
  config?: Record<string, unknown>; expectedAccountId?: string | null; mintToken(): Promise<string>; fetch?: typeof fetch;
}) {
  const granted = workspacePermissions(provider, credentials.scope ?? "", credentials, options.config);
  if (!granted.email && !granted.calendar) throw new Error("Authorize and select the required account permissions before checking activation.");
  const token = await options.mintToken(), request = options.fetch ?? fetch;
  const get = async (url: string) => {
    const response = await request(url, { redirect: "error", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Account access could not be verified. Reconnect the exact selected account.");
    return await response.json() as Record<string, unknown>;
  };
  const account = await get(provider === "google_workspace" ? "https://www.googleapis.com/oauth2/v2/userinfo" : "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName");
  if (typeof account.id !== "string" || !account.id || (options.expectedAccountId && account.id !== options.expectedAccountId) || (credentials.accountId && account.id !== credentials.accountId))
    throw new Error("The authorization belongs to a different account. Reconnect the exact selected account.");
  if (granted.email) await get(provider === "google_workspace" ? "https://gmail.googleapis.com/gmail/v1/users/me/profile" : "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=1&$select=id");
  if (granted.calendar) {
    if (provider === "google_workspace") {
      const id = typeof options.config?.calendar_id === "string" && options.config.calendar_id ? options.config.calendar_id : "primary";
      const calendar = await get(`https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(id)}`);
      if (typeof calendar.id !== "string" || calendar.accessRole !== "owner" || (id !== "primary" && calendar.id !== id)) throw new Error("The selected calendar is not owned by this Google account.");
      await get(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?maxResults=1`);
    } else await get(`https://graph.microsoft.com/v1.0/me/calendar/events?$top=1&$select=id`);
  }
  return { email: granted.email, calendar: granted.calendar, accountId: account.id,
    accountName: String(account.email ?? account.mail ?? account.userPrincipalName ?? "Connected account") };
}

export function freshCheck(
  value: unknown,
  now = Date.now(),
  maxAge = 24 * 60 * 60 * 1000,
) {
  const at = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(at) && at <= now + 60_000 && now - at < maxAge;
}

export function slotFitsActivation(
  plan: ActivationPlan,
  start: string,
  end: string,
) {
  const startMs = Date.parse(start),
    endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  const candidates = computeOpenSlots([], {
    timezone: plan.timezone,
    now: new Date(startMs - 2 * 60 * 60 * 1000),
    maxSlots: 1,
    maxPerDay: 1,
    businessStartHour: plan.booking_start_hour,
    businessEndHour: plan.booking_end_hour,
    durationMinutes: plan.booking_minutes,
    availabilityWindows: plan.booking_weekdays.map((weekday) => ({
      weekday,
      start_time: `${String(plan.booking_start_hour).padStart(2, "0")}:00`,
      end_time: `${String(plan.booking_end_hour).padStart(2, "0")}:00`,
      appointment_minutes: plan.booking_minutes,
    })),
  });
  return candidates.some(
    (s) => Date.parse(s.startIso) === startMs && Date.parse(s.endIso) === endMs,
  );
}
