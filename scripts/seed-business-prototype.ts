import { createClient } from "@supabase/supabase-js";
import { createBusinessRecord } from "../lib/business/engine";
import {
  EMPTY_PROFILE,
  type RecordData,
  type RecordKind,
} from "../lib/business/types";

// Additive, explicitly fictional sandbox. Never writes into a live client.
// Load the intended environment explicitly, e.g. tsx --env-file=.env.local ...
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Load the intended Supabase environment first.");
  const local = ["localhost", "127.0.0.1"].includes(new URL(url).hostname);
  if (!local && !process.argv.includes("--hosted-test-account")) {
    throw new Error("Hosted fixture creation requires --hosted-test-account.");
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  async function fixture(
    table: "partners" | "client_businesses",
    slug: string,
    extra: Record<string, unknown>,
  ) {
    const existing = await admin
      .from(table)
      .select("id,is_test_account")
      .eq("slug", slug)
      .maybeSingle()
      .throwOnError();
    if (existing.data) {
      if (!existing.data.is_test_account)
        throw new Error(`Refusing to modify a live ${table} account.`);
      return existing.data.id as string;
    }
    const created = await admin
      .from(table)
      .insert({ slug, is_test_account: true, status: "active", ...extra })
      .select("id")
      .single()
      .throwOnError();
    return created.data.id as string;
  }
  const partnerId = await fixture("partners", "northstar-beta-agency", {
    name: "Northstar Prototype Agency",
  });
  const clientId = await fixture("client_businesses", "sample-golf-shop", {
    partner_id: partnerId,
    name: "Fairway Golf Shop · Test business",
    timezone: "America/Chicago",
    client_portal_enabled: true,
    crm_operating_mode: "primary_crm",
    client_experience_mode: "northstar_crm",
    default_runtime_mode: "sandbox",
    account_kind: "managed_client",
    partner_can_edit_client_data: true,
  });
  const scope = { partnerId, clientId, actorId: null };
  const priorProfile = await admin
    .from("business_workspace_profiles")
    .select("client_id")
    .eq("client_id", clientId)
    .maybeSingle()
    .throwOnError();
  if (!priorProfile.data) {
    const profile = {
      ...EMPTY_PROFILE,
      description:
        "Fictional prototype golf shop selling pre-owned clubs, balls, and accessories, with a small regripping workshop.",
      industry: "retail",
      goals: [
        "Improve marketing",
        "Find products & suppliers",
        "Manage purchasing",
        "Keep work on track",
      ],
      services:
        "Pre-owned golf equipment, grip replacement, and equipment trade-ins. All example prices and quantities are fictional.",
      audience:
        "Local golfers looking for practical advice and good-value equipment.",
      hours: "Example hours: Tuesday–Saturday, 10am–6pm Central.",
      policies:
        "Owner approval required for purchases and campaigns. Confirm equipment condition and availability before making promises.",
      tone: "Friendly, knowledgeable, down to earth",
    };
    await admin
      .from("business_workspace_profiles")
      .insert({ client_id: clientId, partner_id: partnerId, profile })
      .throwOnError();
    await admin
      .from("client_knowledge_profiles")
      .upsert(
        {
          client_id: clientId,
          partner_id: partnerId,
          business_description: profile.description,
          services_offered: profile.services,
          business_hours: profile.hours,
          booking_rules: profile.policies,
        },
        { onConflict: "client_id" },
      )
      .throwOnError();
  }
  async function record(
    key: string,
    kind: RecordKind,
    title: string,
    body: string,
    data: RecordData,
  ) {
    return createBusinessRecord(
      admin,
      scope,
      { kind, title, body, data },
      `prototype-golf-v1:${key}`,
    );
  }
  const productId = await record(
    "grips",
    "product",
    "Standard rubber grips",
    "Fictional stock item. The purchasing planner can prepare a restock request from these levels.",
    {
      sku: "DEMO-GRIP-STD",
      quantity: 4,
      reorder_point: 8,
      target_stock: 24,
      unit_cost: 4.5,
      price: 9,
      supplier: "Example Golf Supply",
    },
  );
  await record(
    "putter",
    "product",
    "Pre-owned mallet putter",
    "Fictional example: right-handed, 34-inch, inspected condition. Verify all product facts before publishing.",
    {
      sku: "DEMO-PUTTER-01",
      quantity: 2,
      reorder_point: 1,
      target_stock: 3,
      unit_cost: 45,
      price: 95,
      supplier: "Example Trade-ins",
    },
  );
  await record(
    "supplier",
    "supplier",
    "Example Golf Supply",
    "Fictional supplier for testing comparison and purchase records. No connection or account exists.",
    {
      email: "supplier@example.test",
      website: "https://example.com",
      lead_days: 5,
      contact: "Example wholesale desk",
    },
  );
  await record(
    "opportunity",
    "opportunity",
    "Used iron set buying opportunity",
    "Fictional sourcing example. Compare landed cost and expected resale, then prepare a purchase request. No live listing was found.",
    {
      supplier: "Example Trade-ins",
      url: "https://example.com",
      cost: 180,
      shipping: 20,
      fees: 10,
      resale: 320,
      condition: "Used · inspection required",
    },
  );
  const campaign = await record(
    "campaign",
    "campaign",
    "Weekend regripping campaign",
    "Give your clubs a fresh feel for your next round. Visit our workshop to ask about grip options and current turnaround times.\n\nFictional campaign draft. Review details before using it.",
    {
      channel: "Social",
      audience: "Local golfers",
      objective: "Bring more regripping work into the shop",
      budget: 0,
      publish_reference: "",
    },
  );
  const purchase = await record(
    "purchase",
    "purchase",
    "Replenish standard rubber grips",
    "Example request linked to inventory. Approve, record a manual order reference, then receive to add 20 grips to stock.",
    {
      supplier: "Example Golf Supply",
      quantity: 20,
      unit_cost: 4.5,
      shipping: 8,
      product_id: productId,
      order_reference: "",
    },
  );
  for (const id of [campaign, purchase]) {
    const current = await admin
      .from("business_records")
      .select("status,revision")
      .eq("id", id)
      .single()
      .throwOnError();
    // Only initial creation is submitted. Re-running never changes reviewed work.
    if (current.data.status === "draft" && current.data.revision === 1) {
      await admin
        .rpc("transition_business_record", {
          p_partner: partnerId,
          p_client: clientId,
          p_actor: null,
          p_id: id,
          p_revision: 1,
          p_action: "submit",
          p_reference: "",
        })
        .throwOnError();
    }
  }
  await record(
    "job",
    "job",
    "Inspect and photograph trade-in clubs",
    "Fictional workshop job. Record condition, verify specs, take photos, and prepare the listing facts.",
    {
      assignee: "Shop owner",
      due_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      priority: "normal",
      checklist:
        "Inspect condition\nVerify specifications\nPhotograph equipment\nUpdate inventory",
    },
  );
  await record(
    "knowledge",
    "knowledge",
    "Trade-in inspection checklist",
    "Example procedure:\n1. Confirm model and specifications.\n2. Inspect the head, shaft, and grip.\n3. Record defects and photographs.\n4. Ask the owner to confirm the purchase price.\n5. Add approved equipment to inventory.",
    { category: "Procedure" },
  );
  await record(
    "invoice",
    "invoice",
    "Example workshop invoice",
    "Fictional invoice for trying the payment reminder capability. It is not a real balance and no payment is collected here.",
    {
      customer: "Example Customer",
      amount: 54,
      due_date: new Date().toISOString().slice(0, 10),
      reference: "DEMO-INV-001",
    },
  );
  const { data: contact } = await admin
    .from("crm_contacts")
    .select("id")
    .eq("client_id", clientId)
    .eq("email", "customer@example.test")
    .maybeSingle()
    .throwOnError();
  if (!contact)
    await admin
      .from("crm_contacts")
      .insert({
        partner_id: partnerId,
        client_id: clientId,
        first_name: "Example",
        last_name: "Customer",
        email: "customer@example.test",
        source: "prototype_fixture",
      })
      .throwOnError();
  for (const recipe_key of [
    "marketing-studio",
    "sourcing-analyst",
    "purchasing-planner",
    "operations-coordinator",
    "listing-assistant",
    "document-assistant",
    "owner-briefing",
    "payment-followup",
  ]) {
    await admin
      .from("business_capability_installs")
      .upsert(
        {
          client_id: clientId,
          partner_id: partnerId,
          recipe_key,
          status: "enabled",
          schedule_enabled: false,
        },
        { onConflict: "client_id,recipe_key", ignoreDuplicates: true },
      )
      .throwOnError();
  }
  console.log(
    JSON.stringify({
      status: "Prototype fixture ready",
      clientId,
      name: "Fairway Golf Shop · Test business",
      fictional: true,
      scheduledRuns: false,
    }),
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Fixture creation failed.",
  );
  process.exitCode = 1;
});
