import assert from "node:assert/strict";
import test from "node:test";
import {
  applySamplePreviewAction,
  applySamplePreviewEvent,
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

  const changedTime = { start_iso: "2027-02-26T21:00:00.000Z", end_iso: "2027-02-26T21:30:00.000Z" };
  const changed = applySamplePreviewAction(initial, { ...action, bookedSlot: changedTime });
  assert.equal(changed.work[0]?.title, "Booked Jayden at 3:00 PM (sample)");
  assert.equal(changed.appointments.find((item) => item.id === "sample-jayden-confirmed")?.start_at, changedTime.start_iso);
});

test("sample actions can be restored from browser history without inventing account writes", () => {
  const action = { approvalId: "sample-task-review", resolution: "approve" as const, editedContent: "" };
  assert.deepEqual(parseSamplePreviewHistory(JSON.stringify([action])), [action]);
  assert.deepEqual(parseSamplePreviewHistory("invalid json"), []);
  const after = applySamplePreviewAction(createSamplePreview(), action);
  assert.equal(after.tasks.some((item) => item.id === "sample-task-brief"), false);
  assert.equal(after.counts.tasks, 1);
});

test("calendar changes survive sample history and update both the decision pane and Calendar section", () => {
  const edit = {
    kind: "calendar_edit" as const,
    appointmentId: "sample-client-handoff",
    slot: { start_iso: "2027-02-26T21:30:00.000Z", end_iso: "2027-02-26T22:00:00.000Z" },
  };
  const restored = parseSamplePreviewHistory(JSON.stringify([edit]));
  assert.deepEqual(restored, [edit]);
  const after = restored.reduce(applySamplePreviewEvent, createSamplePreview());
  assert.equal(after.appointments.find((item) => item.id === edit.appointmentId)?.start_at, edit.slot.start_iso);
  assert.equal(after.connectedData?.appointments.find((item) => item.id === edit.appointmentId)?.startAt, edit.slot.start_iso);
  const requested = after.approvals.find((item) => item.id === "sample-jayden-booking")!.proposed_payload!.requested_slot as typeof edit.slot;
  assert.equal(overlappingAppointments(after.appointments, requested).length, 0);
  assert.deepEqual(parseSamplePreviewHistory(JSON.stringify([{ ...edit, slot: { start_iso: "bad", end_iso: "bad" } }])), []);
  assert.equal(applySamplePreviewEvent(after, { ...edit, appointmentId: "sample-does-not-exist" }), after);
});

test("changing Jayden’s accepted time sends an offer and waits for his reply instead of booking", () => {
  const initial = createSamplePreview();
  const offer = {
    approvalId: "sample-jayden-booking",
    resolution: "propose_time" as const,
    editedContent: "Hi Jayden, would Friday at 3:00 PM work instead? Please confirm.",
    proposedSlot: { start_iso: "2027-02-26T21:00:00.000Z", end_iso: "2027-02-26T21:30:00.000Z" },
  };
  assert.deepEqual(parseSamplePreviewHistory(JSON.stringify([offer])), [offer]);
  const after = applySamplePreviewAction(initial, offer);
  assert.equal(after.approvals.some((item) => item.id === offer.approvalId), false);
  assert.equal(after.appointments.some((item) => item.id === "sample-jayden-confirmed"), false);
  assert.equal(after.connectedData?.messages.find((item) => item.id === "sample-sent-sample-jayden-booking")?.preview, offer.editedContent);
  assert.equal(sampleConversationSnapshot(after).conversations.find((item) => item.id === "sample-conversation-jayden")?.state, "open");
  assert.match(sampleConversationSnapshot(after).conversations.find((item) => item.id === "sample-conversation-jayden")?.next_action ?? "", /Await Jayden/);
});
