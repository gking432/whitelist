import assert from "node:assert/strict";
import test from "node:test";
import { isLeadFollowUp, leadFollowUpContext, quietFor, splitLeadFollowUps } from "../lib/business/lead-followups.ts";
import { applySamplePreviewAction, createSamplePreview, sampleConversationSnapshot } from "../lib/business/sample-preview.ts";
import { buildDailyBrief } from "../lib/business/daily-brief.ts";

const base = { id: "a", title: "Follow up: Quote request", summary: "", created_at: "2027-02-24T10:00:00.000Z", type: "customer_message", editable_content: "Hi" };

test("only agent-prepared messages outside a conversation are background follow-ups", () => {
  assert.equal(isLeadFollowUp({ ...base, proposed_payload: { agent_work_id: "w", to: "x@example.test", channel: "email" } }), true);
  assert.equal(isLeadFollowUp({ ...base, proposed_payload: { agent_work_id: "w", conversation_id: "c" } }), false, "conversation replies stay in their thread");
  assert.equal(isLeadFollowUp({ ...base, proposed_payload: { to: "x@example.test" } }), false, "a person-written message is not agent outreach");
  assert.equal(isLeadFollowUp({ ...base, type: "appointment_booking", proposed_payload: { agent_work_id: "w" } }), false);
  const { followUps, other } = splitLeadFollowUps([
    { ...base, id: "1", proposed_payload: { agent_work_id: "w1" } },
    { ...base, id: "2", proposed_payload: { conversation_id: "c", agent_work_id: "w2" } },
  ]);
  assert.deepEqual([followUps.map((item) => item.id), other.map((item) => item.id)], [["1"], ["2"]]);
});

test("follow-up context prefers the lead's own facts and never shows raw titles as names", () => {
  const context = leadFollowUpContext({ ...base, proposed_payload: { agent_work_id: "w", to: "x@example.test", channel: "sms", subject: "Hi",
    lead_context: { name: "Karen Liu", stage: "new", reason: "Quiet since Oct 28.", history: "Asked about repairs.", last_contact_at: "2026-10-28T00:00:00.000Z" } } });
  assert.equal(context.name, "Karen Liu");
  assert.equal(context.channel, "sms");
  assert.equal(context.reason, "Quiet since Oct 28.");
  assert.equal(leadFollowUpContext({ ...base, proposed_payload: { agent_work_id: "w" } }).name, "Quote request");
});

test("quiet-period wording stays readable and refuses impossible dates", () => {
  const now = "2027-02-24T15:00:00.000Z";
  assert.equal(quietFor("2027-02-20T15:00:00.000Z", now), "Quiet for 4 days");
  assert.equal(quietFor("2026-12-16T15:00:00.000Z", now), "Quiet for 10 weeks");
  assert.equal(quietFor("2026-06-12T15:00:00.000Z", now), "Quiet for 9 months");
  assert.equal(quietFor("2027-03-01T15:00:00.000Z", now), null);
  assert.equal(quietFor(null, now), null);
});

test("the sample's warm-lead drafts are one decision and sending one never touches another customer's thread", () => {
  const initial = createSamplePreview();
  const followUps = splitLeadFollowUps(initial.approvals).followUps;
  assert.equal(followUps.length, 4);
  const individual = initial.approvals.length - followUps.length;
  assert.equal(buildDailyBrief(initial).decisions, individual + 1);

  const priya = followUps.find((item) => item.id === "sample-followup-priya")!;
  const after = applySamplePreviewAction(initial, { approvalId: priya.id, resolution: "approve", editedContent: "Hi Priya, edited." });
  assert.equal(after.approvals.some((item) => item.id === priya.id), false);
  assert.equal(after.work[0]?.title, "Sent follow-up to Priya Shah (sample)");
  assert.equal(after.connectedData?.messages.at(-1)?.subject, "Your logo refresh quote");
  assert.equal(after.connectedData?.messages.at(-1)?.preview, "Hi Priya, edited.");
  const jamieThread = sampleConversationSnapshot(after).messages.filter((item) => item.conversation_id === "sample-conversation-jamie");
  assert.equal(jamieThread.some((item) => item.body === "Hi Priya, edited."), false);

  const skipped = applySamplePreviewAction(initial, { approvalId: "sample-followup-tom", resolution: "reject", editedContent: "" });
  assert.equal(skipped.work[0]?.title, "Skipped follow-up to Tom Becker (sample)");
  assert.equal(skipped.connectedData?.messages.length, initial.connectedData?.messages.length);
});
