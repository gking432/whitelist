import test from "node:test";
import assert from "node:assert/strict";
import { assertGooglePermissionAttempt, googleAccountCanAct, googleCredentialsCanAct, googlePermissionScopes, parseGooglePermissions,
  verifyGooglePermissionUpgrade, type GoogleActionPermission } from "../lib/connections/google-permissions.ts";
import { buildWorkspaceAuthorizationUrl, buildWorkspaceOAuthState, verifyWorkspaceOAuthState, GOOGLE_WORKSPACE_READ_SCOPES } from "../lib/integrations/providers/workspace-oauth.ts";
import { createGoogleWorkspaceCalendarMutationSession, sendGoogleWorkspaceEmail } from "../lib/integrations/providers/google-workspace.ts";

const client = { clientId: "synthetic-client", clientSecret: "synthetic-secret" };
const existing = { ...client, refreshToken: "original-read-token", scope: GOOGLE_WORKSPACE_READ_SCOPES.join(" "), accountId: "same-google-subject", accountName: "same@synthetic.invalid", accessMode: "read_only" as const };
const all = googlePermissionScopes(["calendar.write", "email.send"]).join(" ");
function provider(overrides: { code?: Record<string, unknown>; tokenInfo?: Record<string, unknown>; codeIdentity?: string; refreshIdentity?: string } = {}) {
  const calls: { url: string; body: URLSearchParams; authorization: string | null }[] = [];
  const request: typeof fetch = async (url, init) => {
    const target = String(url), body = new URLSearchParams(String(init?.body ?? ""));
    const authorization = new Headers(init?.headers).get("Authorization"); calls.push({ url: target, body, authorization });
    if (target.endsWith("/token") && body.get("grant_type") === "authorization_code")
      return Response.json({ access_token: "new-code-access", refresh_token: "new-offline-token", scope: all, ...overrides.code });
    if (target.endsWith("/token")) return Response.json({ access_token: "new-refreshed-access" });
    if (target.endsWith("/tokeninfo")) return Response.json({ aud: client.clientId, sub: existing.accountId, scope: all, ...overrides.tokenInfo });
    if (target.endsWith("/userinfo")) return Response.json({ id: authorization === "Bearer new-code-access" ? overrides.codeIdentity ?? existing.accountId : overrides.refreshIdentity ?? existing.accountId, email: existing.accountName });
    throw new Error("Unexpected provider endpoint");
  };
  return { calls, request };
}
function input(requested: GoogleActionPermission[] = ["calendar.write"]) {
  return { client, code: "one-use-code", verifier: "one-use-pkce", expectedAccountId: existing.accountId, existing: { ...existing }, requested, previouslySelected: [] as GoogleActionPermission[] };
}

test("Google upgrade URL is incremental, scoped to selected actions, browser attempt, PKCE and existing account hint", () => {
  const previous = process.env.SECRETS_ENCRYPTION_KEY;
  process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  try {
    const url = new URL(buildWorkspaceAuthorizationUrl("google_workspace", client, "existing-connection", undefined, undefined,
      { attemptId: "permission-attempt", challenge: "pkce-challenge", loginHint: existing.accountName, scopes: googlePermissionScopes(["calendar.write"]) }));
    const state = verifyWorkspaceOAuthState(url.searchParams.get("state")!);
    assert.equal(state?.connectionId, "existing-connection"); assert.equal(state?.permissionAttemptId, "permission-attempt");
    assert.equal(state?.readOnlyAttemptId, undefined); assert.equal(state?.activationAttemptId, undefined);
    assert.equal(url.searchParams.get("include_granted_scopes"), "true"); assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256"); assert.equal(url.searchParams.get("login_hint"), existing.accountName);
    assert.ok(url.searchParams.get("scope")!.includes("calendar.events ")); assert.ok(url.searchParams.get("scope")!.includes("calendar.calendarlist.readonly"));
    assert.equal(url.searchParams.get("scope")!.includes("gmail.send"), false); assert.equal(url.searchParams.get("scope")!.includes("auth/contacts"), false);
    assert.equal(verifyWorkspaceOAuthState(buildWorkspaceOAuthState("google_workspace", "connection", undefined, "activation", undefined, "permission")), null);
    assert.equal(verifyWorkspaceOAuthState(buildWorkspaceOAuthState("microsoft_365", "connection", undefined, undefined, undefined, "permission")), null);
  } finally { if (previous === undefined) delete process.env.SECRETS_ENCRYPTION_KEY; else process.env.SECRETS_ENCRYPTION_KEY = previous; }
});
test("selection and verified provider scopes independently gate each channel while imports stay read-only", () => {
  assert.deepEqual(parseGooglePermissions(["email.send", "calendar.write"]), ["calendar.write", "email.send"]);
  for (const invalid of [[], ["email.send", "email.send"], ["contacts.write"], "calendar.write"]) assert.throws(() => parseGooglePermissions(invalid));
  const config = { workspace_view_only: true, google_action_permissions: { calendar_write: true, email_send: false }, google_verified_scopes: all.split(" ") };
  assert.equal(googleAccountCanAct(config, "calendar"), true); assert.equal(googleAccountCanAct(config, "email"), false);
  assert.equal(googleAccountCanAct({ ...config, google_verified_scopes: [...GOOGLE_WORKSPACE_READ_SCOPES] }, "calendar"), false);
  assert.equal(googleCredentialsCanAct({ ...existing, scope: all }, "calendar.write"), false);
  const selected = { ...existing, scope: all, accessMode: "owner_selected" as const, googlePermissions: ["email.send"] as GoogleActionPermission[] };
  assert.equal(googleCredentialsCanAct(selected, "email.send"), true); assert.equal(googleCredentialsCanAct(selected, "calendar.write"), false);
});
test("attempt binding rejects changed actor, browser, provider, workspace, connection and expiry before consent is usable", () => {
  const expected = { attemptId: "attempt", actorId: "owner", partnerId: "partner", clientId: "client", connectionId: "connection", cookieHash: "browser-hash", now: "2026-11-18T12:00:00Z" };
  const attempt = { id: expected.attemptId, actor_id: expected.actorId, partner_id: expected.partnerId, client_id: expected.clientId, connection_id: expected.connectionId,
    cookie_hash: expected.cookieHash, provider_key: "google_workspace", purpose: "permission_upgrade", consumed_at: expected.now, expires_at: "2026-11-18T12:15:00Z", expected_account_id: existing.accountId, requested_permissions: ["calendar.write"] };
  assert.doesNotThrow(() => assertGooglePermissionAttempt(attempt, expected));
  for (const patch of [{ actor_id: "another-owner" }, { cookie_hash: "another-browser" }, { provider_key: "microsoft_365" }, { client_id: "another-workspace" }, { connection_id: "new-account" }, { expires_at: expected.now }, { consumed_at: null }, { purpose: "read_only" }])
    assert.throws(() => assertGooglePermissionAttempt({ ...attempt, ...patch }, expected));
});
test("offline upgrade proves actual refreshed grants, audience and same immutable account without inheriting unselected writes", async () => {
  const p = provider(), original = structuredClone(existing);
  const verified = await verifyGooglePermissionUpgrade(input(), { fetch: p.request });
  assert.deepEqual(verified.selectedPermissions, ["calendar.write"]); assert.equal(verified.credentials.accessMode, "owner_selected");
  assert.equal(verified.credentials.refreshToken, "new-offline-token"); assert.equal(verified.accountId, existing.accountId);
  assert.equal(googleCredentialsCanAct(verified.credentials, "email.send"), false);
  assert.deepEqual(existing, original);
  assert.equal(p.calls[0].body.get("code_verifier"), "one-use-pkce");
  assert.equal(p.calls[2].body.get("refresh_token"), "new-offline-token");
  assert.equal(p.calls[3].authorization, "Bearer new-refreshed-access");
  assert.ok(p.calls.every((call) => !call.url.includes("access_token=")));
});
test("missing replacement refresh token reuses prior same-account offline access only after refreshed grants are proved", async () => {
  const p = provider({ code: { refresh_token: undefined } });
  const verified = await verifyGooglePermissionUpgrade(input(), { fetch: p.request });
  assert.equal(verified.credentials.refreshToken, existing.refreshToken); assert.equal(p.calls[2].body.get("refresh_token"), existing.refreshToken);
});
test("granular denial or absent actual grants preserves the original credentials and never claims requested permissions", async () => {
  for (const code of [{ scope: existing.scope }, { scope: undefined }, { access_token: undefined }]) {
    const p = provider({ code }), context = input(), before = structuredClone(context.existing);
    await assert.rejects(verifyGooglePermissionUpgrade(context, { fetch: p.request }));
    assert.equal(p.calls.length, 1); assert.deepEqual(context.existing, before);
  }
});
test("wrong-account code, refreshed account, audience or offline grant cannot authorize credential replacement", async () => {
  for (const patch of [{ codeIdentity: "other-subject" }, { refreshIdentity: "other-subject" }, { tokenInfo: { aud: "other-app" } }, { tokenInfo: { sub: "other-subject" } }, { tokenInfo: { scope: existing.scope } }]) {
    const p = provider(patch), context = input(), before = structuredClone(context.existing);
    await assert.rejects(verifyGooglePermissionUpgrade(context, { fetch: p.request })); assert.deepEqual(context.existing, before);
  }
  const p = provider(); await assert.rejects(verifyGooglePermissionUpgrade({ ...input(), existing: { ...existing, accountId: "other-subject" } }, { fetch: p.request })); assert.equal(p.calls.length, 0);
});
test("prior explicitly selected rights are retained only when their actual grants survive the new consent", async () => {
  const p = provider({ code: { scope: googlePermissionScopes(["email.send"]).join(" ") }, tokenInfo: { scope: googlePermissionScopes(["email.send"]).join(" ") } });
  const context = input(["email.send"]); context.previouslySelected = ["calendar.write"];
  const verified = await verifyGooglePermissionUpgrade(context, { fetch: p.request }); assert.deepEqual(verified.selectedPermissions, ["email.send"]);
  const full = provider(); assert.deepEqual((await verifyGooglePermissionUpgrade(context, { fetch: full.request })).selectedPermissions, ["calendar.write", "email.send"]);
});
test("calendar driver rejects a Gmail-only owner choice before token mint or any calendar request", async () => {
  let minted = 0;
  await assert.rejects(createGoogleWorkspaceCalendarMutationSession({ ...existing, scope: all, accessMode: "owner_selected", googlePermissions: ["email.send"] },
    { accountId: existing.accountId, calendarId: "primary", eventId: "event" }, { mintToken: async () => { minted++; return "unused"; } }));
  assert.equal(minted, 0);
});
test("email driver rejects unselected Gmail rights in a combined grant before token mint or sending", async () => {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Unselected email permission must not mint a token"); };
  try {
    await assert.rejects(sendGoogleWorkspaceEmail({ ...existing, scope: all, accessMode: "owner_selected", googlePermissions: ["calendar.write"] },
      { to: "customer@synthetic.invalid", subject: "Synthetic", body: "Synthetic", idempotencyKey: "denied-owner-choice" }), /email-send permission/);
    assert.equal(calls, 0);
    await assert.rejects(sendGoogleWorkspaceEmail({ ...existing, scope: all },
      { to: "customer@synthetic.invalid", subject: "Synthetic", body: "Synthetic", idempotencyKey: "read-only" }), /email-send permission/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = previous; }
});
