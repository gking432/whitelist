import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { generateStructured, isAIConfigured } from "@/lib/ai/provider";
import { BUSINESS_RECIPES } from "./catalog";
import { readBusinessData } from "./data";
import {
  opportunityEconomics,
  reorderQuantity,
  displayMoney,
  RECORD_SCHEMA,
} from "./rules";
import type { BusinessRecord, RecordData, RecordKind } from "./types";
import { validateGoalLink } from "./record-links";

export type BusinessScope = {
  partnerId: string;
  clientId: string;
  actorId: string | null;
};
export async function createBusinessRecord(
  admin: SupabaseClient,
  scope: BusinessScope,
  record: { kind: RecordKind; title: string; body: string; data: RecordData },
  requestKey: string,
  sourceId: string | null = null,
): Promise<string> {
  const parsed = RECORD_SCHEMA.parse(record);
  await validateGoalLink(admin, scope, parsed);
  if (
    parsed.kind === "purchase" &&
    typeof parsed.data.product_id === "string" &&
    parsed.data.product_id
  ) {
    const { data, error } = await admin
      .from("business_records")
      .select("id")
      .eq("id", parsed.data.product_id)
      .eq("client_id", scope.clientId)
      .eq("partner_id", scope.partnerId)
      .eq("kind", "product")
      .maybeSingle();
    if (error || !data)
      throw new Error("Choose an inventory item from this business.");
  }
  const { data, error } = await admin.rpc("create_business_record", {
    p_partner: scope.partnerId,
    p_client: scope.clientId,
    p_actor: scope.actorId,
    p_kind: parsed.kind,
    p_title: parsed.title,
    p_body: parsed.body,
    p_data: parsed.data,
    p_request: requestKey,
    p_source: sourceId,
  });
  if (error || !data)
    throw new Error("The work could not be saved. Please retry.");
  return String(data);
}
function summarizeJobs(records: BusinessRecord[]) {
  const jobs = records.filter(
    (r) => r.kind === "job" && !["completed", "archived"].includes(r.status),
  );
  if (!jobs.length)
    return "No open jobs are recorded. Add work in Operations to track assignments, due dates, and blockers.";
  return jobs
    .map(
      (r) =>
        `• ${r.title} — ${r.status.replaceAll("_", " ")}${r.data.assignee ? `; owner: ${r.data.assignee}` : "; unassigned"}${r.data.due_date ? `; due: ${r.data.due_date}` : ""}${r.body ? `\n  ${r.body.slice(0, 500)}` : ""}`,
    )
    .join("\n");
}
export async function runBusinessRecipe(
  admin: SupabaseClient,
  scope: BusinessScope,
  recipeKey: string,
  brief: string,
  requestKey: string,
  sourceId?: string,
) {
  const recipe = BUSINESS_RECIPES.find((r) => r.key === recipeKey);
  if (!recipe || recipe.mode !== "workspace")
    throw new Error(
      "This capability needs its connected-app setup before it can run.",
    );
  const state = await readBusinessData(admin, scope.partnerId, scope.clientId);
  if (state.error) throw new Error(state.error);
  const install = state.installs.find((i) => i.recipe_key === recipeKey);
  if (!install || install.status !== "enabled")
    throw new Error("Enable this capability before running it.");
  const existing = await admin
    .from("business_records")
    .select("id")
    .eq("client_id", scope.clientId)
    .eq("partner_id", scope.partnerId)
    .eq("request_key", requestKey)
    .maybeSingle();
  if (existing.data)
    return {
      recordId: existing.data.id,
      message: "This run was already saved.",
    };
  const records = state.records.filter((r) => r.status !== "archived");
  const profile = state.profile;
  const money = (value: unknown) => displayMoney(value, profile.currency);
  let kind: RecordKind = recipe.output ?? "brief";
  let title = recipe.name;
  let body = "";
  let data: RecordData = { recipe_key: recipeKey };
  if (recipeKey === "purchasing-planner") {
    const proposals = [];
    for (const product of records.filter((r) => r.kind === "product")) {
      const qty = reorderQuantity(product, records);
      if (!qty) continue;
      const closed = state.records
        .filter(
          (r) =>
            r.kind === "purchase" &&
            r.data.product_id === product.id &&
            ["rejected", "archived", "received"].includes(r.status),
        )
        .sort(
          (a, b) =>
            b.updated_at.localeCompare(a.updated_at) ||
            b.id.localeCompare(a.id),
        )[0];
      const cycle = closed ? `${closed.id}:${closed.revision}` : "initial";
      const id = await createBusinessRecord(
        admin,
        scope,
        {
          kind: "purchase",
          title: `Replenish ${product.title}`.slice(0, 180),
          body: `Stock is ${product.data.quantity}; reorder point is ${product.data.reorder_point}; target is ${product.data.target_stock}. Review supplier and cost before ordering.`,
          data: {
            supplier: String(product.data.supplier ?? ""),
            quantity: qty,
            unit_cost: Number(product.data.unit_cost ?? 0),
            shipping: 0,
            product_id: product.id,
            order_reference: "",
          },
        },
        `reorder:${product.id}:${product.revision}:${cycle}`,
        product.id,
      );
      proposals.push(
        `${product.title}: ${qty} units (${money(qty * Number(product.data.unit_cost ?? 0))} before shipping)`,
      );
    }
    body = proposals.length
      ? `Prepared ${proposals.length} purchase request(s). Review each in Purchasing.\n\n${proposals.join("\n")}\n\nNo supplier order has been sent.`
      : "No replenishment is needed based on recorded quantities, reorder points, and open purchase requests. Add inventory or update stock to plan purchasing.";
    kind = "brief";
    title = "Purchasing plan";
  } else if (recipeKey === "sourcing-analyst") {
    const opportunities = records
      .filter((r) => r.kind === "opportunity")
      .map((r) => ({ record: r, ...opportunityEconomics(r.data) }))
      .sort((a, b) => b.profit - a.profit);
    body = opportunities.length
      ? `Comparison of saved opportunities. Expected resale values are your assumptions, not verified sold prices. No live market search was performed.\n\n${opportunities.map((r, i) => `${i + 1}. ${r.record.title}\nSupplier: ${r.record.data.supplier || "Not recorded"}\nLanded cost: ${money(r.landed)} · Expected resale: ${money(r.record.data.resale)}\nEstimated contribution: ${money(r.profit)}${r.margin === null ? "" : ` (${r.margin}% margin)`}\nSource: ${r.record.data.url || "No source URL recorded"}\n${r.record.body}`).join("\n\n")}`
      : "Add buying opportunities in Sourcing with a source URL, cost, shipping, fees, and expected resale value. The analyst can then compare them using your recorded evidence.";
    title = "Sourcing shortlist";
  } else if (recipeKey === "operations-coordinator") {
    body = `Operations review\n\n${summarizeJobs(records)}\n\nPhysical work remains open until a responsible person records completion.`;
    title = "Operations action list";
  } else if (recipeKey === "owner-briefing") {
    const pending = records.filter((r) => r.status === "needs_approval");
    const products = records.filter(
      (r) => r.kind === "product" && reorderQuantity(r, records) > 0,
    );
    body = `Your business at a glance\n\n${pending.length} business approvals awaiting a decision\n${state.pendingCustomerApprovals} customer actions awaiting approval\n${products.length} inventory items need replenishment\n${records.filter((r) => r.kind === "campaign" && r.status === "draft").length} campaign drafts\n${state.contacts.length} customer records loaded\n\nNeeds a decision\n${pending.map((r) => `• ${r.title}`).join("\n") || "No pending business decisions."}\n\nOpen work\n${summarizeJobs(records)}`;
    title = "Daily business briefing";
  } else {
    if (
      !brief.trim() &&
      !["listing-assistant", "payment-followup"].includes(recipeKey)
    )
      throw new Error(
        "Add a brief so the assistant has real information to work from.",
      );
    const sourceRecord = sourceId
      ? records.find((r) => r.id === sourceId)
      : undefined;
    if (recipeKey === "listing-assistant" && sourceRecord?.kind !== "product")
      throw new Error("Choose an inventory item for this listing.");
    if (
      recipeKey === "payment-followup" &&
      (sourceRecord?.kind !== "invoice" || sourceRecord.status === "paid")
    )
      throw new Error("Choose an unpaid invoice for this reminder.");
    const context =
      recipeKey === "listing-assistant"
        ? records
            .filter((r) => r.kind === "product" && r.id === sourceId)
            .map(
              (r) =>
                `${r.title}: ${r.body}; price ${money(r.data.price)}; stock ${r.data.quantity}`,
            )
            .join("\n")
        : recipeKey === "payment-followup"
          ? records
              .filter(
                (r) =>
                  r.kind === "invoice" &&
                  r.status !== "paid" &&
                  r.id === sourceId,
              )
              .map(
                (r) =>
                  `${r.title}: ${r.data.customer}; ${money(r.data.amount)}; due ${r.data.due_date}; ${r.data.reference}`,
              )
              .join("\n")
          : "";
    if (
      ["listing-assistant", "payment-followup"].includes(recipeKey) &&
      !context
    )
      throw new Error(
        recipeKey === "listing-assistant"
          ? "Add inventory before preparing a listing."
          : "Add an unpaid invoice before preparing a reminder.",
      );
    title =
      recipeKey === "document-assistant"
        ? "Business procedure"
        : recipeKey === "listing-assistant"
          ? "Product listing draft"
          : recipeKey === "payment-followup"
            ? "Payment reminder draft"
            : recipeKey === "followup-assistant"
              ? "Customer follow-up draft"
              : recipeKey === "review-followup"
                ? "Review and rebooking draft"
                : "Campaign draft";
    body =
      recipeKey === "document-assistant"
        ? `Procedure for review\n\n${brief}\n\nReview the steps, assign responsibility, and confirm any missing details before use.`
        : recipeKey === "payment-followup"
          ? `Hello,\n\nA quick follow-up on the invoice information below. Please let us know if you need a copy or have a question.\n\n${context}\n\nThank you.\n\nOwner review: select the relevant customer and confirm the balance before sending.`
          : recipeKey === "listing-assistant"
            ? `${context}\n\n${brief}\n\nContact us for current availability and product details.`
            : `${profile.services || profile.description}\n\n${brief}\n\nInterested? Reply to learn more.\n\nAudience: ${profile.audience || "Select an appropriate audience before publishing."}`;
    let source = "Prepared from your information using a standard template.";
    if (isAIConfigured()) {
      try {
        const output = await generateStructured({
          tenant: { partnerId: scope.partnerId, clientId: scope.clientId },
          taskKey: `business.${recipeKey}`,
          system: `You help a small business with ${recipe.name}. Prepare a concise, useful work product for owner review. Use only supplied facts. Never invent discounts, claims, inventory, prices, metrics, sources, or completed actions. Return title and body. Do not include private customer information unless explicitly needed in this draft.`,
          user: JSON.stringify({ profile, brief, context }),
          schema: z.object({
            title: z.string().min(2).max(180),
            body: z.string().max(16000),
          }),
          maxTokens: 1800,
        });
        title = output.data.title;
        body = output.data.body;
        source = "AI-assisted draft. Review facts and audience before use.";
      } catch {
        source =
          "AI was unavailable. Prepared from your information using a standard template.";
      }
    }
    body = `${body}\n\n— ${source}`;
    data =
      kind === "knowledge"
        ? { category: "Procedure" }
        : {
            channel: "Email",
            audience:
              recipeKey === "payment-followup"
                ? String(
                    sourceRecord?.data.customer ?? "Confirm invoice recipient",
                  )
                : profile.audience,
            objective: brief.slice(0, 4000),
            budget: 0,
            publish_reference: "",
          };
  }
  const recordId = await createBusinessRecord(
    admin,
    scope,
    { kind, title, body: body.slice(0, 20000), data },
    requestKey,
    sourceId ?? null,
  );
  const { error } = await admin
    .from("business_capability_installs")
    .update({ last_run_at: new Date().toISOString() })
    .eq("client_id", scope.clientId)
    .eq("partner_id", scope.partnerId)
    .eq("recipe_key", recipeKey);
  if (error)
    throw new Error(
      "Work was saved, but the last-run status could not be updated. Refresh to see the saved work.",
    );
  return {
    recordId,
    message: `${title} saved. No external message, purchase, or publication was sent.`,
  };
}
