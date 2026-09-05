import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizedActionPayload,
  actionCanBeClaimed,
  type ApprovalSnapshot,
} from "../lib/jobs/execution-state.ts";
import { agencyLaunchSteps } from "../lib/partners/launch-guide.ts";

const job = {
  approval_id: "a",
  partner_id: "p",
  client_id: "c",
  kind: "sms.send",
};
const approved: ApprovalSnapshot = {
  id: "a",
  partner_id: "p",
  client_id: "c",
  status: "edited_and_approved",
  type: "customer_message",
  resolved_content: "Human edited text",
  proposed_payload: { channel: "sms", to: "+15555550123" },
};
test("delivery uses the human-approved text and recipient, never a stale retry payload", () => {
  assert.deepEqual(authorizedActionPayload(job, approved), {
    channel: "sms",
    to: "+15555550123",
    body: "Human edited text",
  });
});
test("pending, rejected, absent, cross-tenant and wrong-channel approvals cannot authorize delivery", () => {
  for (const approval of [
    null,
    { ...approved, status: "pending" },
    { ...approved, status: "rejected" },
    { ...approved, client_id: "other" },
    { ...approved, partner_id: "other" },
    { ...approved, id: "other" },
    { ...approved, resolved_content: null },
    { ...approved, proposed_payload: { channel: "email" } },
  ])
    assert.equal(authorizedActionPayload(job, approval), null);
});
test("a message approval cannot authorize calendar writes", () => {
  assert.equal(
    authorizedActionPayload({ ...job, kind: "calendar.book" }, approved),
    null,
  );
});
test("uncertain and in-progress delivery can never be retried, including manually", () => {
  for (const status of ["processing", "uncertain", "succeeded", "cancelled"]) {
    assert.equal(actionCanBeClaimed(status), false);
    assert.equal(actionCanBeClaimed(status, true), false);
  }
  assert.equal(actionCanBeClaimed("dry_run"), false);
  assert.equal(actionCanBeClaimed("dry_run", true), true);
});
test("agency guide points new partners to branding and existing partners to their actual client setup", () => {
  assert.equal(
    agencyLaunchSteps({
      branded: false,
      packageCount: 0,
      firstClient: null,
    }).find((step) => !step.done)?.href,
    "/partner/settings",
  );
  assert.equal(
    agencyLaunchSteps({
      branded: true,
      packageCount: 2,
      firstClient: { id: "client-1", name: "Example", live: false },
    }).find((step) => !step.done)?.href,
    "/partner/clients/client-1/setup",
  );
});
