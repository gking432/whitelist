import test from "node:test";
import assert from "node:assert/strict";
import { completeHubSpotOAuthAttempt, hubSpotOAuthSelection, loadHubSpotOAuthCredentialsFromStore, readHubSpotOAuthState, signHubSpotOAuthState,
  type HubSpotCompletionStore, type HubSpotCredentialSnapshot, type HubSpotRefreshStore } from "../lib/connections/hubspot-oauth.ts";
import { HubSpotOAuthError, hubspotOAuthScopes, type HubSpotOAuthCredentials } from "../lib/integrations/providers/hubspot-oauth.ts";

const now = "2026-11-18T12:00:00Z", id = "b6fbd167-7ff2-42e0-8b71-6765df30b4bf", otherId = "9bb039fe-2281-45b3-a931-18519211426f";
const client = { clientId: "client-fixture", clientSecret: "secret-fixture", redirectUri: "https://app.synthetic.invalid/api/oauth/hubspot/callback" };
const state = { provider: "hubspot" as const, attemptId: id, connectionId: otherId };
const actor = { partnerId: id, clientId: otherId, actorId: id, state, cookie: "browser-fixture", code: "code-fixture", denied: false };
function credentials(expiresAt = "2026-11-18T11:59:00Z"): HubSpotOAuthCredentials {
  return { authType: "oauth", clientId: client.clientId, accessToken: "access-fixture", refreshToken: "refresh-fixture", accountId: "12345", userId: "77", appId: "88",
    accountName: "hub.synthetic.invalid", scopes: hubspotOAuthScopes([]), permissions: [], accessMode: "read_only", expiresAt, grantRevision: id };
}
test("signed provider state rejects tampering, cross-provider payloads and incomplete bindings", () => {
  const signed = signHubSpotOAuthState(state, "state-secret-fixture");
  assert.deepEqual(readHubSpotOAuthState(signed, "state-secret-fixture"), state);
  assert.equal(readHubSpotOAuthState(signed, "wrong-state-secret"), null);
  assert.equal(readHubSpotOAuthState(signed + ".extra", "state-secret-fixture"), null);
  assert.equal(readHubSpotOAuthState(signed.replace(/^./, "x"), "state-secret-fixture"), null);
  assert.throws(() => signHubSpotOAuthState({ ...state, provider: "google_workspace" } as unknown as typeof state, "state-secret-fixture"));
});
test("callback is single-use and denied/missing codes preserve the existing grant without provider calls", async () => {
  let used = false, exchanged = 0, finished = 0, retired = 0;
  const oldGrant = credentials();
  const store: HubSpotCompletionStore = {
    consume: async (input) => {
      if (used) return null; used = true;
      return { id, partner_id: actor.partnerId, client_id: actor.clientId, actor_id: actor.actorId, connection_id: state.connectionId,
        provider_key: "hubspot", purpose: "hubspot_oauth", cookie_hash: input.cookieHash, consumed_at: now,
        expires_at: "2026-11-18T12:15:00Z", encrypted_verifier: "must-not-decrypt-a-denied-attempt", requested_permissions: [], expected_account_id: "12345" };
    }, finish: async () => { finished++; }, retire: async () => { retired++; },
  };
  const deps = { client, store, now: () => now, exchange: async () => { exchanged++; return credentials(); } };
  assert.equal(await completeHubSpotOAuthAttempt({ ...actor, denied: true }, deps), "denied");
  assert.equal(await completeHubSpotOAuthAttempt(actor, deps), "expired");
  assert.equal(exchanged, 0); assert.equal(finished, 0); assert.equal(retired, 1); assert.equal(oldGrant.refreshToken, "refresh-fixture");
});
test("callback independently rejects wrong actor/business/provider/purpose/expiry before exchanging", async () => {
  let exchanges = 0;
  for (const patch of [{ actor_id: otherId }, { partner_id: otherId }, { client_id: id }, { connection_id: id }, { provider_key: "google_workspace" },
    { purpose: "read_only" }, { cookie_hash: "another-browser" }, { expires_at: now }, { consumed_at: null }]) {
    const store: HubSpotCompletionStore = { consume: async (input) => ({ id, partner_id: actor.partnerId, client_id: actor.clientId, actor_id: actor.actorId, connection_id: state.connectionId,
      provider_key: "hubspot", purpose: "hubspot_oauth", cookie_hash: input.cookieHash, consumed_at: now, expires_at: "2026-11-18T12:15:00Z", encrypted_verifier: "not-used",
      requested_permissions: [], expected_account_id: "12345", ...patch }), finish: async () => { throw new Error("must not save"); }, retire: async () => undefined };
    assert.equal(await completeHubSpotOAuthAttempt(actor, { client, store, now: () => now, exchange: async () => { exchanges++; return credentials(); } }), "expired");
  }
  assert.equal(exchanges, 0);
});
test("successful callback pins the prior portal and commits before reporting success; cleanup cannot undo it", async () => {
  const previous = process.env.SECRETS_ENCRYPTION_KEY; process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64");
  let saved: HubSpotOAuthCredentials | null = null;
  try {
    const store: HubSpotCompletionStore = { consume: async (input) => ({ id, partner_id: actor.partnerId, client_id: actor.clientId, actor_id: actor.actorId, connection_id: state.connectionId,
      provider_key: "hubspot", purpose: "hubspot_oauth", cookie_hash: input.cookieHash, consumed_at: now, expires_at: "2026-11-18T12:15:00Z",
      encrypted_verifier: JSON.stringify({ clientId: client.clientId, redirectUri: client.redirectUri, nonce: "server-nonce" }), requested_permissions: [], expected_account_id: "12345" }),
      finish: async (_, value) => { saved = value; }, retire: async () => { throw new Error("cleanup unavailable"); } };
    assert.equal(await completeHubSpotOAuthAttempt(actor, { client, store, now: () => now, decrypt: (value) => value, exchange: async (_, code, permissions, expected) => {
      assert.equal(code, actor.code); assert.deepEqual(permissions, []); assert.equal(expected, "12345"); return credentials();
    } }), "connected");
    assert.ok(saved); assert.notEqual((saved as HubSpotOAuthCredentials).grantRevision, id);
    store.finish = async () => { throw new Error("CAS lost to a concurrent reconnect"); };
    assert.equal(await completeHubSpotOAuthAttempt(actor, { client, store, now: () => now, decrypt: (value) => value, exchange: async () => credentials() }), "failed");
  } finally { if (previous === undefined) delete process.env.SECRETS_ENCRYPTION_KEY; else process.env.SECRETS_ENCRYPTION_KEY = previous; }
});

function refreshStore() {
  let current: HubSpotCredentialSnapshot = { credentials: credentials(), secretRevision: id }, claimed = false;
  const failures: boolean[] = [], order: string[] = [];
  const store: HubSpotRefreshStore = {
    read: async () => structuredClone(current), claim: async () => { if (claimed) return false; claimed = true; order.push("claim"); return true; },
    finish: async (_, __, updated, revision) => { order.push("commit"); current = { credentials: updated, secretRevision: revision }; claimed = false; return true; },
    fail: async (_, __, reauth) => { failures.push(reauth); claimed = false; },
  };
  return { store, failures, order, current: () => current, replace: (value: HubSpotCredentialSnapshot) => { current = value; } };
}
test("rotation is persisted before exposure and keeps the grant revision unchanged", async () => {
  const fixture = refreshStore();
  const result = await loadHubSpotOAuthCredentialsFromStore(fixture.store, { client, now: () => now, refresh: async (_, old) => {
    fixture.order.push("provider"); return { ...old, accessToken: "rotated-access", refreshToken: "rotated-refresh", expiresAt: "2026-11-18T12:30:00Z" };
  } });
  assert.deepEqual(fixture.order, ["claim", "provider", "commit"]); assert.equal(result.refreshToken, "rotated-refresh");
  assert.equal(fixture.current().credentials.refreshToken, result.refreshToken); assert.notEqual(fixture.current().secretRevision, id); assert.equal(result.grantRevision, id);
});
test("a competing worker cannot issue a second concurrent refresh", async () => {
  const fixture = refreshStore(); let release: (() => void) | undefined, calls = 0;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const deps = { client, now: () => now, refresh: async (_: typeof client, old: HubSpotOAuthCredentials) => { calls++; await waiting; return { ...old, expiresAt: "2026-11-18T12:30:00Z" }; } };
  const first = loadHubSpotOAuthCredentialsFromStore(fixture.store, deps);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await assert.rejects(loadHubSpotOAuthCredentialsFromStore(fixture.store, deps), /already in progress/);
  assert.equal(calls, 1); release!(); await first;
});
test("lost credential CAS and invalid/unknown refresh never expose an uncommitted token", async () => {
  const lost = refreshStore(); lost.store.finish = async () => false;
  await assert.rejects(loadHubSpotOAuthCredentialsFromStore(lost.store, { client, now: () => now,
    refresh: async (_, old) => ({ ...old, accessToken: "must-not-expose" }) }), /could not be committed/);
  assert.deepEqual(lost.failures, [true]); assert.equal(lost.current().credentials.accessToken, "access-fixture");
  for (const reauth of [true, false]) {
    const fixture = refreshStore();
    await assert.rejects(loadHubSpotOAuthCredentialsFromStore(fixture.store, { client, now: () => now,
      refresh: async () => { throw new HubSpotOAuthError("Provider fixture failure", reauth, !reauth); } }));
    assert.deepEqual(fixture.failures, [reauth]); assert.equal(fixture.order.includes("commit"), false);
  }
});
test("a fresh cached token is checked again against a concurrent reconnect before use", async () => {
  const fixture = refreshStore(); fixture.replace({ credentials: credentials("2026-11-18T12:30:00Z"), secretRevision: id });
  const verified: string[] = [];
  const result = await loadHubSpotOAuthCredentialsFromStore(fixture.store, { client, now: () => now, verify: async (old) => {
    verified.push(old.accessToken);
    if (old.accessToken === "access-fixture") fixture.replace({ credentials: { ...old, accessToken: "reconnected-access", grantRevision: otherId }, secretRevision: otherId });
    return { accessToken: old.accessToken, accountId: old.accountId, scopes: old.scopes, authType: "oauth" };
  } });
  assert.equal(result.accessToken, "reconnected-access"); assert.deepEqual(verified, ["access-fixture", "reconnected-access"]); assert.deepEqual(fixture.order, []);
});

test("reconnect preserves existing selected actions and a later consent button only adds its permission", () => {
  const existing = { providerKey: "hubspot", config: { hubspot_owner_crm: true, workspace_view_only: true, hubspot_selected_permissions: ["contact.create"] } };
  assert.deepEqual(hubSpotOAuthSelection(existing, []), ["contact.create"]);
  assert.deepEqual(hubSpotOAuthSelection(existing, ["note.create"]), ["contact.create", "note.create"]);
  assert.deepEqual(hubSpotOAuthSelection({ ...existing, config: { ...existing.config, hubspot_selected_permissions: ["contact.create", "note.create"] } }, []), ["contact.create", "note.create"]);
  assert.deepEqual(hubSpotOAuthSelection(existing, ["contact.create"]), ["contact.create"]);
  assert.deepEqual(hubSpotOAuthSelection(null), []);
  assert.throws(() => hubSpotOAuthSelection(null, ["note.create"]), /read-only/);
  assert.throws(() => hubSpotOAuthSelection({ ...existing, providerKey: "stripe" }), /exact owner/);
  assert.throws(() => hubSpotOAuthSelection({ ...existing, config: { workspace_view_only: true } }), /exact owner/);
  assert.deepEqual(existing.config.hubspot_selected_permissions, ["contact.create"]);
});
