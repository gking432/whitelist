import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSchedulingConstraints } from "../lib/scheduling/constraints.ts";
import { computeOpenSlots } from "../lib/scheduling/slots.ts";

const MONDAY_NOON_UTC = new Date("2026-07-06T12:00:00.000Z");
const TZ = "America/New_York";

function localHour(iso: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hour: "numeric",
      hour12: false,
    }).format(new Date(iso)),
  );
}

test('"after 5" means 5pm or later', () => {
  const constraints = parseSchedulingConstraints("I work until 5, so after 5 please");
  assert.equal(constraints.earliestHour, 17);
});

test('"after 9am" stays morning', () => {
  const constraints = parseSchedulingConstraints("anytime after 9am");
  assert.equal(constraints.earliestHour, 9);
});

test('"mornings are better" caps the day at noon', () => {
  const constraints = parseSchedulingConstraints("Mornings are better for me");
  assert.equal(constraints.latestHour, 12);
});

test('"not tomorrow" is flagged', () => {
  const constraints = parseSchedulingConstraints("Any day but not tomorrow");
  assert.equal(constraints.excludeTomorrow, true);
});

test("weekday names are captured", () => {
  const constraints = parseSchedulingConstraints("Friday works best");
  assert.deepEqual(constraints.weekdays, [5]);
});

test("no constraints from plain text", () => {
  const constraints = parseSchedulingConstraints("Water heater is leaking");
  assert.equal(constraints.earliestHour, null);
  assert.equal(constraints.latestHour, null);
  assert.equal(constraints.weekdays.length, 0);
  assert.equal(constraints.excludeTomorrow, false);
});

test("slot engine honors morning preference", () => {
  const constraints = parseSchedulingConstraints("mornings are better");
  const slots = computeOpenSlots([], {
    timezone: TZ,
    now: MONDAY_NOON_UTC,
    maxSlots: 3,
    constraints,
  });

  assert.ok(slots.length > 0);

  for (const slot of slots) {
    assert.ok(localHour(slot.startIso) < 12, `slot at ${localHour(slot.startIso)}`);
  }
});

test("slot engine skips tomorrow when excluded", () => {
  const constraints = parseSchedulingConstraints("not tomorrow");
  const slots = computeOpenSlots([], {
    timezone: TZ,
    now: MONDAY_NOON_UTC,
    maxSlots: 3,
    constraints,
  });

  const tomorrow = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    day: "numeric",
  }).format(new Date(MONDAY_NOON_UTC.getTime() + 24 * 60 * 60 * 1000));

  for (const slot of slots) {
    const day = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      day: "numeric",
    }).format(new Date(slot.startIso));
    assert.notEqual(day, tomorrow);
  }
});

test("slot engine returns nothing when constraints close the window", () => {
  const constraints = parseSchedulingConstraints("after 8pm only");
  const slots = computeOpenSlots([], {
    timezone: TZ,
    now: MONDAY_NOON_UTC,
    constraints,
  });

  assert.equal(slots.length, 0);
});

test("weekday constraint restricts slot days", () => {
  const constraints = parseSchedulingConstraints("Friday please");
  const slots = computeOpenSlots([], {
    timezone: TZ,
    now: MONDAY_NOON_UTC,
    maxSlots: 3,
    maxPerDay: 3,
    constraints,
  });

  assert.ok(slots.length > 0);

  for (const slot of slots) {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      weekday: "short",
    }).format(new Date(slot.startIso));
    assert.equal(weekday, "Fri");
  }
});
