import assert from "node:assert/strict";
import test from "node:test";

import {
  appointmentDurationMinutes,
  appointmentIntervalsOverlap,
  buildAppointmentTiming,
} from "../lib/crm/appointments.ts";

test("appointment timing clamps duration and returns an exact end", () => {
  const timing = buildAppointmentTiming("2026-08-12T15:00:00.000Z", 5);
  assert.ok(timing);
  assert.equal(timing.durationMinutes, 15);
  assert.equal(timing.end.toISOString(), "2026-08-12T15:15:00.000Z");

  const longTiming = buildAppointmentTiming(
    "2026-08-12T15:00:00.000Z",
    900,
  );
  assert.equal(longTiming?.durationMinutes, 480);
});

test("invalid appointment starts are rejected", () => {
  assert.equal(buildAppointmentTiming("not-a-date", 60), null);
});

test("adjacent appointments do not conflict but overlapping ones do", () => {
  const first = {
    start: new Date("2026-08-12T15:00:00.000Z"),
    end: new Date("2026-08-12T16:00:00.000Z"),
  };
  assert.equal(
    appointmentIntervalsOverlap(first, {
      start: new Date("2026-08-12T16:00:00.000Z"),
      end: new Date("2026-08-12T17:00:00.000Z"),
    }),
    false,
  );
  assert.equal(
    appointmentIntervalsOverlap(first, {
      start: new Date("2026-08-12T15:30:00.000Z"),
      end: new Date("2026-08-12T16:30:00.000Z"),
    }),
    true,
  );
});

test("appointment duration falls back for malformed ranges", () => {
  assert.equal(
    appointmentDurationMinutes(
      "2026-08-12T15:00:00.000Z",
      "2026-08-12T16:30:00.000Z",
    ),
    90,
  );
  assert.equal(appointmentDurationMinutes("bad", "also-bad"), 60);
});
