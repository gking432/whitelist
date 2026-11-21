import test from "node:test";
import assert from "node:assert/strict";
import { readCurrentServerUser } from "../lib/auth/session-check.ts";
const id = "21c6fc45-5219-405e-a92c-14f45ace9572", user = { id, email: "synthetic@invalid" };
type Client = Parameters<typeof readCurrentServerUser>[0];
function fixture(actor: unknown = id, rpcError: unknown = null, authUser: unknown = user, authError: unknown = null, transportFailure = false) {
  const calls: string[] = [];
  return { calls, client: { auth: { getUser: async () => { calls.push("fresh Auth user"); return { data: { user: authUser }, error: authError }; } }, rpc: async (name: string) => { calls.push(name); if (transportFailure) throw new Error("network detail"); return { data: actor, error: rpcError }; } } as unknown as Client };
}
test("server identity requires both fresh Auth validation and the same active session actor", async () => {
  const f = fixture();
  assert.deepEqual(await readCurrentServerUser(f.client), { user, error: null });
  assert.deepEqual(f.calls, ["fresh Auth user", "current_session_actor"]);
});
test("an old JWT accepted by Auth never restores server access after the session row is gone", async () => {
  for (const actor of [null, "different-user", { id }, [id], true]) {
    const result = await readCurrentServerUser(fixture(actor).client);
    assert.equal(result.user, null); assert.match(result.error!, /session has ended or could not be verified/);
  }
});
test("Auth absence and errors stop before session lookup, while session RPC errors fail closed", async () => {
  for (const auth of [{ user: null, error: null }, { user, error: new Error("secret upstream detail") }]) {
    const f = fixture(id, null, auth.user, auth.error), result = await readCurrentServerUser(f.client);
    assert.equal(result.user, null); assert.equal(f.calls.length, 1); assert.equal(result.error?.includes("secret") ?? false, false);
  }
  const result = await readCurrentServerUser(fixture(id, { message: "secret database detail" }).client);
  assert.equal(result.user, null); assert.equal(result.error?.includes("secret") ?? false, false);
});
test("active legacy users need an active session, without adding first-owner email requirements", async () => {
  const legacy = { id, email: "", email_confirmed_at: null, app_metadata: {} };
  assert.deepEqual(await readCurrentServerUser(fixture(id, null, legacy).client), { user: legacy, error: null });
});
test("transport exceptions never expose a stale cached user", async () => {
  const f = fixture(id, null, user, null, true);
  assert.equal((await readCurrentServerUser(f.client)).user, null);
});
