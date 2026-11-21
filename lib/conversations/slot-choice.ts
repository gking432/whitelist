import type { OfferedSlot } from "./availability";

// A model may interpret a request, but a vague acknowledgement cannot authorize
// choosing a time. Require a unique option number, ordinal, or offered clock time.
export function hasUnambiguousSlotChoice(
  text: string,
  slots: OfferedSlot[],
  selected: number | null,
  timezone: string,
) {
  if (!selected || !slots[selected - 1]) return false;
  const value = text.toLowerCase().trim();
  if (
    /\b(no|not|don't|do not|cancel|instead|either|any|or|maybe)\b/.test(value)
  )
    return false;
  const options = [
    ...value.matchAll(/\b(?:option|number|slot)\s*#?([1-3])\b/g),
  ].map((m) => Number(m[1]));
  const simple = value.match(/^([1-3])(?:\s+please)?[.!]?$/);
  if (simple) options.push(Number(simple[1]));
  for (const [i, ordinal] of ["first", "second", "third"].entries()) {
    if (new RegExp(`\\b${ordinal}\\b`).test(value)) options.push(i + 1);
  }
  if (
    options.length &&
    (new Set(options).size !== 1 || options[0] !== selected)
  )
    return false;
  const days = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const mentionedDays = days.filter((day) => value.includes(day));
  const mentionsTime =
    /\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(?:am|pm)\b|\bat\s+\d{1,2}\b/.test(value);
  const matches = slots.flatMap((slot, index) => {
    const date = new Date(slot.start_iso);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      weekday: "long",
    }).formatToParts(date);
    const part = (kind: string) =>
      parts.find((p) => p.type === kind)?.value.toLowerCase() ?? "";
    if (mentionedDays.length && !mentionedDays.includes(part("weekday")))
      return [];
    if (options.length && !mentionsTime) return [index + 1];
    const hour = Number(part("hour")),
      minute = part("minute"),
      period = part("dayPeriod");
    // Bare hours need 'at' or am/pm; minutes make a clock time unambiguous.
    const clock =
      minute === "00"
        ? new RegExp(
            `(?:\\b${hour}(?::00)?\\s*${period}\\b|\\bat\\s+${hour}(?::00)?(?![\\d:])(?:\\s*${period})?\\b)`,
          )
        : new RegExp(`\\b${hour}:${minute}(?:\\s*${period})?\\b`);
    const opposite = new RegExp(
      `\\b${hour}(?::${minute})?\\s*${period === "am" ? "pm" : "am"}\\b`,
    );
    return clock.test(value) && !opposite.test(value) ? [index + 1] : [];
  });
  return options.length
    ? matches.includes(selected)
    : matches.length === 1 && matches[0] === selected;
}
