// Disposable hosted-CI HTTP evidence only. Authentication is produced by the
// existing normal email UI; this module never creates or injects a session.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertHostedCi } from "./ci-bootstrap-customer-journey-db.mjs";
import { inspectWorkspacePreferenceResponse, withOwnerBrowserDeadline } from "./owner-workspace-browser-scenarios.mjs";

const contextPath = "/api/business/context";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function assertFoundationHttpScope({ fixture, owners, target, env }) {
  assertHostedCi(env);
  assert.equal(env.OWNER_BROWSER_CONFIRMATION, "owner-browser-disposable");
  assert.match(fixture.prefix, /^owner-browser-[a-f0-9]{12}$/); assert.match(fixture.partnerId, uuid);
  for (const name of ["appUrl", "supabaseUrl"]) {
    const url = new URL(target[name]);
    assert.ok(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash, "Foundation HTTP requires the explicit disposable loopback origins.");
  }
  assert.equal(new URL(target.appUrl).port, "3000");
  assert.equal(owners.length, 2); assert.ok(new Set(owners.map((owner) => owner.clientId)).size === 2);
  assert.ok(new Set(owners.map((owner) => owner.userId)).size === 2);
  assert.ok(owners.some((owner) => owner.label === "desktop") && owners.some((owner) => owner.label === "phone"));
  for (const owner of owners) {
    for (const id of [owner.userId, owner.clientId, owner.membershipId, owner.receiptId]) assert.match(id, uuid);
    assert.ok(owner.marker.startsWith(`${fixture.prefix}-`));
  }
}
export async function readFoundationHttpJson(action, { operation, expected = [200], phase = async () => {}, diagnose403 }) {
  await phase(`${operation}: request`);
  let response;
  try { response = await withOwnerBrowserDeadline("foundation HTTP response headers", action, 15000); }
  catch { throw new Error(`${operation}: response headers unavailable within the bounded request.`); }
  const status = response.status();
  const record = async (value) => { if (status === 403 && !expected.includes(status)) { try { await phase(value); } catch { /* Original403 remains the failure. */ } } else await phase(value); };
  await record(`${operation}: HTTP ${status}; read JSON`);
  let body;
  try { body = await withOwnerBrowserDeadline("foundation HTTP response JSON", () => response.json(), 10000); }
  catch {
    if (status === 403 && !expected.includes(status)) await inspectWorkspacePreferenceResponse({ status: () => status, json: async () => { throw new Error("Unavailable diagnostic JSON"); } }, { operation, phase, diagnose403 }, true);
    throw new Error(`${operation}: HTTP ${status}; complete JSON unavailable.`);
  }
  await record(`${operation}: HTTP ${status}; JSON complete`);
  if (status === 403 && !expected.includes(status)) {
    // Reuse the existing fixed-enum/later-state diagnosis without another
    // request/body read, and retain the original failed HTTP assertion.
    await inspectWorkspacePreferenceResponse({ status: () => status, json: async () => body }, { operation, phase, diagnose403 }, true);
  }
  assert.ok(expected.includes(status), `${operation}: expected HTTP ${expected.join("/")}, received ${status}.`);
  return { status, body };
}
export async function collectFoundationHttpRace(actions) {
  // Retain both real outcomes before failing; never retry a losing request.
  const outcomes = await Promise.allSettled(actions.map((action) => action()));
  assert.ok(outcomes.every((outcome) => outcome.status === "fulfilled"), "Every foundation race attempt must complete its actual HTTP and JSON response.");
  return outcomes.map((outcome) => outcome.value);
}
function commandReceipt(response, replayed) {
  const receipt = response.body?.result;
  assert.ok(response.status === 200 && receipt && uuid.test(receipt.id) && Number.isSafeInteger(receipt.revision) && receipt.revision >= 0 && Number.isSafeInteger(receipt.cancelledWork) && receipt.cancelledWork >= 0 && receipt.replayed === replayed && typeof receipt.message === "string" && receipt.message.length > 0, "The real owner command must return a complete durable receipt.");
  return receipt;
}
function same(value, expected, message) { assert.ok(JSON.stringify(value) === JSON.stringify(expected), message); }
async function effects(admin, scope) {
  const result = {};
  for (const table of ["action_jobs", "agent_work_items", "integration_sync_jobs"]) {
    const read = await admin.from(table).select("id", { count: "exact", head: true }).eq("partner_id", scope.partnerId).eq("client_id", scope.clientId);
    assert.equal(read.error, null, "Scoped execution effects must be readable."); result[table] = read.count;
  }
  return result;
}
async function controlState(admin, scope) {
  const result = {};
  for (const [table, fields] of [["business_workspace_profiles", "profile,updated_at"], ["business_context_reviews", "profile_revision,actor_id,reviewed_at"], ["agent_team_settings", "status,authority_revision,channel_authority"]]) {
    const read = await admin.from(table).select(fields).eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).maybeSingle();
    assert.equal(read.error, null, "Scoped context controls must be readable."); result[table] = read.data;
  }
  const receipts = await admin.from("business_owner_commands").select("id", { count: "exact", head: true }).eq("partner_id", scope.partnerId).eq("client_id", scope.clientId);
  assert.equal(receipts.error, null); result.receipts = receipts.count;
  return result;
}
async function approvalRow(admin, scope, id) {
  const row = await admin.from("approval_items").select("id,status,resolved_by,resolved_content,proposed_payload").eq("id", id).eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).single();
  assert.equal(row.error, null); return row.data;
}
export function assertFoundationApprovalDecision(response, success) {
  const body = response.body;
  assert.ok(body && typeof body === "object" && !Array.isArray(body) && body.status === (success ? "success" : "error") && body.httpStatus === response.status && (success ? response.status === 200 : response.status !== 200) && [200, 400, 403, 404, 409, 413, 422, 503].includes(response.status) &&
    typeof body.message === "string" && body.message.trim().length > 0 && body.message.length <= 4000 &&
    Object.keys(body).every((key) => ["status", "httpStatus", "message", "fieldErrors"].includes(key)) && Buffer.byteLength(JSON.stringify(body), "utf8") <= 32768,
  "The consumed owner approval API must return its complete bounded decision receipt and HTTP status.");
  if (body.fieldErrors !== undefined) assert.ok(body.fieldErrors && typeof body.fieldErrors === "object" && !Array.isArray(body.fieldErrors) && Object.keys(body.fieldErrors).length <= 20 && Object.entries(body.fieldErrors).every(([key, value]) => key.length <= 80 && typeof value === "string" && value.length <= 1000), "The approval receipt field errors must match the bounded public contract.");
}
const decision = assertFoundationApprovalDecision;
async function createWebsiteFixture(admin, scope, label, register) {
  const saved = (value) => { assert.equal(value.error, null, "A native website fixture must use the real scoped schema."); return value.data; };
  assert.equal(saved(await admin.rpc("business_channel_can_draft", { p_partner: scope.partnerId, p_client: scope.clientId, p_channel: "website_chat", p_connection: null })), true, "The current reviewed website policy must genuinely allow drafting.");
  const provider = saved(await admin.from("integration_providers").select("id").eq("provider_key", "northstar_web_chat").eq("is_active", true).single());
  const value = { ...scope, connectionId: randomUUID(), contactId: randomUUID(), conversationId: randomUUID(), approvalIds: [randomUUID(), randomUUID()] };
  register(value); // Finally cleanup also covers a partially written fixture.
  saved(await admin.from("integration_connections").insert({ id: value.connectionId, partner_id: scope.partnerId, client_id: scope.clientId, provider_id: provider.id, display_name: `Synthetic foundation website ${label}`, status: "connected", runtime_mode: "dry_run", credential_status: "configured", config: { activation_managed: false } }));
  saved(await admin.from("crm_contacts").insert({ id: value.contactId, partner_id: scope.partnerId, client_id: scope.clientId, first_name: "Synthetic website visitor", source: "cj_acceptance" }));
  saved(await admin.from("business_conversations").insert({ id: value.conversationId, partner_id: scope.partnerId, client_id: scope.clientId, connection_id: value.connectionId, channel: "website_chat", external_thread_id: `foundation-${randomUUID()}`, contact_id: value.contactId, identity_status: "unverified", mode: "agent", state: "open" }));
  // Native INSERT is fixture evidence, not ingest_business_message. The real
  // queue is explicitly checked unchanged; no trigger or RLS is disabled.
  saved(await admin.from("business_conversation_messages").insert({ partner_id: scope.partnerId, client_id: scope.clientId, conversation_id: value.conversationId, external_key: `foundation-${randomUUID()}`, direction: "inbound", body: "Synthetic source request: please explain your service.", status: "received" }));
  const conversation = saved(await admin.from("business_conversations").select("revision").eq("id", value.conversationId).eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).single());
  const safety = saved(await admin.rpc("conversation_action_check", { p_conversation: value.conversationId, p_revision: conversation.revision, p_human: false }));
  assert.ok(safety?.allowed === true, "The exact native website source must pass its current policy before becoming stale.");
  const settings = saved(await admin.from("agent_team_settings").select("authority_revision").eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).single());
  saved(await admin.from("approval_items").insert(value.approvalIds.map((id) => ({ id, partner_id: scope.partnerId, client_id: scope.clientId, type: "customer_message", status: "pending", title: `Synthetic website authority ${label}`, editable_content: "Our team will review this synthetic service request.", proposed_payload: { channel: "website_chat", conversation_id: value.conversationId, conversation_revision: conversation.revision, connection_id: value.connectionId, to: `foundation-${label}`, human_authored: false, authority_revision: settings.authority_revision }, expires_at: new Date(Date.now() + 3600000).toISOString() }))));
  return value;
}
export async function runOwnerFoundationConflictHttp({ admin, fixture, owners, target, readSession, verifySession, diagnoseAccess, phase = async () => {}, onProgress = async () => {}, env = process.env, request = fetch }) {
  assertFoundationHttpScope({ fixture, owners, target, env });
  const report = { version: 1, status: "in_progress", activeStep: null, checks: [], fixtureCleanup: "not_started", providerWrites: false,
    limitations: ["Synthetic disposable fixtures and genuine owner sessions only; no live provider or model request.", "App approval races use HTTP200/409; a raw pending-filter PATCH returning no rows is a different boundary."] };
  const createdApprovals = [], nativeFixtures = [], originals = [];
  const publish = () => onProgress({ ...report, checks: report.checks.map((check) => ({ ...check })), limitations: [...report.limitations] });
  const stage = async (key, action) => {
    report.activeStep = key; await publish(); await phase(`foundation: ${key}: starting`);
    try { await withOwnerBrowserDeadline(`foundation stage ${key}`, action, 120000); report.checks.push({ key, status: "passed" }); report.activeStep = null; await publish(); }
    catch (error) { report.checks.push({ key, status: "failed" }); report.status = "failed"; await publish().catch(() => {}); throw error; }
  };
  let failure;
  try {
    for (const owner of owners) {
      const scope = { partnerId: fixture.partnerId, clientId: owner.clientId }, other = owners.find((candidate) => candidate.userId !== owner.userId);
      const ownerPhase = (operation) => `${owner.label}: foundation ${operation}`;
      const diagnose403 = diagnoseAccess ? () => diagnoseAccess(owner) : undefined;
      const call = (path, body, expected = [200], operation = "owner request", origin = target.appUrl) => readFoundationHttpJson(() => body === undefined
        ? owner.context.request.get(`${target.appUrl}${path}`, { timeout: 15000 })
        : owner.context.request.post(`${target.appUrl}${path}`, { headers: { Origin: origin }, data: body, timeout: 15000 }), { operation: ownerPhase(operation), expected, phase, diagnose403 });
      const snapshot = async (operation = "context GET") => {
        const response = await call(contextPath, undefined, [200], operation), value = response.body;
        assert.ok(value?.version === 1 && value.canWrite === true && value.scope?.partnerId === scope.partnerId && value.scope?.clientId === scope.clientId && typeof value.revision === "string" && Number.isSafeInteger(value.authority?.revision), "The context snapshot must be complete and scoped to the real owner."); return value;
      };
      const command = (body, expected, operation) => call(contextPath, body, expected, operation);
      const profile = (value, operation) => call("/api/business/workspace", { action: "save_profile", profile: value }, [200], operation);
      const approval = (id, resolution, expected, operation, extra = {}) => call(`/api/business/approvals/${id}`, { resolution, ...extra }, expected, operation);
      const unchanged = async (action, operation) => { const before = await controlState(admin, scope), work = await effects(admin, scope); await action(); same(await controlState(admin, scope), before, `${operation} must not change controls or receipts.`); same(await effects(admin, scope), work, `${operation} must not create execution work.`); };
      let originalProfile, baselineEffects, token;
      await stage(`${owner.label}: genuine session and scoped foundation`, async () => {
        token = await readSession(owner.context, target); await verifySession(target, token, owner.userId);
        const receipt = await admin.from("first_owner_workspaces").select("id").eq("id", owner.receiptId).eq("user_id", owner.userId).eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).single(); assert.equal(receipt.error, null);
        const current = await snapshot(); originalProfile = current.profile; baselineEffects = await effects(admin, scope);
        const settings = await admin.from("agent_team_settings").select("status,channel_authority,conversations_enabled,sales_enabled,scheduling_enabled").eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).single(); assert.equal(settings.error, null);
        const knowledge = await admin.from("client_knowledge_profiles").select("business_description,services_offered,business_hours,booking_rules").eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).maybeSingle(); assert.equal(knowledge.error, null);
        const review = await admin.from("business_context_reviews").select("profile_revision").eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).maybeSingle(); assert.equal(review.error, null); assert.equal(review.data, null, "This new-owner foundation must start without a fabricated context review.");
        originals.push({ ...scope, profile: originalProfile, settings: settings.data, knowledge: knowledge.data, baselineEffects });
        assert.ok(current.authority.status === "paused" && Object.values(current.authority.channels).every((mode) => mode === "off"), "Foundation evidence begins with the genuine stopped workspace.");
        const scoped = await call(`${contextPath}?clientId=${other.clientId}`, undefined, [200], "foreign context query");
        assert.ok(scoped.body.scope.clientId === owner.clientId, "A query string cannot switch the real owner's context.");
      });
      await stage(`${owner.label}: reviewed context receipt and stale source`, async () => {
        let current = await snapshot();
        await unchanged(() => command({ action: "set_authority", key: randomUUID(), expectedRevision: current.authority.revision, channel: "website", mode: "draft" }, [422], "unreviewed drafting denied"), "Unreviewed authority");
        const review = { action: "review_context", key: randomUUID(), expectedContextRevision: current.revision };
        const first = commandReceipt(await command(review, [200], "review current facts"), false);
        const replay = commandReceipt(await command(review, [200], "exact review receipt retry"), true);
        assert.ok(first.id === replay.id && first.revision === replay.revision, "An exact retry must return the original saved review receipt.");
        await unchanged(() => command({ ...review, expectedContextRevision: "1970-01-01T00:00:00.000Z" }, [409], "changed review key denied"), "Changed review key");
        const changed = { ...originalProfile, description: `${originalProfile.description}\nSynthetic disposable foundation review.` };
        const saved = await profile(changed, "save owner profile change"); assert.ok(saved.body.ok === true, "The normal profile API must confirm the source change.");
        current = await snapshot("changed profile context GET"); assert.ok(current.revision !== review.expectedContextRevision, "The actual profile save must advance its source revision.");
        await unchanged(() => command({ ...review, key: randomUUID() }, [409], "stale source review denied"), "Stale context review");
        commandReceipt(await command({ action: "review_context", key: randomUUID(), expectedContextRevision: current.revision }, [200], "review current changed facts"), false);
      });
      await stage(`${owner.label}: authority compare and swap and exact receipt`, async () => {
        const current = await snapshot(), revision = current.authority.revision;
        const commands = ["website", "instagram"].map((channel) => ({ action: "set_authority", key: randomUUID(), expectedRevision: revision, channel, mode: "observe" }));
        const outcomes = await collectFoundationHttpRace(commands.map((body, index) => () => command(body, [200, 409], `authority race attempt ${index + 1}`)));
        same(outcomes.map((value) => value.status).sort(), [200, 409], "One real authority revision must have exactly one winner and one conflict.");
        const winner = outcomes.findIndex((value) => value.status === 200), receipt = commandReceipt(outcomes[winner], false);
        const after = await snapshot("authority race saved context GET");
        assert.ok(after.authority.revision === revision + 1 && after.authority.status === "paused", "Only the winning authority change may advance the stopped team.");
        assert.ok(after.authority.channels[commands[winner].channel] === "observe" && after.authority.channels[commands[1 - winner].channel] === "off", "The losing authority request cannot alter its channel.");
        const replay = commandReceipt(await command(commands[winner], [200], "authority exact receipt retry"), true); assert.ok(replay.id === receipt.id && replay.revision === receipt.revision, "Authority replay must retain its durable receipt.");
        await unchanged(() => command({ ...commands[winner], mode: "off" }, [409], "changed authority key denied"), "Changed authority key");
        await unchanged(() => command({ action: "set_authority", key: randomUUID(), expectedRevision: revision, channel: "sms", mode: "observe" }, [409], "stale authority revision denied"), "Stale authority revision");
        await unchanged(() => command({ action: "manager_control", key: randomUUID(), expectedRevision: after.authority.revision, command: "maybe pause the team" }, [422], "ambiguous manager control denied"), "Ambiguous control");
        await unchanged(() => command({ action: "manager_control", key: randomUUID(), expectedRevision: after.authority.revision, command: "Pause team", actorId: other.userId }, [400], "body actor rejected"), "Supplied actor");
        await unchanged(() => call(contextPath, { action: "manager_control", key: randomUUID(), expectedRevision: after.authority.revision, command: "Pause team" }, [403], "foreign origin rejected", "https://outside.invalid"), "Foreign origin");
      });
      const createApproval = async () => {
        const id = randomUUID(); const saved = await admin.from("approval_items").insert({ id, partner_id: scope.partnerId, client_id: scope.clientId, type: "content_draft", status: "pending", title: `${fixture.prefix} synthetic foundation decision ${id.slice(0, 8)}`, summary: "Disposable HTTP decision evidence; no customer or provider action.", editable_content: "Synthetic disposable review only.", proposed_payload: {} });
        assert.equal(saved.error, null, "A scoped synthetic no-action proposal must be stored."); createdApprovals.push({ id, ...scope }); return id;
      };
      await stage(`${owner.label}: consumed approval API decisions and conflict`, async () => {
        for (const resolution of ["approve", "reject"]) {
          const id = await createApproval(), response = await approval(id, resolution, [200], `${resolution} no-action proposal`); decision(response, true);
          const row = await approvalRow(admin, scope, id); assert.ok(row.status === (resolution === "approve" ? "approved" : "rejected") && row.resolved_by === owner.userId, "The real caller must durably resolve its scoped proposal.");
          decision(await approval(id, resolution, [409], "resolved decision conflict"), false);
        }
        const id = await createApproval(), choices = ["approve", "reject"];
        const outcomes = await collectFoundationHttpRace(choices.map((choice, index) => () => approval(id, choice, [200, 409], `approval race attempt ${index + 1}`)));
        same(outcomes.map((value) => value.status).sort(), [200, 409], "The consumed approval API must expose exactly one winner and one conflict.");
        for (const outcome of outcomes) decision(outcome, outcome.status === 200);
        const winner = outcomes.findIndex((value) => value.status === 200), row = await approvalRow(admin, scope, id);
        assert.ok(row.status === (choices[winner] === "approve" ? "approved" : "rejected") && row.resolved_by === owner.userId, "The saved approval must match the sole HTTP winner.");
        const rawPatch = async (pendingOnly) => {
          const response = await request(`${target.supabaseUrl}/rest/v1/approval_items?id=eq.${id}&client_id=eq.${owner.clientId}${pendingOnly ? "&status=eq.pending" : ""}`, { method: "PATCH", headers: { apikey: target.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ status: "rejected", resolved_by: owner.userId }), signal: AbortSignal.timeout(15000), redirect: "error" });
          return { status: () => response.status, json: () => response.json() };
        };
        const conditional = await readFoundationHttpJson(() => rawPatch(true), { operation: ownerPhase("raw terminal pending-filter PATCH"), expected: [200], phase });
        assert.ok(Array.isArray(conditional.body) && conditional.body.length === 0, "A raw pending-filter loser returns HTTP200 with no rows; the consumed app maps its decision conflict to409.");
        const immutable = await readFoundationHttpJson(() => rawPatch(false), { operation: ownerPhase("direct immutable row PATCH"), expected: [409], phase });
        assert.ok(immutable.body?.code === "PT409", "The real terminal-row guard must return the non-retryable conflict code.");
        same(await approvalRow(admin, scope, id), row, "The immutable-row conflict cannot rewrite the winner.");
        const untouched = await createApproval();
        decision(await approval(untouched, "reject", [400], "approval body actor denied", { actorId: other.userId }), false);
        decision(await approval(untouched, "reject", [400], "approval body tenant denied", { clientId: other.clientId }), false);
        decision(await call(`/api/business/approvals/${untouched}`, { resolution: "reject" }, [403], "approval foreign origin denied", "https://outside.invalid"), false);
        const foreign = await readFoundationHttpJson(() => other.context.request.post(`${target.appUrl}/api/business/approvals/${untouched}`, { headers: { Origin: target.appUrl }, data: { resolution: "reject" }, timeout: 15000 }), { operation: ownerPhase("cross-owner approval denied"), expected: [404], phase }); decision(foreign, false);
        assert.ok((await approvalRow(admin, scope, untouched)).status === "pending", "Forbidden requests cannot resolve a scoped proposal.");
      });
      await stage(`${owner.label}: current membership role denies approval`, async () => {
        const id = await createApproval();
        const exact = () => admin.from("memberships").update({ role: "client_viewer" }).eq("id", owner.membershipId).eq("user_id", owner.userId).eq("client_id", owner.clientId).eq("partner_id", scope.partnerId).eq("role", "client_owner").select("id").single();
        const changed = await exact(); assert.equal(changed.error, null, "Only this run's exact owner membership may become the temporary read-only fixture.");
        try { decision(await approval(id, "reject", [403], "read-only membership decision denied"), false); assert.ok((await approvalRow(admin, scope, id)).status === "pending", "A read-only role cannot resolve a proposal."); }
        finally {
          const restored = await admin.from("memberships").update({ role: "client_owner" }).eq("id", owner.membershipId).eq("user_id", owner.userId).eq("client_id", owner.clientId).eq("partner_id", scope.partnerId).eq("role", "client_viewer").select("id").single();
          assert.equal(restored.error, null, "The exact original owner role must be restored before the remaining UI journey.");
        }
      });
      await stage(`${owner.label}: owner decision UI consumes JSON route`, async () => {
        const id = await createApproval(), path = `/api/business/approvals/${id}`, page = owner.page;
        await page.goto(`${target.appUrl}${owner.label === "phone" ? "/client/mobile" : "/client/approvals"}`);
        if (owner.label === "phone") await page.getByRole("button").filter({ has: page.getByRole("heading", { name: `${fixture.prefix} synthetic foundation decision ${id.slice(0, 8)}`, exact: true }) }).click();
        const controls = page.locator(`[data-owner-approval-id='${id}']`); await controls.waitFor({ state: "visible" });
        const response = page.waitForResponse((value) => {
          try { return value.url() === `${target.appUrl}${path}` && value.request().method() === "POST" && value.request().postDataJSON()?.resolution === "reject"; } catch { return false; }
        }, { timeout: 15000 }); void response.catch(() => {});
        await phase(ownerPhase("actual UI Reject click")); await controls.getByRole("button", { name: "Reject", exact: true }).click(); assert.equal((await response).status(), 200, "The real owner UI must consume the JSON decision route.");
        // The browser adapter validates the JSON receipt. Require its rendered
        // success or refreshed resolved card, rather than reloading over Saving.
        await page.waitForFunction((approvalId) => { const form = document.querySelector(`[data-owner-approval-id='${approvalId}']`); return !form || form.querySelector('[role="status"]')?.textContent?.includes("Approval rejected"); }, id, { timeout: 15000 });
        const saved = await approvalRow(admin, scope, id); assert.ok(saved.status === "rejected" && saved.resolved_by === owner.userId, "The consumed UI route must save the genuine caller's decision.");
      });
      await stage(`${owner.label}: valid native proposal rejects stale authority`, async () => {
        // Explicit isolated fixture prerequisite, never attributed to the owner
        // API. Finally restores every original team flag and declared fact.
        await phase(ownerPhase("synthetic prerequisite conversations_enabled=true"));
        const enabled = await admin.from("agent_team_settings").update({ conversations_enabled: true }).eq("partner_id", scope.partnerId).eq("client_id", scope.clientId); assert.equal(enabled.error, null);
        let current = await snapshot();
        commandReceipt(await command({ action: "set_authority", key: randomUUID(), expectedRevision: current.authority.revision, channel: "website", mode: "require_approval" }, [200], "explicit website approval authority"), false);
        current = await snapshot(); commandReceipt(await command({ action: "manager_control", key: randomUUID(), expectedRevision: current.authority.revision, command: "Resume team" }, [200], "explicit owner Resume team"), false);
        const native = await createWebsiteFixture(admin, scope, owner.label, (value) => { nativeFixtures.push(value); for (const id of value.approvalIds) createdApprovals.push({ ...scope, id }); });
        same(await effects(admin, scope), baselineEffects, "The valid native fixture must not enqueue agent/provider work.");
        current = await snapshot(); commandReceipt(await command({ action: "manager_control", key: randomUUID(), expectedRevision: current.authority.revision, command: "Stop using website" }, [200], "explicit owner Stop website"), false);
        const before = await approvalRow(admin, scope, native.approvalIds[0]);
        decision(await approval(native.approvalIds[0], "approve", [409], "stale authority approval denied"), false);
        same(await approvalRow(admin, scope, native.approvalIds[0]), before, "A stale approval conflict must leave the valid pending proposal unchanged.");
        decision(await approval(native.approvalIds[1], "reject", [200], "stale proposal human rejection allowed"), true);
        assert.ok((await approvalRow(admin, scope, native.approvalIds[1])).status === "rejected", "Stale authority must not prevent human rejection.");
        current = await snapshot(); commandReceipt(await command({ action: "manager_control", key: randomUUID(), expectedRevision: current.authority.revision, command: "Pause team" }, [200], "explicit owner Pause team"), false);
      });
      await stage(`${owner.label}: restore full profile and stopped authority`, async () => {
        const saved = await profile(originalProfile, "restore owner profile"); assert.ok(saved.body.ok === true);
        let current = await snapshot("restore full context GET");
        for (const channel of ["website", "email", "sms", "instagram", "calendar"]) if (current.authority.channels[channel] !== "off") {
          commandReceipt(await command({ action: "set_authority", key: randomUUID(), expectedRevision: current.authority.revision, channel, mode: "off" }, [200], `restore ${channel} off`), false); current = await snapshot("restored channel context GET");
        }
        assert.ok(current.authority.status === "paused" && Object.values(current.authority.channels).every((mode) => mode === "off"), "The remaining24 UI stages must receive stopped authority.");
        same(current.profile, originalProfile, "The full original declared profile must be restored.");
        const review = await admin.from("business_context_reviews").select("client_id", { count: "exact", head: true }).eq("partner_id", scope.partnerId).eq("client_id", scope.clientId); assert.equal(review.error, null); assert.equal(review.count, 0, "Restored profile source must require a fresh review.");
        same(await effects(admin, scope), baselineEffects, "Foundation HTTP cannot create provider/outbox/agent/import work.");
      });
    }
    report.status = "passed";
  } catch (error) { failure = error; report.status = "failed"; }
  finally {
    report.fixtureCleanup = "running";
    const cleanup = await Promise.allSettled(createdApprovals.map((scope) => withOwnerBrowserDeadline("remove scoped foundation approval fixture", async () => {
      const removed = await admin.from("approval_items").delete().eq("id", scope.id).eq("partner_id", scope.partnerId).eq("client_id", scope.clientId);
      assert.equal(removed.error, null);
      const remaining = await admin.from("approval_items").select("id", { count: "exact", head: true }).eq("id", scope.id).eq("partner_id", scope.partnerId).eq("client_id", scope.clientId);
      assert.ok(!remaining.error && remaining.count === 0, "The scoped foundation proposal must be removed.");
    }, 10000)));
    if (cleanup.some((outcome) => outcome.status === "rejected")) { report.fixtureCleanup = "failed"; failure ||= new Error("Scoped foundation approval cleanup failed."); report.status = "failed"; }
    for (const native of nativeFixtures) {
      try {
        for (const [table, column, id] of [["business_conversation_messages", "conversation_id", native.conversationId], ["business_conversations", "id", native.conversationId], ["crm_contacts", "id", native.contactId], ["integration_connections", "id", native.connectionId]]) {
          const removed = await withOwnerBrowserDeadline("remove exact native foundation fixture", () => admin.from(table).delete().eq(column, id).eq("partner_id", native.partnerId).eq("client_id", native.clientId), 10000); assert.equal(removed.error, null);
        }
      } catch { report.fixtureCleanup = "failed"; failure ||= new Error("Scoped native foundation cleanup failed."); report.status = "failed"; }
    }
    for (const original of originals) {
      try {
        await withOwnerBrowserDeadline("restore original scoped foundation state", async () => {
        const scoped = { partner_id: original.partnerId, client_id: original.clientId };
        const profile = await admin.from("business_workspace_profiles").upsert({ ...scoped, profile: original.profile }, { onConflict: "client_id" }); assert.equal(profile.error, null);
        const knowledge = original.knowledge ? await admin.from("client_knowledge_profiles").upsert({ ...scoped, ...original.knowledge }, { onConflict: "client_id" }) : await admin.from("client_knowledge_profiles").delete().eq("partner_id", original.partnerId).eq("client_id", original.clientId); assert.equal(knowledge.error, null);
        const review = await admin.from("business_context_reviews").delete().eq("partner_id", original.partnerId).eq("client_id", original.clientId); assert.equal(review.error, null);
        const settings = await admin.from("agent_team_settings").update(original.settings).eq("partner_id", original.partnerId).eq("client_id", original.clientId); assert.equal(settings.error, null);
        const checked = await admin.from("agent_team_settings").select("status,channel_authority,conversations_enabled,sales_enabled,scheduling_enabled").eq("partner_id", original.partnerId).eq("client_id", original.clientId).single(); assert.equal(checked.error, null); same(checked.data, original.settings, "Every original team flag must be restored.");
        same(await effects(admin, original), original.baselineEffects, "Foundation fixture cleanup cannot leave execution effects.");
        }, 20000);
      } catch { report.fixtureCleanup = "failed"; failure ||= new Error("Original scoped foundation state restoration failed."); report.status = "failed"; }
    }
    if (report.fixtureCleanup === "running") report.fixtureCleanup = "complete";
    try { await publish(); } catch (error) { failure ||= error; }
  }
  if (failure) throw failure;
  return report;
}
