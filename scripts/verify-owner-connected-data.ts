#!/usr/bin/env -S tsx
// Hosted disposable CI only. Provider transport fixtures establish no real
// OAuth consent, provider grants, external writes or customer delivery.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const CONFIRMATION = "owner-browser-disposable";
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(v);
let acceptanceStep = "protected fixture and hosted-CI guard";
type Fixture = { version: 1; confirmation: string; runId: string; partnerId: string; clientId: string; ownerId: string; marker: string };
type Row = Record<string, unknown>;
function connectedEnvironment(env: Record<string, string | undefined>): string {
  if (env.CI !== "true" || env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted" || !env.GITHUB_ENV || !env.RUNNER_TEMP || !isAbsolute(env.RUNNER_TEMP) || env.OWNER_BROWSER_CONFIRMATION !== CONFIRMATION)
    throw new Error("Hosted disposable CI and explicit owner-browser confirmation are required. No connection was attempted.");
  const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      !env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY || Buffer.from(env.SECRETS_ENCRYPTION_KEY ?? "", "base64").length !== 32)
    throw new Error("An explicit loopback API-backed disposable database and configured encryption are required.");
  return url.origin;
}
export function validateOwnerConnectedFixture(raw: unknown, env: Record<string, string | undefined>): { fixture: Fixture; origin: string } {
  const origin = connectedEnvironment(env), f = raw as Fixture;
  if (!f || f.version !== 1 || f.confirmation !== CONFIRMATION || !/^[a-f\d]{12}$/.test(f.runId) || ![f.partnerId, f.clientId, f.ownerId].every(uuid) ||
      !new RegExp(`^owner-browser-${f.runId}-(desktop|phone)-source$`).test(f.marker)) throw new Error("Invalid protected browser-created workspace reference.");
  return { fixture: f, origin };
}

export async function verifyOwnerConnectedData(args = process.argv.slice(2)) {
  connectedEnvironment(process.env);
  if (args.length !== 4 || args[0] !== "--fixture" || args[2] !== "--report" || !isAbsolute(args[1]) || !isAbsolute(args[3]) || resolve(args[1]) === resolve(args[3]))
    throw new Error("Use --fixture <absolute protected JSON path> --report <absolute new report path>.");
  if (![args[1], args[3]].every((path) => resolve(path).startsWith(resolve(process.env.RUNNER_TEMP!) + sep))) throw new Error("Protected fixtures and safe reports must remain within the disposable runner temporary directory.");
  const info = await lstat(args[1]);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 20000 || typeof process.getuid === "function" && info.uid !== process.getuid())
    throw new Error("The workspace reference must be a private regular file owned by this CI process.");
  const { fixture: f, origin } = validateOwnerConnectedFixture(JSON.parse(await readFile(args[1], "utf8")), process.env);
  const prefix = `owner-browser-${f.runId}`, scope = { partnerId: f.partnerId, clientId: f.clientId };
  const now = Date.now(), base = now - 60_000, clock = (round = 0) => new Date(base + round * 1000).toISOString();
  // Fixture-only all-day source evidence stays observable in the business day
  // even when hosted acceptance runs near midnight. It is not a booking receipt.
  const dayParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  const dayPart = (key: string) => dayParts.find((part) => part.type === key)!.value;
  const appointmentDay = `${dayPart("year")}-${dayPart("month")}-${dayPart("day")}`;
  const appointmentEndDay = new Date(Date.parse(`${appointmentDay}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const epoch = (round = 0) => Math.floor((base + round * 1000) / 1000);
  const portal = f.marker.includes("-desktop-") ? "900000001" : "900000002";
  const tag = f.marker.replaceAll("-", ""), invoiceId = `in_${tag}`, paymentId = `pi_${tag}`;
  const expected = { invoiceNumber: `${f.marker}-invoice`, customerName: `${f.marker} customer updated`, inquiryTitle: `${f.marker} inquiry`, appointmentTitle: `${f.marker} appointment updated`, messageSubject: `${f.marker} message` };
  let round = 0, conflicting = false, forbiddenNetwork = 0;
  const calls: Record<string, number> = {}, originalFetch = globalThis.fetch;
  const oldEnv = Object.fromEntries(["HUBSPOT_CLIENT_ID", "HUBSPOT_CLIENT_SECRET", "APP_URL"].map((key) => [key, process.env[key]]));
  const hubClient = `fixture-${f.runId}`, access = `fixture-access-${f.marker}`;
  const hubScopes = ["crm.objects.contacts.read", "crm.objects.deals.read", "oauth"];
  const contact = (id: string, archived = false): Row => ({ id, archived, updatedAt: clock(id === "1002" ? 0 : round), ...(archived ? { archivedAt: clock(1) } : {}),
    properties: { hs_object_id: id, firstname: id === "1001" ? conflicting ? `${f.marker} conflicting source` : round ? expected.customerName : `${f.marker} customer` : `${f.marker} archived customer`, lastname: "", email: `${f.marker}@example.test`, lifecyclestage: "lead" } });
  globalThis.fetch = async (input, init) => {
    const u = new URL(input instanceof Request ? input.url : String(input)), method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (u.origin === origin && /^\/(rest|auth)\/v1(?:\/|$)/.test(u.pathname)) return originalFetch(input, { ...init, redirect: "error" });
    const key = `${method} ${u.origin}${u.pathname}`; calls[key] = (calls[key] ?? 0) + 1;
    const reply = (data: unknown) => Response.json(data);
    if (u.origin === "https://oauth2.googleapis.com" && u.pathname === "/token" && method === "POST") {
      const body = new URLSearchParams(String(init?.body)); assert.equal(body.get("client_id"), "synthetic-owner-google"); assert.equal(body.get("refresh_token"), `synthetic-refresh-${f.marker}`);
      return reply({ access_token: access });
    }
    if (u.origin === "https://api.hubapi.com" && u.pathname === "/oauth/2026-03/token/introspect" && method === "POST") {
      const body = new URLSearchParams(String(init?.body)); assert.equal(body.get("client_id"), hubClient); assert.equal(body.get("access_token"), access);
      return reply({ active: true, token: access, token_type: "Bearer", token_use: "access_token", client_id: hubClient, hub_id: portal, user_id: "77", app_id: "88", scopes: hubScopes, expires_in: 1700 });
    }
    if (method === "GET" && u.origin === "https://gmail.googleapis.com") {
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${access}`);
      if (u.pathname === "/gmail/v1/users/me/profile") return reply({ historyId: "100" });
      if (u.pathname === "/gmail/v1/users/me/messages") return reply({ messages: [{ id: "fixture-mail", threadId: "fixture-thread" }] });
      if (u.pathname === "/gmail/v1/users/me/history") return reply({ history: [{ messages: [{ id: "fixture-mail", threadId: "fixture-thread" }] }], historyId: "101" });
      if (u.pathname === "/gmail/v1/users/me/messages/fixture-mail") return reply({ id: "fixture-mail", threadId: "fixture-thread", internalDate: String(base), snippet: `${f.marker} synthetic received question`, labelIds: round ? ["INBOX"] : ["INBOX", "UNREAD"],
        payload: { headers: [{ name: "From", value: `Synthetic <${f.marker}@example.test>` }, { name: "To", value: "owner@example.test" }, { name: "Subject", value: expected.messageSubject }] } });
    }
    if (method === "GET" && u.origin === "https://www.googleapis.com" && u.pathname === "/calendar/v3/calendars/primary/events") {
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${access}`);
      return reply({ items: [{ id: "fixture-event", status: "confirmed", updated: clock(round), summary: round ? expected.appointmentTitle : `${f.marker} appointment`, start: { date: appointmentDay }, end: { date: appointmentEndDay }, htmlLink: "https://calendar.google.com/calendar/event?eid=synthetic" }], nextSyncToken: "fixture-calendar-cursor" });
    }
    if (method === "GET" && u.origin === "https://api.hubapi.com" && ["/crm/v3/objects/contacts", "/crm/v3/objects/deals", "/crm/v3/objects/notes"].includes(u.pathname)) {
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${access}`);
      const archived = u.searchParams.get("archived") === "true";
      if (u.pathname.endsWith("/contacts")) return reply(archived ? { results: round ? [contact("1002", true)] : [] }
        : u.searchParams.has("after") ? { results: round ? [] : [contact("1002")] } : { results: [contact("1001")], paging: { next: { after: "fixture-contact-next" } } });
      if (archived) return reply({ results: [] });
      return reply({ results: [{ id: u.pathname.endsWith("/deals") ? "2001" : "3001", archived: false, updatedAt: clock(round),
        properties: u.pathname.endsWith("/deals") ? { hs_object_id: "2001", dealname: `${f.marker} deal`, amount: "5000.25", dealstage: "qualified", deal_currency_code: "USD" } : { hs_object_id: "3001", hs_note_body: `${f.marker} source note`, hs_timestamp: clock(round) },
        associations: { contacts: { results: [{ id: "1001" }] } } }] });
    }
    if (method === "GET" && u.origin === "https://api.stripe.com" && ["/v1/invoices", "/v1/payment_intents"].includes(u.pathname)) {
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer rk_test_synthetic_${tag}`);
      return reply({ has_more: false, data: [u.pathname.endsWith("/invoices") ? { id: invoiceId, object: "invoice", customer: `cus_${tag}`, created: epoch(), livemode: false, number: expected.invoiceNumber, status: "open", collection_method: "send_invoice", currency: "usd", total: 1250, amount_due: 1250, amount_remaining: round ? 1000 : 1250, amount_paid: round ? 250 : 0, due_date: epoch() - 86400, status_transitions: { finalized_at: epoch() }, hosted_invoice_url: `https://invoice.stripe.com/i/${tag}` }
        : { id: paymentId, object: "payment_intent", customer: `cus_${tag}`, created: epoch(), amount: 1250, amount_received: 1250, status: "succeeded", currency: "usd", description: `${f.marker} payment`, latest_charge: { id: `ch_${tag}`, amount_captured: 1250, amount_refunded: round ? 100 : 0, refunds: { data: round ? [{ created: epoch(1) }] : [] }, receipt_url: "https://pay.stripe.com/receipts/synthetic" } }] });
    }
    forbiddenNetwork++;
    throw new Error("Unexpected or external network request blocked by the owner connected-data fixture transport.");
  };
  process.env.HUBSPOT_CLIENT_ID = hubClient; process.env.HUBSPOT_CLIENT_SECRET = "synthetic-owner-secret"; process.env.APP_URL = "https://owner-browser-fixture.invalid";
  try {
    const [{ createClient }, { encryptSecret }, { enqueueInitialConnectorSync, processConnectorSyncJobs }, { loadConnectedRecords }, { readBusinessContext }, { buildManagerContext }, { normalizeOwnerIntake }, { persistOwnerImportRecord }] = await Promise.all([
      import("@supabase/supabase-js"), import("../lib/integrations/secrets.ts"), import("../lib/integrations/connectors/sync-runner.ts"), import("../lib/connections/canonical-loader.ts"),
      import("../lib/business/context-data.ts"), import("../lib/business/context.ts"), import("../lib/connections/intake.ts"), import("../lib/connections/import-store.ts"),
    ]);
    const admin = createClient(origin, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    acceptanceStep = "real browser-created owner, workspace and stopped authority";
    const checked = <T>(r: { data: T; error: unknown }, label: string): NonNullable<T> => { if (r.error) throw new Error(`Connected-data acceptance database step failed: ${label}.`); return r.data!; };
    const rows = async (table: string) => checked(await admin.from(table).select("*").eq("partner_id", f.partnerId).eq("client_id", f.clientId), table);
    const partner = checked(await admin.from("partners").select("slug,name").eq("id", f.partnerId).single(), "operator");
    assert.equal(partner.slug, prefix); assert.ok(partner.name.includes("synthetic CI operator"));
    const business = checked(await admin.from("client_businesses").select("id,partner_id,name,status,default_runtime_mode,crm_operating_mode").eq("id", f.clientId).eq("partner_id", f.partnerId).single(), "workspace");
    assert.equal(business.default_runtime_mode, "sandbox"); assert.equal(business.status, "active"); assert.equal(business.crm_operating_mode, "external_crm_only");
    const ownerLabel = f.marker.includes("-desktop-") ? "desktop" : "phone";
    assert.equal(business.name, `${prefix} ${ownerLabel}`);
    const identity = await admin.auth.admin.getUserById(f.ownerId);
    if (identity.error || !identity.data.user) throw new Error("The synthetic browser-created identity could not be verified.");
    assert.equal(identity.data.user.email, `${prefix}-${ownerLabel}@example.test`);
    const membership = checked(await admin.from("memberships").select("user_id,role,status").eq("partner_id", f.partnerId).eq("client_id", f.clientId).eq("user_id", f.ownerId).single(), "owner membership");
    assert.equal(membership.role, "client_owner"); assert.equal(membership.status, "active");
    const receipt = checked(await admin.from("first_owner_workspaces").select("client_id").eq("user_id", f.ownerId).single(), "genuine first-owner receipt"); assert.equal(receipt.client_id, f.clientId);
    const assertStopped = async () => {
      const team = (await rows("agent_team_settings"))[0]; assert.equal(team.status, "paused"); assert.ok(Object.values(team.channel_authority).every((v) => v === "off"));
      assert.equal((await rows("client_beta_acceptances")).length, 0);
      for (const table of ["action_jobs", "agent_work_items", "business_conversations", "crm_contacts", "crm_leads", "crm_appointments", "integration_events", "workflow_runs"]) assert.equal((await rows(table)).length, 0, `${table} must remain untouched by owner imports`);
    };
    await assertStopped(); assert.equal((await rows("integration_connections")).length, 0, "Only a fresh browser-created workspace is accepted");
    acceptanceStep = "synthetic read-only accounts and encrypted credentials";
    const providerKeys = ["google_workspace", "hubspot", "stripe", "generic_inbound_webhook"];
    const providers = checked(await admin.from("integration_providers").select("id,provider_key").in("provider_key", providerKeys), "catalog"); assert.equal(providers.length, providerKeys.length);
    const connections = Object.fromEntries(providerKeys.map((key) => [key, randomUUID()])), grant = randomUUID();
    for (const key of providerKeys) {
      const config = { workspace_view_only: true, owner_workspace_imports: true, ...(key === "hubspot" ? { hubspot_owner_crm: true, hubspot_actions_enabled: false, hubspot_grant_revision: grant, hubspot_secret_revision: grant, hubspot_config_revision: randomUUID(), hubspot_verified_scopes: hubScopes, hubspot_selected_permissions: [] } : {}) };
      checked(await admin.from("integration_connections").insert({ id: connections[key], ...{ partner_id: f.partnerId, client_id: f.clientId }, provider_id: providers.find((p) => p.provider_key === key)!.id, display_name: `${f.marker} ${key}`, external_account_name: `${f.marker} account`, external_account_id: key === "hubspot" ? portal : key === "stripe" ? `acct_${tag}` : key === "google_workspace" ? `synthetic-google-${tag}` : `${f.marker}-form`, status: "connected", credential_status: "configured", runtime_mode: "dry_run", config }), "source connection");
      if (key === "generic_inbound_webhook") continue;
      const credentials = key === "hubspot" ? { authType: "oauth", clientId: hubClient, accessToken: access, refreshToken: `synthetic-hub-refresh-${tag}`, accountId: portal, userId: "77", appId: "88", accountName: `${f.marker} account`, scopes: hubScopes, expiresAt: new Date(now + 30 * 60000).toISOString(), permissions: [], accessMode: "read_only", grantRevision: grant }
        : key === "google_workspace" ? { clientId: "synthetic-owner-google", clientSecret: "synthetic-owner-secret", refreshToken: `synthetic-refresh-${f.marker}`, accessMode: "read_only", accountId: `synthetic-google-${tag}` }
          : { apiKey: `rk_test_synthetic_${tag}`, accessMode: "read_only" };
      checked(await admin.from("integration_secrets").insert({ partner_id: f.partnerId, client_id: f.clientId, connection_id: connections[key], secret_kind: "provider_credentials", encrypted_value: encryptSecret(JSON.stringify(credentials)), last_four: "test" }), "synthetic encrypted credential");
      await enqueueInitialConnectorSync(admin, { ...scope, connectionId: connections[key], providerKey: key });
    }
    const intake = normalizeOwnerIntake("form.submitted", { id: `${f.marker}-form`, title: expected.inquiryTitle, name: `${f.marker} source claim`, message: `${f.marker} synthetic question from a real import contract`, submitted_at: clock() }, new Date().toISOString());
    assert.equal(await persistOwnerImportRecord(admin, { ...scope, connectionId: connections.generic_inbound_webhook }, intake, { eventAt: clock(), eventId: `${f.marker}-event`, observedAt: new Date().toISOString() }), true);
    const drain = async (key: string) => {
      let processed = 0;
      for (let turn = 0; turn < 10; turn++) { const result = await processConnectorSyncJobs(8, { connectionId: connections[key], readOnly: true }); processed += result.processed; if (!result.processed) break; assert.equal(result.failed, 0, `Background ${key} read failed`); }
      assert.ok(processed > 0, `Actual ${key} queue must execute`); return processed;
    };
    const executed: Record<string, number> = {};
    acceptanceStep = "actual initial background queue and canonical persistence";
    for (const key of providerKeys.slice(0, 3)) executed[key] = await drain(key);
    const initial = await loadConnectedRecords(admin, scope);
    assert.equal(initial.data.messages.length, 1); assert.equal(initial.data.appointments.length, 1); assert.equal(initial.data.invoices?.length, 1); assert.equal(initial.data.payments?.length, 1);
    assert.equal(initial.data.customers?.length, 2); assert.equal(initial.apps.find((a) => a.id === connections.hubspot)?.streams?.every((s) => s.status === "fresh"), true);
    const before = await rows("integration_canonical_records");
    acceptanceStep = "actual queued updates, archive evidence and source deduplication";
    round = 1;
    for (const key of providerKeys.slice(0, 3)) { checked(await admin.from("integration_sync_jobs").update({ scheduled_for: new Date().toISOString() }).eq("partner_id", f.partnerId).eq("client_id", f.clientId).eq("connection_id", connections[key]).eq("status", "queued"), "due follow-up import"); executed[key] += await drain(key); }
    let imported = await loadConnectedRecords(admin, scope);
    assert.equal((await rows("integration_canonical_records")).length, before.length, "Replayed source identity must not create duplicates");
    assert.equal(imported.data.messages[0].unread, false); assert.equal(imported.data.appointments[0].title, expected.appointmentTitle);
    assert.equal(imported.data.customers?.find((r) => r.externalId === "1001")?.name, expected.customerName);
    assert.equal(imported.data.customers?.find((r) => r.externalId === "1002")?.archived, true);
    assert.equal(imported.data.invoices?.[0].amountDueMinor, 1000); assert.equal(imported.data.payments?.[0].amountRefundedMinor, 100);
    // A real conflicting canonical write is refused by SQL, marks its stream
    // failing, and cannot erase the prior successful completion or target facts.
    const completedBefore = imported.apps.find((a) => a.id === connections.hubspot)!.streams!.find((s) => s.key === "customer")!.lastSyncedAt;
    acceptanceStep = "equal-clock source conflict and retained completed import";
    conflicting = true;
    checked(await admin.from("integration_sync_jobs").update({ scheduled_for: new Date().toISOString() }).eq("partner_id", f.partnerId).eq("client_id", f.clientId).eq("connection_id", connections.hubspot).eq("object_type", "customer").eq("status", "queued"), "due conflict import");
    const failure = await processConnectorSyncJobs(4, { connectionId: connections.hubspot, readOnly: true }); assert.equal(failure.failed, 1); executed.hubspot += failure.processed;
    imported = await loadConnectedRecords(admin, scope); const failedStream = imported.apps.find((a) => a.id === connections.hubspot)!.streams!.find((s) => s.key === "customer")!;
    assert.equal(failedStream.status, "error"); assert.equal(failedStream.lastSyncedAt, completedBefore);
    assert.equal(imported.data.customers?.find((r) => r.externalId === "1001")?.name, expected.customerName);
    conflicting = false;
    acceptanceStep = "complete background scan recovery after source conflict";
    await enqueueInitialConnectorSync(admin, { ...scope, connectionId: connections.hubspot, providerKey: "hubspot" }); executed.hubspot += await drain("hubspot");
    imported = await loadConnectedRecords(admin, scope); assert.equal(imported.apps.find((a) => a.id === connections.hubspot)!.streams!.find((s) => s.key === "customer")!.status, "fresh", "Later complete scans recover while old dead-letter attempts remain immutable");
    const providerCallsBeforePause = Object.values(calls).reduce((a, n) => a + n, 0);
    acceptanceStep = "source pause and deliberate read-only resumption";
    checked(await admin.rpc("manage_readonly_workspace_connection", { p_partner: f.partnerId, p_client: f.clientId, p_connection: connections.hubspot, p_action: "pause" }), "pause source");
    assert.equal((await processConnectorSyncJobs(4, { connectionId: connections.hubspot, readOnly: true })).processed, 0);
    assert.equal(Object.values(calls).reduce((a, n) => a + n, 0), providerCallsBeforePause);
    checked(await admin.rpc("manage_readonly_workspace_connection", { p_partner: f.partnerId, p_client: f.clientId, p_connection: connections.hubspot, p_action: "resume" }), "resume imports only");
    await enqueueInitialConnectorSync(admin, { ...scope, connectionId: connections.hubspot, providerKey: "hubspot" }); executed.hubspot += await drain("hubspot");
    imported = await loadConnectedRecords(admin, scope);
    acceptanceStep = "same owner and manager source evidence, stopped actions and safe report";
    const manager = buildManagerContext(await readBusinessContext(admin, scope, false));
    for (const app of imported.apps) for (const stream of app.streams ?? []) { const coverage = manager.coverage.find((r) => r.key === `${app.id}:${stream.key}`); assert.equal(coverage?.status, stream.status); assert.equal(coverage?.lastUpdatedAt, stream.lastSyncedAt); }
    for (const source of imported.rows) assert.ok(manager.records.some((r) => r.id === source.id), "Owner and manager must use the same actual imported sources");
    await assertStopped(); assert.equal(forbiddenNetwork, 0);
    assert.ok((await rows("integration_connections")).every((c) => c.runtime_mode === "dry_run" && c.config.workspace_view_only === true && c.config.hubspot_actions_enabled !== true));
    const source = (key: string, type: string, external: string) => { const r = imported.rows.find((r) => r.connection_id === connections[key] && r.object_type === type && r.external_object_id === external); assert.ok(r); return { connectionId: r.connection_id, recordId: r.id }; };
    const report = { version: 1, clientId: f.clientId, marker: f.marker, expected, counts: { canonical: imported.rows.length, messages: imported.data.messages.length, appointments: imported.data.appointments.length, customers: imported.data.customers?.length, invoices: imported.data.invoices?.length, payments: imported.data.payments?.length, intake: imported.data.leads?.length }, sourceRefs: { hubspot: source("hubspot", "customer", "1001"), invoice: source("stripe", "invoice", invoiceId), message: source("google_workspace", "message", "fixture-mail"), appointment: source("google_workspace", "appointment", "fixture-event") }, executedJobs: executed,
      proof: { actualQueue: true, actualCanonicalRpc: true, ownerManagerSourcesMatch: true, providerTransportFixtures: true, externalNetworkRequests: 0, liveOAuth: false, liveProviderWrites: false, teamPaused: true, sandboxPreserved: true, paginationArchiveUpdateConflictRecoveryPause: true } };
    await writeFile(args[3], `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    console.log(`PASS: actual queued connected-data import and owner/manager read models for ${f.marker}; provider transport fixtures only, no live OAuth or external write proof.`);
    return report;
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) verifyOwnerConnectedData().catch((error: unknown) => {
  const location = error instanceof Error ? error.stack?.split("\n").find((line) => line.includes("verify-owner-connected-data.ts:") && line.trim().startsWith("at "))?.trim() : null;
  console.error(`FAIL: owner connected-data acceptance at ${acceptanceStep}${location ? ` (${location})` : ""}. Provider transport fixtures are not live-provider proof; protected fixture identifiers and credentials are not logged.`); process.exitCode = 1;
});
