import assert from "node:assert/strict";
import test from "node:test";
import { AssistantIntegrationSchema, WorkstationStatusResponseSchema, type AssistantSourceEvidence } from "../lib/personal-assistant/integration-contract.ts";

// Structural unit values only. These are not a customer timeline or integration fixture.
const scope = { partnerId: "11111111-1111-4111-8111-111111111111", clientId: "22222222-2222-4222-8222-222222222222" };
const checkedAt = "2026-11-21T12:00:00Z";
const source = (table: AssistantSourceEvidence["table"], id = "record-id"): AssistantSourceEvidence => ({ scope, table, id, revision: "record-revision", sourceUpdatedAt: null, checkedAt, freshness: "unknown" });
function missing() {
  return { version: 1, scope, checkedAt, customer: { source: source("crm_contacts"), identity: "unknown" }, quote: { state: "missing", reason: "not_checked" }, team: null,
    work: [], historyCoverage: "not_checked", replies: { state: "not_checked", sources: [], coverage: "unavailable" }, missing: ["quote", "team", "history", "replies"], actionBoundary: "existing_owner_approval_and_final_checks" };
}
function entry(state: string) {
  return { source: source("agent_work_items"), managerKey: "recorded-manager-key", state, scheduledFor: null, approval: null, effect: null, blockers: [] };
}
const approved = () => ({ source: source("approval_items", "approval-id"), status: "approved", decisionBy: "human" });

test("absent quote, team, history and reply evidence stay missing without invented records", () => {
  const value = missing(); assert.equal(WorkstationStatusResponseSchema.safeParse(value).success, true);
  assert.equal(WorkstationStatusResponseSchema.safeParse({ ...value, customer: null, missing: ["customer", ...value.missing] }).success, true);
  assert.equal(WorkstationStatusResponseSchema.safeParse({ ...value, customer: null }).success, false);
  for (const changed of [{ ...value, missing: [] }, { ...value, work: [entry("planned")] }, { ...value, replies: { state: "no_reply_in_checked_sources", sources: [], coverage: "bounded" } }])
    assert.equal(WorkstationStatusResponseSchema.safeParse(changed).success, false);
});

test("plans, pending decisions and approved future work cannot be substituted for send receipts", () => {
  const base = { ...missing(), historyCoverage: "bounded" };
  assert.equal(WorkstationStatusResponseSchema.safeParse({ ...base, work: [entry("planned")] }).success, true);
  const waiting = { ...entry("awaiting_approval"), approval: { source: source("approval_items"), status: "pending", decisionBy: "not_decided" } };
  assert.equal(WorkstationStatusResponseSchema.safeParse({ ...base, work: [waiting] }).success, true);
  const future = { ...entry("approved_future"), approval: approved(), scheduledFor: "2026-11-22T12:00:00Z", blockers: ["reply"] };
  const parsed = WorkstationStatusResponseSchema.parse({ ...base, work: [future] }); assert.deepEqual(parsed.work[0].blockers, ["reply"]);
  for (const invalid of [{ ...future, scheduledFor: checkedAt }, { ...future, approval: null }, { ...waiting, state: "sent" }, { ...future, state: "sent" }])
    assert.equal(WorkstationStatusResponseSchema.safeParse({ ...base, work: [invalid] }).success, false);
});

test("sent requires matching human approval and a succeeded external receipt, not dry run or acceptance", () => {
  const base = { ...missing(), historyCoverage: "bounded" };
  const sent = { ...entry("sent"), approval: approved(), effect: { source: source("action_jobs"), approvalId: "approval-id", status: "succeeded", providerRef: "recorded-external-reference", recordedAt: checkedAt } };
  assert.equal(WorkstationStatusResponseSchema.safeParse({ ...base, work: [sent] }).success, true);
  for (const effect of [{ ...sent.effect, status: "provider_pending" }, { ...sent.effect, status: "uncertain" }, { ...sent.effect, status: "dry_run" }, { ...sent.effect, providerRef: null }, { ...sent.effect, approvalId: "different-approval" }])
    assert.equal(WorkstationStatusResponseSchema.safeParse({ ...base, work: [{ ...sent, effect }] }).success, false);
  assert.equal(WorkstationStatusResponseSchema.safeParse({ ...base, work: [{ ...sent, approval: { ...approved(), decisionBy: "assistant" } }] }).success, false);
});

test("every nested evidence reference retains tenant scope, observation time and bounded provenance", () => {
  const base = { ...missing(), historyCoverage: "partial", work: [entry("planned")] };
  for (const changed of [{ ...source("agent_work_items"), scope: { ...scope, clientId: "33333333-3333-4333-8333-333333333333" } }, { ...source("agent_work_items"), checkedAt: "2026-11-22T12:00:00Z" }, { ...source("agent_work_items"), rawPayload: { secret: "not-allowed" } }])
    assert.equal(WorkstationStatusResponseSchema.safeParse({ ...base, work: [{ ...entry("planned"), source: changed }] }).success, false);
  assert.equal(WorkstationStatusResponseSchema.safeParse({ ...base, quote: { state: "recorded", source: source("business_records"), customerId: "different-customer", customerLink: source("integration_object_links"), status: "recorded" } }).success, false);
});

test("read coverage can report bounded silence while preserving partial freshness explicitly", () => {
  const parsed = WorkstationStatusResponseSchema.parse({ ...missing(), replies: { state: "no_reply_in_checked_sources", sources: [{ ...source("business_conversation_messages"), freshness: "partial" }], coverage: "partial" } });
  assert.equal(parsed.replies.coverage, "partial"); assert.equal(parsed.replies.sources[0].freshness, "partial");
  assert.equal(WorkstationStatusResponseSchema.safeParse({ ...missing(), replies: { state: "no_reply", sources: [], coverage: "complete" } }).success, false);
});

test("workstation access and embedded conversation are independent verified gates with no self approval", () => {
  const unverified = { state: "unverified", checkedAt: null, proofId: null };
  const value = { version: 1, identity: { kind: "existing_personal_assistant", label: "Owner-selected assistant", providerAssistantId: "verified-provider-assistant-id" },
    workstationAccess: { state: "verified", checkedAt, proofId: "scoped-connector-grant", scope, capabilities: ["read_customer_status"] }, inWorkstationConversation: unverified, selfApprovalAllowed: false };
  assert.equal(AssistantIntegrationSchema.safeParse(value).success, true);
  for (const changed of [{ ...value, selfApprovalAllowed: true }, { ...value, identity: { ...value.identity, providerAssistantId: null } },
    { ...value, workstationAccess: { ...value.workstationAccess, state: "revoked" } }, { ...value, workstationAccess: { ...value.workstationAccess, capabilities: ["approve_action"] } },
    { ...value, identity: { ...value.identity, kind: "external_shortcut" }, inWorkstationConversation: { state: "verified", checkedAt, proofId: "shortcut-is-not-chat" } }])
    assert.equal(AssistantIntegrationSchema.safeParse(changed).success, false);
});
