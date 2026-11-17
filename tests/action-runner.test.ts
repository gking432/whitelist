import assert from "node:assert/strict";
import test from "node:test";
import { drainActionJobs, dispatchClaimedAction } from "../lib/jobs/runner-core.ts";
import type { ActionJobRecord } from "../lib/jobs/record.ts";
import type { DeliveryOutcome } from "../lib/delivery/customer-message.ts";
import { effectiveAuthoritySnapshot, evaluateAuthority } from "../lib/agents/authority.ts";
const now = new Date("2026-11-17T02:00:00Z");
function job(id: string, status = "pending", last_attempt_at: string | null = null): ActionJobRecord {
  return { id, status, last_attempt_at, attempt_count: 1, partner_id: "p", client_id: "c", connection_id: null, approval_id: "a", workflow_run_id: null, kind: "email.send", payload: {}, last_error: null, created_at: now.toISOString() };
}
const outcome = (status: DeliveryOutcome["status"]): DeliveryOutcome => ({ status, attempted: status !== "skipped", delivered: status === "succeeded", detail: status });
test("confirmation preparation runs after receipt commit and cannot undo a successful booking", async () => {
  const order: string[] = [];
  const result = await dispatchClaimedAction({ ...job("booking"), kind: "calendar.book" }, {
    now: () => now, token: () => "claim", claim: async (row) => row,
    execute: async () => { order.push("provider"); return { ...outcome("succeeded"), externalRef: "event-verified" }; },
    complete: async () => { order.push("receipt-committed"); return true; },
    afterComplete: async () => { order.push("confirmation"); throw new Error("proposal store unavailable"); },
  });
  assert.deepEqual(order, ["provider", "receipt-committed", "confirmation"]);
  assert.equal(result?.status, "succeeded");
  assert.equal(result?.externalRef, "event-verified");
});
test("a lost receipt completion claim never prepares a confirmation", async () => {
  let prepared = false;
  await assert.rejects(dispatchClaimedAction(job("lost"), {
    now: () => now, token: () => "claim", claim: async (row) => row,
    execute: async () => outcome("succeeded"), complete: async () => false,
    afterComplete: async () => { prepared = true; },
  }), /completion claim was lost/);
  assert.equal(prepared, false);
});
test("backoff candidates cannot starve a due job beyond the initial limit", async () => {
  const jobs = [job("wait-1", "failed", now.toISOString()), job("wait-2", "failed", now.toISOString()), job("due", "failed", "2026-11-17T01:00:00Z")];
  const sent: string[] = [];
  const result = await drainActionJobs({ now: () => now, page: async (offset, size) => jobs.slice(offset, offset + size), dispatch: async (candidate) => { sent.push(candidate.id); return outcome("succeeded"); } }, 2);
  assert.deepEqual(sent, ["due"]);
  assert.equal(result.scanned, 3);
  assert.equal(result.waiting, 2);
  assert.equal(result.succeeded, 1);
});
test("only confirmed success increments successes; every other outcome remains distinct", async () => {
  const statuses: DeliveryOutcome["status"][] = ["succeeded", "skipped", "dry_run", "failed", "uncertain", "provider_pending"];
  const result = await drainActionJobs({ now: () => now, page: async (offset, size) => statuses.map((_, i) => job(String(i))).slice(offset, offset + size), dispatch: async (candidate) => outcome(statuses[Number(candidate.id)]) }, 10);
  assert.deepEqual(result, { scanned: 6, attempted: 6, succeeded: 1, failed: 1, waiting: 1, skipped: 1, dryRun: 1, uncertain: 1 });
});
test("losing a compare-and-swap claim prevents execution", async () => {
  let calls = 0;
  const result = await dispatchClaimedAction(job("a"), { now: () => now, token: () => "claim", claim: async () => null, execute: async () => { calls++; return outcome("succeeded"); }, complete: async () => true });
  assert.equal(result, null);
  assert.equal(calls, 0);
});
test("lost completion claims are reported even when the provider succeeded", async () => {
  let calls = 0;
  await assert.rejects(dispatchClaimedAction(job("a"), { now: () => now, token: () => "claim", claim: async (candidate) => candidate, execute: async () => { calls++; return outcome("succeeded"); }, complete: async () => false }), /completion claim was lost.*Do not resend/);
  assert.equal(calls, 1);
});
test("an interrupted provider call is saved as uncertain and never automatically reclaimed", async () => {
  let saved: DeliveryOutcome | undefined;
  await dispatchClaimedAction(job("a"), { now: () => now, token: () => "claim", claim: async (candidate) => candidate, execute: async () => { throw new Error("network interrupted"); }, complete: async (_id, _claim, result) => { saved = result; return true; } });
  assert.equal(saved?.status, "uncertain");
  const result = await dispatchClaimedAction(job("a", "uncertain"), { now: () => now, token: () => "claim", claim: async () => { throw new Error("must not reclaim"); }, execute: async () => outcome("succeeded"), complete: async () => true });
  assert.equal(result, null);
});
test("a stop after approval suppresses delivery through the durable dispatcher", async () => {
  const approved = { ...job("approved-unsent"), payload: { authority_revision: 1 } };
  let providerCalls = 0;
  let saved: DeliveryOutcome | undefined;
  const result = await drainActionJobs({
    now: () => now,
    page: async (offset) => offset ? [] : [approved],
    dispatch: (candidate) => dispatchClaimedAction(candidate, {
      now: () => now, token: () => "claim",
      claim: async (row) => row,
      execute: async (row) => {
        const authority = effectiveAuthoritySnapshot({ status: "active", authority_revision: 2,
          conversations_enabled: true, channel_authority: { email: "off" } }, null, []);
        const check = evaluateAuthority({ authority, channel: "email", phase: "execute",
          approved: true, expectedRevision: Number(row.payload.authority_revision) });
        if (!check.allowed) return { attempted: false, delivered: false, status: "skipped", detail: check.reason };
        providerCalls++;
        return outcome("succeeded");
      },
      complete: async (_id, _claim, recorded) => { saved = recorded; return true; },
    }),
  });
  assert.equal(providerCalls, 0);
  assert.equal(saved?.status, "skipped");
  assert.equal(result.succeeded, 0);
  assert.equal(result.skipped, 1);
});
