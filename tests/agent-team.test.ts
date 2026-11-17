import test from "node:test";
import assert from "node:assert/strict";
import {
  leadIsStale,
  childWorkState,
  deliveryWorkState,
  purchaseWorkState,
} from "../lib/agents/rules.ts";

test("lead eligibility uses the latest known activity and only open sales stages", () => {
  const now = Date.parse("2026-10-03T12:00:00Z");
  const lead = {
    status: "new",
    created_at: "2026-10-01T12:00:00Z",
    updated_at: "2026-10-01T12:00:00Z",
    last_contact_at: null,
  };
  assert.equal(leadIsStale(lead, 24, now), true);
  for (const status of ["won", "lost", "scheduled"])
    assert.equal(leadIsStale({ ...lead, status }, 24, now), false);
  assert.equal(leadIsStale(lead, 24, now, "2026-10-03T11:00:00Z"), false);
  assert.equal(
    leadIsStale({ ...lead, last_contact_at: "2026-10-03T11:00:00Z" }, 24, now),
    false,
  );
  assert.equal(leadIsStale({ ...lead, updated_at: "invalid" }, 24, now), false);
});
test("approval, dry run, uncertainty, and failed delivery never count as completed follow-up", () => {
  for (const status of [
    undefined,
    "pending",
    "processing",
    "failed",
    "uncertain",
    "dry_run",
    "skipped",
    "cancelled",
  ])
    assert.notEqual(deliveryWorkState(status).status, "completed");
  assert.equal(deliveryWorkState("uncertain").status, "blocked");
  assert.equal(deliveryWorkState("failed", 5).status, "blocked");
  assert.equal(deliveryWorkState("cancelled").status, "cancelled");
  assert.equal(deliveryWorkState("succeeded").status, "completed");
  assert.match(
    deliveryWorkState("succeeded").summary,
    /does not establish recipient delivery/,
  );
});
test("purchasing waits for recorded receipt and distinguishes rejection", () => {
  assert.equal(purchaseWorkState("needs_approval").status, "waiting_approval");
  assert.equal(purchaseWorkState("approved").status, "waiting_external");
  assert.match(
    purchaseWorkState("approved").summary,
    /place the supplier order/,
  );
  assert.equal(purchaseWorkState("ordered").status, "waiting_external");
  assert.equal(purchaseWorkState("received").status, "completed");
  assert.equal(purchaseWorkState("rejected").status, "cancelled");
});
test("managers continue watching blocked children and observe eventual recovery", () => {
  assert.equal(
    childWorkState(["completed", "blocked"]).status,
    "waiting_children",
  );
  assert.match(
    childWorkState(["completed", "blocked"]).summary,
    /1 need attention/,
  );
  assert.equal(
    childWorkState(["completed", "waiting_approval"]).status,
    "waiting_children",
  );
  assert.equal(childWorkState(["completed", "completed"]).status, "completed");
});
