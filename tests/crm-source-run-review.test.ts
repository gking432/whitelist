import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { executeCrmGatewayAction, readCrmGatewayReview } from "../lib/crm/gateway-service.ts";
import type { ActionJobRecord } from "../lib/jobs/record.ts";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const scope = { partnerId: id(1), clientId: id(2) }, clock = "2026-11-18T03:00:00Z";
type Row = Record<string, unknown>;
function repository(run?: Row, event?: Row) {
  const calls: { table: string; columns: string; filters: [string, unknown][] }[] = [];
  const records: Record<string, Row[]> = {
    workflow_runs: run ? [run] : [], integration_events: event ? [event] : [], workflow_templates: [{ id: id(8), template_key: "customer_intake", prompt: "must not be read" }],
    integration_connections: [{ id: id(3), partner_id: id(1), client_id: id(2), display_name: "Business CRM", external_account_name: "Exact HubSpot", external_account_id: "456", status: "connected", runtime_mode: "live", credential_status: "configured", provider: { provider_key: "hubspot" },
      config: { hubspot_owner_crm: true, hubspot_config_revision: "config-r1", hubspot_grant_revision: "grant-r1", hubspot_actions_enabled: true, hubspot_selected_permissions: ["contact.create"] } }],
    agent_team_settings: [{ partner_id: id(1), client_id: id(2), authority_revision: 4 }], client_businesses: [{ id: id(2), partner_id: id(1), customer_system_connection_id: id(3) }], approval_items: [],
  };
  const admin = { from(table: string) {
    const call = { table, columns: "", filters: [] as [string, unknown][] }; calls.push(call);
    const result = () => (records[table] ?? []).filter((row) => call.filters.every(([field, value]) => row[field] === value));
    const query = { select(columns: string) { call.columns = columns; return this; }, eq(field: string, value: unknown) { call.filters.push([field, value]); return this; },
      order() { return this; }, limit() { return this; }, async maybeSingle() { return { data: result()[0] ?? null, error: null }; },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { return Promise.resolve({ data: result(), error: null }).then(resolve, reject); } };
    return query;
  }, rpc: async (name: string, args: Record<string, unknown>) => { assert.equal(args.p_partner, scope.partnerId); assert.equal(args.p_client, scope.clientId); if (name === "hubspot_open_review") { assert.equal(args.p_connection, id(3)); return { data: null, error: null }; } assert.equal(name, "crm_gateway_source_check"); return { data: { allowed: true }, error: null }; } } as unknown as SupabaseClient;
  return { admin, calls };
}
const run = { id: id(4), partner_id: id(1), client_id: id(2), template_id: id(8), trigger_event_id: id(9), created_at: clock,
  summary: "<untrusted source context>" + "a".repeat(2100), input_snapshot: { credentials: "must not appear" }, output_snapshot: { raw_prompt: "must not appear" } };
const event = { id: id(9), partner_id: id(1), client_id: id(2), event_type: "form.submitted", request_payload: { private: "must not appear" } };

test("original work read-through returns only bounded summary and scoped source metadata", async () => {
  const { admin, calls } = repository(run, event);
  const review = await readCrmGatewayReview(admin, scope, true, { connectionId: id(3), sourceRunId: id(4) });
  assert.deepEqual(review.sourceRun, { id: id(4), summary: run.summary.slice(0, 2000), eventType: "form.submitted", templateKey: "customer_intake", createdAt: clock });
  assert.equal(review.contact, null, "Source context never chooses a CRM contact.");
  assert.equal(JSON.stringify(review).includes("must not appear"), false);
  for (const table of ["workflow_runs", "integration_events"]) {
    const call = calls.find((item) => item.table === table)!;
    assert.ok(call.filters.some(([field, value]) => field === "partner_id" && value === scope.partnerId));
    assert.ok(call.filters.some(([field, value]) => field === "client_id" && value === scope.clientId));
    assert.doesNotMatch(call.columns, /\*|snapshot|payload|prompt/);
  }
});
test("missing or other-business work fails closed before account/source/provider access", async () => {
  for (const candidate of [undefined, { ...run, partner_id: id(7) }, { ...run, client_id: id(7) }]) {
    const { admin, calls } = repository(candidate, event);
    await assert.rejects(readCrmGatewayReview(admin, scope, true, { connectionId: id(3), sourceRunId: id(4) }), (error: unknown) => error instanceof Error && "status" in error && error.status === 404);
    assert.deepEqual(calls.map((call) => call.table), ["workflow_runs"]);
  }
  const foreignEvent = repository(run, { ...event, client_id: id(7) });
  await assert.rejects(readCrmGatewayReview(foreignEvent.admin, scope, true, { connectionId: id(3), sourceRunId: id(4) }), /source metadata could not be checked/);
});
test("ordinary CRM review does not read any workflow or source event", async () => {
  const { admin, calls } = repository();
  const review = await readCrmGatewayReview(admin, scope, false, { connectionId: id(3) });
  assert.equal(review.sourceRun, undefined); assert.equal(review.canWrite, false);
  assert.equal(calls.some((call) => ["workflow_runs", "workflow_templates", "integration_events"].includes(call.table)), false);
});
test("pre-effect policy and credential failures are failed without inventing provider uncertainty", async () => {
  const payload = { crm_gateway_version: 1, provider: "hubspot", operation: "contact.create", owner_command_id: id(10), connection_id: id(3), account_id: "456", grant_revision: "grant-r1", authority_revision: 4,
    source_record_id: null, source_updated_at: null, source_external_updated_at: null, external_id: null, source_fingerprint: null, properties: { firstname: "Deliberately new" }, note_body: null, new_identity_confirmed: true, source_run_id: null };
  const job = { id: id(11), partner_id: id(1), client_id: id(2), kind: "crm.sync", payload } as unknown as ActionJobRecord;
  for (const policyFails of [true, false]) {
    const admin = { rpc: async () => { if (policyFails) throw new Error("Policy unavailable"); return { data: { allowed: true }, error: null }; },
      from: () => { throw new Error("Credential repository unavailable"); } } as unknown as SupabaseClient;
    const outcome = await executeCrmGatewayAction(admin, job);
    assert.equal(outcome.status, "failed"); assert.equal(outcome.attempted, false); assert.equal(outcome.delivered, false); assert.match(outcome.detail, /No provider write was attempted/);
  }
  const malformedPolicy = { rpc: async () => ({ data: null, error: null }) } as unknown as SupabaseClient;
  const malformed = await executeCrmGatewayAction(malformedPolicy, job);
  assert.equal(malformed.status, "failed"); assert.equal(malformed.attempted, false);
});
