import test from "node:test";
import assert from "node:assert/strict";
import { buildHubSpotAuthorizationUrl, exchangeHubSpotOAuthCode, getHubSpotOAuthClient, hubspotOAuthScopes, HubSpotOAuthError,
  parseHubSpotPermissions, refreshHubSpotOAuthCredentials, verifyHubSpotToken, type HubSpotOAuthCredentials } from "../lib/integrations/providers/hubspot-oauth.ts";
import type { HubSpotOwnerPermission } from "../lib/crm/provider-contract.ts";

const now = "2026-11-18T12:00:00Z";
const client = { clientId: "client-fixture", clientSecret: "secret-fixture", redirectUri: "https://app.synthetic.invalid/api/oauth/hubspot/callback" };
function credentials(): HubSpotOAuthCredentials {
  return { authType: "oauth", clientId: client.clientId, accessToken: "access-fixture", refreshToken: "refresh-fixture", accountId: "12345", userId: "77", appId: "88", accountName: "hub.synthetic.invalid",
    scopes: hubspotOAuthScopes([]), expiresAt: "2026-11-18T12:29:00Z", permissions: [], accessMode: "read_only", grantRevision: "b6fbd167-7ff2-42e0-8b71-6765df30b4bf" };
}
function provider(options: { permissions?: HubSpotOwnerPermission[]; token?: Record<string, unknown>; access?: Record<string, unknown>; refresh?: Record<string, unknown> } = {}) {
  const calls: { url: string; fields: URLSearchParams; init?: RequestInit }[] = [];
  const granted = hubspotOAuthScopes(options.permissions ?? []);
  const fetcher: typeof fetch = async (url, init) => {
    const fields = new URLSearchParams(String(init?.body)); calls.push({ url: String(url), fields, init });
    if (!String(url).includes("introspect")) return Response.json({ token_type: "bearer", access_token: "new-access-fixture", refresh_token: "new-refresh-fixture", hub_id: 12345, scopes: granted, expires_in: 1800, ...options.token });
    const use = fields.get("token_type_hint")!;
    return Response.json({ active: true, token: fields.get(use), token_type: "Bearer", token_use: use, client_id: client.clientId,
      hub_id: 12345, user_id: 77, app_id: 88, hub_domain: "hub.synthetic.invalid", scopes: granted,
      ...(use === "access_token" ? { expires_in: 1780, ...options.access } : options.refresh) });
  };
  return { fetch: fetcher, calls, now: () => now };
}
test("HubSpot authorization is server-confidential, account-pinned on reconnect and never claims MCP PKCE", () => {
  const url = new URL(buildHubSpotAuthorizationUrl(client, "signed-state", ["note.create"], "12345"));
  assert.equal(url.pathname, "/oauth/12345/authorize"); assert.equal(url.searchParams.get("state"), "signed-state");
  assert.ok(url.searchParams.get("scope")?.includes("crm.objects.contacts.write"));
  assert.equal(url.searchParams.has("client_secret"), false); assert.equal(url.searchParams.has("code_challenge"), false);
  assert.equal(new URL(buildHubSpotAuthorizationUrl(client, "state")).pathname, "/oauth/authorize");
  assert.deepEqual(parseHubSpotPermissions(["note.create", "note.create"]), ["note.create"]);
  assert.throws(() => parseHubSpotPermissions(["contact.delete"]));
});
test("a code is exchanged once and BOTH real tokens must identify the same app, user, portal and grants", async () => {
  const api = provider(); const result = await exchangeHubSpotOAuthCode(client, "code-fixture", [], "12345", api);
  assert.equal(result.accountId, "12345"); assert.equal(result.accessMode, "read_only"); assert.equal(result.userId, "77");
  assert.equal(result.expiresAt, "2026-11-18T12:29:40.000Z");
  assert.equal(api.calls.length, 3); assert.ok(api.calls.every((call) => call.init?.method === "POST" && call.init.cache === "no-store" && call.init.redirect === "error"));
  assert.equal(api.calls[0].url, "https://api.hubapi.com/oauth/2026-03/token");
  assert.ok(api.calls.slice(1).every((call) => call.url.endsWith("/oauth/2026-03/token/introspect")));
  assert.deepEqual(api.calls.slice(1).map((call) => call.fields.get("token_type_hint")), ["access_token", "refresh_token"]);
  assert.ok(api.calls.every((call) => !call.url.includes("fixture")), "No code, client secret or token belongs in a URL.");
  assert.equal("clientSecret" in result, false);
});
test("missing actual scopes/offline grant and mismatched or inactive token metadata never authorize a save", async () => {
  for (const option of [{ token: { scopes: undefined } }, { token: { refresh_token: undefined } }, { access: { active: false } },
    { access: { client_id: "another-app" } }, { access: { hub_id: 54321 } }, { refresh: { hub_id: 54321 } },
    { refresh: { user_id: 78 } }, { refresh: { app_id: 89 } }, { access: { token_use: "refresh_token" } },
    { access: { expires_in: 0 } }, { access: { token: "unrelated-token" } }]) {
    const api = provider(option); await assert.rejects(exchangeHubSpotOAuthCode(client, "code-fixture", [], "12345", api), HubSpotOAuthError);
  }
  await assert.rejects(exchangeHubSpotOAuthCode(client, "code-fixture", [], "54321", provider()), /same reviewed account/);
});
test("provider scope never implicitly selects an owner action, and omitted selected write grant fails", async () => {
  await assert.rejects(exchangeHubSpotOAuthCode(client, "code-fixture", [], null, provider({ permissions: ["contact.create"] })), /outside this reviewed/);
  await assert.rejects(exchangeHubSpotOAuthCode(client, "code-fixture", ["note.create"], null, provider()), /every selected/);
  const result = await exchangeHubSpotOAuthCode(client, "code-fixture", ["note.create"], null, provider({ permissions: ["note.create"] }));
  assert.equal(result.accessMode, "owner_selected"); assert.deepEqual(result.permissions, ["note.create"]);
});
test("refresh verifies rotated tokens and preserves exact grant and user identity", async () => {
  const original = credentials(), result = await refreshHubSpotOAuthCredentials(client, original, provider());
  assert.equal(result.refreshToken, "new-refresh-fixture"); assert.equal(result.grantRevision, original.grantRevision);
  assert.equal(original.refreshToken, "refresh-fixture");
  const kept = await refreshHubSpotOAuthCredentials(client, original, provider({ token: { refresh_token: undefined } }));
  assert.equal(kept.refreshToken, original.refreshToken);
  await assert.rejects(refreshHubSpotOAuthCredentials(client, original, provider({ access: { user_id: 78 }, refresh: { user_id: 78 } })), /same reviewed account/);
});
test("a read session verifies the exact stored and requested portal without exposing long-lived secrets", async () => {
  const actual = await verifyHubSpotToken(credentials(), { client, expectedAccountId: "12345", ...provider() });
  assert.deepEqual(actual, { accessToken: "access-fixture", accountId: "12345", scopes: hubspotOAuthScopes([]), authType: "oauth" });
  await assert.rejects(verifyHubSpotToken(credentials(), { client, expectedAccountId: "54321", ...provider() }), /no longer matches/);
});
test("retryable provider unavailability and unknown refresh outcomes remain distinct and secret-safe", async () => {
  for (const status of [429, 500, 503]) await assert.rejects(refreshHubSpotOAuthCredentials(client, credentials(), {
    fetch: async () => Response.json({ error: "temporary", error_description: "refresh-fixture secret-fixture" }, { status }),
  }), (e: unknown) => e instanceof HubSpotOAuthError && e.retryable && !e.reauth && !e.message.includes("fixture"));
  await assert.rejects(refreshHubSpotOAuthCredentials(client, credentials(), { fetch: async () => { throw new Error("transport reset"); } }),
    (e: unknown) => e instanceof HubSpotOAuthError && e.reauth && !e.retryable);
  await assert.rejects(verifyHubSpotToken(credentials(), { client, fetch: async () => { throw new Error("read unavailable"); } }),
    (e: unknown) => e instanceof HubSpotOAuthError && e.retryable && !e.reauth);
});
test("OAuth client configuration requires a valid production domain or localhost dev callback", () => {
  const previous = { id: process.env.HUBSPOT_CLIENT_ID, secret: process.env.HUBSPOT_CLIENT_SECRET, app: process.env.APP_URL };
  process.env.HUBSPOT_CLIENT_ID = client.clientId; process.env.HUBSPOT_CLIENT_SECRET = client.clientSecret;
  try {
    process.env.APP_URL = "https://app.synthetic.invalid"; assert.equal(getHubSpotOAuthClient()?.redirectUri, client.redirectUri);
    for (const app of ["http://127.0.0.1:3000", "http://production.synthetic.invalid", "not-a-url"]) { process.env.APP_URL = app; assert.equal(getHubSpotOAuthClient(), null); }
    process.env.APP_URL = "http://localhost:3000"; assert.ok(getHubSpotOAuthClient());
  } finally {
    for (const [key, value] of Object.entries({ HUBSPOT_CLIENT_ID: previous.id, HUBSPOT_CLIENT_SECRET: previous.secret, APP_URL: previous.app }))
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
