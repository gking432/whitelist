import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readIntakeReview } from "../lib/connections/intake-review.ts";

const connectionId = "94fdb839-9d52-40ad-b569-7adfae2475b9";
const recordId = "c3a9bf3a-2872-42f7-9e54-1faf00c33c41";
const scope = { partnerId: "partner", clientId: "business" };
const version = "2026-11-17T04:00:00.123456+00:00";
const source = { id: recordId, connection_id: connectionId, external_object_id: "form-123", updated_at: version,
  native_object_id: null, canonical_data: { status: "new", name: "Claimed name", email: "claim@example.test", description: "Question", secret: "not-returned" },
  source_payload: { token: "not-returned" } };
const connection = { display_name: "Website intake", status: "connected", runtime_mode: "dry_run", config: { workspace_view_only: true, secret: "not-returned" }, provider: { provider_key: "generic_inbound_webhook" } };

function repository(overrides: Record<string, unknown> = {}) {
  const calls: { table: string; filters: [string, unknown][]; search: string | null; limit: number | null }[] = [];
  const rows: Record<string, unknown> = { integration_canonical_records: source, integration_connections: connection,
    crm_contacts: [{ id: "selected-by-owner", first_name: "Customer", last_name: "One", email: "claim@example.test", phone: null, updated_at: version, private_note: "not-returned" }], ...overrides };
  const admin = { from(table: string) {
    const call = { table, filters: [] as [string, unknown][], search: null as string | null, limit: null as number | null };
    calls.push(call);
    const query = {
      select() { return query; }, eq(field: string, value: unknown) { call.filters.push([field, value]); return query; },
      order() { return query; }, or(search: string) { call.search = search; return query; },
      limit(count: number) { call.limit = count; return query; },
      async maybeSingle() { return { data: rows[table], error: null }; },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { return Promise.resolve({ data: rows[table], error: null }).then(resolve, reject); },
    };
    return query;
  } } as unknown as SupabaseClient;
  return { admin, calls };
}

test("intake review preserves precise source revisions and offers explicit bounded customer choices", async () => {
  const { admin, calls } = repository();
  const review = await readIntakeReview(admin, scope, { connectionId, recordId });
  assert.equal(review.source.updatedAt, version);
  assert.equal(review.source.name, "Claimed name");
  assert.equal(review.contacts[0].email, review.source.email);
  assert.equal("selectedContact" in review, false, "a matching claim must not select a customer");
  assert.equal(JSON.stringify(review).includes("not-returned"), false);
  for (const call of calls) {
    assert.ok(call.filters.some(([key, value]) => key === "partner_id" && value === scope.partnerId));
    assert.ok(call.filters.some(([key, value]) => key === "client_id" && value === scope.clientId));
  }
  assert.equal(calls.find((call) => call.table === "crm_contacts")?.limit, 51);
});

test("intake review rejects deleted, already adopted and inactive source accounts before customer browsing", async () => {
  for (const overrides of [
    { integration_canonical_records: { ...source, native_object_id: "already-linked" } },
    { integration_canonical_records: { ...source, canonical_data: { deleted: true } } },
    { integration_connections: { ...connection, runtime_mode: "paused" } },
    { integration_connections: { ...connection, provider: { provider_key: "other" } } },
  ]) {
    const { admin, calls } = repository(overrides);
    await assert.rejects(readIntakeReview(admin, scope, { connectionId, recordId }));
    assert.ok(calls.every((call) => call.table !== "crm_contacts"));
  }
});

test("customer chooser search cannot inject PostgREST filters and reports bounded coverage", async () => {
  const contacts = Array.from({ length: 51 }, (_, i) => ({ id: `contact-${i}`, first_name: "Customer", updated_at: version }));
  const { admin, calls } = repository({ crm_contacts: contacts });
  const result = await readIntakeReview(admin, scope, { connectionId, recordId, q: 'Ada,(email.eq.secret)%_"' });
  assert.equal(result.contacts.length, 50);
  assert.equal(result.limited, true);
  const search = calls.find((call) => call.table === "crm_contacts")!.search!;
  assert.equal(search.split(",").length, 4);
  for (const filter of search.split(",")) assert.equal(/[()"_]/.test(filter.split(".ilike.")[1]), false);
  assert.equal((search.match(/%/g) ?? []).length, 8, "only generated contains wildcards are retained");
});
