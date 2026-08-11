export type SchedulingProvider = "google_calendar" | "northstar_internal";

export function resolveSchedulingProvider(input: {
  hasGoogleCalendar: boolean;
  crmOperatingMode: string | null | undefined;
}): SchedulingProvider | null {
  if (input.hasGoogleCalendar) return "google_calendar";
  if (input.crmOperatingMode === "primary_crm") return "northstar_internal";
  return null;
}
