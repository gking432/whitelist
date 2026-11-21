import test from "node:test";
import assert from "node:assert/strict";
import { firstOwnerSameOrigin, FirstOwnerValidationError, parseFirstOwnerRequest } from "../lib/auth/first-owner-rules.ts";
import { loadFirstOwnerEntry, provisionFirstOwner } from "../lib/auth/first-owner.ts";
import { toSafeNextPath } from "../lib/auth/redirects.ts";
const id = "21c6fc45-5219-405e-a92c-14f45ace9572";
const input = () => ({ key: id, business: { name: "  Synthetic business  ", description: "  A synthetic business for owner setup testing.  ", timezone: "America/Chicago" } });
type Client = Parameters<typeof loadFirstOwnerEntry>[0];
function client(result: unknown, error: { code?: string; message?: string } | null = null) {
  const calls: { name: string; args: unknown }[] = [];
  return { calls, value: { rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { data: result, error }; } } as unknown as Client };
}
test("first owner input trims bounded business declarations without accepting actor, scope, plan or authority fields", () => {
  assert.deepEqual(parseFirstOwnerRequest(input()), { key: id, business: { name: "Synthetic business", description: "A synthetic business for owner setup testing.", timezone: "America/Chicago" } });
  for (const change of [{ key: "invalid" }, { actor: id }, { business: { ...input().business, partnerId: id } }, { business: { ...input().business, timezone: "Invalid/Zone" } }, { business: { ...input().business, name: "x" } }, { business: { ...input().business, description: "too short" } }, { business: { ...input().business, name: "x".repeat(101) } }])
    assert.throws(() => parseFirstOwnerRequest({ ...input(), ...change }), FirstOwnerValidationError);
});
test("first owner POST origin must exactly match the canonical application origin", () => {
  assert.equal(firstOwnerSameOrigin("https://app.synthetic.invalid", "https://app.synthetic.invalid/start"), true);
  for (const origin of [null, "null", "https://other.synthetic.invalid", "http://app.synthetic.invalid", "https://app.synthetic.invalid.evil", "https://app.synthetic.invalid/path"])
    assert.equal(firstOwnerSameOrigin(origin, "https://app.synthetic.invalid"), false);
  assert.equal(firstOwnerSameOrigin("https://app.synthetic.invalid", "bad configuration"), false);
});
test("RPC entry state distinguishes configured new owner, existing access, setup requirement and revoked access", async () => {
  for (const result of [{ state: "new" }, { state: "existing", destination: "/client" }, { state: "blocked", reason: "Access was disabled." }, { state: "setup_required", reason: "The operator must configure a package." }]) {
    const fixture = client(result);
    assert.deepEqual(await loadFirstOwnerEntry(fixture.value), result);
    assert.deepEqual(fixture.calls, [{ name: "get_first_owner_entry", args: undefined }]);
  }
  for (const result of [null, { state: "existing", destination: "https://foreign.invalid" }, { state: "existing", destination: "/start" }, { state: "blocked" }, { state: "eligible" }])
    await assert.rejects(loadFirstOwnerEntry(client(result).value), /incomplete access/);
  await assert.rejects(loadFirstOwnerEntry(client(null, { message: "secret database detail" }).value), (error: Error) => !error.message.includes("secret"));
});
test("first owner provisioning passes only its idempotency key and declared fields to authenticated RPC", async () => {
  const receipt = { id, partnerId: id, clientId: id, destination: "/client/onboarding", replayed: false };
  const fixture = client(receipt);
  assert.deepEqual(await provisionFirstOwner(fixture.value, input()), receipt);
  assert.deepEqual(fixture.calls, [{ name: "provision_first_owner", args: { p_key: id, p_business: parseFirstOwnerRequest(input()).business } }]);
  const replay = client({ ...receipt, replayed: true });
  assert.equal((await provisionFirstOwner(replay.value, input())).replayed, true);
  const invalid = client(receipt);
  await assert.rejects(provisionFirstOwner(invalid.value, { ...input(), actor: id }), FirstOwnerValidationError);
  assert.equal(invalid.calls.length, 0);
});
test("capacity, changed membership and malformed results never become a successful workspace receipt", async () => {
  for (const code of ["P1001", "P1002"]) await assert.rejects(provisionFirstOwner(client(null, { code }).value, input()), /operator.*billing or capacity/);
  await assert.rejects(provisionFirstOwner(client(null, { code: "40001" }).value, input()), /access or setup may have changed/);
  for (const receipt of [null, { id, partnerId: id, clientId: id, destination: "/client/onboarding" }, { id, partnerId: id, clientId: id, destination: "https://foreign.invalid", replayed: false }])
    await assert.rejects(provisionFirstOwner(client(receipt).value, input()), /could not be verified/);
});
test("auth next paths retain local destinations and reject literal or encoded external redirects", () => {
  assert.equal(toSafeNextPath("/client?view=brief"), "/client?view=brief");
  assert.equal(toSafeNextPath(undefined), "/start");
  for (const value of ["//evil.invalid", "/\\evil.invalid", "/%5cevil.invalid", "/%2fevil.invalid", "/%255cevil.invalid", "/%252fevil.invalid", "/\n/evil.invalid", "https://evil.invalid", "/%00", "/%"])
    assert.equal(toSafeNextPath(value), "/start", value);
  assert.equal(toSafeNextPath(null, "https://evil.invalid"), "/start");
});
