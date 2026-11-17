import test from "node:test";
import assert from "node:assert/strict";
import {
  buildJourneyCommand, customerJourneyHref, formatJourneyElapsed, invalidJourneyFilter, journeyActions, journeyActionNeedsSlot,
  journeyQuery, JOURNEY_STATE_LABELS, journeyStateDetail, readJourneyReceipt, safeJourneyHref, visibleCustomerJourneys,
} from "../lib/business/customer-journey-presentation.ts";
import type { CustomerJourney, CustomerJourneyAction, CustomerJourneyOffer, CustomerJourneySnapshot } from "../lib/business/customer-journey-contract.ts";

const id = (end: number) => `00000000-0000-4000-8000-${String(end).padStart(12, "0")}`;
const action = (values: Partial<Extract<CustomerJourneyAction, { kind: "command" }>> = {}): Extract<CustomerJourneyAction, { kind: "command" }> => ({
  kind: "command", label: "Review scheduling", command: "progress_inquiry", targetId: id(1), expectedRevision: "lead:r3|source:2026-11-17T15:00:00.000001Z|contact:r9", requiresQualification: true, ...values,
});
const journey = (values: Partial<CustomerJourney> = {}): CustomerJourney => ({
  id: id(1), title: "Consultation inquiry", customer: { id: id(2), name: "Same customer name", identity: "unverified" },
  leadId: id(3), conversationId: id(4), revision: "journey:r1", updatedAt: "2026-11-17T15:00:00Z", warnings: [], stages: [], nextAction: null, ...values,
});
const snapshot = (journeys: CustomerJourney[]): CustomerJourneySnapshot => ({ version: 1, generatedAt: "2026-11-17T15:00:00Z", canWrite: true, limited: false, errors: [], journeys });
const offer: CustomerJourneyOffer = {
  id: id(9), expiresAt: "2026-11-17T17:00:00Z", provider: "northstar_internal", timezone: "America/Chicago",
  slots: [{ start_iso: "2026-11-18T17:00:00Z", end_iso: "2026-11-18T18:00:00Z", label: "Nov 18 at 11 AM" }], detail: "Saved availability offer",
};
const now = Date.parse("2026-11-17T16:00:00Z");

test("journey states distinguish requests, drafts, decisions, pending providers and verified results", () => {
  assert.equal(JOURNEY_STATE_LABELS.requested, "Requested");
  assert.equal(JOURNEY_STATE_LABELS.provider_pending, "Provider result pending");
  assert.notEqual(JOURNEY_STATE_LABELS.draft, JOURNEY_STATE_LABELS.confirmed);
  assert.notEqual(JOURNEY_STATE_LABELS.needs_owner, JOURNEY_STATE_LABELS.confirmed);
  assert.match(journeyStateDetail("scheduled"), /does not establish delivery/);
  assert.match(journeyStateDetail("provider_pending"), /verification before repeating/);
  assert.match(journeyStateDetail("requested"), /outcome is still pending/);
});
test("recorded elapsed times keep minute, hour and day boundaries concise without rounding up", () => {
  for (const [seconds, expected] of [[0, "Under 1 min"], [59.9, "Under 1 min"], [60, "1 min"], [3599, "59 min"],
    [3600, "1 hr"], [5400, "1 hr 30 min"], [86399, "23 hr 59 min"], [86400, "1 day"], [90000, "1 day 1 hr"], [172800, "2 days"]] as const)
    assert.equal(formatJourneyElapsed(seconds), expected);
});
test("unknown, reversed or unsafe elapsed measurements stay hidden", () => {
  for (const seconds of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, Number.MAX_SAFE_INTEGER + 1,
    null as unknown as number, undefined as unknown as number]) assert.equal(formatJourneyElapsed(seconds), null);
});
test("links allow only normalized owner routes or credential-free HTTPS sources", () => {
  assert.equal(safeJourneyHref("/client/messages?id=thread"), "/client/messages?id=thread");
  assert.equal(safeJourneyHref("https://calendar.google.com/calendar/event?eid=event"), "https://calendar.google.com/calendar/event?eid=event");
  for (const href of ["javascript:alert(1)", "data:text/html,x", "//evil.test/client", "/client/../api/jobs/run", "/client/%2e%2e/api/jobs/run", "/client\\evil.test", "https://user:password@example.test", "/client.evil/path"])
    assert.equal(safeJourneyHref(href), null, href);
});
test("customer deep links include exact record IDs and reject invalid or ambiguous filter values", () => {
  assert.equal(customerJourneyHref({ leadId: id(3) }), `/client/customer-work?leadId=${id(3)}`);
  assert.equal(journeyQuery({ conversationId: id(4) }), `conversationId=${id(4)}`);
  assert.equal(invalidJourneyFilter({ leadId: "customer name" }), true);
  assert.equal(invalidJourneyFilter({ leadId: [id(3)] } as unknown as { leadId: string }), true);
});
test("late or broad responses cannot display another same-named customer's journey", () => {
  const first = journey();
  const second = journey({ id: id(5), leadId: id(6), conversationId: id(7) });
  assert.deepEqual(visibleCustomerJourneys(snapshot([first, second]), { conversationId: id(7) }).map((item) => item.id), [second.id]);
  assert.deepEqual(visibleCustomerJourneys(snapshot([first, second]), { leadId: id(3), conversationId: id(7) }), []);
  assert.deepEqual(visibleCustomerJourneys(snapshot([first]), { conversationId: "invalid" }), []);
  const task = journey({ stages: [{ key: "lead", status: "complete", summary: "Task saved", updatedAt: null, sources: [{ kind: "task", id: id(8) }] }] });
  assert.equal(visibleCustomerJourneys(snapshot([task, second]), { taskId: id(8) }).length, 1);
});
test("read-only views retain review links and suppress mutations or unsupported action links", () => {
  const link = { kind: "link", label: "Review approval", href: "/client/approvals" } as const;
  const data = journey({ nextAction: action(), actions: [link, link, { kind: "link", label: "Unsafe", href: "javascript:alert(1)" }] });
  assert.deepEqual(journeyActions(data, false), [link]);
  assert.equal(journeyActions(data, true).length, 2);
});
test("qualification requires an explicit service and both distinct owner confirmations", () => {
  for (const qualification of [undefined, { service: "", identityConfirmed: true, bookingRequested: true },
    { service: "Consultation", identityConfirmed: false, bookingRequested: true }, { service: "Consultation", identityConfirmed: true, bookingRequested: false }])
    assert.throws(() => buildJourneyCommand(action(), id(10), { qualification }), /explicitly confirm/);
  const request = buildJourneyCommand(action(), id(10), { qualification: { service: " Consultation ", preference: " Weekday afternoon ", identityConfirmed: true, bookingRequested: true } });
  assert.equal(request.expectedRevision, action().expectedRevision);
  assert.deepEqual(request.qualification, { service: "Consultation", preference: "Weekday afternoon", identityConfirmed: true, bookingRequested: true });
  assert.equal("slot" in request, false);
});
test("slot selection never supplies a default time and preserves the exact saved offer", () => {
  const select = action({ command: "select_intake_slot", targetId: offer.id, requiresQualification: false, requiresSlot: true, expectedRevision: "7" });
  assert.throws(() => buildJourneyCommand(select, id(10), { offer }, now), /explicitly choose a time/);
  const request = buildJourneyCommand(select, id(10), { offer, slot: offer.slots[0] }, now);
  assert.equal(request.offerId, offer.id);
  assert.deepEqual(request.slot, offer.slots[0]);
  assert.equal(request.expectedRevision, "7");
  assert.equal(journeyActionNeedsSlot({ ...select, requiresSlot: undefined }), true);
});
test("changed, past and expired offers cannot create booking requests", () => {
  const select = action({ command: "select_intake_slot", targetId: offer.id, requiresQualification: false, requiresSlot: true });
  assert.throws(() => buildJourneyCommand(select, id(10), { offer: { ...offer, expiresAt: "2026-11-17T15:00:00Z" }, slot: offer.slots[0] }, now), /current availability/);
  assert.throws(() => buildJourneyCommand(select, id(10), { offer, slot: { ...offer.slots[0], label: "Edited label" } }, now), /unchanged future time/);
  assert.throws(() => buildJourneyCommand(select, id(10), { offer, slot: { ...offer.slots[0], start_iso: "2026-11-17T01:00:00Z" } }, now), /unchanged future time/);
  assert.throws(() => buildJourneyCommand({ ...select, targetId: id(99) }, id(10), { offer, slot: offer.slots[0] }, now), /assignment changed/);
});
test("initial rebooking and cancellation remain supported review requests without invented availability", () => {
  for (const command of ["prepare_rebooking", "request_cancellation", "prepare_reminder", "recover_confirmation"] as const) {
    const request = buildJourneyCommand(action({ command, requiresQualification: false }), id(10), {}, now);
    assert.equal(request.action, command);
    assert.equal("slot" in request, false);
    assert.equal("qualification" in request, false);
  }
});
test("a bare successful response cannot claim a saved result and replay remains historical", () => {
  for (const value of [null, {}, { message: "Saved" }, { id: "receipt", message: "Saved", replayed: "true" }])
    assert.throws(() => readJourneyReceipt(value), /saved result was not confirmed/);
  assert.deepEqual(readJourneyReceipt({ id: "receipt", message: "Cancellation review task saved.", replayed: true }), { id: "receipt", message: "Cancellation review task saved.", replayed: true });
});
