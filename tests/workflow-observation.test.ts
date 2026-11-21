import test from "node:test";
import assert from "node:assert/strict";
import { attachObservationLineage, buildObservedLineage } from "../lib/business/observation.ts";
import { observeWaitingPoints, type RecordEvidence } from "../lib/business/context.ts";

const scope = { partnerId: "partner", clientId: "business" };
const row = (patch: Partial<RecordEvidence>): RecordEvidence => ({ partner_id: scope.partnerId, client_id: scope.clientId, id: "work", table: "agent_work_items", kind: "business_request", title: "Saved assignment", status: "waiting_approval", revision: 3, updated_at: "2026-11-15T12:00:00Z", ...patch });
test("observed process intervals come only from persisted scoped event identities", () => {
  const records = [row({}), row({ id: "event-two", table: "agent_work_events", source_record_id: "work", status: "waiting_approval", updated_at: "2026-11-15T11:00:00Z" }), row({ id: "event-one", table: "agent_work_events", source_record_id: "work", status: "running", updated_at: "2026-11-15T10:00:00Z" }), row({ id: "other-event", table: "agent_work_events", source_record_id: "different-work", status: "completed" })];
  const [trace] = buildObservedLineage(scope, records);
  assert.equal(trace.historyComplete, false);
  assert.deepEqual(trace.transitions.map((t) => t.source.id), ["event-one", "event-two"]);
  assert.equal(trace.transitions[0].observedMilliseconds, 3600000);
  assert.equal(trace.transitions[1].observedMilliseconds, null);
  assert.match(trace.limitation, /do not establish labor time/);
  const observations = attachObservationLineage(observeWaitingPoints(records, "2026-11-17T12:00:00Z"), [trace]);
  assert.deepEqual(observations[0].sources.map((s) => s.id), ["work", "event-two"]);
  assert.equal(observations[0].since, "2026-11-15T12:00:00Z");
});
test("snapshots without saved events never become invented history; mismatched and foreign evidence is rejected", () => {
  const [trace] = buildObservedLineage(scope, [row({})]);
  assert.deepEqual(trace.transitions, []);
  const records = [row({}), row({ id: "event", table: "agent_work_events", source_record_id: "work", status: "running", updated_at: "2026-11-15T10:00:00Z" })];
  const observations = observeWaitingPoints(records, "2026-11-17T12:00:00Z");
  assert.equal(attachObservationLineage(observations, buildObservedLineage(scope, records))[0].sources.length, 1);
  assert.throws(() => buildObservedLineage(scope, [row({ client_id: "other-business" })]), /does not belong/);
});
