// Synthetic source records and an explicitly configured test operator only.
// Owners, their business and their sessions are created through the real UI.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export function browserFixtureIdentity(runId) {
  if (!/^[a-f0-9]{12}$/.test(runId)) throw new Error("Invalid browser fixture tag.");
  const prefix = `owner-browser-${runId}`;
  return { prefix, partnerId: randomUUID(), packageId: randomUUID(), owners: ["desktop", "phone"].map((label) => ({ label, email: `${prefix}-${label}@example.test`, name: `${prefix} ${label}`, marker: `${prefix}-${label}-source` })) };
}
async function inserted(admin, table, values) {
  const result = await admin.from(table).insert(values);
  if (result.error) throw new Error(`Synthetic browser fixture ${table} could not be saved (${result.error.code || "database error"}).`);
}
export async function assertEmptyBrowserTarget(admin) {
  for (const table of ["partners", "client_businesses", "first_owner_signup_configuration"]) {
    const result = await admin.from(table).select(table === "first_owner_signup_configuration" ? "singleton" : "id", { count: "exact", head: true });
    if (result.error || result.count !== 0) throw new Error("The browser target contains existing tenant rows or cannot be verified empty. Nothing was seeded.");
  }
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (users.error || users.data.users.length) throw new Error("The browser target contains existing identities. Nothing was seeded.");
  const marker = await admin.from("platform_schema_state").select("current_migration").eq("singleton", true).single();
  if (marker.error || marker.data?.current_migration !== "20261118170156_owner_rpc_conflict_response") throw new Error("The owner workspace migration is not applied to the API-backed database.");
}
export async function prepareBrowserCatalog(admin, fixture) {
  await inserted(admin, "partners", { id: fixture.partnerId, name: `${fixture.prefix} synthetic CI operator`, slug: fixture.prefix, status: "active", plan_key: "partner_v1", is_test_account: true });
  await inserted(admin, "partner_packages", { id: fixture.packageId, partner_id: fixture.partnerId, name: `${fixture.prefix} synthetic shared package`, description: "Disposable browser acceptance catalog; no billing or provider entitlement is manufactured.", capabilities: {}, is_archived: false });
  const configured = await admin.rpc("configure_first_owner_signup", { p_partner: fixture.partnerId, p_package: fixture.packageId, p_enabled: true });
  if (configured.error) throw new Error("The explicit synthetic operator/package could not be configured for browser acceptance.");
}
export async function readCreatedOwner(admin, fixture, owner) {
  const identities = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (identities.error) throw new Error("The browser-created identity could not be checked.");
  const user = identities.data.users.find((candidate) => candidate.email === owner.email);
  assert.ok(user?.id, "The normal login must create and verify the synthetic owner identity.");
  const membership = await admin.from("memberships").select("id,partner_id,client_id,role,status").eq("user_id", user.id);
  if (membership.error || membership.data.length !== 1) throw new Error("A first owner must have exactly one scoped membership.");
  const entry = membership.data[0];
  assert.equal(entry.partner_id, fixture.partnerId); assert.equal(entry.role, "client_owner"); assert.equal(entry.status, "active");
  const business = await admin.from("client_businesses").select("id,name,partner_id,default_runtime_mode,is_test_account,account_kind").eq("id", entry.client_id).eq("partner_id", fixture.partnerId).single();
  if (business.error) throw new Error("The visibly created business could not be verified.");
  assert.equal(business.data.name, owner.name); assert.equal(business.data.default_runtime_mode, "sandbox"); assert.equal(business.data.is_test_account, false); assert.equal(business.data.account_kind, "managed_client");
  const receipt = await admin.from("first_owner_workspaces").select("id,client_id").eq("user_id", user.id).single();
  const team = await admin.from("agent_team_settings").select("status,channel_authority").eq("partner_id", fixture.partnerId).eq("client_id", entry.client_id).single();
  if (receipt.error || team.error) throw new Error("The genuine first-owner receipt and paused authority could not be checked.");
  assert.equal(receipt.data.client_id, business.data.id); assert.equal(team.data.status, "paused");
  assert.ok(Object.values(team.data.channel_authority).every((value) => value === "off"));
  const beta = await admin.from("client_beta_acceptances").select("client_id", { count: "exact", head: true }).eq("partner_id", fixture.partnerId).eq("client_id", entry.client_id);
  if (beta.error) throw new Error("First-owner beta state could not be verified.");
  assert.equal(beta.count, 0, "Creating an owner workspace must not manufacture launch acceptance.");
  return { ...owner, userId: user.id, membershipId: entry.id, clientId: business.data.id, receiptId: receipt.data.id };
}
export async function cleanupBrowserFixtures(admin, fixture) {
  const errors = [];
  const clean = async (name, action) => { try { const result = await action(); if (result?.error) throw new Error(result.error.code || "database error"); } catch { errors.push(name); } };
  // Every delete is pinned to identifiers created by this run. No table reset.
  await clean("signup configuration", () => admin.from("first_owner_signup_configuration").delete().eq("singleton", true).eq("partner_id", fixture.partnerId));
  await clean("synthetic operator/catalog/businesses", () => admin.from("partners").delete().eq("id", fixture.partnerId).eq("slug", fixture.prefix));
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (users.error) errors.push("synthetic identities lookup");
  else for (const owner of fixture.owners) for (const user of users.data.users.filter((candidate) => candidate.email === owner.email)) await clean("synthetic identity", () => admin.auth.admin.deleteUser(user.id));
  if (errors.length) throw new Error(`Browser fixture cleanup incomplete: ${errors.join(", ")}. No unrelated rows were deleted.`);
  await assertEmptyBrowserTarget(admin);
  return 0;
}
