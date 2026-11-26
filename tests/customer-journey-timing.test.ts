import test from "node:test";
import assert from "node:assert/strict";
import { customerJourneyTiming } from "../lib/business/customer-journey-timing.ts";

test("recorded journey durations use actual instants across the daylight-saving boundary", () => {
  const [measurement] = customerJourneyTiming({ now: "2026-11-01T03:00:00-06:00",
    inquiry: { id: "source", receivedAt: "2026-11-01T01:30:00-05:00" }, bookingReceipt: { id: "receipt", recordedAt: "2026-11-01T01:30:00-06:00" } });
  assert.equal(measurement.seconds, 3600);
  assert.deepEqual(measurement.sources.map((source) => source.id), ["source", "receipt"]);
  assert.match(measurement.detail, /not time saved/);
});
test("a current pending owner decision has measured age and stops counting at expiry", () => {
  const input = { now: "2026-11-17T12:00:00Z", pendingDecision: { id: "decision", createdAt: "2026-11-17T11:15:00Z", expiresAt: "2026-11-17T12:01:00Z" } };
  assert.equal(customerJourneyTiming(input)[0].seconds, 2700);
  assert.equal(customerJourneyTiming({ ...input, now: input.pendingDecision.expiresAt }).length, 0);
});
test("missing, invalid, reversed and future source clocks never become a fabricated measurement", () => {
  for (const receivedAt of [null, "invalid", "2026-11-18T12:00:00Z"]) assert.deepEqual(customerJourneyTiming({ now: "2026-11-17T12:00:00Z",
    inquiry: { id: "source", receivedAt }, bookingReceipt: { id: "receipt", recordedAt: "2026-11-17T11:00:00Z" } }), []);
  assert.deepEqual(customerJourneyTiming({ now: "invalid", pendingDecision: { id: "approval", createdAt: "2026-11-17T11:00:00Z", expiresAt: null } }), []);
});
