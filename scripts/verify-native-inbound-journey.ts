import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { produceNativeCrmLifecycleEvents } from "../lib/crm/lifecycle";
import { enqueueInboundEvent, processInboundEventJobs } from "../lib/integrations/inbound/queue";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(url && key && ["127.0.0.1", "localhost"].includes(new URL(url).hostname), "An isolated local backend is required.");
process.env.ANTHROPIC_API_KEY = "";
process.env.OPENAI_API_KEY = "";
const admin = createClient(url, key, { auth: { persistSession: false } });
const partnerId = randomUUID();
const clientId = randomUUID();
const contactId = randomUUID();

async function main() {
  try {
    await admin.from("partners").insert({ id: partnerId, name: "Synthetic native queue", slug: `native-${partnerId}`, status: "active", is_test_account: true }).throwOnError();
    await admin.from("client_businesses").insert({ id: clientId, partner_id: partnerId, name: "Synthetic native queue", slug: `native-${clientId}`, status: "active", is_test_account: true, crm_operating_mode: "primary_crm", default_runtime_mode: "live", native_lifecycle_enabled_at: new Date().toISOString() }).throwOnError();
    await admin.from("crm_contacts").insert({ id: contactId, partner_id: partnerId, client_id: clientId, first_name: "Synthetic", email: "native-queue@example.test" }).throwOnError();
    const { data: templates } = await admin.from("workflow_templates").select("id,template_key").in("template_key", ["appointment_reminder", "review_request"]).throwOnError();
    assert.equal(templates?.length, 2);
    await admin.from("client_workflow_instances").insert(templates!.map((template) => ({ partner_id: partnerId, client_id: clientId, template_id: template.id, name: template.template_key, status: "active", runtime_mode: "live", approval_policy: { requires_approval: true } }))).throwOnError();
    await admin.from("crm_appointments").insert([
      { partner_id: partnerId, client_id: clientId, contact_id: contactId, title: "Future fixture", status: "booked", start_at: new Date(Date.now() + 3600000).toISOString(), end_at: new Date(Date.now() + 7200000).toISOString() },
      { partner_id: partnerId, client_id: clientId, contact_id: contactId, title: "Completed fixture", status: "completed", start_at: new Date(Date.now() - 7200000).toISOString(), end_at: new Date(Date.now() - 3600000).toISOString() },
    ]).throwOnError();
    const produced = await produceNativeCrmLifecycleEvents(admin);
    assert.equal(produced.failed, 0);
    const { data: jobs } = await admin.from("inbound_event_jobs").select("event_id,connection_id").eq("client_id", clientId).throwOnError();
    assert.equal(jobs?.length, 2);
    for (const job of jobs!) {
      assert.equal(job.connection_id, null);
      assert.deepEqual(await processInboundEventJobs(admin, 1, job.event_id), { processed: 1, failed: 0 });
    }
    const { data: approvals } = await admin.from("approval_items").select("id,status").eq("client_id", clientId).throwOnError();
    assert.equal(approvals?.length, 2);
    assert.ok(approvals!.every((row) => row.status === "pending"));
    const { count: actions } = await admin.from("action_jobs").select("id", { count: "exact", head: true }).eq("client_id", clientId).throwOnError();
    assert.equal(actions, 0, "Native events must stop at approval, without sending customer messages.");
    await produceNativeCrmLifecycleEvents(admin);
    const { count: afterReplay } = await admin.from("inbound_event_jobs").select("id", { count: "exact", head: true }).eq("client_id", clientId).throwOnError();
    assert.equal(afterReplay, 2, "Another scheduler sweep must not repeat native events.");
    const receipt = await enqueueInboundEvent(admin, { partnerId, clientId, connectionId: null, eventType: "job.completed", idempotencyKey: "native-cancel-fixture", data: { email: "native-queue@example.test" } });
    await admin.from("client_businesses").update({ native_lifecycle_enabled_at: null }).eq("id", clientId).throwOnError();
    await processInboundEventJobs(admin, 1, receipt.eventId);
    const { data: cancelled } = await admin.from("inbound_event_jobs").select("status,encrypted_payload").eq("event_id", receipt.eventId).single().throwOnError();
    assert.deepEqual(cancelled, { status: "cancelled", encrypted_payload: null });
    console.log(JSON.stringify({ verified: true, native_queue: "appointment and completion events reached pending approvals", scheduler_deduplication: "passed", disabled_before_processing: "cancelled and purged", external_actions: 0 }));
  } finally {
    await admin.from("partners").delete().eq("id", partnerId).throwOnError();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
