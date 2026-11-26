import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createBusinessRecord, runBusinessRecipe } from "../lib/business/engine";
import { processBusinessSchedules } from "../lib/business/scheduler";
import { EMPTY_PROFILE } from "../lib/business/types";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname), "Local database only");
  // This verifies deterministic behavior without making paid provider calls.
  delete process.env.ANTHROPIC_API_KEY;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const partnerId = randomUUID(), clientId = randomUUID();
  const scope = { partnerId, clientId, actorId: null };
  const unwrap = <T,>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data; };
  const due = unwrap(await admin.from("business_capability_installs").select("id").eq("schedule_enabled", true).eq("status", "enabled").lte("next_run_at", new Date().toISOString()));
  assert.equal(due?.length, 0, "Do not run another local account's due schedules during verification");
  unwrap(await admin.from("partners").insert({ id: partnerId, name: "Recipe verification", slug: `verify-${partnerId}`, is_test_account: true, status: "active" }));
  try {
    unwrap(await admin.from("client_businesses").insert({ id: clientId, partner_id: partnerId, name: "Recipe verification", slug: `verify-${clientId}`, is_test_account: true, status: "active" }));
    unwrap(await admin.from("business_workspace_profiles").insert({ client_id: clientId, partner_id: partnerId, profile: { ...EMPTY_PROFILE, description: "A fictional shop for isolated verification.", industry: "retail" } }));
    const productId = await createBusinessRecord(admin, scope, { kind: "product", title: "Verification grips", body: "", data: { quantity: 2, reorder_point: 4, target_stock: 12, unit_cost: 5, price: 10 } }, randomUUID());
    for (const recipe_key of ["purchasing-planner", "owner-briefing", "payment-followup", "listing-assistant"]) unwrap(await admin.from("business_capability_installs").insert({ partner_id: partnerId, client_id: clientId, recipe_key, status: "enabled" }));
    const key = randomUUID();
    const first = await runBusinessRecipe(admin, scope, "purchasing-planner", "", key);
    const repeated = await runBusinessRecipe(admin, scope, "purchasing-planner", "", key);
    assert.equal(repeated.recordId, first.recordId);
    await runBusinessRecipe(admin, scope, "purchasing-planner", "", randomUUID());
    const purchases = unwrap(await admin.from("business_records").select("id,revision,data,status").eq("client_id", clientId).eq("kind", "purchase"));
    assert.equal(purchases?.length, 1, "Open proposals must prevent duplicate replenishment");
    assert.equal(purchases![0].data.quantity, 10);
    assert.equal(purchases![0].status, "draft");
    unwrap(await admin.rpc("transition_business_record", { p_partner: partnerId, p_client: clientId, p_actor: null, p_id: purchases![0].id, p_revision: purchases![0].revision, p_action: "archive", p_reference: "" }));
    await Promise.all([runBusinessRecipe(admin, scope, "purchasing-planner", "", randomUUID()), runBusinessRecipe(admin, scope, "purchasing-planner", "", randomUUID())]);
    const replacement = unwrap(await admin.from("business_records").select("id").eq("client_id", clientId).eq("kind", "purchase").neq("status", "archived"));
    assert.equal(replacement?.length, 1, "An archived proposal can be replaced without concurrent duplicates");
    assert.notEqual(replacement![0].id, purchases![0].id);
    const invoiceA = await createBusinessRecord(admin, scope, { kind: "invoice", title: "Invoice A", body: "", data: { customer: "Customer A", amount: 25, reference: "A-001" } }, randomUUID());
    await createBusinessRecord(admin, scope, { kind: "invoice", title: "Invoice B", body: "", data: { customer: "PRIVATE-CUSTOMER-B", amount: 77, reference: "B-002" } }, randomUUID());
    await assert.rejects(() => runBusinessRecipe(admin, scope, "payment-followup", "", randomUUID()), /Choose an unpaid invoice/);
    const reminder = await runBusinessRecipe(admin, scope, "payment-followup", "", randomUUID(), invoiceA);
    const draft = unwrap(await admin.from("business_records").select("body,data,source_record_id").eq("id", reminder.recordId).single());
    assert.ok(draft);
    assert.ok(draft.body.includes("Customer A"));
    assert.ok(!draft.body.includes("PRIVATE-CUSTOMER-B"));
    assert.equal(draft.source_record_id, invoiceA);
    assert.equal(draft.data.audience, "Customer A", "Invoice reminders must not inherit the general marketing audience");
    await assert.rejects(() => runBusinessRecipe(admin, scope, "listing-assistant", "", randomUUID(), invoiceA), /Choose an inventory item/);
    await runBusinessRecipe(admin, scope, "listing-assistant", "", randomUUID(), productId);
    unwrap(await admin.from("business_capability_installs").update({ status: "paused" }).eq("client_id", clientId).eq("recipe_key", "purchasing-planner"));
    await assert.rejects(() => runBusinessRecipe(admin, scope, "purchasing-planner", "", randomUUID()), /Enable this capability/);
    unwrap(await admin.from("business_capability_installs").update({ schedule_enabled: true, next_run_at: new Date(Date.now() - 1000).toISOString() }).eq("client_id", clientId).eq("recipe_key", "owner-briefing"));
    const schedule = await Promise.all([processBusinessSchedules(admin, 5), processBusinessSchedules(admin, 5)]);
    assert.equal(schedule.reduce((n, r) => n + r.completed, 0), 1, "Only one worker must claim a daily run");
    const briefings = unwrap(await admin.from("business_records").select("id").eq("client_id", clientId).like("request_key", "scheduled:%"));
    assert.equal(briefings?.length, 1);
    const installed = unwrap(await admin.from("business_capability_installs").select("next_run_at").eq("client_id", clientId).eq("recipe_key", "owner-briefing").single());
    assert.ok(installed);
    assert.ok(Date.parse(installed.next_run_at) > Date.now() + 23 * 3600000, "Successful schedule moves to tomorrow");
    console.log("PASS: capability outputs, replay-safe replenishment, selected-record privacy, pause behavior, and concurrent daily scheduling.");
  } finally {
    unwrap(await admin.from("business_workspace_events").delete().eq("client_id", clientId));
    unwrap(await admin.from("business_records").delete().eq("client_id", clientId));
    unwrap(await admin.from("business_capability_installs").delete().eq("client_id", clientId));
    unwrap(await admin.from("business_workspace_profiles").delete().eq("client_id", clientId));
    unwrap(await admin.from("client_businesses").delete().eq("id", clientId));
    unwrap(await admin.from("partners").delete().eq("id", partnerId));
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Verification failed"); process.exitCode = 1; });
