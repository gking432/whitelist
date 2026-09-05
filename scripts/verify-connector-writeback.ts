import assert from "node:assert/strict";

import { createClient } from "@supabase/supabase-js";

import { enqueueLeadConnectorWriteback } from "../lib/integrations/connectors/writeback.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error("Local Supabase configuration is required.");
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false },
});
const partnerId = "10000000-0000-4000-8000-000000000001";
const clientId = "20000000-0000-4000-8000-000000000001";
const providerKey = "workiz";
let runId: string | null = null;

const { data: provider } = await admin
  .from("integration_providers")
  .select("id")
  .eq("provider_key", providerKey)
  .single();
assert.ok(provider);

const { data: connection, error: connectionError } = await admin
  .from("integration_connections")
  .insert({
    partner_id: partnerId,
    client_id: clientId,
    provider_id: provider.id,
    display_name: "Write-back verification",
    status: "connected",
    runtime_mode: "live",
    credential_status: "configured",
    config: {},
  })
  .select("id")
  .single();
assert.ifError(connectionError);
assert.ok(connection);

try {
  const { data: workflow } = await admin
    .from("client_workflow_instances")
    .select("id, template_id, template:workflow_templates!inner(template_key)")
    .eq("client_id", clientId)
    .eq("template.template_key", "new_lead_intake")
    .maybeSingle();
  assert.ok(workflow);
  const { data: run, error: runError } = await admin
    .from("workflow_runs")
    .insert({
      partner_id: partnerId,
      client_id: clientId,
      workflow_instance_id: workflow.id,
      template_id: workflow.template_id,
      status: "running",
      runtime_mode: "sandbox",
    })
    .select("id")
    .single();
  assert.ifError(runError);
  assert.ok(run);
  runId = run.id;

  const result = await enqueueLeadConnectorWriteback(admin, {
    partnerId,
    clientId,
    workflowRunId: run.id,
    templateKey: "new_lead_intake",
    eventType: "call.completed",
    eventData: {
      name: "Writeback Verification",
      phone: "+13125550100",
      email: "writeback@example.test",
    },
    runSummary: "Customer requested an estimate.",
  });
  assert.equal(result?.writeback.status, "queued");
  assert.equal(result?.writeback.object_type, "lead");

  const { data: jobs } = await admin
    .from("integration_sync_jobs")
    .select("id, direction, object_type, operation, status, payload")
    .eq("connection_id", connection.id);
  assert.equal(jobs?.length, 1);
  assert.equal(jobs?.[0]?.direction, "push");
  assert.equal(jobs?.[0]?.object_type, "lead");
  assert.equal(jobs?.[0]?.operation, "create");
  assert.equal(jobs?.[0]?.status, "queued");
  assert.equal(
    (jobs?.[0]?.payload as { data?: { phone?: string } }).data?.phone,
    "+13125550100",
  );

  const { data: events } = await admin
    .from("integration_events")
    .select("event_type, status, external_object_type, request_payload")
    .eq("connection_id", connection.id)
    .eq("workflow_run_id", run.id);
  assert.equal(events?.length, 1);
  assert.equal(events?.[0]?.event_type, "connector.lead_writeback_queued");
  assert.equal(events?.[0]?.status, "processed");
  assert.equal(events?.[0]?.external_object_type, "lead");
  assert.equal(
    (events?.[0]?.request_payload as { phone?: string }).phone,
    "+13125550100",
  );

  console.log("Connector write-back queue verified against local Supabase.");
} finally {
  await admin.from("integration_connections").delete().eq("id", connection.id);
  if (runId) await admin.from("workflow_runs").delete().eq("id", runId);
}
