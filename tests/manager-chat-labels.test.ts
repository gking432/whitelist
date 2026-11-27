import assert from "node:assert/strict";
import test from "node:test";
import { MANAGER_CHAT_COMMANDS, managerCommandLabel } from "../lib/agents/manager-command-labels.ts";

test("manager chat only lists commands issued from the conversation", () => {
  assert.deepEqual([...MANAGER_CHAT_COMMANDS].sort(), ["manager_control", "review_context", "set_authority"]);
});

test("manager command labels never render undefined values", () => {
  assert.equal(managerCommandLabel({ action: "set_authority", channel: "sms", mode: "require_approval" }), "Set text message authority to ask me first");
  assert.equal(managerCommandLabel({ action: "manager_control", command: "pause team" }), "pause team");
  assert.equal(managerCommandLabel({ action: "owner_onboarding", step: "done" }), "Owner instruction");
  assert.equal(managerCommandLabel({ action: "set_authority" }), "Owner instruction");
  assert.doesNotMatch(managerCommandLabel(null), /undefined/);
});
