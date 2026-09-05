import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { findVerifiedInvitationIdentity } from "../lib/auth/invitation-identity.ts";
import { filterClientCrmData } from "../lib/crm/permission-filter.ts";
import type { NorthstarCrmData } from "../lib/crm/operating-suite.ts";

function auth(users: Partial<User>[]) {
  return { auth: { admin: { listUsers: async () => ({ data: { users }, error: null }) } } } as unknown as SupabaseClient;
}

test("invitation authority uses exact verified Auth email, not display metadata or wildcard matching", async () => {
  const client = auth([{ id: "attacker", email: "attacker@example.invalid", email_confirmed_at: "2026-01-01", user_metadata: { email: "owner@example.invalid" } }]);
  assert.equal(await findVerifiedInvitationIdentity(client, "owner@example.invalid"), null);
  assert.equal(await findVerifiedInvitationIdentity(client, "%@example.invalid"), null);
  assert.equal((await findVerifiedInvitationIdentity(client, " ATTACKER@example.invalid "))?.id, "attacker");
});

test("unconfirmed Auth identities never acquire access through an existing-account shortcut", async () => {
  await assert.rejects(findVerifiedInvitationIdentity(auth([{ id: "pending", email: "owner@example.invalid" }]), "owner@example.invalid"), /unconfirmed/);
});

test("overview payload contains no hidden employee datasets and does not mutate source data", () => {
  const sensitive = [{ private: "customer information" }];
  const data = Object.fromEntries(["contacts","leads","tasks","timeline","communications","appointments","availability","calls","transcriptTurns","quotes","feedback","campaigns","connections","workflows","workflowRuns","integrationEvents","teamMembers"].map((key) => [key,sensitive])) as unknown as NorthstarCrmData;
  data.client = null; data.pendingApprovals = 9; data.escalationRules = "private instructions";
  const filtered = filterClientCrmData(data, ["overview"]);
  for (const value of Object.values(filtered)) if (Array.isArray(value)) assert.equal(value.length, 0);
  assert.equal(filtered.pendingApprovals, 0);
  assert.equal(filtered.escalationRules, null);
  assert.equal(data.contacts, sensitive);
  const calls = filterClientCrmData(data, ["calls"]);
  assert.equal(calls.calls, sensitive);
  assert.equal(calls.transcriptTurns, sensitive);
  assert.deepEqual(calls.contacts, []);
  assert.deepEqual(filterClientCrmData(data, ["settings"]).teamMembers, []);
});
