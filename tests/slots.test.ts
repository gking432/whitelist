import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeOpenSlots,
  formatSlotLabel,
} from "../lib/scheduling/slots.ts";

// Fixed clock: Monday 2026-07-06 12:00 UTC (08:00 in America/New_York).
const MONDAY_NOON_UTC = new Date("2026-07-06T12:00:00.000Z");
const TZ = "America/New_York";

test("proposes slots inside business hours on business days", () => {
  const slots = computeOpenSlots([], {
    timezone: TZ,
    now: MONDAY_NOON_UTC,
    maxSlots: 3,
  });

  assert.equal(slots.length, 3);

  for (const slot of slots) {
    const start = new Date(slot.startIso);
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        hour: "numeric",
        hour12: false,
      }).format(start),
    );
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      weekday: "short",
    }).format(start);

    assert.ok(hour >= 9 && hour < 17, `slot at local hour ${hour}`);
    assert.ok(!["Sat", "Sun"].includes(weekday), `slot on ${weekday}`);
  }
});

test("spreads slots across different days by default", () => {
  const slots = computeOpenSlots([], {
    timezone: TZ,
    now: MONDAY_NOON_UTC,
    maxSlots: 3,
  });

  const days = new Set(
    slots.map((slot) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        day: "numeric",
        month: "numeric",
      }).format(new Date(slot.startIso)),
    ),
  );

  assert.equal(days.size, 3);
});

test("never overlaps busy intervals", () => {
  // Block the entire first business day (Mon 9-17 ET = 13:00-21:00 UTC).
  const busy = [
    { start: "2026-07-06T13:00:00.000Z", end: "2026-07-06T21:00:00.000Z" },
  ];

  const slots = computeOpenSlots(busy, {
    timezone: TZ,
    now: MONDAY_NOON_UTC,
    maxSlots: 3,
  });

  for (const slot of slots) {
    const startMs = Date.parse(slot.startIso);
    const endMs = Date.parse(slot.endIso);

    for (const interval of busy) {
      const busyStart = Date.parse(interval.start);
      const busyEnd = Date.parse(interval.end);
      assert.ok(
        endMs <= busyStart || startMs >= busyEnd,
        `slot ${slot.startIso} overlaps busy block`,
      );
    }
  }
});

test("returns no slots when the whole horizon is busy", () => {
  const busy = [
    { start: "2026-07-01T00:00:00.000Z", end: "2026-08-01T00:00:00.000Z" },
  ];

  const slots = computeOpenSlots(busy, {
    timezone: TZ,
    now: MONDAY_NOON_UTC,
  });

  assert.equal(slots.length, 0);
});

test("slot duration matches the requested length", () => {
  const slots = computeOpenSlots([], {
    timezone: TZ,
    now: MONDAY_NOON_UTC,
    durationMinutes: 90,
    maxSlots: 1,
  });

  assert.equal(slots.length, 1);
  assert.equal(
    Date.parse(slots[0].endIso) - Date.parse(slots[0].startIso),
    90 * 60 * 1000,
  );
});

test("formats labels in the client's timezone", () => {
  const label = formatSlotLabel("2026-07-07T13:00:00.000Z", TZ);
  assert.match(label, /Tue/);
  assert.match(label, /9:00/);
});
