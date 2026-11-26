import test from "node:test";
import assert from "node:assert/strict";
import { buildBusinessContext, buildManagerContext, observeWaitingPoints, summarizeBusinessContext, type BusinessContextInput, type RecordEvidence } from "../lib/business/context.ts";
import { effectiveAuthoritySnapshot } from "../lib/agents/authority.ts";
import { readBusinessContext } from "../lib/business/context-data.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readManagerBusinessContext } from "../lib/agents/manager-context.ts";
import { loadConnectedRecords } from "../lib/connections/data.ts";
import { readFileSync, readdirSync } from "node:fs";

const now = "2026-11-17T12:00:00.000Z";
const scope = { partnerId: "partner-one", clientId: "client-one" };
const tenant = { partner_id: scope.partnerId, client_id: scope.clientId };
function fixture(): BusinessContextInput {
  return {
    scope, generatedAt: now,
    profile: { ...tenant, updated_at: "2026-11-15T12:00:00.000Z", profile: { description: "Appointment business", industry: "coaching", services: "Coaching sessions", hours: "9 to 5" } },
    review: { ...tenant, profile_revision: "2026-11-15T12:00:00.000Z", reviewed_at: "2026-11-16T12:00:00.000Z" },
    connections: [{ ...tenant, id: "google-one", display_name: "Office", provider_key: "google_workspace", status: "connected", runtime_mode: "live" }],
    streams: [{ ...tenant, connection_id: "google-one", stream_key: "message", status: "idle", last_completed_at: "2026-11-17T11:50:00.000Z" }],
    batches: [], canWrite: true,
    authority: effectiveAuthoritySnapshot(null, null, []),
  };
}
const record = (patch: Partial<RecordEvidence> = {}): RecordEvidence => ({
  ...tenant, id: "approval-one", table: "approval_items", kind: "message_reply", title: "Reply proposal", status: "pending", revision: "updated-one", updated_at: "2026-11-16T10:00:00.000Z", created_at: "2026-11-14T10:00:00.000Z", ...patch,
});
test("bounded manager context retains money sources when native work fills the sample", () => {
  const input = fixture();
  const tables = ["business_records", "crm_leads", "approval_items", "agent_work_items", "crm_appointments", "business_workspace_events", "agent_work_events", "crm_tasks", "crm_contacts", "crm_communications"];
  input.batches = tables.map((table) => ({ key: table, label: table, limit: 100, hasMore: false,
    rows: Array.from({ length: 12 }, (_, i) => record({ id: `${table}-${i}`, table, kind: "saved" })) }));
  input.batches.push({ key: "money", label: "Money", limit: 100, hasMore: false,
    rows: [record({ id: "source-invoice", table: "integration_canonical_records", kind: "invoice" }), record({ id: "source-payment", table: "integration_canonical_records", kind: "payment" })] });
  const model = buildManagerContext(buildBusinessContext(input));
  assert.equal(model.records.length, 120);
  assert.ok(model.records.some((row) => row.id === "source-invoice"));
  assert.ok(model.records.some((row) => row.id === "source-payment"));
  assert.equal(model.record_sample_partial, true);
});

test("context facts retain scope, source identity and exact reviewed profile revision", () => {
  const input = fixture();
  const context = buildBusinessContext(input);
  assert.equal(context.version, 1);
  assert.deepEqual(context.scope, scope);
  const services = context.facts.find((f) => f.key === "services")!;
  assert.equal(services.reviewed, true);
  assert.deepEqual(services.sources, [{ table: "business_workspace_profiles", id: scope.clientId, revision: input.profile!.updated_at, updatedAt: input.profile!.updated_at }]);
  input.profile!.updated_at = "2026-11-17T11:00:00.000Z";
  assert.equal(buildBusinessContext(input).facts.find((f) => f.key === "services")!.reviewed, false);
});

test("profile defaults and absent facts are explicit unknowns rather than reviewed assumptions", () => {
  const context = buildBusinessContext(fixture());
  assert.deepEqual(context.facts.find((f) => f.key === "tone"), { key: "tone", value: "Friendly and helpful", state: "unknown", reviewed: false, sources: [] });
  const missing = { ...fixture(), profile: null };
  assert.equal(buildBusinessContext(missing).revision, "unconfigured");
  assert.ok(buildBusinessContext(missing).facts.every((f) => f.state === "unknown" && !f.reviewed));
});

test("conflicting approved knowledge is shown with both sources and does not become reviewed", () => {
  const input = fixture();
  input.knowledge = { ...tenant, id: "knowledge-one", updated_at: now, business_description: "Appointment business", services_offered: "Only group classes", business_hours: "9 to 5" };
  const facts = buildBusinessContext(input).facts;
  const services = facts.find((f) => f.key === "services")!;
  assert.equal(services.state, "conflict");
  assert.equal(services.reviewed, false);
  assert.deepEqual(services.sources.map((s) => s.table), ["business_workspace_profiles", "client_knowledge_profiles"]);
  assert.equal(facts.find((f) => f.key === "description")!.state, "known");
});

test("foreign business evidence is rejected for profiles, imports, activity and review state", () => {
  for (const key of ["profile", "review"] as const) {
    const input = fixture();
    input[key]!.client_id = "another-client";
    assert.throws(() => buildBusinessContext(input), /does not belong/);
  }
  const input = fixture();
  input.batches = [{ key: "events", label: "Events", limit: 100, hasMore: false, rows: [record({ table: "agent_work_events", partner_id: "other-partner" })] }];
  assert.throws(() => buildBusinessContext(input), /does not belong/);
  const streamInput = fixture();
  streamInput.streams[0].client_id = "another-client";
  assert.throws(() => buildBusinessContext(streamInput), /does not belong/);
});

test("stream freshness and completeness are independent for email and calendar", () => {
  const input = fixture();
  let coverage = buildBusinessContext(input).coverage;
  assert.equal(coverage.find((c) => c.key === "google-one:message")!.status, "fresh");
  assert.equal(coverage.find((c) => c.key === "google-one:appointment")!.status, "missing");
  input.streams[0].cursor_value = { pageToken: "private-page-token" };
  coverage = buildBusinessContext(input).coverage;
  assert.equal(coverage[0].status, "stale");
  assert.equal(coverage[0].hasMore, true);
  assert.equal(JSON.stringify(coverage).includes("private-page-token"), false);
  input.streams[0].last_error = "provider-secret-stack";
  assert.equal(buildBusinessContext(input).coverage[0].status, "error");
  assert.equal(JSON.stringify(buildBusinessContext(input)).includes("provider-secret-stack"), false);
});

test("bounded coverage states omitted rows and waiting observations do not inspect records beyond that boundary", () => {
  const input = fixture();
  input.batches = [{ key: "approvals", label: "Decisions", limit: 1, hasMore: false, rows: [record(), record({ id: "second" })] }];
  const context = buildBusinessContext(input);
  assert.equal(context.coverage[0].sampled, 1);
  assert.equal(context.coverage[0].hasMore, true);
  assert.equal(context.observations.length, 1);
  assert.equal(context.observations[0].sources[0].id, "approval-one");
});

test("waiting points use persistent state and timestamps without inferring unread-mail neglect or historical process time", () => {
  const observations = observeWaitingPoints([
    record(), record({ id: "done", status: "approved" }),
    record({ id: "mail", table: "integration_canonical_records", kind: "message", status: "unread" }),
    record({ id: "future", created_at: "2026-11-18T12:00:00Z" }),
    record({ id: "lead", table: "crm_leads", status: "new", updated_at: "2026-11-10T12:00:00Z", next_action: "Confirm needs" }),
    record({ id: "empty-lead", table: "crm_leads", status: "new", updated_at: "2026-11-10T12:00:00Z" }),
    record({ id: "blocked", table: "agent_work_items", status: "blocked" }),
  ], now);
  assert.deepEqual(observations.map((o) => o.sources[0].id).sort(), ["approval-one", "blocked", "lead"]);
  assert.match(observations.find((o) => o.sources[0].id === "lead")!.limitation, /not proof of customer consent/);
  assert.ok(observations.every((o) => o.sources[0].revision));
});

test("manager receives the identical reviewed facts, provenance, authority and partial-coverage warnings as owner context", () => {
  const context = buildBusinessContext(fixture());
  const manager = buildManagerContext(context);
  assert.deepEqual(manager.business_facts, context.facts);
  assert.deepEqual(manager.authority, context.authority);
  assert.deepEqual(manager.coverage, context.coverage);
  assert.match(manager.limits, /Unknown, conflicting or unreviewed/);
  assert.equal(manager.scope.clientId, scope.clientId);
});

function repositoryFixture(failTable?: string, overrides: Record<string, unknown> = {}) {
  const queries: { table: string; columns: string; filters: [string, unknown][]; bounds: { op: "in" | "gte" | "lt"; key: string; value: unknown }[]; orders: { key: string; ascending: boolean }[]; limit: number | null }[] = [];
  const input = fixture();
  const tables: Record<string, unknown> = {
    business_workspace_profiles: input.profile,
    business_context_reviews: input.review,
    client_knowledge_profiles: null,
    agent_team_settings: { status: "paused", authority_revision: 3 },
    business_agent_activation: null,
    integration_connections: [{ ...input.connections[0], config: { workspace_view_only: true, client_secret: "private-configuration" }, provider: { provider_key: "google_workspace" } }],
    integration_sync_states: input.streams,
    client_businesses: { id: scope.clientId, partner_id: scope.partnerId, status: "active", crm_operating_mode: "primary_crm", default_runtime_mode: "live" },
    ...overrides,
  };
  const admin = {
    from(table: string) {
      const query: (typeof queries)[number] = { table, columns: "", filters: [], bounds: [], orders: [], limit: null };
      queries.push(query);
      const chain = {
        select(columns: string) { query.columns = columns; return chain; },
        eq(key: string, value: unknown) { query.filters.push([key, value]); return chain; },
        in(key: string, value: unknown[]) { query.bounds.push({ op: "in", key, value }); return chain; },
        gte(key: string, value: unknown) { query.bounds.push({ op: "gte", key, value }); return chain; },
        lt(key: string, value: unknown) { query.bounds.push({ op: "lt", key, value }); return chain; },
        order(key: string, options: { ascending?: boolean } = {}) { query.orders.push({ key, ascending: options.ascending ?? true }); return chain; },
        limit(value: number) { query.limit = value; return chain; },
        maybeSingle() { return chain; },
        then(resolve: (value: { data: unknown; error: unknown }) => unknown) {
          const value = Object.hasOwn(tables, table) ? tables[table] : [];
          const field = (row: Record<string, unknown>, key: string): unknown => {
            const [column, property] = key.split("->>");
            return property ? (row[column] as Record<string, unknown> | null)?.[property] : row[column];
          };
          let data = value;
          if (Array.isArray(value)) {
            data = value.filter((row) => query.filters.every(([key, value]) => field(row, key) === value) && query.bounds.every(({ op, key, value }) => {
              const current = field(row, key);
              if (op === "in") return (value as unknown[]).includes(current);
              if (current === undefined || current === null) return false;
              const timestamp = !key.includes("->>") && Number.isFinite(Date.parse(String(current))) && Number.isFinite(Date.parse(String(value)));
              const left = timestamp ? Date.parse(String(current)) : String(current), right = timestamp ? Date.parse(String(value)) : String(value);
              return op === "gte" ? left >= right : left < right;
            }));
            (data as Record<string, unknown>[]).sort((a, b) => {
              for (const order of query.orders) {
                const result = String(field(a, order.key) ?? "").localeCompare(String(field(b, order.key) ?? ""));
                if (result) return order.ascending ? result : -result;
              }
              return 0;
            });
            if (query.limit !== null) data = (data as unknown[]).slice(0, query.limit);
          }
          return Promise.resolve({ data, error: table === failTable ? { message: "provider-private-error" } : null }).then(resolve);
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { admin, queries };
}

test("production context repository binds every privileged read to both tenant keys and allowlists its response", async () => {
  const { admin, queries } = repositoryFixture();
  const context = await readBusinessContext(admin, scope, false, () => new Date(now));
  assert.equal(context.canWrite, false);
  assert.ok(queries.length > 10);
  for (const query of queries) {
    assert.ok(query.filters.some(([key, value]) => key === "partner_id" && value === scope.partnerId), query.table);
    assert.ok(query.filters.some(([key, value]) => key === (query.table === "client_businesses" ? "id" : "client_id") && value === scope.clientId), query.table);
    assert.notEqual(query.columns, "*");
  }
  assert.equal(JSON.stringify(context).includes("private-configuration"), false);
  assert.equal(JSON.stringify(context).includes("canonical_data"), false);
});

test("context query failures reject incomplete evidence instead of returning a successful empty business", async () => {
  const { admin } = repositoryFixture("business_context_reviews");
  await assert.rejects(readBusinessContext(admin, scope, true, () => new Date(now)), /could not be fully loaded/);
});

test("canonical context deduplicates exact native event links and per-account threads without guessing identity", () => {
  const input = fixture();
  input.batches = [{ key: "source-records", label: "Sources", limit: 100, hasMore: false, rows: [
    record({ id: "native", table: "crm_appointments", kind: "appointment", status: "booked", title: "Visit", start_at: "2026-11-18T12:00:00Z" }),
    record({ id: "unlinked", table: "crm_appointments", kind: "appointment", status: "booked", title: "Visit", start_at: "2026-11-18T12:00:00Z" }),
    record({ id: "external", table: "integration_canonical_records", kind: "appointment", status: "booked", title: "External authoritative visit", native_object_id: "native", source_record_id: "account-one", start_at: "2026-11-18T12:00:00Z" }),
    record({ id: "mail-one", table: "integration_canonical_records", kind: "message", status: "imported_snapshot", source_record_id: "account-one", external_parent_id: "same-thread" }),
    record({ id: "mail-two", table: "integration_canonical_records", kind: "message", status: "imported_snapshot", source_record_id: "account-one", external_parent_id: "same-thread", updated_at: now }),
    record({ id: "other-account-mail", table: "integration_canonical_records", kind: "message", status: "imported_snapshot", source_record_id: "account-two", external_parent_id: "same-thread" }),
  ] }];
  const context = buildBusinessContext(input);
  assert.equal(context.records.length, 4);
  const event = context.records.find((r) => r.id === "external")!;
  assert.equal(event.title, "External authoritative visit");
  assert.deepEqual(event.sources.map((s) => s.id).sort(), ["external", "native"]);
  assert.deepEqual(context.records.find((r) => r.id === "mail-two")!.sources.map((s) => s.id).sort(), ["mail-one", "mail-two"]);
  assert.ok(context.records.some((r) => r.id === "other-account-mail"));
  assert.match(summarizeBusinessContext(context).summary, /2 appointments/);
});

test("manager production boundary shares owner sources and authority, excludes itself and preserves truthful sample limits", async () => {
  const { admin } = repositoryFixture(undefined, {
    agent_work_items: [{ ...tenant, id: "manager-current", title: "This request", kind: "business_request", status: "running", revision: 2, updated_at: now }, ...Array.from({ length: 15 }, (_, index) => ({ ...tenant, id: `work-${index}`, title: `Saved work ${index}`, kind: "business_request", status: "blocked", revision: index + 1, updated_at: "2026-11-15T12:00:00Z" }))],
    crm_appointments: [{ ...tenant, id: "native-event", title: "Visit", status: "booked", start_at: "2026-11-18T12:00:00Z", updated_at: now }],
    integration_canonical_records: [
      { ...tenant, id: "imported-event", connection_id: "google-one", object_type: "appointment", native_object_id: "native-event", external_object_id: "external-event", updated_at: now, external_updated_at: now, canonical_data: { title: "Visit from source", status: "booked", start_at: "2026-11-18T12:00:00Z", end_at: "2026-11-18T13:00:00Z", raw_secret: "private-canonical-payload" } },
      { ...tenant, id: "mail", connection_id: "google-one", object_type: "message", external_object_id: "gmail-id", external_parent_id: "gmail-thread", updated_at: now, external_updated_at: now, canonical_data: { subject: "A normal email", is_read: false, body: "private-email-body" } },
    ],
  });
  const owner = await readBusinessContext(admin, scope, true, () => new Date(now));
  const manager = await readManagerBusinessContext(admin, { id: "manager-current", partner_id: scope.partnerId, client_id: scope.clientId }, () => new Date(now));
  assert.deepEqual(manager.model.business_facts, owner.facts);
  assert.deepEqual(manager.model.authority, owner.authority);
  assert.equal(manager.model.records.some((r) => r.id === "manager-current"), false);
  assert.equal(manager.model.records.filter((r) => r.table === "agent_work_items").length, 12);
  assert.equal(manager.model.record_sample_partial, true);
  const appointment = manager.model.records.find((r) => r.id === "imported-event")!;
  assert.deepEqual(appointment.sources, owner.records.find((r) => r.id === "imported-event")!.sources);
  assert.match(manager.summary.summary, /1 appointments/);
  assert.match(manager.summary.summary, /0 open leads/);
  assert.equal(manager.evidence.context_revision, owner.revision);
  assert.equal(JSON.stringify(manager).includes("private-canonical-payload"), false);
  assert.equal(JSON.stringify(manager).includes("private-email-body"), false);
});

test("cancelled imported events suppress linked native bookings and disconnected imports stay out of manager facts", async () => {
  const { admin } = repositoryFixture(undefined, {
    crm_appointments: [{ ...tenant, id: "native-event", title: "Old booked visit", status: "booked", start_at: "2026-11-18T12:00:00Z", updated_at: now }],
    integration_connections: [{ ...tenant, id: "google-one", display_name: "Office", status: "connected", runtime_mode: "live", config: {}, provider: { provider_key: "google_workspace" } }, { ...tenant, id: "disconnected", display_name: "Disconnected", status: "not_connected", runtime_mode: "paused", config: {}, provider: { provider_key: "google_workspace" } }],
    integration_canonical_records: [
      { ...tenant, id: "cancelled-import", connection_id: "google-one", object_type: "appointment", native_object_id: "native-event", updated_at: now, external_updated_at: now, canonical_data: { title: "Cancelled visit", status: "cancelled", start_at: "2026-11-18T12:00:00Z" } },
      { ...tenant, id: "private-disconnected-mail", connection_id: "disconnected", object_type: "message", external_object_id: "gmail-id", updated_at: now, external_updated_at: now, canonical_data: { subject: "Disconnected account contents" } },
    ],
  });
  const context = await readBusinessContext(admin, scope, true, () => new Date(now));
  assert.equal(context.records.some((r) => r.id === "native-event"), false);
  assert.equal(context.records.some((r) => r.id === "private-disconnected-mail"), false);
  assert.match(summarizeBusinessContext(context).summary, /0 appointments/);
  assert.equal(context.records.find((r) => r.id === "cancelled-import")!.status, "cancelled");
});

test("date-less persisted deletion snapshots reconcile native bookings; Google statuses and source timestamps remain truthful", async () => {
  const event = (id: string, connection: string, data: Record<string, unknown>, native: string | null = null) => ({ ...tenant, id, connection_id: connection, object_type: "appointment", external_object_id: id, native_object_id: native, updated_at: now, external_updated_at: "2026-11-16T12:00:00Z", canonical_data: data.start_at ? { end_at: String(data.start_at).replace("12:00", "13:00"), ...data } : data });
  const { admin, queries } = repositoryFixture(undefined, {
    crm_appointments: [{ ...tenant, id: "native-event", title: "Old booking", status: "booked", start_at: "2026-11-18T12:00:00Z", updated_at: now }],
    integration_connections: [{ ...tenant, id: "google-one", display_name: "Office", status: "connected", runtime_mode: "live", config: {}, provider: { provider_key: "google_workspace" } }, { ...tenant, id: "disconnected", display_name: "Old account", status: "not_connected", runtime_mode: "paused", config: {}, provider: { provider_key: "google_workspace" } }],
    integration_canonical_records: [
      ...Array.from({ length: 150 }, (_, i) => event(`old-account-${i}`, "disconnected", { title: "Private disconnected appointment", status: "confirmed", start_at: "2026-11-18T12:00:00Z" })),
      event("deleted-event", "google-one", { deleted: true }, "native-event"),
      event("confirmed", "google-one", { title: "Google confirmed", status: "confirmed", start_at: "2026-11-19T12:00:00Z" }),
      event("tentative", "google-one", { title: "Google tentative", status: "tentative", start_at: "2026-11-20T12:00:00Z" }),
    ],
  });
  const context = await readBusinessContext(admin, scope, true, () => new Date(now));
  assert.equal(context.records.find((r) => r.id === "deleted-event")!.status, "deleted");
  assert.equal(context.records.some((r) => r.id === "native-event"), false);
  assert.equal(context.records.some((r) => r.id.startsWith("old-account")), false);
  assert.equal(context.records.find((r) => r.id === "confirmed")!.status, "booked");
  assert.equal(context.records.find((r) => r.id === "tentative")!.status, "proposed");
  assert.equal(context.records.find((r) => r.id === "confirmed")!.sources[0].updatedAt, now);
  assert.match(summarizeBusinessContext(context).summary, /2 appointments/);
  assert.equal(context.coverage.find((c) => c.key === "imported:appointment")!.hasMore, false);
  const reconciliation = queries.find((q) => q.bounds.some((b) => b.op === "in" && b.key === "native_object_id"))!;
  assert.ok(reconciliation);
  assert.equal(reconciliation.bounds.some((b) => b.key.includes("start_at")), false);
  assert.ok(queries.filter((q) => q.table === "integration_canonical_records").every((q) => q.bounds.some((b) => b.op === "in" && b.key === "connection_id" && JSON.stringify(b.value) === '["google-one"]')));
});

test("overlapping bounded calendar lookups count each canonical source once and retain linked tombstones ahead of overflow", async () => {
  const { admin } = repositoryFixture(undefined, {
    crm_appointments: [{ ...tenant, id: "native", title: "Stale native visit", status: "booked", start_at: "2026-11-18T12:00:00Z", updated_at: now }],
    integration_canonical_records: [
      ...Array.from({ length: 110 }, (_, index) => ({ ...tenant, id: `live-${index}`, external_object_id: `live-${index}`, connection_id: "google-one", object_type: "appointment", updated_at: now, external_updated_at: now, canonical_data: { title: "Future event", status: "confirmed", start_at: "2026-11-18T12:00:00Z", end_at: "2026-11-18T13:00:00Z" } })),
      { ...tenant, id: "deleted-native", external_object_id: "deleted-native", connection_id: "google-one", object_type: "appointment", native_object_id: "native", updated_at: now, external_updated_at: null, canonical_data: { deleted: true } },
    ],
  });
  const context = await readBusinessContext(admin, scope, true, () => new Date(now));
  assert.ok(context.records.some((r) => r.id === "deleted-native"));
  assert.equal(context.records.some((r) => r.id === "native"), false);
  assert.equal(context.coverage.find((c) => c.key === "imported:appointment")!.sampled, 100);
  assert.equal(context.coverage.find((c) => c.key === "imported:appointment")!.hasMore, true);
  assert.equal(new Set(context.records.map((r) => `${r.table}:${r.id}`)).size, context.records.length);
});

test("conflicting booking policies expose both source identities and cap previously selected action authority", async () => {
  const { admin } = repositoryFixture(undefined, {
    business_workspace_profiles: { ...fixture().profile!, profile: { ...fixture().profile!.profile, policies: "Require a deposit" } },
    client_knowledge_profiles: { ...tenant, id: "knowledge-policy", updated_at: now, business_description: "Appointment business", services_offered: "Coaching sessions", business_hours: "9 to 5", booking_rules: "No deposit required" },
    agent_team_settings: { status: "active", authority_revision: 4, conversations_enabled: true, scheduling_enabled: true, channel_authority: { email: "require_approval", calendar: "require_approval" } },
    business_agent_activation: { status: "active", email: true, bookings: true, workspace_connection_id: "google-one" },
  });
  const context = await readBusinessContext(admin, scope, true, () => new Date(now));
  const policies = context.facts.find((fact) => fact.key === "policies")!;
  assert.equal(policies.state, "conflict");
  assert.deepEqual(policies.sources.map((s) => s.table), ["business_workspace_profiles", "client_knowledge_profiles"]);
  assert.ok(context.facts.every((fact) => !fact.reviewed));
  assert.equal(context.authority.channels.email, "observe");
  assert.equal(context.authority.channels.calendar, "observe");
});

// This is a migration-derived schema contract, not a Postgres/RLS execution test.
function migrationColumns(sql: string, table: string): Set<string> {
  const columns = new Set<string>();
  const create = new RegExp(`create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+(?:public\\.)?${table}\\s*\\(`, "gi");
  let match: RegExpExecArray | null;
  while ((match = create.exec(sql))) {
    let depth = 1, quoted = false, chunk = "";
    const add = () => {
      const name = /^\s*([a-z_][a-z_0-9]*)\s+/i.exec(chunk)?.[1];
      if (name && !["constraint", "primary", "foreign", "unique", "check"].includes(name.toLowerCase())) columns.add(name);
      chunk = "";
    };
    for (let index = create.lastIndex; index < sql.length && depth; index++) {
      const character = sql[index];
      if (!quoted && sql.slice(index, index + 2) === "--") { index = sql.indexOf("\n", index); if (index < 0) break; continue; }
      if (character === "'") { if (quoted && sql[index + 1] === "'") { chunk += "''"; index++; continue; } quoted = !quoted; }
      if (!quoted && character === "(") depth++;
      if (!quoted && character === ")") { depth--; if (!depth) { add(); break; } }
      if (!quoted && character === "," && depth === 1) add();
      else chunk += character;
    }
  }
  const alter = new RegExp(`alter\\s+table(?:\\s+if\\s+exists)?\\s+(?:public\\.)?${table}\\b([\\s\\S]*?);`, "gi");
  while ((match = alter.exec(sql))) {
    for (const addition of match[1].matchAll(/\badd\s+column(?:\s+if\s+not\s+exists)?\s+([a-z_][a-z_0-9]*)/gi)) columns.add(addition[1]);
  }
  return columns;
}
test("production loader selected columns and predicates exist in the actual migration schema", async () => {
  const folder = new URL("../supabase/migrations/", import.meta.url);
  const sql = readdirSync(folder).filter((file) => file.endsWith(".sql")).sort().map((file) => readFileSync(new URL(file, folder), "utf8")).join("\n");
  const { admin, queries } = repositoryFixture(undefined, { crm_appointments: [{ ...tenant, id: "native", title: "Visit", status: "booked", start_at: "2026-11-18T12:00:00Z", updated_at: now }] });
  await readBusinessContext(admin, scope, true, () => new Date(now));
  for (const query of queries) {
    const available = migrationColumns(sql, query.table);
    assert.ok(available.size, `${query.table} must exist in migration history`);
    const selection = query.columns.replace(/\w+:(\w+)(?:!inner)?\(([^)]*)\)/g, (_all, relation, fields) => {
      const joined = migrationColumns(sql, relation);
      for (const field of String(fields).split(",")) assert.ok(joined.has(field.trim()), `${relation}.${field}`);
      return "";
    });
    const used = [...selection.split(",").filter(Boolean), ...query.filters.map(([key]) => key), ...query.bounds.map(({ key }) => key), ...query.orders.map(({ key }) => key)];
    for (const column of used) assert.ok(available.has(column.trim().split("->>")[0]), `${query.table}.${column} is absent from migration schema`);
  }
});

test("shared multi-app loader gives owner and manager the same bounded intake question and current money fields", async () => {
  const connections = [
    { ...tenant, id: "form", display_name: "Website form", status: "connected", runtime_mode: "live", config: {}, provider: { provider_key: "generic_inbound_webhook" } },
    { ...tenant, id: "stripe", display_name: "Payments", status: "connected", runtime_mode: "live", config: {}, provider: { provider_key: "stripe" } },
  ];
  const canonical = (id: string, connection: string, kind: string, data: Record<string, unknown>) => ({ ...tenant, id, connection_id: connection, object_type: kind, external_object_id: id, external_parent_id: null, native_object_id: null, updated_at: now, external_updated_at: "2026-11-01T12:00:00Z", canonical_data: data });
  const { admin, queries } = repositoryFixture(undefined, {
    integration_connections: connections,
    integration_sync_states: [
      { ...tenant, connection_id: "form", stream_key: "lead", status: "idle", last_completed_at: now, cursor_value: null, last_error: null },
      { ...tenant, connection_id: "stripe", stream_key: "invoice", status: "idle", last_completed_at: now, cursor_value: null, last_error: null },
      { ...tenant, connection_id: "stripe", stream_key: "payment", status: "running", last_completed_at: now, cursor_value: { after: "private-page-token" }, last_error: null },
    ],
    integration_canonical_records: [
      canonical("lead-source", "form", "lead", { title: "Question", status: "new", received_at: now, description: "Please help with a service appointment.", internal_metadata: "private-meta" }),
      canonical("in_source", "stripe", "invoice", { status: "open", currency: "USD", amount_due_minor: 1200, amount_paid_minor: 0, total_minor: 1200 }),
      canonical("pi_source", "stripe", "payment", { status: "partially_refunded", currency: "USD", amount_minor: 5000, amount_refunded_minor: 2000 }),
    ],
  });
  const owner = await loadConnectedRecords(admin, scope, { connections, clock: () => new Date(now) });
  const context = await readBusinessContext(admin, scope, true, () => new Date(now));
  const manager = buildManagerContext(context);
  assert.equal(owner.data.leads![0].preview, "Please help with a service appointment.");
  assert.equal(manager.records.find((r) => r.id === "lead-source")!.summary, owner.data.leads![0].preview);
  assert.equal(manager.records.find((r) => r.id === "in_source")!.amountDueMinor, owner.data.invoices![0].amountDueMinor);
  assert.equal(manager.records.find((r) => r.id === "pi_source")!.amountRefundedMinor, 2000);
  assert.equal(owner.apps.find((a) => a.id === "stripe")!.streams!.find((s) => s.key === "payment")!.partial, true);
  assert.equal(owner.apps.find((a) => a.id === "stripe")!.streams!.find((s) => s.key === "payment")!.status, "stale");
  assert.equal(JSON.stringify(manager).includes("private-meta"), false);
  assert.equal(JSON.stringify(owner.data).includes("private-page-token"), false);
  assert.ok(queries.filter((q) => q.table === "integration_canonical_records").every((q) => q.bounds.some((b) => b.key === "connection_id" && b.op === "in")));
});

test("void, draft and uncollectible invoice snapshots do not become collection recommendations", () => {
  const input = fixture();
  input.batches = [{ key: "money", label: "Money", limit: 100, hasMore: false, rows: ["void", "draft", "uncollectible"].map((status) => record({ id: status, kind: "invoice", status, table: "integration_canonical_records", display: { amountDueMinor: 9999, currency: "USD" } })) }];
  const recommendation = buildBusinessContext(input).recommendations.find((r) => r.key === "money_review")!;
  assert.equal(recommendation.label, "Inspect money records");
  assert.equal(recommendation.reason.includes("unpaid"), false);
  input.batches[0].rows.push(record({ id: "open", kind: "invoice", status: "open", table: "integration_canonical_records", display: { amountDueMinor: 1000, currency: "USD" } }));
  assert.equal(buildBusinessContext(input).recommendations.find((r) => r.key === "money_review")!.label, "Review money due");
});
