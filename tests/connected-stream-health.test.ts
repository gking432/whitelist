import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { connectedStreamHealth, pullJobNeedsAttention, sourceCursorIsPartial } from "../lib/connections/stream-health.ts";
import { loadConnectedRecords, type OwnerConnectionRow } from "../lib/connections/canonical-loader.ts";
import { readBusinessContext } from "../lib/business/context-data.ts";
import { buildManagerContext } from "../lib/business/context.ts";

const now = "2026-11-18T12:00:00Z", completed = "2026-11-18T11:50:00Z";
const scope = { partnerId: "partner", clientId: "business" }, tenant = { partner_id: scope.partnerId, client_id: scope.clientId };
const state = { status: "idle", last_error: null, last_completed_at: completed, cursor_value: null };
const health = (patch: Partial<Parameters<typeof connectedStreamHealth>[0]> = {}) => connectedStreamHealth({ key: "customer", generatedAt: now, eventBased: false, connectionStatus: "connected", paused: false, state, jobs: [], ...patch });

test("HubSpot active/archive phases and provider page tokens remain incomplete without an after token", () => {
  for (const cursor of [{ version: 1, phase: "active" }, { version: 1, phase: "archived" }, { pageToken: "private" }, { nextLink: "private" }, { after: "private" }, { starting_after: "private" }, { has_more: true }]) {
    assert.equal(sourceCursorIsPartial(cursor), true);
    const result = health({ state: { ...state, cursor_value: cursor }, jobs: [{ status: "queued" }] });
    assert.equal(result.stream.status, "stale"); assert.equal(result.stream.partial, true); assert.equal(result.syncing, true);
    assert.equal(result.stream.lastSyncedAt, completed); assert.equal(JSON.stringify(result).includes("private"), false);
  }
  assert.equal(sourceCursorIsPartial(null), false); assert.equal(sourceCursorIsPartial({}), false);
});
test("a completed later scan recovers from old terminal jobs without rewriting historical attempts", () => {
  const old = { status: "dead_letter", updated_at: "2026-11-18T11:30:00Z", completed_at: "2026-11-18T11:30:00Z" }, bytes = JSON.stringify(old);
  assert.equal(pullJobNeedsAttention(old, completed), false);
  const result = health({ jobs: [old, { status: "queued", updated_at: now }] });
  assert.equal(result.stream.status, "fresh"); assert.equal(result.syncing, false); assert.equal(JSON.stringify(old), bytes);
});
test("current, unclocked and equal-clock errors remain visible beside the earlier successful import", () => {
  for (const job of [{ status: "failed", updated_at: "2026-11-18T11:55:00Z" }, { status: "dead_letter" }, { status: "dead_letter", updated_at: completed }]) {
    assert.equal(pullJobNeedsAttention(job, completed), true);
    const result = health({ jobs: [job] }); assert.equal(result.stream.status, "error"); assert.equal(result.stream.lastSyncedAt, completed);
  }
  assert.equal(health({ state: { ...state, status: "failing", last_error: "private source conflict" } }).stream.status, "error");
});
test("bounded display coverage is distinct from actual background work", () => {
  const sample = health({ sampled: true }); assert.equal(sample.stream.partial, true); assert.equal(sample.stream.status, "fresh"); assert.equal(sample.syncing, false);
  assert.equal(health({ jobs: [{ status: "running" }] }).syncing, true);
  assert.equal(health({ state: { ...state, cursor_value: { version: 1, phase: "archived" } } }).syncing, false, "An orphan continuation cannot claim a running worker");
});
test("pause, reconnect, invalid/missing clocks and incomplete metadata cannot claim current data", () => {
  assert.equal(health({ paused: true, jobs: [{ status: "running" }] }).stream.status, "paused");
  assert.equal(health({ paused: true, jobs: [{ status: "running" }] }).syncing, false);
  assert.equal(health({ connectionStatus: "needs_attention" }).stream.status, "error");
  assert.equal(health({ connectionStatus: "not_connected" }).stream.status, "missing");
  assert.equal(health({ metadataUnavailable: true }).stream.status, "error");
  assert.equal(health({ metadataIncomplete: true }).stream.status, "stale");
  assert.equal(health({ state: { ...state, last_completed_at: null } }).stream.status, "missing");
  assert.equal(health({ state: { ...state, last_completed_at: "2026-11-18T12:01:00Z" } }).stream.status, "stale");
  assert.equal(health({ state: { ...state, last_completed_at: "2026-11-18T10:00:00Z" } }).stream.status, "stale");
});
test("event intake never claims historical coverage and retains event freshness after forty-five minutes", () => {
  const result = health({ key: "lead", eventBased: true, state: { ...state, last_completed_at: "2026-11-17T10:00:00Z" } });
  assert.equal(result.stream.status, "fresh"); assert.equal(result.stream.partial, true); assert.equal(result.syncing, false);
  assert.match(result.stream.detail, /Only received form events/);
});

function repository(tables: Record<string, unknown>) {
  const queries: { table: string; columns: string; filters: [string, unknown][]; bound: number | null }[] = [];
  const admin = { from(table: string) {
    const query = { table, columns: "", filters: [] as [string, unknown][], bound: null as number | null }; queries.push(query);
    const field = (r: Record<string, unknown>, key: string): unknown => key.includes("->>") ? (r[key.split("->>")[0]] as Record<string, unknown>)?.[key.split("->>")[1]] : r[key];
    let single = false; const orders: { key: string; ascending: boolean }[] = [], predicates: ((r: Record<string, unknown>) => boolean)[] = [];
    const chain = {
      select(columns: string) { query.columns = columns; return chain; },
      eq(key: string, value: unknown) { query.filters.push([key, value]); predicates.push((r) => field(r, key) === value); return chain; },
      in(key: string, values: unknown[]) { query.filters.push([key, values]); predicates.push((r) => values.includes(field(r, key))); return chain; },
      gte(key: string, value: unknown) { predicates.push((r) => String(field(r, key)) >= String(value)); return chain; },
      lt(key: string, value: unknown) { predicates.push((r) => String(field(r, key)) < String(value)); return chain; },
      order(key: string, options: { ascending?: boolean } = {}) { orders.push({ key, ascending: options.ascending !== false }); return chain; },
      limit(n: number) { query.bound = n; return chain; }, maybeSingle() { single = true; return chain; },
      then(resolve: (result: { data: unknown; error: null }) => unknown) {
        let data: unknown = tables[table] ?? [];
        if (Array.isArray(data)) {
          data = data.filter((r) => predicates.every((p) => p(r))).sort((a, b) => { for (const order of orders) { const cmp = String(field(a, order.key) ?? "").localeCompare(String(field(b, order.key) ?? "")); if (cmp) return order.ascending ? cmp : -cmp; } return 0; });
          if (query.bound !== null) data = (data as unknown[]).slice(0, query.bound);
          if (single) data = (data as unknown[])[0] ?? null;
        }
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    }; return chain;
  } } as unknown as SupabaseClient;
  return { admin, queries };
}
test("the production loader and manager share exact account/stream health after failed imports and recovery", async () => {
  const connections: OwnerConnectionRow[] = ["google_workspace", "hubspot", "stripe", "generic_inbound_webhook"].map((provider, i) => ({ ...tenant, id: `account-${i}`, display_name: provider, status: "connected", runtime_mode: "dry_run", config: { workspace_view_only: true }, provider: { provider_key: provider } }));
  const stateRows = connections.flatMap((c, i) => (i === 0 ? ["message", "appointment"] : i === 1 ? ["customer", "lead", "note"] : i === 2 ? ["invoice", "payment"] : ["lead"]).map((key) => ({ ...tenant, connection_id: c.id, stream_key: key, ...state,
    ...(i === 1 && key === "customer" ? { cursor_value: { version: 1, phase: "archived" } } : {}) })));
  const jobs = [{ ...tenant, id: "historical-error", connection_id: "account-0", direction: "pull", object_type: "message", status: "dead_letter", updated_at: "2026-11-18T11:30:00Z", completed_at: "2026-11-18T11:30:00Z" },
    { ...tenant, id: "current-error", connection_id: "account-2", direction: "pull", object_type: "payment", status: "failed", updated_at: "2026-11-18T11:55:00Z" },
    { ...tenant, id: "archive-page", connection_id: "account-1", direction: "pull", object_type: "customer", status: "queued", updated_at: now }];
  const { admin, queries } = repository({ integration_connections: connections, integration_sync_states: stateRows, integration_sync_jobs: jobs,
    client_businesses: [{ id: scope.clientId, partner_id: scope.partnerId, status: "active", crm_operating_mode: "assist", default_runtime_mode: "live" }] });
  const owner = await loadConnectedRecords(admin, scope, { connections, clock: () => new Date(now) });
  const manager = buildManagerContext(await readBusinessContext(admin, scope, false, () => new Date(now)));
  for (const app of owner.apps) for (const stream of app.streams ?? []) {
    const coverage = manager.coverage.find((c) => c.key === `${app.id}:${stream.key}`)!;
    assert.equal(coverage.status, stream.status); assert.equal(coverage.lastUpdatedAt, stream.lastSyncedAt);
  }
  assert.equal(owner.apps[0].streams?.[0].status, "fresh"); assert.equal(owner.apps[0].syncing, false);
  assert.equal(owner.apps[1].streams?.[0].status, "stale"); assert.equal(owner.apps[1].syncing, true);
  assert.equal(owner.apps[2].streams?.find((s) => s.key === "payment")?.status, "error");
  assert.equal(owner.apps[2].streams?.find((s) => s.key === "invoice")?.status, "fresh");
  assert.ok(queries.filter((q) => q.table === "integration_sync_jobs").every((q) => q.filters.some(([k, v]) => k === "partner_id" && v === scope.partnerId) && q.filters.some(([k, v]) => k === "client_id" && v === scope.clientId) && q.columns.includes("updated_at") && q.bound === 1001));
});
