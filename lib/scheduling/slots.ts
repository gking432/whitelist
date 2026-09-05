// Open-slot computation for appointment proposals. Deliberately pure and
// dependency-free (no path aliases) so it is directly unit-testable: busy
// intervals in, open slots out.

export type BusyInterval = { start: string; end: string };

export type OpenSlot = { startIso: string; endIso: string };
export type AvailabilityWindow = { weekday: number; start_time: string; end_time: string; appointment_minutes: number };

export type SlotConstraints = {
  earliestHour: number | null;
  latestHour: number | null;
  weekdays: number[];
  excludeTomorrow: boolean;
};

export type SlotOptions = {
  timezone: string;
  durationMinutes?: number;
  businessStartHour?: number;
  businessEndHour?: number;
  daysAhead?: number;
  maxSlots?: number;
  maxPerDay?: number;
  availabilityWindows?: AvailabilityWindow[];
  // Customer constraints (parsed by lib/scheduling/constraints.ts),
  // intersected with business hours.
  constraints?: SlotConstraints;
  // Injectable clock for tests.
  now?: Date;
};

type LocalParts = { weekday: number; hour: number; minute: number; dayKey: string };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localParts(date: Date, timezone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });

  let weekday = 0;
  let hour = 0;
  let minute = 0;
  let year = "";
  let month = "";
  let day = "";

  for (const part of formatter.formatToParts(date)) {
    if (part.type === "weekday") {
      weekday = WEEKDAYS.indexOf(part.value);
    } else if (part.type === "hour") {
      hour = Number(part.value) % 24;
    } else if (part.type === "minute") {
      minute = Number(part.value);
    } else if (part.type === "year") {
      year = part.value;
    } else if (part.type === "month") {
      month = part.value;
    } else if (part.type === "day") {
      day = part.value;
    }
  }

  return { weekday, hour, minute, dayKey: `${year}-${month}-${day}` };
}

function overlaps(
  startMs: number,
  endMs: number,
  busy: { startMs: number; endMs: number }[],
): boolean {
  return busy.some(
    (interval) => startMs < interval.endMs && endMs > interval.startMs,
  );
}

// Scans a 30-minute grid from ~2 hours out to daysAhead, keeping slots that
// fall on business days/hours in the given timezone and do not overlap any
// busy interval. Spreads results across days (maxPerDay).
export function computeOpenSlots(
  busy: BusyInterval[],
  options: SlotOptions,
): OpenSlot[] {
  const {
    timezone,
    durationMinutes = 60,
    businessStartHour = 9,
    businessEndHour = 17,
    daysAhead = 7,
    maxSlots = 3,
    maxPerDay = 1,
    constraints,
    availabilityWindows,
    now = new Date(),
  } = options;

  // Customer constraints tighten the business window, never widen it.
  const startHour = Math.max(
    businessStartHour,
    constraints?.earliestHour ?? businessStartHour,
  );
  const endHour = Math.min(
    businessEndHour,
    constraints?.latestHour ?? businessEndHour,
  );

  if (endHour <= startHour) {
    return [];
  }

  const tomorrowKey = constraints?.excludeTomorrow
    ? localParts(new Date(now.getTime() + 24 * 60 * 60 * 1000), timezone).dayKey
    : null;

  const busyMs = busy
    .map((interval) => ({
      startMs: Date.parse(interval.start),
      endMs: Date.parse(interval.end),
    }))
    .filter(
      (interval) =>
        Number.isFinite(interval.startMs) && Number.isFinite(interval.endMs),
    );

  const gridMs = 30 * 60 * 1000;
  const windows = availabilityWindows?.length ? availabilityWindows : null;
  const timeMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  // First candidate: at least 2 hours out, rounded up to the grid.
  const earliest = now.getTime() + 2 * 60 * 60 * 1000;
  const firstCandidate = Math.ceil(earliest / gridMs) * gridMs;
  const horizon = now.getTime() + daysAhead * 24 * 60 * 60 * 1000;

  const slots: OpenSlot[] = [];
  const perDay = new Map<string, number>();

  for (
    let startMs = firstCandidate;
    startMs < horizon && slots.length < maxSlots;
    startMs += gridMs
  ) {
    const start = new Date(startMs);
    const { weekday, hour, minute, dayKey } = localParts(start, timezone);
    const localMinute = hour * 60 + minute;
    const window = windows?.find((candidate) => candidate.weekday === weekday &&
      localMinute >= timeMinutes(candidate.start_time) &&
      localMinute + candidate.appointment_minutes <= timeMinutes(candidate.end_time));
    if (windows && !window) continue;
    const durationMs = (window?.appointment_minutes ?? durationMinutes) * 60 * 1000;
    if (durationMs <= 0 || startMs + durationMs > horizon) continue;

    if (!windows && (weekday === 0 || weekday === 6)) {
      continue;
    }

    if (
      constraints &&
      constraints.weekdays.length > 0 &&
      !constraints.weekdays.includes(weekday)
    ) {
      continue;
    }

    if (tomorrowKey && dayKey === tomorrowKey) {
      continue;
    }

    if (localMinute < (windows ? constraints?.earliestHour ?? 0 : startHour) * 60) {
      continue;
    }

    // The whole appointment must end inside business hours.
    const endMs = startMs + durationMs;
    const endParts = localParts(new Date(endMs), timezone);

    if (
      endParts.dayKey !== dayKey ||
      endParts.hour * 60 + endParts.minute > (windows ? constraints?.latestHour ?? 24 : endHour) * 60 ||
      (window && endParts.hour * 60 + endParts.minute > timeMinutes(window.end_time))
    ) {
      continue;
    }

    if ((perDay.get(dayKey) ?? 0) >= maxPerDay) {
      continue;
    }

    if (overlaps(startMs, endMs, busyMs)) {
      continue;
    }

    perDay.set(dayKey, (perDay.get(dayKey) ?? 0) + 1);
    slots.push({
      startIso: start.toISOString(),
      endIso: new Date(endMs).toISOString(),
    });
  }

  return slots;
}

export function formatSlotLabel(startIso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(startIso));
}
