import test from "node:test";
import assert from "node:assert/strict";
import { prepareBookingFollowup, recoverBookingLifecycle, type BookingLifecycleRepository } from "../lib/scheduling/lifecycle-service.ts";
import type { BookingLifecyclePin } from "../lib/scheduling/lifecycle-rules.ts";
import type { ActionJobRecord } from "../lib/jobs/record.ts";

const job = { id: "receipt", partner_id: "partner", client_id: "client", kind: "calendar.book", status: "succeeded", approval_id: "approval" } as ActionJobRecord;

test("early reminder preparation performs no approval or provider write", async () => {
  let writes = 0;
  const repository: BookingLifecycleRepository = { inspect: async () => ({ state: "not_due", reason: "Not due", nextDueAt: "2026-11-18T12:00:00Z" }),
    prepare: async () => { writes++; throw new Error("Must not prepare before due"); } };
  const result = await prepareBookingFollowup(repository, job, "reminder", "2026-11-17T12:00:00Z");
  assert.equal(result.state, "not_due"); assert.equal(writes, 0); assert.equal(job.status, "succeeded");
});

test("receipt preparation rejects uncertain bookings and requires a confirmed persisted proposal", async () => {
  let inspections = 0;
  const repository: BookingLifecycleRepository = { inspect: async () => { inspections++; return { state: "ready", pin: {} as BookingLifecyclePin }; },
    prepare: async () => ({ state: "queued", approvalId: null }) };
  assert.equal((await prepareBookingFollowup(repository, { ...job, status: "uncertain" }, "confirmation", "2026-11-17T12:00:00Z")).state, "blocked");
  assert.equal(inspections, 0);
  await assert.rejects(prepareBookingFollowup(repository, job, "confirmation", "2026-11-17T12:00:00Z"), /successful booking is unchanged/);
  assert.equal(job.status, "succeeded");
});

test("recovery records separate downstream failures and never retries a durable calendar write", async () => {
  const jobs = [job, { ...job, id: "already", status: "succeeded" }, { ...job, id: "wait" }, { ...job, id: "blocked" },
    { ...job, id: "error" }, { ...job, id: "uncertain", status: "uncertain" }];
  const retries: { id: string; nextDueAt?: string }[] = [], inspected: string[] = [];
  const result = await recoverBookingLifecycle({ now: () => "2026-11-17T12:00:00Z", list: async () => jobs,
    prepare: async (record) => { inspected.push(record.id);
      if (record.id === "error") throw new Error("Source refresh unavailable");
      if (record.id === "wait") return { state: "not_due", approvalId: null, reason: "Not due", nextDueAt: "2026-11-18T12:00:00Z" };
      if (record.id === "blocked") return { state: "blocked", approvalId: null, reason: "Customer replied" };
      return { state: record.id === "already" ? "existing" : "queued", approvalId: "proposal" }; },
    retry: async (record, _reason, nextDueAt) => { retries.push({ id: record.id, nextDueAt }); } });
  assert.deepEqual(result, { prepared: 2, waiting: 1, blocked: 1, failed: 1 });
  assert.equal(inspected.includes("uncertain"), false);
  assert.deepEqual(retries, [{ id: "wait", nextDueAt: "2026-11-18T12:00:00Z" }, { id: "blocked", nextDueAt: undefined }, { id: "error", nextDueAt: undefined }]);
  assert.equal(jobs.every((record) => record.id === "uncertain" || record.status === "succeeded"), true);
});
