import assert from "node:assert/strict";
import test from "node:test";
import {
  applySamplePreviewAction,
  createSamplePreview,
  parseSamplePreviewHistory,
  sampleConversationSnapshot,
} from "../lib/business/sample-preview.ts";
import { buildDailyBrief } from "../lib/business/daily-brief.ts";
import { overlappingAppointments } from "../lib/business/morning-queue.ts";

test("sample booking explains the 2 PM conflict and safely adds the approved 2:30 slot", () => {
  const initial = createSamplePreview();
  const approval = initial.approvals.find((item) => item.id === "sample-jayden-booking")!;
  const requested = approval.proposed_payload!.requested_slot as { start_iso: string; end_iso: string };
  const preferred = approval.proposed_payload!.slot as { start_iso: string; end_iso: string };
  assert.deepEqual(overlappingAppointments(initial.appointments, requested).map((item) => item.id), ["sample-client-handoff"]);
  assert.equal(overlappingAppointments(initial.appointments, preferred).length, 0);

  const action = { approvalId: approval.id, resolution: "approve" as const, editedContent: approval.editable_content!, bookedSlot: preferred };
  const after = applySamplePreviewAction(initial, action);
  assert.equal(after.approvals.length, initial.approvals.length - 1);
  assert.equal(after.counts.approvals, initial.counts.approvals - 1);
  assert.equal(after.appointments.find((item) => item.id === "sample-jayden-confirmed")?.start_at, preferred.start_iso);
  assert.equal(after.connectedData?.appointments.some((item) => item.id === "sample-jayden-confirmed"), true);
  assert.equal(sampleConversationSnapshot(after).messages.some((item) => item.id === "sample-sent-sample-jayden-booking"), true);
  assert.equal(applySamplePreviewAction(after, action), after);
  assert.equal(buildDailyBrief(after).upcoming.some((item) => item.title === "Consultation with Jayden"), true);
});

test("sample actions can be restored from browser history without inventing account writes", () => {
  const action = { approvalId: "sample-task-review", resolution: "approve" as const, editedContent: "" };
  assert.deepEqual(parseSamplePreviewHistory(JSON.stringify([action])), [action]);
  assert.deepEqual(parseSamplePreviewHistory("invalid json"), []);
  const after = applySamplePreviewAction(createSamplePreview(), action);
  assert.equal(after.tasks.some((item) => item.id === "sample-task-brief"), false);
  assert.equal(after.counts.tasks, 1);
});
