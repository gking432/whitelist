export const EXTERNAL_CALENDAR_PROVIDER_KEYS = [
  "google_workspace",
  "microsoft_365",
  "google_calendar",
] as const;

export type ExternalCalendarProvider =
  (typeof EXTERNAL_CALENDAR_PROVIDER_KEYS)[number];
export type SchedulingProvider = ExternalCalendarProvider | "northstar_internal";

export function resolveSchedulingProvider(input: {
  hasGoogleCalendar: boolean;
  externalProvider?: ExternalCalendarProvider | null;
  crmOperatingMode: string | null | undefined;
}): SchedulingProvider | null {
  if (input.externalProvider) return input.externalProvider;
  if (input.hasGoogleCalendar) return "google_calendar";
  if (input.crmOperatingMode === "primary_crm") return "northstar_internal";
  return null;
}
