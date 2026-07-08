// Customer scheduling-constraint parsing (docs/11 "AI Scheduling Layer").
// Turns phrases like "after 5", "mornings are better", "not tomorrow",
// "any weekday", "Friday works" into a structured constraint the slot
// engine applies against real calendar availability. Pure and
// dependency-free so it is unit-testable.

export type SchedulingConstraints = {
  // Local-hour bounds, e.g. "after 5" (pm) -> earliestHour 17.
  earliestHour: number | null;
  latestHour: number | null;
  // Preferred weekdays (0=Sun..6=Sat). Empty = no preference.
  weekdays: number[];
  excludeTomorrow: boolean;
  // Echo of what was understood, for honest approval summaries.
  understood: string[];
};

const WEEKDAY_NAMES: [string, number][] = [
  ["sunday", 0],
  ["monday", 1],
  ["tuesday", 2],
  ["wednesday", 3],
  ["thursday", 4],
  ["friday", 5],
  ["saturday", 6],
];

function parseHour(raw: string, meridiem: string | undefined): number | null {
  const hour = Number.parseInt(raw, 10);

  if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
    return null;
  }

  if (meridiem?.toLowerCase().startsWith("p") && hour < 12) {
    return hour + 12;
  }

  if (meridiem?.toLowerCase().startsWith("a") && hour === 12) {
    return 0;
  }

  // No meridiem: 1-6 in scheduling talk almost always means afternoon.
  if (!meridiem && hour >= 1 && hour <= 6) {
    return hour + 12;
  }

  return hour;
}

export function parseSchedulingConstraints(
  text: string | null | undefined,
): SchedulingConstraints {
  const constraints: SchedulingConstraints = {
    earliestHour: null,
    latestHour: null,
    weekdays: [],
    excludeTomorrow: false,
    understood: [],
  };

  if (!text?.trim()) {
    return constraints;
  }

  const lower = text.toLowerCase();

  // "after 5", "after 5pm", "not before 10am", "past 3"
  const after = lower.match(
    /(?:after|past|not before|no earlier than)\s+(\d{1,2})(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?/,
  );

  if (after) {
    const hour = parseHour(after[1], after[2]);

    if (hour !== null) {
      constraints.earliestHour = hour;
      constraints.understood.push(`after ${hour}:00`);
    }
  }

  // "before 3", "by noon", "no later than 2pm"
  const before = lower.match(
    /(?:before|by|no later than|until)\s+(\d{1,2})(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?/,
  );

  if (before) {
    const hour = parseHour(before[1], before[2]);

    if (hour !== null) {
      constraints.latestHour = hour;
      constraints.understood.push(`before ${hour}:00`);
    }
  }

  if (/\bnoon\b/.test(lower) && /\b(by|before|until)\s+noon\b/.test(lower)) {
    constraints.latestHour = 12;
    constraints.understood.push("before 12:00");
  }

  // Day parts.
  if (/morning/.test(lower)) {
    constraints.latestHour = Math.min(constraints.latestHour ?? 24, 12);
    constraints.understood.push("mornings");
  }

  if (/afternoon/.test(lower)) {
    constraints.earliestHour = Math.max(constraints.earliestHour ?? 0, 12);
    constraints.understood.push("afternoons");
  }

  if (/evening|after work/.test(lower)) {
    constraints.earliestHour = Math.max(constraints.earliestHour ?? 0, 16);
    constraints.understood.push("late afternoon/evening");
  }

  // "not tomorrow" / "anytime but tomorrow"
  if (/\b(not|except|but not|anytime but)\s+tomorrow\b/.test(lower)) {
    constraints.excludeTomorrow = true;
    constraints.understood.push("not tomorrow");
  }

  // Specific weekdays ("friday works", "monday or tuesday").
  for (const [name, index] of WEEKDAY_NAMES) {
    if (lower.includes(name)) {
      constraints.weekdays.push(index);
    }
  }

  if (/\bweekday(s)?\b/.test(lower)) {
    constraints.weekdays.push(1, 2, 3, 4, 5);
  }

  if (constraints.weekdays.length > 0) {
    constraints.weekdays = [...new Set(constraints.weekdays)];
    constraints.understood.push(
      `on ${constraints.weekdays
        .map((day) => WEEKDAY_NAMES.find(([, value]) => value === day)?.[0])
        .filter(Boolean)
        .join("/")}`,
    );
  }

  return constraints;
}

export function describeConstraints(
  constraints: SchedulingConstraints,
): string | null {
  return constraints.understood.length > 0
    ? constraints.understood.join(", ")
    : null;
}
