export const CRM_APPOINTMENT_STATUSES = [
  "proposed",
  "booked",
  "completed",
  "cancelled",
] as const;

export type CrmAppointmentStatus =
  (typeof CRM_APPOINTMENT_STATUSES)[number];

export function buildAppointmentTiming(
  startAt: string,
  durationMinutes = 60,
): { start: Date; end: Date; durationMinutes: number } | null {
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return null;

  const requested = Number.isFinite(durationMinutes)
    ? Math.trunc(durationMinutes)
    : 60;
  const duration = Math.min(480, Math.max(15, requested));

  return {
    start,
    end: new Date(start.getTime() + duration * 60_000),
    durationMinutes: duration,
  };
}

export function appointmentDurationMinutes(
  startAt: string,
  endAt: string,
): number {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 60;
  }

  return Math.min(480, Math.max(15, Math.round((end - start) / 60_000)));
}

export function appointmentIntervalsOverlap(
  first: { start: Date; end: Date },
  second: { start: Date; end: Date },
): boolean {
  return first.start < second.end && first.end > second.start;
}
