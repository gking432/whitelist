import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluateCalendarReconciliation, verifiedCalendarReconciliation, calendarReconciliationRevision,
  type CalendarReconciliationTarget, type CalendarReconciliationRead,
} from "../lib/scheduling/calendar-reconciliation-rules.ts";
import {
  observeCalendarReconciliation, readCalendarReconciliationReview, reconcileCalendarChange,
  type CalendarReconciliationContext, type CalendarReconciliationCommand,
} from "../lib/scheduling/calendar-reconciliation.ts";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const now = "2026-11-17T13:00:00Z";
function target(): CalendarReconciliationTarget {
  return { jobId: id(1), approvalId: id(2), previousStatus: "uncertain", attemptedAt: "2026-11-17T12:55:00Z", bookingReceiptAt: "2026-11-17T10:00:00Z",
    payload: { calendar_mutation_version: 1, mutation: "reschedule", booking_approval_id: id(3), booking_action_job_id: id(4), appointment_id: id(5), appointment_updated_at: "2026-11-17T10:00:00Z",
      contact_id: id(6), contact_updated_at: "2026-11-17T09:00:00Z", provider: "google_workspace", calendar_connection_id: id(7), calendar_account_id: "account-subject", calendar_id: "primary", external_ref: "exact-event",
      source_record_id: id(8), source_updated_at: "2026-11-17T09:00:00Z", source_etag: '"before"', old_slot: { start_iso: "2026-11-18T15:00:00Z", end_iso: "2026-11-18T16:00:00Z" },
      new_slot: { start_iso: "2026-11-18T16:00:00Z", end_iso: "2026-11-18T17:00:00Z" }, authority_revision: 4,
      customer_activity_id: null, customer_activity_at: null, conversation_id: null, conversation_revision: null } };
}
function read(p = target()): CalendarReconciliationRead {
  return { observed_at: "2026-11-17T12:59:00Z", account_id: "account-subject", requested_calendar_id: "primary", resolved_calendar_id: "owner@example.invalid", calendar_access_role: "owner", event_id: "exact-event", http_status: 200,
    event: { id: "exact-event", status: "confirmed", etag: '"after"', updated_at: "2026-11-17T12:56:00Z", slot: p.payload.new_slot!, organizer_self: true, recurring: false, attendee_count: 0, event_type: "default" }, tombstone: null, tombstone_complete: false };
}
function cancellation() {
  const input = target(); input.payload.mutation = "cancel"; delete input.payload.new_slot;
  const observed = read(input); observed.http_status = 404; observed.tombstone_complete = true;
  observed.tombstone = { ...observed.event!, status: "cancelled", slot: null }; observed.event = null;
  return { input, observed };
}
function context(input = target()): CalendarReconciliationContext {
  return { target: input, revision: "opaque-revision", resolved: false, readBlock: null,
    expectedJobUpdatedAt: "2026-11-17T12:56:00Z", expectedAppointmentUpdatedAt: "2026-11-17T10:00:00Z", expectedContactUpdatedAt: "2026-11-17T09:00:00Z", expectedConnectionUpdatedAt: "2026-11-17T12:00:00Z",
    review: { jobId: input.jobId, revision: "opaque-revision", provider: input.payload.provider, operation: input.payload.mutation, status: input.previousStatus, detail: "Read-only source check", sources: [] } };
}
const command: CalendarReconciliationCommand = { action: "reconcile_calendar_change", key: id(10), targetId: id(1), expectedRevision: "opaque-revision" };
const actor = { partnerId: id(20), clientId: id(21), actorId: id(22) };

test("two exact post-attempt observations verify source state while retaining the original uncertain result", () => {
  const input = target(), before = structuredClone(input);
  const evidence = evaluateCalendarReconciliation(input, [read(input), read(input)], now);
  assert.equal(evidence.state, "source_state_verified"); assert.equal(evidence.previous_status, "uncertain");
  assert.match(evidence.reason, /does not attribute/); assert.deepEqual(input, before);
  assert.equal("http_status" in evidence, false, "A source review must not invent the original write response");
  assert.equal(verifiedCalendarReconciliation(input, evidence, "2026-12-01T00:00:00Z"), true, "Recorded proof does not expire with its display age");
  assert.equal(verifiedCalendarReconciliation(input, evidence, "2026-11-17T12:59:00Z"), false);
});
test("acceptance alone, unchanged source, wrong account/event/slot, weak versions and disagreeing reads remain in review", () => {
  const input = target(), observed = read(input);
  const cases: CalendarReconciliationRead[][] = [[], [observed], [{ ...observed, http_status: 202 }, observed],
    [{ ...observed, account_id: "other-account" }, observed], [{ ...observed, event_id: "another-event" }, observed],
    [{ ...observed, event: { ...observed.event!, slot: input.payload.old_slot } }, observed],
    [{ ...observed, event: { ...observed.event!, etag: input.payload.source_etag } }, observed],
    [{ ...observed, event: { ...observed.event!, etag: 'W/"weak"' } }, observed],
    [observed, { ...observed, event: { ...observed.event!, etag: '"changed-again"' } }]];
  for (const observations of cases) assert.equal(evaluateCalendarReconciliation(input, observations, now).state, "needs_review");
});
test("a lone or repeated absence cannot prove cancellation without positive exact tombstones", () => {
  const { input, observed } = cancellation();
  assert.equal(evaluateCalendarReconciliation(input, [{ ...observed, tombstone: null }, { ...observed, tombstone: null }], now).state, "needs_review");
  assert.equal(evaluateCalendarReconciliation(input, [observed, { ...observed, tombstone_complete: false }], now).state, "needs_review");
  assert.equal(evaluateCalendarReconciliation(input, [observed, { ...observed, tombstone: { ...observed.tombstone!, id: "other-event" } }], now).state, "needs_review");
  assert.equal(evaluateCalendarReconciliation(input, [observed, observed], now).state, "source_state_verified");
});
test("missing, pre-attempt, stale and future clocks cannot become verified source evidence", () => {
  const input = target(), observed = read(input);
  for (const changed of [{ ...input, attemptedAt: null }, { ...input, bookingReceiptAt: null }, { ...input, attemptedAt: "2026-11-17T09:00:00Z" }])
    assert.equal(evaluateCalendarReconciliation(changed, [observed, observed], now).state, "needs_review");
  for (const changed of [{ ...observed, observed_at: "2026-11-17T12:54:00Z" }, { ...observed, observed_at: "2026-11-17T13:01:00Z" },
    { ...observed, event: { ...observed.event!, updated_at: "2026-11-17T12:54:00Z" } }, { ...observed, event: { ...observed.event!, updated_at: "2026-11-17T13:01:00Z" } }])
    assert.equal(evaluateCalendarReconciliation(input, [changed, observed], now).state, "needs_review");
});
test("stored proof is bound to exact job, approved source pins and previous status", () => {
  const input = target(), evidence = evaluateCalendarReconciliation(input, [read(), read()], now);
  for (const changed of [{ ...evidence, action_job_id: id(99) }, { ...evidence, calendar_account_id: "other" },
    { ...evidence, previous_status: "provider_pending" }, { ...evidence, old_slot: input.payload.new_slot }])
    assert.equal(verifiedCalendarReconciliation(input, changed, now), false);
  assert.equal(calendarReconciliationRevision({ b: 2, a: 1 }), calendarReconciliationRevision({ a: 1, b: 2 }));
});
test("read failures preserve partial evidence as review and never invoke any mutation capability", async () => {
  let reads = 0;
  const evidence = await observeCalendarReconciliation(target(), { now: () => now, session: async () => ({ read: async () => { if (++reads === 2) throw new Error("Provider unavailable"); return read(); } }) });
  assert.equal(reads, 2); assert.equal(evidence.state, "needs_review"); assert.equal(evidence.observations.length, 1);
  let opened = false;
  const unavailable = await observeCalendarReconciliation({ ...target(), attemptedAt: null }, { now: () => now, session: async () => { opened = true; throw new Error("Must not request a provider"); } });
  assert.equal(opened, false); assert.equal(unavailable.state, "needs_review");
});
test("the service saves correlated normalized evidence and source CAS pins without rewriting provider status", async () => {
  const input = context(), before = structuredClone(input), calls: { name: string; args: Record<string, unknown> }[] = [];
  const admin = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data: { id: id(30), actionJobId: id(1), bookingApprovalId: id(3), message: "Source state review saved.", replayed: false }, error: null }; },
    from: () => { throw new Error("Injected repository should not touch another database path"); } } as unknown as SupabaseClient;
  let reads = 0;
  const result = await reconcileCalendarChange(admin, actor, command, { now: () => now, load: async () => input, session: async () => ({ read: async () => { reads++; return read(); } }) });
  assert.equal(result.actionJobId, id(1)); assert.equal(reads, 2); assert.equal(calls[0].name, "reconcile_calendar_change");
  const saved = calls[0].args.p_command as Record<string, unknown>;
  assert.deepEqual(saved.owner_request, command); assert.equal(saved.expectedJobUpdatedAt, input.expectedJobUpdatedAt);
  assert.equal((saved.evidence as { state: string }).state, "source_state_verified");
  assert.equal("status" in saved, false); assert.deepEqual(input, before);
});
test("stale review, save failure or a mismatched receipt never claims saved reconciliation", async () => {
  let opened = 0;
  const input = context(), dependencies = { now: () => now, load: async () => input, session: async () => { opened++; return { read: async () => read() }; } };
  const admin = { rpc: async () => ({ data: null, error: { message: "Save unavailable" } }) } as unknown as SupabaseClient;
  await assert.rejects(reconcileCalendarChange(admin, actor, { ...command, expectedRevision: "stale" }, dependencies), /versions changed/); assert.equal(opened, 0);
  await assert.rejects(reconcileCalendarChange(admin, actor, command, dependencies), /Retry this unchanged request/);
  const wrong = { rpc: async () => ({ data: { id: id(30), actionJobId: id(99), bookingApprovalId: id(3), message: "Saved", replayed: false }, error: null }) } as unknown as SupabaseClient;
  await assert.rejects(reconcileCalendarChange(wrong, actor, command, dependencies), /correlated saved/);
  assert.equal(input.target.previousStatus, "uncertain");
});
test("changed native records need fresh explicit acceptance before source reads and preserve that exact request", async () => {
  const input = context(); input.review.requiresFreshReview = true;
  input.review.current = { start_iso: "2026-11-18T18:00:00Z", end_iso: "2026-11-18T19:00:00Z", label: "Current owner-edited time UTC" };
  input.review.currentStatus = "booked"; input.review.proposed = { ...input.target.payload.new_slot!, label: "Approved replacement UTC" };
  let opened = 0, saved: Record<string, unknown> | undefined;
  const admin = { rpc: async (_name: string, args: { p_command: Record<string, unknown> }) => { saved = args.p_command;
    return { data: { id: id(30), actionJobId: id(1), bookingApprovalId: id(3), message: "Reviewed source evidence saved.", replayed: false }, error: null }; } } as unknown as SupabaseClient;
  const dependencies = { now: () => now, load: async () => input, session: async () => { opened++; return { read: async () => read() }; } };
  await assert.rejects(reconcileCalendarChange(admin, actor, command, dependencies), /Explicitly review the current local appointment/);
  assert.equal(opened, 0);
  const accepted = { ...command, acceptReviewedSource: true as const };
  await reconcileCalendarChange(admin, actor, accepted, dependencies);
  assert.equal(opened, 1); assert.deepEqual(saved?.owner_request, accepted); assert.equal(saved?.acceptReviewedSource, true);
  assert.equal(saved?.expectedAppointmentUpdatedAt, input.expectedAppointmentUpdatedAt);
});
test("review loading scopes every source lookup and does not call a provider", async () => {
  const p = target().payload;
  const tables: Record<string, Record<string, unknown>[]> = {
    action_jobs: [{ id: id(1), approval_id: id(2), kind: "calendar.reschedule", status: "uncertain", payload: p, updated_at: now, last_attempt_at: target().attemptedAt },
      { id: id(4), approval_id: id(3), kind: "calendar.book", status: "succeeded", external_ref: p.external_ref, receipt_recorded_at: target().bookingReceiptAt }],
    approval_items: [{ id: id(2), type: "appointment_change", status: "approved", proposed_payload: p }, { id: id(3), type: "appointment_booking", status: "approved", proposed_payload: { provider: p.provider, calendar_connection_id: p.calendar_connection_id } }],
    crm_appointments: [{ id: id(5), approval_id: id(3), contact_id: id(6), external_ref: p.external_ref, status: "booked", start_at: p.old_slot.start_iso, end_at: p.old_slot.end_iso, updated_at: p.appointment_updated_at }], crm_contacts: [{ id: id(6), updated_at: p.contact_updated_at }],
    integration_connections: [{ id: id(7), status: "connected", external_account_id: p.calendar_account_id, updated_at: now, provider: { provider_key: p.provider } }],
  };
  const scoped: string[] = [];
  const admin = { from: (table: string) => {
    const filters: [string, unknown][] = [], builder = { select: () => builder, eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; },
      maybeSingle: async () => { assert.ok(filters.some(([key, value]) => key === "partner_id" && value === actor.partnerId)); assert.ok(filters.some(([key, value]) => key === "client_id" && value === actor.clientId)); scoped.push(table);
        return { data: tables[table].find((row) => filters.every(([key, value]) => ["partner_id", "client_id"].includes(key) || row[key] === value)) ?? null, error: null }; } }; return builder;
  } } as unknown as SupabaseClient;
  const review = await readCalendarReconciliationReview(admin, actor, id(1), now);
  assert.equal(review?.jobId, id(1)); assert.equal(review?.status, "uncertain"); assert.equal(scoped.length, 7);
});
