import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateBookingLifecycle, planBookingOwnerChange, readBookingLifecyclePin, sameBookingVersion,
  type BookingLifecycleState,
} from "../lib/scheduling/lifecycle-rules.ts";

const now = "2026-11-17T12:00:00Z";
function state(): BookingLifecycleState {
  const scope = { partnerId: "partner", clientId: "client" };
  return { ...scope, bookingApprovalId: "approval", actionJobId: "receipt", approvalStatus: "approved", receiptStatus: "succeeded",
    externalRef: "event-exact", receiptAt: "2026-11-17T11:50:00Z", provider: "google_workspace", calendarConnectionId: "calendar",
    calendarAccountId: "account", startAt: "2026-11-18T15:00:00Z", endAt: "2026-11-18T16:00:00Z", nativeLifecycleEnabledAt: "2026-11-17T10:00:00Z",
    native: { ...scope, id: "appointment", approvalId: "approval", updatedAt: "2026-11-17T11:50:00.123456Z", contactId: "contact",
      status: "booked", startAt: "2026-11-18T15:00:00Z", endAt: "2026-11-18T16:00:00Z", completedAt: null },
    contact: { ...scope, id: "contact", updatedAt: "2026-11-17T11:30:00Z", tags: [] }, delivery: { channel: "email", to: "customer@example.com" },
    latestInbound: null, conversation: null, otherHumanTakeover: false, cancellationRequested: false, coverageComplete: true,
    imports: [{ ...scope, id: "source", connectionId: "calendar-read", externalAccountId: "account", provider: "google_workspace",
      externalId: "event-exact", externalUpdatedAt: "2026-11-17T11:51:00Z", sourceEventAt: null, observedAt: "2026-11-17T11:55:00Z",
      deleted: false, status: "confirmed", startAt: "2026-11-18T15:00:00Z", endAt: "2026-11-18T16:00:00Z", nativeId: "appointment" }],
    authority: { allowed: true, reason: "Approved current context and channel.", revision: 4 } };
}
function pin(data = state()) {
  const decision = evaluateBookingLifecycle(data, { kind: "confirmation", now });
  assert.equal(decision.state, "ready");
  if (decision.state !== "ready") throw new Error("Fixture must be ready");
  return decision.pin;
}

test("a follow-up pins the exact successful booking, source version and customer", () => {
  const data = state(), saved = pin(data);
  assert.equal(saved.booking_approval_id, "approval");
  assert.equal(saved.booking_source.canonical_record_id, "source");
  assert.deepEqual(readBookingLifecyclePin({ ...saved, subject: "safe extra proposal field" }), saved);
  assert.equal(readBookingLifecyclePin({ ...saved, authority_revision: -1 }), null);
  for (const receiptStatus of ["processing", "provider_pending", "uncertain", "failed", "dry_run"]) {
    assert.equal(evaluateBookingLifecycle({ ...data, receiptStatus }, { kind: "confirmation", now }).state, "blocked");
  }
  assert.equal(evaluateBookingLifecycle({ ...data, receiptAt: "" }, { kind: "confirmation", now }).state, "blocked");
});

test("source observation refresh preserves approval, source modification invalidates it", () => {
  const data = state(), saved = pin(data);
  data.imports[0].observedAt = "2026-11-17T11:59:00Z";
  assert.equal(evaluateBookingLifecycle(data, { kind: "confirmation", now, pin: saved }).state, "ready");
  data.imports[0].externalUpdatedAt = "2026-11-17T11:58:00Z";
  const changed = evaluateBookingLifecycle(data, { kind: "confirmation", now, pin: saved });
  assert.equal(changed.state, "blocked");
  assert.match(changed.reason, /source version changed/);
});

test("post-booking customer replies block first preparation and final send", () => {
  const data = state(), saved = pin(data);
  data.latestInbound = { id: "reply", at: "2026-11-17T11:51:00Z" };
  for (const existing of [undefined, saved]) {
    const decision = evaluateBookingLifecycle(data, { kind: "confirmation", now, pin: existing });
    assert.equal(decision.state, "blocked");
    assert.match(decision.reason, /replied after booking/);
  }
  data.latestInbound.at = "2026-11-17T11:49:00Z";
  assert.equal(evaluateBookingLifecycle(data, { kind: "confirmation", now }).state, "ready");
});

test("an exact cancellation, reschedule or another source account cannot send an old confirmation", () => {
  for (const patch of [{ deleted: true }, { status: "cancelled" }, { startAt: "2026-11-18T17:00:00Z" },
    { externalAccountId: "other-account" }, { externalId: "other-event" }, { nativeId: "other-appointment" }]) {
    const data = state(), saved = pin(data); Object.assign(data.imports[0], patch);
    assert.equal(evaluateBookingLifecycle(data, { kind: "confirmation", now, pin: saved }).state, "blocked");
  }
  const data = state(); data.native!.status = "cancelled";
  assert.equal(evaluateBookingLifecycle(data, { kind: "confirmation", now }).state, "blocked");
});

test("current takeover, suppression, destination, context and durable cancellation markers stop follow-ups", () => {
  for (const change of [
    (data: BookingLifecycleState) => { data.contact!.tags = ["Do Not Contact"]; },
    (data: BookingLifecycleState) => { data.otherHumanTakeover = true; },
    (data: BookingLifecycleState) => { data.cancellationRequested = true; },
    (data: BookingLifecycleState) => { data.authority.allowed = false; data.authority.reason = "Current business context needs owner review."; },
    (data: BookingLifecycleState) => { data.delivery!.to = "someone-else@example.com"; },
    (data: BookingLifecycleState) => { data.contact!.clientId = "another-client"; },
  ]) {
    const data = state(), saved = pin(data); change(data);
    assert.equal(evaluateBookingLifecycle(data, { kind: "confirmation", now, pin: saved }).state, "blocked");
  }
});

test("future reminders remain unprepared until 24 hours before their verified time", () => {
  const data = state();
  const early = evaluateBookingLifecycle(data, { kind: "reminder", now });
  assert.equal(early.state, "not_due");
  assert.equal(early.nextDueAt, "2026-11-17T15:00:00.000Z");
  data.provider = "northstar_internal"; data.calendarConnectionId = null; data.imports = [];
  assert.equal(evaluateBookingLifecycle(data, { kind: "reminder", now: "2026-11-17T15:00:00Z" }).state, "ready");
  data.nativeLifecycleEnabledAt = "2026-11-17T11:59:00Z";
  assert.equal(evaluateBookingLifecycle(data, { kind: "reminder", now: "2026-11-17T15:00:00Z" }).state, "blocked");
});

test("source freshness and microsecond versions fail closed without fabricating native connections", () => {
  const data = state(); data.imports[0].observedAt = "2026-11-17T11:40:00Z";
  assert.equal(evaluateBookingLifecycle(data, { kind: "confirmation", now }).state, "waiting");
  data.provider = "northstar_internal"; data.calendarConnectionId = null; data.calendarAccountId = null; data.imports = [];
  const saved = pin(data); data.native!.updatedAt = "2026-11-17T11:50:00.123457Z";
  assert.equal(evaluateBookingLifecycle(data, { kind: "confirmation", now, pin: saved }).state, "blocked");
  assert.equal(sameBookingVersion("2026-11-17T11:50:00.123456Z", "2026-11-17T05:50:00.123456-06:00"), true);
  assert.equal(sameBookingVersion("2026-11-17T11:50:00.123456Z", "2026-11-17T11:50:00.123457Z"), false);
});

test("external cancellation and reschedule remain honest owner requests", () => {
  const data = { canWrite: true, provider: "google_workspace", nativeUpdatedAt: "2026-11-17T11:00:00Z", expectedUpdatedAt: "2026-11-17T11:00:00Z", status: "booked", action: "cancel" as const, now };
  assert.equal(planBookingOwnerChange(data).state, "external_request");
  assert.equal(planBookingOwnerChange({ ...data, provider: "northstar_internal" }).state, "internal_change");
  assert.equal(planBookingOwnerChange({ ...data, expectedUpdatedAt: "2026-11-17T10:00:00Z" }).state, "blocked");
  assert.equal(planBookingOwnerChange({ ...data, action: "reschedule", newSlot: { startAt: now, endAt: "2026-11-17T13:00:00Z" } }).state, "blocked");
});
