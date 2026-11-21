// Disposable hosted-CI transport evidence. No OAuth provider is contacted and
// synthetic ciphertexts below are deliberately not usable credentials.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertFoundationHttpScope } from "./owner-foundation-conflict-http.mjs";
import { withOwnerBrowserDeadline } from "./owner-workspace-browser-scenarios.mjs";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const rpcNames = ["finish_readonly_workspace_oauth", "finish_google_permission_upgrade", "begin_hubspot_oauth", "finish_hubspot_oauth"];
const googleScopes = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.calendarlist.readonly"];
const hubspotScopes = ["oauth", "crm.objects.contacts.read", "crm.objects.deals.read", "crm.objects.contacts.write"];
const scopeTables = ["integration_connections", "integration_secrets", "business_connection_oauth_attempts", "agent_team_settings", "business_agent_activation", "action_jobs", "approval_items", "agent_work_items", "integration_sync_jobs", "integration_canonical_records", "ai_call_usage", "usage_events", "voice_usage_events"];
const same = (actual, expected, message) => assert.ok(JSON.stringify(actual) === JSON.stringify(expected), message);
const saved = (result) => { assert.equal(result.error, null, "The disposable OAuth fixture must use the actual scoped schema."); return result.data; };

export function assertOAuthConflictHttpScope(options) {
  assertFoundationHttpScope(options);
  assert.ok(typeof options.target.serviceKey === "string" && options.target.serviceKey.length > 0 && options.target.serviceKey !== options.target.anonKey, "OAuth wire evidence requires the ephemeral CI service key in Node only.");
}

// PostgREST v14.1: three RETURNS void functions are 204/empty; JSONB begin is
// 200/JSON. PT409 is 409/JSON; deleted strict attempts are P0002/500, not replay.
export async function readOAuthWireResponse(action, { status, code, begin = false }) {
  let response, text;
  try { response = await withOwnerBrowserDeadline("OAuth HTTP headers", action, 15000); }
  catch { throw new Error("OAuth RPC response headers were unavailable; no request is retried."); }
  assert.ok(response && Number.isInteger(response.status), "OAuth RPC must complete actual HTTP response headers.");
  try { text = await withOwnerBrowserDeadline("OAuth HTTP body", () => response.text(), 10000); }
  catch { throw new Error(`OAuth RPC HTTP ${response.status}: complete response body unavailable.`); }
  assert.ok(typeof text === "string" && Buffer.byteLength(text, "utf8") <= 32768, "OAuth RPC response body must be complete and bounded.");
  assert.equal(response.status, status, "OAuth RPC must preserve the native HTTP status.");
  if (status === 204) { assert.equal(text, "", "A void OAuth RPC must finish with its native empty body."); return { status, body: null }; }
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`OAuth RPC HTTP ${response.status}: complete JSON unavailable.`); }
  assert.ok(body && typeof body === "object" && !Array.isArray(body), "OAuth RPC must return its complete JSON object.");
  if (begin) {
    assert.ok(status === 200 && Object.keys(body).length === 3 && ["attemptId", "connectionId", "expectedAccountId"].every((key) => Object.hasOwn(body, key)) && uuid.test(body.attemptId) && uuid.test(body.connectionId) && (body.expectedAccountId === null || typeof body.expectedAccountId === "string" && /^[0-9]+$/.test(body.expectedAccountId)), "HubSpot begin must return its exact durable attempt/account JSON.");
  } else {
    assert.ok(status >= 400 && Object.keys(body).length === 4 && ["code", "message", "details", "hint"].every((key) => Object.hasOwn(body, key)) && body.code === code && typeof body.message === "string" && body.message.length > 0 && body.message.length <= 4000 && [body.details, body.hint].every((value) => value === null || typeof value === "string" && value.length <= 4000), "OAuth RPC errors must retain their complete bounded PostgREST code contract.");
  }
  return { status, body };
}

export async function collectOAuthConsumeRace(actions) {
  const settled = await Promise.allSettled(actions.map((action) => action()));
  assert.ok(settled.every((value) => value.status === "fulfilled"), "Both original OAuth consume attempts must complete; no transport failure is a winner.");
  const outcomes = settled.map((value) => value.value);
  assert.ok(outcomes.every((value) => value.status === 200 && Array.isArray(value.body) && value.body.length <= 1), "OAuth consume CAS uses native HTTP200 row arrays, not invented 409 receipts.");
  same(outcomes.map((value) => value.body.length).sort(), [0, 1], "Exactly one actual scoped attempt consumer must win.");
  return outcomes;
}

async function scopeState(admin, partnerId, clientId) {
  const result = {};
  for (const table of scopeTables) {
    const order = table === "agent_team_settings" || table === "business_agent_activation" ? "client_id" : table === "voice_usage_events" ? "call_session_id" : "id";
    const rows = saved(await admin.from(table).select("*").eq("partner_id", partnerId).eq("client_id", clientId).order(order).limit(101));
    assert.ok(rows.length <= 100, "OAuth effect evidence must fit its explicit disposable bound."); result[table] = rows;
  }
  return result;
}

export async function runOAuthConflictHttp({ admin, fixture, owners, target, readSession, verifySession, phase = async () => {}, onProgress = async () => {}, env = process.env, request = fetch }) {
  assertOAuthConflictHttpScope({ fixture, owners, target, env });
  const report = { version: 1, status: "in_progress", activeStep: null, checks: [], fixtureCleanup: "not_started", cleanupRemaining: null, wire: { begin: "200 JSON", finish: "204 empty", conflict: "409 PT409 JSON", deletedAttempt: "500 P0002 JSON", consume: "200 JSON row array; one winner" }, serviceRoleOnly: false, originalOwnerStateUnchanged: false, providerRequests: 0, modelCalls: 0, limitations: ["Synthetic isolated-CI ciphertexts/scopes test database HTTP policy, not valid credentials, provider consent or account ownership.", "Finish RPCs intentionally trust the service callback; browser actor/provider verification occurs before these RPCs and is not established by this fixture.", "Successful finishes delete attempts. Exact and changed missing-attempt replays fail closed; begin supersedes an older attempt and is not an idempotent receipt.", "One temporary sandbox client has no membership, team settings, context review or live acceptance and is fully removed before the owner journey continues."] };
  const clientId = randomUUID(), slug = `${fixture.prefix}-oauth-transport-${randomUUID().slice(0, 8)}`;
  const actor = owners[0].userId, sessions = [], originals = [];
  const publish = () => onProgress({ ...report, checks: report.checks.map((value) => ({ ...value })), wire: { ...report.wire }, limitations: [...report.limitations], cleanupRemaining: report.cleanupRemaining ? { ...report.cleanupRemaining } : null });
  const stage = async (key, action) => {
    report.activeStep = key; await publish(); await phase(`oauth HTTP: ${key}`);
    try { await withOwnerBrowserDeadline(`OAuth transport stage ${key}`, action, 120000); report.checks.push({ key, status: "passed" }); report.activeStep = null; await publish(); }
    catch (error) { report.checks.push({ key, status: "failed" }); report.status = "failed"; await publish().catch(() => {}); throw error; }
  };
  const service = (name, body, expected) => {
    assert.ok(rpcNames.includes(name), "Only the four delegated OAuth RPCs are permitted.");
    return readOAuthWireResponse(() => request(`${target.supabaseUrl}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: target.serviceKey, Authorization: `Bearer ${target.serviceKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(15000) }), expected);
  };
  const readConnection = async (id) => saved(await admin.from("integration_connections").select("*").eq("partner_id", fixture.partnerId).eq("client_id", clientId).eq("id", id).single());
  const readSecret = async (id) => saved(await admin.from("integration_secrets").select("*").eq("partner_id", fixture.partnerId).eq("client_id", clientId).eq("connection_id", id).eq("secret_kind", "provider_credentials").maybeSingle());
  const attempt = async (connectionId, provider, purpose, permissions = null) => {
    const connection = await readConnection(connectionId), secret = await readSecret(connectionId), id = randomUUID();
    saved(await admin.from("business_connection_oauth_attempts").insert({ id, partner_id: fixture.partnerId, client_id: clientId, connection_id: connectionId, actor_id: actor, provider_key: provider, purpose, cookie_hash: "a".repeat(64), encrypted_verifier: "synthetic-oauth-verifier-not-provider-proof", requested_permissions: permissions, expected_account_id: connection.external_account_id, expected_connection_updated_at: connection.updated_at, expected_secret_updated_at: secret?.updated_at ?? null, consumed_at: new Date().toISOString(), expires_at: new Date(Date.now() + 600000).toISOString() }));
    return id;
  };
  const updateAttempt = async (id, values) => saved(await admin.from("business_connection_oauth_attempts").update(values).eq("partner_id", fixture.partnerId).eq("client_id", clientId).eq("id", id));
  const unchanged = async (action) => { const before = await scopeState(admin, fixture.partnerId, clientId); await action(); same(await scopeState(admin, fixture.partnerId, clientId), before, "A denied OAuth request must not change attempts, saved access, authority or execution state."); };
  const beginBody = (connectionId, permissions = ["contact.create"]) => ({ p_partner: fixture.partnerId, p_client: clientId, p_actor: actor, p_connection: connectionId, p_cookie_hash: "a".repeat(64), p_encrypted_verifier: "synthetic-hubspot-verifier-not-provider-proof", p_permissions: permissions, p_expires_at: new Date(Date.now() + 600000).toISOString() });
  const hubspotFinish = (id) => ({ p_attempt: id, p_encrypted: "synthetic-hubspot-ciphertext-not-provider-proof", p_last_four: "test", p_account_id: "810001", p_account_name: "Synthetic OAuth transport HubSpot", p_verified_scopes: hubspotScopes, p_permissions: ["contact.create"], p_expires_at: new Date(Date.now() + 1800000).toISOString(), p_grant_revision: randomUUID() });
  const consume = async (id, connectionId) => {
    const query = new URLSearchParams({ id: `eq.${id}`, partner_id: `eq.${fixture.partnerId}`, client_id: `eq.${clientId}`, connection_id: `eq.${connectionId}`, actor_id: `eq.${actor}`, provider_key: "eq.hubspot", purpose: "eq.hubspot_oauth", cookie_hash: `eq.${"a".repeat(64)}`, consumed_at: "is.null", expires_at: `gt.${new Date().toISOString()}`, select: "id" });
    let response, text;
    try {
      response = await request(`${target.supabaseUrl}/rest/v1/business_connection_oauth_attempts?${query}`, { method: "PATCH", headers: { apikey: target.serviceKey, Authorization: `Bearer ${target.serviceKey}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ consumed_at: new Date().toISOString() }), redirect: "error", signal: AbortSignal.timeout(15000) });
      text = await withOwnerBrowserDeadline("OAuth consume body", () => response.text(), 10000);
    } catch { throw new Error("The original OAuth consume transport did not complete; no retry is permitted."); }
    assert.ok(Buffer.byteLength(text, "utf8") <= 32768, "OAuth consume JSON must be bounded.");
    let body; try { body = JSON.parse(text); } catch { throw new Error("OAuth consume requires complete native row-array JSON."); }
    assert.ok(response.status === 200 && Array.isArray(body) && body.length <= 1 && body.every((row) => row && Object.keys(row).length === 1 && row.id === id), "OAuth consume must return only its exact scoped attempt row or no row.");
    return { status: response.status, body };
  };
  let readonlyId, googleId, hubspotId, readonlyAttempt, googleAttempt, hubspotAttempt, readonlyArgs, googleArgs, hubspotArgs, failure;
  try {
    await stage("guarded temporary scope and genuine sessions", async () => {
      for (const owner of owners) {
        const token = await readSession(owner.context, target); await verifySession(target, token, owner.userId);
        sessions.push({ owner, token }); originals.push({ clientId: owner.clientId, state: await scopeState(admin, fixture.partnerId, owner.clientId) });
        saved(await admin.from("first_owner_workspaces").select("id").eq("id", owner.receiptId).eq("partner_id", fixture.partnerId).eq("client_id", owner.clientId).eq("user_id", owner.userId).single());
      }
      const sourceClient = saved(await admin.from("client_businesses").select("package_id").eq("partner_id", fixture.partnerId).eq("id", owners[0].clientId).single());
      saved(await admin.from("client_businesses").insert({ id: clientId, partner_id: fixture.partnerId, package_id: sourceClient.package_id, name: "Synthetic OAuth HTTP transport fixture — no owner workspace", slug, status: "active", default_runtime_mode: "sandbox", crm_operating_mode: "external_crm_only", client_portal_enabled: false }));
      const providers = saved(await admin.from("integration_providers").select("id,provider_key").in("provider_key", ["google_workspace", "hubspot"]).eq("is_active", true));
      assert.equal(providers.length, 2, "The existing active provider catalog must supply both transport fixtures.");
      const providerId = (key) => { const value = providers.find((row) => row.provider_key === key); assert.ok(value); return value.id; };
      [readonlyId, googleId, hubspotId] = [randomUUID(), randomUUID(), randomUUID()];
      saved(await admin.from("integration_connections").insert([
        { id: readonlyId, provider_id: providerId("google_workspace"), display_name: "Synthetic OAuth read-only transport", status: "not_connected", runtime_mode: "dry_run", credential_status: "missing", config: { workspace_view_only: true } },
        { id: googleId, provider_id: providerId("google_workspace"), display_name: "Synthetic Google permission transport", status: "connected", runtime_mode: "paused", credential_status: "configured", external_account_id: "synthetic-google-transport-account", config: { workspace_view_only: true, google_action_permissions: { calendar_write: false, email_send: false }, google_verified_scopes: [googleScopes[0], "https://www.googleapis.com/auth/calendar.events.readonly"] } },
        { id: hubspotId, provider_id: providerId("hubspot"), display_name: "Synthetic HubSpot transport", status: "not_connected", runtime_mode: "dry_run", credential_status: "missing", config: { workspace_view_only: true, owner_workspace_imports: true, hubspot_owner_crm: true, hubspot_actions_enabled: false } },
      ].map((row) => ({ ...row, partner_id: fixture.partnerId, client_id: clientId, created_by: actor }))));
      saved(await admin.from("integration_secrets").insert({ partner_id: fixture.partnerId, client_id: clientId, connection_id: googleId, secret_kind: "provider_credentials", encrypted_value: "synthetic-original-google-ciphertext", last_four: "test" }));
      readonlyAttempt = await attempt(readonlyId, "google_workspace", "read_only"); googleAttempt = await attempt(googleId, "google_workspace", "permission_upgrade", ["calendar.write"]);
      readonlyArgs = { p_attempt: readonlyAttempt, p_encrypted: "synthetic-readonly-ciphertext-not-provider-proof", p_last_four: "test", p_account_id: "synthetic-readonly-transport-account", p_account_name: "Synthetic read-only account" };
      googleArgs = { p_attempt: googleAttempt, p_encrypted: "synthetic-upgraded-google-ciphertext", p_last_four: "test", p_account_id: "synthetic-google-transport-account", p_account_name: "Synthetic selected Google account", p_verified_scopes: googleScopes, p_selected_permissions: ["calendar.write"] };
      const begun = await service("begin_hubspot_oauth", beginBody(hubspotId), { status: 200, begin: true });
      assert.equal(begun.body.connectionId, hubspotId); assert.equal(begun.body.expectedAccountId, null); hubspotAttempt = begun.body.attemptId;
      hubspotArgs = hubspotFinish(hubspotAttempt);
    });
    await stage("service-only RPC denial leaves every row unchanged", async () => {
      const calls = [[rpcNames[0], readonlyArgs], [rpcNames[1], googleArgs], [rpcNames[2], beginBody(hubspotId)], [rpcNames[3], hubspotArgs]];
      for (const { owner, token } of sessions) for (const [name, body] of calls) await unchanged(async () => {
        await readOAuthWireResponse(async () => { const response = await owner.context.request.post(`${target.supabaseUrl}/rest/v1/rpc/${name}`, { headers: { apikey: target.anonKey, Authorization: `Bearer ${token}` }, data: body, timeout: 15000 }); return { status: response.status(), text: () => response.text() }; }, { status: 403, code: "42501" });
      });
      for (const [name, body] of calls) await unchanged(() => readOAuthWireResponse(() => request(`${target.supabaseUrl}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: target.anonKey, Authorization: `Bearer ${target.anonKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(15000) }), { status: 401, code: "42501" }));
      report.serviceRoleOnly = true;
    });
    await stage("read-only stale CAS and native void success replay denial", async () => {
      await updateAttempt(readonlyAttempt, { expected_connection_updated_at: "1970-01-01T00:00:00.000Z" });
      await unchanged(() => service(rpcNames[0], readonlyArgs, { status: 409, code: "PT409" }));
      await updateAttempt(readonlyAttempt, { expected_connection_updated_at: (await readConnection(readonlyId)).updated_at });
      await service(rpcNames[0], readonlyArgs, { status: 204 });
      const connection = await readConnection(readonlyId), secret = await readSecret(readonlyId);
      assert.ok(connection.status === "connected" && connection.runtime_mode === "dry_run" && connection.config.workspace_view_only === true && connection.external_account_id === readonlyArgs.p_account_id && secret.encrypted_value === readonlyArgs.p_encrypted, "Native read-only success must save only the exact synthetic account and secret.");
      await unchanged(() => service(rpcNames[0], readonlyArgs, { status: 500, code: "P0002" }));
      await unchanged(() => service(rpcNames[0], { ...readonlyArgs, p_attempt: randomUUID(), p_encrypted: "synthetic-changed-missing-attempt" }, { status: 500, code: "P0002" }));
    });
    await stage("Google account grants CAS and anti-downgrade conflicts", async () => {
      for (const change of [{ p_account_id: "synthetic-other-account" }, { p_selected_permissions: ["email.send"] }]) await unchanged(() => service(rpcNames[1], { ...googleArgs, ...change }, { status: 409, code: "PT409" }));
      await unchanged(() => service(rpcNames[1], { ...googleArgs, p_verified_scopes: [googleScopes[0], "https://www.googleapis.com/auth/calendar.events.readonly"] }, { status: 400, code: "22023" }));
      await updateAttempt(googleAttempt, { expected_secret_updated_at: "1970-01-01T00:00:00.000Z" });
      await unchanged(() => service(rpcNames[1], googleArgs, { status: 409, code: "PT409" }));
      await updateAttempt(googleAttempt, { expected_secret_updated_at: (await readSecret(googleId)).updated_at });
      await service(rpcNames[1], googleArgs, { status: 204 });
      const connection = await readConnection(googleId), secret = await readSecret(googleId);
      assert.ok(connection.runtime_mode === "paused" && connection.config.workspace_view_only === true && connection.config.google_action_permissions.calendar_write === true && connection.config.google_action_permissions.email_send === false && secret.encrypted_value === googleArgs.p_encrypted, "Explicit Google consent must preserve import-only mode and the actual account pause.");
      await unchanged(() => service(rpcNames[1], googleArgs, { status: 500, code: "P0002" }));
      const downgrade = await attempt(googleId, "google_workspace", "read_only");
      await unchanged(() => service(rpcNames[0], { ...readonlyArgs, p_attempt: downgrade, p_account_id: googleArgs.p_account_id }, { status: 409, code: "PT409" }));
    });
    await stage("HubSpot exact consume CAS and native completion", async () => {
      await unchanged(() => service(rpcNames[3], hubspotArgs, { status: 409, code: "PT409" }));
      await collectOAuthConsumeRace([() => consume(hubspotAttempt, hubspotId), () => consume(hubspotAttempt, hubspotId)]);
      await service(rpcNames[3], hubspotArgs, { status: 204 });
      const connection = await readConnection(hubspotId), secret = await readSecret(hubspotId);
      assert.ok(connection.external_account_id === "810001" && connection.status === "connected" && connection.runtime_mode === "dry_run" && connection.config.hubspot_actions_enabled === false && connection.config.workspace_view_only === true && connection.config.hubspot_grant_revision === hubspotArgs.p_grant_revision && secret.encrypted_value === hubspotArgs.p_encrypted, "HubSpot completion must save exact provider pins without selecting or activating CRM actions.");
      await unchanged(() => service(rpcNames[3], hubspotArgs, { status: 500, code: "P0002" }));
    });
    await stage("HubSpot grant downgrade supersession account and stale conflicts", async () => {
      await unchanged(() => service(rpcNames[2], beginBody(hubspotId, []), { status: 409, code: "PT409" }));
      const body = beginBody(hubspotId), first = await service(rpcNames[2], body, { status: 200, begin: true }), next = await service(rpcNames[2], body, { status: 200, begin: true });
      assert.ok(first.body.attemptId !== next.body.attemptId && first.body.expectedAccountId === "810001" && next.body.expectedAccountId === "810001", "Repeated begin must truthfully supersede its attempt rather than pretend to replay a receipt.");
      await unchanged(() => service(rpcNames[3], hubspotFinish(first.body.attemptId), { status: 500, code: "P0002" }));
      const id = next.body.attemptId; assert.equal((await consume(id, hubspotId)).body.length, 1);
      const finish = hubspotFinish(id);
      for (const change of [{ p_account_id: "810002" }, { p_permissions: [] }, { p_verified_scopes: ["oauth"] }]) await unchanged(() => service(rpcNames[3], { ...finish, ...change }, { status: 409, code: "PT409" }));
      await updateAttempt(id, { expected_connection_updated_at: "1970-01-01T00:00:00.000Z" });
      await unchanged(() => service(rpcNames[3], finish, { status: 409, code: "PT409" }));
      await updateAttempt(id, { expected_connection_updated_at: (await readConnection(hubspotId)).updated_at });
      await service(rpcNames[3], finish, { status: 204 });
      assert.equal((await readConnection(hubspotId)).config.hubspot_grant_revision, finish.p_grant_revision, "Only the current verified callback may save its synthetic grant revision.");
      await unchanged(() => service(rpcNames[3], { ...finish, p_grant_revision: randomUUID() }, { status: 500, code: "P0002" }));
    });
    await stage("unchanged original owner data and zero execution effects", async () => {
      for (const original of originals) same(await scopeState(admin, fixture.partnerId, original.clientId), original.state, "OAuth transport fixtures must not alter either real owner workspace or its imported source/authority/history.");
      const state = await scopeState(admin, fixture.partnerId, clientId);
      for (const table of scopeTables.filter((name) => !["integration_connections", "integration_secrets", "business_connection_oauth_attempts"].includes(name))) assert.equal(state[table].length, 0, "Transport fixtures must create no team, activation, approvals, jobs, canonical business data or accounting effects.");
      const client = saved(await admin.from("client_businesses").select("default_runtime_mode,customer_system_connection_id,client_portal_enabled").eq("partner_id", fixture.partnerId).eq("id", clientId).single());
      assert.ok(client.default_runtime_mode === "sandbox" && client.customer_system_connection_id === null && client.client_portal_enabled === false, "The temporary transport client must remain sandbox and unselected, without a portal.");
      for (const table of ["memberships", "client_beta_acceptances", "business_context_reviews"]) assert.equal(saved(await admin.from(table).select("client_id").eq("partner_id", fixture.partnerId).eq("client_id", clientId)).length, 0, "Transport evidence must not fabricate owner membership, live acceptance or context review.");
      report.originalOwnerStateUnchanged = true;
    });
  } catch (error) { failure = error; report.status = "failed"; }
  finally {
    report.fixtureCleanup = "running"; await publish().catch(() => {});
    try {
      saved(await admin.from("client_businesses").delete().eq("partner_id", fixture.partnerId).eq("id", clientId).eq("slug", slug));
      const remaining = {};
      for (const table of ["client_businesses", ...scopeTables, "memberships", "client_beta_acceptances", "business_context_reviews", "hubspot_oauth_refresh_leases"]) {
        const query = admin.from(table).select("*", { count: "exact", head: true }).eq("partner_id", fixture.partnerId).eq(table === "client_businesses" ? "id" : "client_id", clientId);
        const result = await query; saved(result); assert.equal(result.count, 0, "Every synthetic OAuth fixture row must be removed before continuing the owner journey."); remaining[table] = result.count;
      }
      report.cleanupRemaining = remaining;
      for (const original of originals) same(await scopeState(admin, fixture.partnerId, original.clientId), original.state, "Cleanup must preserve the original owner source, control and execution history.");
      report.fixtureCleanup = "complete";
    } catch { report.fixtureCleanup = "failed"; failure ??= new Error("OAuth HTTP fixture cleanup failed closed; the owner journey cannot continue."); report.status = "failed"; }
    if (!failure) report.status = "passed";
    report.activeStep = null;
    try { await publish(); }
    catch {
      // An evidence transport failure must not replace the original HTTP or
      // session assertion. A success without its final evidence remains fatal.
      if (!failure) { report.status = "failed"; failure = new Error("OAuth HTTP final evidence publication failed; acceptance cannot be reported as passed."); }
    }
  }
  if (failure) throw failure;
  return report;
}
