import test from "node:test";
import assert from "node:assert/strict";
import {
  hubspotAdapter, hubSpotSourceFingerprint, normalizeHubSpotRecord, pullHubSpotPage,
  readHubSpotObject, syncContactWithNote, testHubSpotConnection, verifyHubSpotReadSession,
} from "../lib/integrations/providers/hubspot.ts";
import { allowsConnectorWork, connectorCursorIsPartial } from "../lib/integrations/connectors/read-only-policy.ts";
import { executeConnectorSyncJob } from "../lib/integrations/connectors/sync-executor.ts";
import { applyOwnerImport, persistOwnerImportRecord } from "../lib/connections/import-store.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalRecord } from "../lib/integrations/connectors/types.ts";
import { ConnectorHttpError } from "../lib/integrations/connectors/errors.ts";
import { NATIVE_CONNECTOR_CAPABILITIES } from "../lib/integrations/connectors/adapters.ts";

const now = "2026-11-18T12:00:00Z", sourceAt = "2026-11-18T11:00:00.000Z";
const context = { partnerId: "partner", clientId: "business", connectionId: "connection", credentials: { privateAppToken: "synthetic-legacy-read", accountId: "12345" },
  config: { hubspot_owner_crm: true, workspace_view_only: true, hubspot_account_id: "12345" } };
const contact = (id = "101", extra: Record<string, unknown> = {}) => ({ id, archived: false, updatedAt: sourceAt,
  properties: { hs_object_id: id, firstname: "Ada", lastname: "Known", email: "known@synthetic.invalid", phone: "+15555550123", address: "1 Source St", lifecyclestage: "customer", sensitive_ignored: "hidden" },
  private_ignored: "hidden", ...extra });
function api(reply: (url: URL) => Response, metadata: Record<string, unknown> = {}) {
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push({ url, init });
    assert.equal(url.origin, "https://api.hubapi.com"); assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store");
    if (url.pathname.endsWith("/get/access-token-info")) return Response.json({ hubId: 12345, scopes: ["crm.objects.contacts.read", "crm.objects.deals.read"], ...metadata });
    return reply(url);
  };
  return { calls, request };
}

test("HubSpot advertises read imports only, with owner-only supported streams and no generic writeback", () => {
  assert.deepEqual(hubspotAdapter.manifest.capabilities, ["customer.read", "lead.read", "note.read"]);
  assert.equal(hubspotAdapter.pushRecord, undefined);
  assert.deepEqual(NATIVE_CONNECTOR_CAPABILITIES.hubspot, ["customer.create", "note.create"], "Only the separately reviewed gateway exposes native writes");
  for (const kind of ["customer", "lead", "note"]) assert.equal(allowsConnectorWork(context.config, "pull", kind, "hubspot"), true);
  for (const kind of ["customer", "lead", "note", "message"]) assert.equal(allowsConnectorWork(context.config, "push", kind, "hubspot"), false);
  assert.equal(allowsConnectorWork({}, "pull", "customer", "hubspot"), false);
  assert.equal(allowsConnectorWork({ workspace_view_only: true }, "pull", "customer", "hubspot"), false);
  assert.equal(allowsConnectorWork({ workspace_view_only: true }, "pull", "customer"), false, "A HubSpot exception cannot widen Google/other read-only imports");
});
test("the GET-only connection probe proves account/contact reading without claiming create readiness", async () => {
  const p = api(() => Response.json({ results: [] }));
  const result = await testHubSpotConnection(context.credentials, { fetch: p.request });
  assert.equal(result.ok, true); assert.equal("externalAccountId" in result && result.externalAccountId, "12345");
  assert.match(result.detail, /read access verified/); assert.match(result.detail, /not established/); assert.doesNotMatch(result.detail, /creation are ready/);
  assert.equal(p.calls.length, 2); assert.equal(p.calls[1].init?.method, undefined);
  assert.ok(p.calls.every(({ url }) => !url.href.includes("synthetic-legacy-read")));
});
test("account and actual scope mismatches stop a page before CRM data can be imported", async () => {
  for (const metadata of [{ hubId: 54321 }, { scopes: [] }, { scopes: ["crm.objects.deals.read"] }]) {
    const p = api(() => { throw new Error("must not read records"); }, metadata);
    await assert.rejects(pullHubSpotPage(context, "customer", null, { fetch: p.request, now: () => now })); assert.equal(p.calls.length, 1);
  }
  const p = api(() => Response.json({ results: [] }));
  await assert.rejects(pullHubSpotPage({ ...context, config: {} }, "customer", null, { fetch: p.request }), /owner flow/); assert.equal(p.calls.length, 0);
});
test("active pagination and archived pass retain real tombstone clocks; link URLs never drive requests", async () => {
  const p = api((url) => {
    if (url.searchParams.get("archived") === "true") return Response.json({ results: [{ id: "99", archived: true, updatedAt: sourceAt, archivedAt: "2026-11-18T11:30:00Z", properties: { hs_object_id: "99" } }] });
    if (url.searchParams.get("after")) { assert.equal(url.searchParams.get("after"), "opaque/+?cursor"); return Response.json({ results: [] }); }
    return Response.json({ results: [contact()], paging: { next: { after: "opaque/+?cursor", link: "https://untrusted.invalid/steal" } } });
  });
  const first = await pullHubSpotPage(context, "customer", null, { fetch: p.request, now: () => now });
  assert.deepEqual(first.nextCursor, { version: 1, phase: "active", after: "opaque/+?cursor" }); assert.equal(connectorCursorIsPartial(first.nextCursor), true);
  assert.equal(first.records[0].data.portal_id, "12345"); assert.equal(first.records[0].data.first_name, "Ada");
  assert.equal(JSON.stringify(first.records[0]).includes("hidden"), false);
  const second = await pullHubSpotPage(context, "customer", first.nextCursor, { fetch: p.request, now: () => now });
  assert.deepEqual(second.nextCursor, { version: 1, phase: "archived" }); assert.equal(connectorCursorIsPartial(second.nextCursor), true);
  const last = await pullHubSpotPage(context, "customer", second.nextCursor, { fetch: p.request, now: () => now });
  assert.equal(last.nextCursor, null); assert.equal(last.continueImmediately, false);
  assert.equal(last.records[0].deleted, true); assert.equal(last.records[0].updatedAt, "2026-11-18T11:30:00Z"); assert.equal(last.records[0].data.archived_at, "2026-11-18T11:30:00Z");
  assert.ok(p.calls.every(({ url }) => url.origin === "https://api.hubapi.com"));
});
test("malformed continuation or archive evidence cannot mark an incomplete page complete", async () => {
  for (const page of [{ results: [], paging: { next: { link: "https://untrusted.invalid" } } }, { results: [], paging: { next: true } }, { results: [], paging: { next: {} } }, { results: [contact()], paging: { next: { after: "repeat" } } }, { results: "missing" }]) {
    const p = api(() => Response.json(page));
    await assert.rejects(pullHubSpotPage(context, "customer", { version: 1, phase: "active", after: "repeat" }, { fetch: p.request, now: () => now }));
  }
  const p = api(() => Response.json({ results: [{ id: "99", archived: true, updatedAt: sourceAt, properties: {} }] }));
  await assert.rejects(pullHubSpotPage(context, "customer", { version: 1, phase: "archived" }, { fetch: p.request, now: () => now }), /archive clock/);
});
test("deals remain external opportunity facts and association incompleteness stays explicit", () => {
  const deal = normalizeHubSpotRecord("lead", { id: "55", archived: false, updatedAt: sourceAt, properties: { hs_object_id: "55", dealname: "Real source deal", amount: "123.450", dealstage: "custom-stage", pipeline: "custom-pipeline", deal_currency_code: "JPY" },
    associations: { contacts: { results: [{ id: "101" }], paging: { next: { after: "more" } } } } }, "12345", now);
  assert.equal(deal.data.amount, "123.450"); assert.equal(deal.data.status, "custom-stage"); assert.equal(deal.data.currency, "JPY");
  assert.deepEqual(deal.data.associated_contact_ids, ["101"]); assert.equal(deal.data.associations_partial, true); assert.equal(deal.data.native_contact_id, undefined);
});
test("source fingerprints ignore observation-only refresh and Postgres clock formatting but preserve changed properties", () => {
  const first = normalizeHubSpotRecord("customer", contact(), "12345", now);
  const later = { ...first, updatedAt: "2026-11-18T11:00:00+00:00", data: { ...first.data, observed_at: "2026-11-18T12:05:00Z", unknown_metadata: "not source truth" } };
  assert.equal(hubSpotSourceFingerprint(first), hubSpotSourceFingerprint(later));
  assert.notEqual(hubSpotSourceFingerprint(first), hubSpotSourceFingerprint(normalizeHubSpotRecord("customer", contact("101", { properties: { ...contact().properties, firstname: "Changed" } }), "12345", now)));
});
test("exact GET refuses merged identities and provider future clocks", async () => {
  const p = api(() => Response.json(contact("102")));
  const session = await verifyHubSpotReadSession(context.credentials, { fetch: p.request });
  await assert.rejects(readHubSpotObject(session, "customer", "101", { fetch: p.request, now: () => now }), /different or merged/);
  assert.throws(() => normalizeHubSpotRecord("customer", contact("101", { updatedAt: "2026-11-18T13:00:00Z" }), "12345", now), /future/);
});
test("HubSpot owner persistence keeps archived source/account provenance and uses only the scoped canonical RPC", async () => {
  const deleted = normalizeHubSpotRecord("customer", { id: "99", archived: true, updatedAt: sourceAt, archivedAt: "2026-11-18T11:30:00Z", properties: {} }, "12345", now);
  let args: Record<string, unknown> = {};
  const admin = { rpc: async (name: string, values: Record<string, unknown>) => { assert.equal(name, "persist_owner_import_record"); args = values; return { data: true, error: null }; } } as unknown as SupabaseClient;
  await persistOwnerImportRecord(admin, { partnerId: context.partnerId, clientId: context.clientId, connectionId: context.connectionId }, deleted);
  assert.equal(args.p_partner, context.partnerId); assert.equal(args.p_connection, context.connectionId);
  assert.equal((args.p_data as Record<string, unknown>).portal_id, "12345"); assert.equal((args.p_data as Record<string, unknown>).archived, true); assert.equal((args.p_data as Record<string, unknown>).deleted, true);
  await assert.rejects(applyOwnerImport({ persist: async () => true }, context, [{ ...deleted, data: { ...deleted.data, portal_id: "foreign" } }], {}));
});
test("the registered pull contract saves source records and cursor, without any generic object link or CRM push", async () => {
  const original = globalThis.fetch; const saved: CanonicalRecord[] = [], cursors: unknown[] = [];
  const p = api(() => Response.json({ results: [contact("101", { updatedAt: "2026-01-01T00:00:00Z" })] })); globalThis.fetch = p.request;
  try {
    const result = await executeConnectorSyncJob({ adapter: hubspotAdapter, context, job: { id: "job", direction: "pull", objectType: "customer", operation: "sync", attempts: 0, maxAttempts: 3, payload: {} },
      repository: { assertCanExecute: async () => undefined, saveCanonicalRecord: async (record) => { saved.push(record); }, saveCursor: async (cursor) => { cursors.push(cursor); }, saveObjectLink: async () => { throw new Error("HubSpot cannot create a native identity link"); } } });
    assert.equal(result.ok, true); assert.equal(saved.length, 1); assert.deepEqual(cursors, [{ version: 1, phase: "archived" }]);
    const before = p.calls.length;
    const push = await executeConnectorSyncJob({ adapter: hubspotAdapter, context, job: { id: "push", direction: "push", objectType: "customer", operation: "create", attempts: 0, maxAttempts: 3, payload: { nativeObjectId: "x", idempotencyKey: "not-a-provider-guarantee", data: { email: "claimed@synthetic.invalid" } } },
      repository: { saveCanonicalRecord: async () => { throw new Error("must not project"); }, saveCursor: async () => undefined, saveObjectLink: async () => undefined } });
    assert.equal(push.ok, false); assert.equal(p.calls.length, before);
  } finally { globalThis.fetch = original; }
});
test("a SQL source conflict stops before cursor completion, while obsolete versions remain ignored", async () => {
  const original = globalThis.fetch;
  const p = api(() => Response.json({ results: [contact("101", { updatedAt: "2026-01-01T00:00:00Z" })] })); globalThis.fetch = p.request;
  try {
    for (const conflict of [false, true]) {
      const filters: [string, unknown][] = []; let cursors = 0;
      const query = { select: (v: string) => { assert.equal(v, "status,last_error"); return query; }, eq: (k: string, v: unknown) => { filters.push([k, v]); return query; },
        maybeSingle: async () => ({ data: { status: conflict ? "failing" : "idle", last_error: conflict ? "Source same-clock conflict" : null }, error: null }) };
      const admin = { rpc: async () => ({ data: false, error: null }), from: (table: string) => { assert.equal(table, "integration_sync_states"); return query; } } as unknown as SupabaseClient;
      const record = normalizeHubSpotRecord("customer", contact(), "12345", now);
      if (conflict) await assert.rejects(persistOwnerImportRecord(admin, context, record), (error) => error instanceof ConnectorHttpError && error.status === 409);
      else assert.equal(await persistOwnerImportRecord(admin, context, record), false);
      assert.deepEqual(filters.slice(0, 4), [["partner_id", "partner"], ["client_id", "business"], ["connection_id", "connection"], ["stream_key", "customer"]]);
      const outcome = await executeConnectorSyncJob({ adapter: hubspotAdapter, context, job: { id: "job", direction: "pull", objectType: "customer", operation: "sync", attempts: 0, maxAttempts: 3, payload: {} },
        repository: { saveCanonicalRecord: async (item) => { await persistOwnerImportRecord(admin, context, item); }, saveCursor: async () => { cursors++; }, saveObjectLink: async () => { throw new Error("no projection"); } } });
      assert.equal(outcome.ok, !conflict); assert.equal(cursors, conflict ? 0 : 1);
    }
  } finally { globalThis.fetch = original; }
});
test("legacy inferred contact/note upsert is disabled before every provider request", async () => {
  const original = globalThis.fetch; let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("must not request"); };
  try { await assert.rejects(syncContactWithNote(context.credentials, { email: "claimed@synthetic.invalid", firstname: null, lastname: null, phone: null, address: null }, "note"), /explicit reviewed provider gateway/); assert.equal(called, false); }
  finally { globalThis.fetch = original; }
});
