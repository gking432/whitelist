import type { ActivationCheck, ActivationPlan } from "./types.ts";
import { computeOpenSlots } from "../scheduling/slots.ts";

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

export function workspacePermissions(provider: string, scope: string) {
  const granted = new Set(scope.toLowerCase().split(/\s+/));
  return provider === "google_workspace"
    ? {
        email:
          (granted.has("https://www.googleapis.com/auth/gmail.readonly") ||
            granted.has("https://www.googleapis.com/auth/gmail.modify") ||
            granted.has("https://mail.google.com/")) &&
          (granted.has("https://www.googleapis.com/auth/gmail.send") ||
            granted.has("https://www.googleapis.com/auth/gmail.modify") ||
            granted.has("https://mail.google.com/")),
        calendar: granted.has("https://www.googleapis.com/auth/calendar"),
      }
    : {
        email: granted.has("mail.read") && granted.has("mail.send"),
        calendar: granted.has("calendars.readwrite"),
      };
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
