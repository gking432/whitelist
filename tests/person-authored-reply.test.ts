import assert from "node:assert/strict";
import test from "node:test";
import { isPersonAuthoredReply } from "../lib/agents/person-authored.ts";

const base = { kind: "conversation.send", approval_id: "a", payload: { human_authored: true, agent_work_id: null } } as const;

test("only an approved, person-written conversation reply skips agent channel authority", () => {
  assert.equal(isPersonAuthoredReply(base as never), true);
  assert.equal(isPersonAuthoredReply({ ...base, payload: { human_authored: true, agent_work_id: "w" } } as never), false);
  assert.equal(isPersonAuthoredReply({ ...base, payload: { human_authored: false, agent_work_id: null } } as never), false);
  assert.equal(isPersonAuthoredReply({ ...base, approval_id: null } as never), false);
  assert.equal(isPersonAuthoredReply({ ...base, kind: "sms.send" } as never), false);
  assert.equal(isPersonAuthoredReply({ ...base, kind: "calendar.book" } as never), false);
});
