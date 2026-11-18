import test from "node:test";
import assert from "node:assert/strict";
import { executeHubSpotGatewayWrite, hubSpotGatewayPinBlock } from "../lib/crm/provider-gateway.ts";
import type { CrmGatewayPin } from "../lib/crm/provider-contract.ts";
import { hubspotOAuthScopes, type HubSpotOAuthCredentials } from "../lib/integrations/providers/hubspot-oauth.ts";
import { hubSpotSourceFingerprint, normalizeHubSpotRecord } from "../lib/integrations/providers/hubspot.ts";
import { ActionSuppressedError } from "../lib/jobs/action-preflight.ts";

process.env.HUBSPOT_CLIENT_ID = "gateway-client-fixture";
process.env.HUBSPOT_CLIENT_SECRET = "gateway-secret-fixture";
process.env.NEXT_PUBLIC_APP_URL = "https://app.synthetic.invalid";
process.env.APP_URL = "https://app.synthetic.invalid";
const now = "2026-11-18T12:00:00Z", sourceAt = "2026-11-18T11:00:00Z";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = (extra: Record<string, unknown> = {}) => ({ id: "101", archived: false, updatedAt: sourceAt,
  properties: { hs_object_id: "101", firstname: "Ada", lastname: "Known", email: "known@synthetic.invalid" }, ...extra });
function credentials(operation: "contact.create" | "note.create" = "contact.create"): HubSpotOAuthCredentials {
  return { authType: "oauth", clientId: "gateway-client-fixture", accessToken: "gateway-access-fixture", refreshToken: "gateway-refresh-fixture", accountId: "12345", userId: "77", appId: "88", accountName: "hub.synthetic.invalid",
    scopes: hubspotOAuthScopes([operation]), expiresAt: "2026-11-18T12:29:00Z", permissions: [operation], accessMode: "owner_selected", grantRevision: id(3) };
}
function pin(operation: "contact.create" | "note.create" = "contact.create"): CrmGatewayPin {
  return { crm_gateway_version: 1, provider: "hubspot", operation, owner_command_id: id(1), connection_id: id(2), account_id: "12345", grant_revision: id(3), authority_revision: 4,
    source_run_id: null, new_identity_confirmed: operation === "contact.create", properties: operation === "contact.create" ? { firstname: "Deliberately new", email: "new@synthetic.invalid" } : {},
    source_record_id: operation === "note.create" ? id(4) : null, source_updated_at: operation === "note.create" ? sourceAt : null,
    source_external_updated_at: operation === "note.create" ? sourceAt : null, external_id: operation === "note.create" ? "101" : null,
    source_fingerprint: operation === "note.create" ? hubSpotSourceFingerprint(normalizeHubSpotRecord("customer", source(), "12345", now)) : null,
    note_body: operation === "note.create" ? "Owner reviewed this exact source contact." : null };
}
function provider(p: CrmGatewayPin, options: { metadata?: Record<string, unknown>; source?: Record<string, unknown>; post?: () => Response; readback?: Record<string, unknown>; readFailure?: boolean } = {}) {
  const events: string[] = [], calls: { url: URL; init?: RequestInit }[] = [];
  let attempted = false, postCount = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push({ url, init }); assert.equal(url.origin, "https://api.hubapi.com"); assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error");
    if (url.pathname.endsWith("/introspect")) {
      events.push("verify-account"); const fields = new URLSearchParams(String(init?.body));
      return Response.json({ active: true, token_type: "Bearer", token_use: "access_token", token: fields.get("access_token"), client_id: "gateway-client-fixture", hub_id: 12345, user_id: 77, app_id: 88,
        scopes: hubspotOAuthScopes([p.operation]), expires_in: 1780, ...options.metadata });
    }
    if (init?.method === "POST") {
      events.push("post"); postCount++; assert.equal(attempted, true, "a durable marker must exist before provider effect");
      assert.equal(url.pathname, `/crm/v3/objects/${p.operation === "contact.create" ? "contacts" : "notes"}`);
      assert.equal(new Headers(init.headers).has("Idempotency-Key"), false);
      const body = JSON.parse(String(init.body));
      if (p.operation === "contact.create") assert.deepEqual(body, { properties: p.properties });
      else assert.deepEqual(body, { properties: { hs_note_body: p.note_body, hs_timestamp: now }, associations: [{ to: { id: "101" }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }] }] });
      return options.post?.() ?? Response.json({ id: "202" }, { status: 201, headers: { "x-hubspot-correlation-id": "request-fixture" } });
    }
    assert.equal(init?.method, undefined);
    if (url.pathname === "/crm/v3/objects/contacts/101") { events.push("read-source"); return Response.json(options.source ?? source()); }
    events.push("read-created"); assert.equal(url.pathname, `/crm/v3/objects/${p.operation === "contact.create" ? "contacts" : "notes"}/202`);
    if (options.readFailure) return new Response(null, { status: 503 });
    return Response.json(options.readback ?? { id: "202", archived: false, updatedAt: now, properties: { hs_object_id: "202", ...(p.operation === "contact.create" ? p.properties : { hs_note_body: p.note_body, hs_timestamp: now }) },
      ...(p.operation === "note.create" ? { associations: { contacts: { results: [{ id: "101" }] } } } : {}) });
  };
  return { fetch: fetcher, now: () => now, calls, events, postCount: () => postCount,
    beforeWrite: async () => { events.push("final-policy"); }, markAttempted: async () => { events.push("durable-marker"); if (attempted) throw new Error("already attempted"); attempted = true; } };
}

test("deliberately new contact creation reads actual account then policy, durably marks once and verifies exact created ID", async () => {
  const p = pin(), api = provider(p), result = await executeHubSpotGatewayWrite({ credentials: credentials(), pin: p, beforeWrite: api.beforeWrite, markAttempted: api.markAttempted }, api);
  assert.equal(result.status, "succeeded"); assert.equal(result.externalRef, "202"); assert.equal(result.delivered, true);
  assert.deepEqual(api.events, ["verify-account", "final-policy", "durable-marker", "post", "read-created"]);
  assert.deepEqual(result.crmGatewayReceipt, { version: 1, provider: "hubspot", operation: "contact.create", account_id: "12345", object_id: "202", http_status: 201, verified_at: now, source_updated_at: now, associated_contact_id: null, request_id: "request-fixture" });
  assert.ok(api.calls.every((c) => !c.url.pathname.includes("search") && c.init?.method !== "PATCH"));
});
test("a note re-reads only the exact pinned contact then verifies its exact note association", async () => {
  const p = pin("note.create"), api = provider(p), result = await executeHubSpotGatewayWrite({ credentials: credentials("note.create"), pin: p, beforeWrite: api.beforeWrite, markAttempted: api.markAttempted }, api);
  assert.equal(result.status, "succeeded"); assert.equal(result.crmGatewayReceipt?.associated_contact_id, "101");
  assert.deepEqual(api.events, ["verify-account", "read-source", "final-policy", "durable-marker", "post", "read-created"]);
});
test("unsupported writes, legacy/read-only/unselected credentials and inferred targets stop before all I/O", async () => {
  const p = pin();
  for (const candidate of [{ ...p, operation: "contact.update" }, { ...p, new_identity_confirmed: false }, { ...p, external_id: "101" }, { ...p, properties: { email: "not an address" } }]) {
    assert.ok(hubSpotGatewayPinBlock(candidate));
    const api = provider(p), result = await executeHubSpotGatewayWrite({ credentials: credentials(), pin: candidate as CrmGatewayPin, beforeWrite: api.beforeWrite, markAttempted: api.markAttempted }, api);
    assert.equal(result.status, "skipped"); assert.equal(api.calls.length, 0);
  }
  for (const cred of [{ privateAppToken: "legacy" }, { ...credentials(), accessMode: "read_only" }, { ...credentials(), permissions: [] }, { ...credentials(), grantRevision: id(99) }]) {
    const api = provider(p), result = await executeHubSpotGatewayWrite({ credentials: cred as HubSpotOAuthCredentials, pin: p, beforeWrite: api.beforeWrite, markAttempted: api.markAttempted }, api);
    assert.equal(result.status, "skipped"); assert.equal(api.calls.length, 0);
  }
});
test("changed actual portal, grant, archived, merged and same-clock changed source contact cannot reach a write", async () => {
  const p = pin("note.create");
  for (const options of [{ metadata: { hub_id: 54321 } }, { metadata: { scopes: hubspotOAuthScopes([]) } }, { source: source({ updatedAt: "2026-11-18T11:01:00Z" }) },
    { source: source({ archived: true, archivedAt: "2026-11-18T11:30:00Z" }) }, { source: source({ id: "102" }) }, { source: source({ properties: { ...source().properties, firstname: "Changed" } }) }]) {
    const api = provider(p, options), result = await executeHubSpotGatewayWrite({ credentials: credentials("note.create"), pin: p, beforeWrite: api.beforeWrite, markAttempted: api.markAttempted }, api);
    assert.equal(result.attempted, false); assert.equal(api.postCount(), 0); assert.equal(api.events.includes("durable-marker"), false);
  }
});
test("final policy or failed durable attempt persistence suppresses POST after provider reads", async () => {
  for (const failing of ["policy", "marker"]) {
    const p = pin("note.create"), api = provider(p);
    const result = await executeHubSpotGatewayWrite({ credentials: credentials("note.create"), pin: p,
      beforeWrite: failing === "policy" ? async () => { throw new ActionSuppressedError("Owner stopped this channel."); } : api.beforeWrite,
      markAttempted: failing === "marker" ? async () => { throw new Error("unconfirmed marker"); } : api.markAttempted }, api);
    assert.equal(result.attempted, false); assert.equal(api.postCount(), 0); assert.ok(api.events.includes("read-source"));
    if (failing === "policy") { assert.equal(result.status, "skipped"); assert.match(result.detail, /Owner stopped/); }
  }
});
test("unknown POST/readback outcomes remain uncertain and cannot replay the durable attempt", async () => {
  for (const options of [{ post: () => { throw new TypeError("lost response"); } }, { post: () => new Response(null, { status: 503 }) },
    { post: () => Response.json({}, { status: 201 }) }, { readFailure: true }, { readback: { id: "203", archived: false, updatedAt: now, properties: {} } },
    { readback: { id: "202", archived: false, updatedAt: now, properties: { firstname: "Wrong" } } }]) {
    const p = pin(), api = provider(p, options), input = { credentials: credentials(), pin: p, beforeWrite: api.beforeWrite, markAttempted: api.markAttempted };
    const first = await executeHubSpotGatewayWrite(input, api); assert.equal(first.status, "uncertain"); assert.equal(first.attempted, true); assert.equal(first.delivered, false);
    const second = await executeHubSpotGatewayWrite(input, api); assert.equal(second.attempted, false); assert.equal(api.postCount(), 1);
  }
});
test("a definite provider rejection remains failed with its durable attempted marker and no automatic second POST", async () => {
  const p = pin(), api = provider(p, { post: () => Response.json({ private_data: "must not leak" }, { status: 409 }) });
  const input = { credentials: credentials(), pin: p, beforeWrite: api.beforeWrite, markAttempted: api.markAttempted };
  const result = await executeHubSpotGatewayWrite(input, api); assert.equal(result.status, "failed"); assert.equal(result.attempted, true); assert.doesNotMatch(result.detail, /private_data/);
  await executeHubSpotGatewayWrite(input, api); assert.equal(api.postCount(), 1);
});
test("note readback with missing, extra or incomplete contact association is uncertain", async () => {
  for (const contacts of [{ results: [] }, { results: [{ id: "102" }] }, { results: [{ id: "101" }, { id: "102" }] }, { results: [{ id: "101" }], paging: { next: { after: "more" } } }]) {
    const p = pin("note.create"), api = provider(p, { readback: { id: "202", archived: false, updatedAt: now, properties: { hs_note_body: p.note_body }, associations: { contacts } } });
    const result = await executeHubSpotGatewayWrite({ credentials: credentials("note.create"), pin: p, beforeWrite: api.beforeWrite, markAttempted: api.markAttempted }, api);
    assert.equal(result.status, "uncertain"); assert.equal(api.postCount(), 1); assert.equal(result.externalRef, "202");
  }
});
