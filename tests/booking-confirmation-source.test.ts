import test from "node:test";
import assert from "node:assert/strict";
import { bookingConfirmationBlock, confirmationContactSuppressed, type ConfirmationSource } from "../lib/scheduling/confirmation-rules.ts";
import { recoverBookingConfirmations } from "../lib/scheduling/confirmation-completion.ts";
import type { ActionJobRecord } from "../lib/jobs/record.ts";

const now = "2026-11-17T04:00:00Z";
function source(): ConfirmationSource {
  return { approvalStatus: "approved", receiptStatus: "succeeded", externalRef: "event-exact", receiptAt: "2026-11-17T03:50:00Z",
    startAt: "2026-11-18T15:00:00Z", endAt: "2026-11-18T16:00:00Z", internal: false, optedOut: false,
    native: { id: "native-exact", status: "booked", startAt: "2026-11-18T15:00:00Z", endAt: "2026-11-18T16:00:00Z" },
    imports: [{ externalId: "event-exact", accountBound: true, observedAt: "2026-11-17T03:55:00Z", deleted: false, status: "confirmed", startAt: "2026-11-18T15:00:00Z", endAt: "2026-11-18T16:00:00Z", nativeId: "native-exact" }] };
}
test("confirmation needs a durable successful booking and fresh exact source", () => {
  assert.equal(bookingConfirmationBlock(source(), now), null);
  for (const receiptStatus of ["processing", "dry_run", "provider_pending", "uncertain", "failed"])
    assert.match(bookingConfirmationBlock({ ...source(), receiptStatus }, now)!, /verified successful receipt/);
  assert.match(bookingConfirmationBlock({ ...source(), imports: [] }, now)!, /current calendar import/);
});
test("cancelled, deleted and rescheduled source appointments suppress confirmation", () => {
  for (const patch of [{ deleted: true }, { status: "cancelled" }, { startAt: "2026-11-18T16:00:00Z" }]) {
    const data = source(); Object.assign(data.imports[0], patch);
    assert.match(bookingConfirmationBlock(data, now)!, /cancelled|deleted|rescheduled/);
  }
  const changed = source(); changed.native!.status = "cancelled";
  assert.match(bookingConfirmationBlock(changed, now)!, /saved appointment/);
});
test("equal titles or slots cannot establish another account or event identity", () => {
  for (const patch of [{ accountBound: false }, { externalId: "another-event" }, { nativeId: "another-native" }]) {
    const data = source(); Object.assign(data.imports[0], patch);
    assert.match(bookingConfirmationBlock(data, now)!, /does not match/);
  }
});
test("old source observations, opt-outs, expired time and changed approvals stop sending", () => {
  const old = source(); old.imports[0].observedAt = "2026-11-17T03:40:00Z";
  assert.match(bookingConfirmationBlock(old, now)!, /predates/);
  const stale = source(); stale.receiptAt = "2026-11-17T02:00:00Z"; stale.imports[0].observedAt = "2026-11-17T02:01:00Z";
  assert.match(bookingConfirmationBlock(stale, now)!, /stale/);
  assert.match(bookingConfirmationBlock({ ...source(), optedOut: true }, now)!, /opted out/);
  assert.match(bookingConfirmationBlock({ ...source(), approvalStatus: "expired" }, now)!, /approval/);
  assert.match(bookingConfirmationBlock(source(), "2026-11-19T00:00:00Z")!, /passed/);
});
test("internal calendars use the exact native receipt without inventing an external connection", () => {
  assert.equal(bookingConfirmationBlock({ ...source(), internal: true, imports: [] }, now), null);
  assert.match(bookingConfirmationBlock({ ...source(), internal: true, native: null, imports: [] }, now)!, /internal booking receipt/);
});
test("worker recovery prepares only a marked successful booking's local follow-up, never another provider write", async () => {
  const jobs = [{ id: "saved-booking", kind: "calendar.book", status: "succeeded" }, { id: "uncertain-booking", kind: "calendar.book", status: "uncertain" }] as ActionJobRecord[];
  const prepared: string[] = [];
  assert.deepEqual(await recoverBookingConfirmations({ list: async () => jobs, prepare: async (job) => { prepared.push(job.id); }, failed: async () => { throw new Error("must not fail"); } }), { prepared: 1, failed: 0 });
  assert.deepEqual(prepared, ["saved-booking"]);
  assert.equal(jobs[0].status, "succeeded");
});
test("known suppression tag variants remain enforced for standalone confirmations", () => {
  for (const tag of ["do_not_contact", "Do Not Contact", "opt-out", "Opted Out", "unsubscribed", "STOP"])
    assert.equal(confirmationContactSuppressed([tag]), true);
  assert.equal(confirmationContactSuppressed(["customer"]), false);
});
