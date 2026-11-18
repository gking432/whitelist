import test from "node:test";
import assert from "node:assert/strict";
import { matchesMessageFilter } from "../lib/conversations/inbox-view.ts";
import type { Conversation } from "../lib/conversations/types.ts";
import { TODO_COMMAND } from "../lib/business/todo-mutations.ts";
import { isOwnerArea, OWNER_AREAS } from "../lib/business/owner-navigation.ts";

const conversation = (values: Partial<Conversation> = {}): Conversation => ({
  id: "thread",
  partner_id: "partner",
  client_id: "client",
  connection_id: "connection",
  channel: "email",
  external_thread_id: "external",
  contact_id: "contact",
  lead_id: null,
  identity_status: "unverified",
  mode: "agent",
  state: "open",
  agent_key: "sales_assistant",
  summary: "",
  next_action: "",
  opted_out: false,
  revision: 1,
  updated_at: "2026-10-31T12:00:00Z",
  ...values,
});

test("a closed human-handled conversation stays done rather than appearing as needing attention", () => {
  const thread = conversation({ state: "closed", mode: "human" });
  assert.equal(matchesMessageFilter(thread, "needs_me"), false);
  assert.equal(matchesMessageFilter(thread, "handling"), false);
  assert.equal(matchesMessageFilter(thread, "closed"), true);
});
test("pending approval and human handoff need the owner; an opted-out thread is not being handled by an agent", () => {
  for (const thread of [
    conversation({ state: "waiting_approval" }),
    conversation({ state: "needs_attention" }),
    conversation({ mode: "human" }),
  ]) {
    assert.equal(matchesMessageFilter(thread, "needs_me"), true);
    assert.equal(matchesMessageFilter(thread, "handling"), false);
  }
  assert.equal(matchesMessageFilter(conversation(), "handling"), true);
  assert.equal(
    matchesMessageFilter(conversation({ opted_out: true }), "handling"),
    false,
  );
});
test("task status changes require an optimistic concurrency token and reject browser-supplied scope", () => {
  const input = {
    action: "task_status",
    id: "00000000-0000-4000-8000-000000000001",
    status: "done",
    updatedAt: "2026-10-31T12:00:00+00:00",
  };
  assert.equal(TODO_COMMAND.safeParse(input).success, true);
  assert.equal(
    TODO_COMMAND.safeParse({ ...input, clientId: "another-client" }).success,
    false,
  );
  assert.equal(
    TODO_COMMAND.safeParse({ ...input, updatedAt: undefined }).success,
    false,
  );
});
test("seven owner areas keep stable navigation while self-contained mobile and CRM views retain their layouts", () => {
  assert.deepEqual(
    OWNER_AREAS.map((area) => area.label),
    ["Today", "Messages", "To-do", "Calendar", "Money", "Manager", "Apps"],
  );
  assert.equal(new Set(OWNER_AREAS.map((area) => area.href)).size, 7);
  for (const path of ["/client", "/client/todo", "/client/apps", "/client/calendar", "/client/money", "/client/business/business", "/client/business/approvals", "/client/onboarding"])
    assert.equal(isOwnerArea(path), true, path);
  for (const path of ["/client/mobile", "/client/crm", "/client/crm/contacts", "/partner", "/control", "/client-other", "https://external.invalid/client"])
    assert.equal(isOwnerArea(path), false, path);
  // Navigation remains a permission-filtered view; settings/schedule access
  // must not be invented for an owner with a smaller allowed section set.
  const allowed = new Set(["action-center", "automations", "tasks"]);
  assert.deepEqual(OWNER_AREAS.filter((area) => allowed.has(area.section)).map((area) => area.label), ["Today", "Messages", "To-do", "Manager"]);
  assert.equal(isOwnerArea("/client/conversations"), true);
  assert.equal(isOwnerArea("/client/crm"), false);
});
