export type BusyInterval = { start: string; end: string };

function checkedInterval(start: unknown, end: unknown): BusyInterval {
  if (typeof start !== "string" || typeof end !== "string" ||
      !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) {
    throw new Error("Calendar returned an invalid busy interval.");
  }
  return { start, end };
}

export function googleBusyIntervals(body: unknown): BusyInterval[] {
  const calendar = (body as { calendars?: { primary?: { errors?: unknown[]; busy?: unknown } } } | null)?.calendars?.primary;
  if (!calendar || calendar.errors?.length || !Array.isArray(calendar.busy)) {
    throw new Error("Calendar availability could not be verified.");
  }
  return calendar.busy.map((item) => checkedInterval(item?.start, item?.end));
}

export function microsoftBusyIntervals(body: unknown, address: string): BusyInterval[] {
  const values = (body as { value?: { scheduleId?: string; error?: unknown; scheduleItems?: unknown }[] } | null)?.value;
  const calendar = Array.isArray(values) ? values.find((value) => value.scheduleId?.toLowerCase() === address.toLowerCase()) : null;
  if (!calendar || calendar.error || !Array.isArray(calendar.scheduleItems)) {
    throw new Error("Calendar availability could not be verified.");
  }
  return calendar.scheduleItems.flatMap((item) => {
    // getSchedule was explicitly requested in UTC. Graph may omit the Z suffix.
    if (item?.start?.timeZone !== "UTC" || item?.end?.timeZone !== "UTC") {
      throw new Error("Calendar returned an unexpected availability time zone.");
    }
    const utc = (value: unknown) => typeof value === "string" && !/(Z|[+-]\d\d:\d\d)$/i.test(value) ? `${value}Z` : value;
    const interval = checkedInterval(utc(item.start.dateTime), utc(item.end.dateTime));
    return item.status === "free" ? [] : [interval];
  });
}
