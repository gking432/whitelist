import { z } from "zod";
import {
  RECORD_KINDS,
  type BusinessRecord,
  type RecordKind,
  type RecordStatus,
  type RecordData,
} from "./types.ts";

const money = z.coerce.number().finite().min(0).max(1_000_000_000);
const quantity = z.coerce.number().finite().int().min(0).max(1_000_000);
const text = z.string().trim().max(4000).default("");
const optionalUrl = z
  .union([
    z.literal(""),
    z
      .url()
      .refine(
        (s) => ["http:", "https:"].includes(new URL(s).protocol),
        "Use an http or https URL",
      ),
  ])
  .default("");
export const PROFILE_SCHEMA = z.object({
  description: z.string().trim().min(5).max(3000),
  industry: z.enum([
    "general",
    "salon",
    "trainer",
    "retail",
    "services",
    "professional",
  ]),
  goals: z.array(z.string().max(80)).max(12),
  services: text,
  audience: text,
  tone: z.string().max(200),
  hours: text,
  policies: text,
  currency: z.enum(["USD", "CAD", "GBP", "EUR", "AUD"]),
  website: optionalUrl,
});
const schemas = {
  campaign: z.object({
    channel: z
      .enum(["Email", "SMS", "Social", "Website", "Other"])
      .default("Email"),
    audience: text,
    objective: text,
    budget: money.default(0),
    publish_reference: optionalUrl,
  }),
  opportunity: z.object({
    supplier: text,
    url: optionalUrl,
    cost: money,
    shipping: money.default(0),
    fees: money.default(0),
    resale: money,
    condition: text,
  }),
  supplier: z.object({
    email: z.union([z.literal(""), z.email()]).default(""),
    website: optionalUrl,
    lead_days: quantity.default(0),
    contact: text,
  }),
  product: z.object({
    sku: text,
    quantity,
    reorder_point: quantity,
    target_stock: quantity,
    unit_cost: money,
    price: money,
    supplier: text,
  }),
  purchase: z.object({
    supplier: text,
    quantity: quantity.refine((n) => n > 0, "Quantity must be positive"),
    unit_cost: money,
    shipping: money.default(0),
    product_id: z.union([z.literal(""), z.uuid()]).default(""),
    order_reference: text,
  }),
  job: z.object({
    assignee: text,
    due_date: z.union([z.literal(""), z.iso.date()]).default(""),
    priority: z.enum(["low", "normal", "high"]).default("normal"),
    checklist: text,
    goal_id: z.union([z.literal(""), z.uuid()]).default(""),
  }),
  goal: z.object({
    period: z.enum(["daily", "weekly", "monthly", "custom"]).default("monthly"),
    current: z.coerce.number().finite().min(0).max(1_000_000_000).default(0),
    target: z.coerce.number().finite().positive().max(1_000_000_000),
    unit: z.string().trim().max(60).default(""),
    due_date: z.union([z.literal(""), z.iso.date()]).default(""),
  }),
  knowledge: z
    .object({
      category: z
        .enum([
          "FAQ",
          "Procedure",
          "Policy",
          "Service",
          "Other",
          "Industry update",
        ])
        .default("Other"),
      source_url: optionalUrl,
      publisher: z.string().trim().max(160).default(""),
      published_date: z.union([z.literal(""), z.iso.date()]).default(""),
    })
    .refine(
      (data) => data.category !== "Industry update" || !!data.source_url,
      {
        path: ["source_url"],
        message: "Add a source link for an industry update.",
      },
    ),
  brief: z.object({ recipe_key: z.string().max(100).default("") }),
  quote: z.object({
    customer: text,
    quantity: quantity.refine((n) => n > 0),
    unit_price: money,
    valid_until: z.union([z.literal(""), z.iso.date()]).default(""),
  }),
  invoice: z.object({
    customer: text,
    amount: money,
    due_date: z.union([z.literal(""), z.iso.date()]).default(""),
    reference: text,
  }),
};
export const RECORD_SCHEMA = z
  .object({
    kind: z.enum(RECORD_KINDS),
    title: z.string().trim().min(2).max(180),
    body: z.string().max(20000).default(""),
    data: z
      .record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.null()]),
      )
      .default({}),
  })
  .transform((record, ctx) => {
    const parsed = schemas[record.kind].safeParse(record.data);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        ctx.addIssue({
          code: "custom",
          message: `${issue.path.join(" ")}: ${issue.message}`,
        });
      return z.NEVER;
    }
    return { ...record, data: parsed.data as RecordData };
  });
export function opportunityEconomics(data: Record<string, unknown>) {
  const parsed = schemas.opportunity.parse(data);
  const landed =
    Math.round((parsed.cost + parsed.shipping + parsed.fees) * 100) / 100;
  const profit = Math.round((parsed.resale - landed) * 100) / 100;
  return {
    landed,
    profit,
    margin:
      parsed.resale > 0
        ? Math.round((profit / parsed.resale) * 1000) / 10
        : null,
  };
}
export function reorderQuantity(
  product: BusinessRecord,
  records: BusinessRecord[],
): number {
  const data = schemas.product.parse(product.data);
  if (data.quantity > data.reorder_point) return 0;
  const inbound = records
    .filter(
      (r) =>
        r.kind === "purchase" &&
        r.data.product_id === product.id &&
        ["draft", "needs_approval", "approved", "ordered"].includes(r.status),
    )
    .reduce((n, r) => n + Number(r.data.quantity || 0), 0);
  return Math.max(0, data.target_stock - data.quantity - inbound);
}
export function allowedTransitions(
  kind: RecordKind,
  status: RecordStatus,
): { action: string; label: string; next: RecordStatus }[] {
  if (status === "archived") return [];
  const transitions: { action: string; label: string; next: RecordStatus }[] =
    [];
  if (status === "draft" && ["campaign", "purchase", "quote"].includes(kind))
    transitions.push({
      action: "submit",
      label: "Request approval",
      next: "needs_approval",
    });
  if (status === "needs_approval")
    transitions.push(
      { action: "approve", label: "Approve", next: "approved" },
      { action: "reject", label: "Decline", next: "rejected" },
    );
  if (kind === "job") {
    if (["draft", "blocked"].includes(status))
      transitions.push({
        action: "start",
        label: "Start work",
        next: "in_progress",
      });
    if (status === "in_progress")
      transitions.push(
        { action: "block", label: "Mark blocked", next: "blocked" },
        { action: "complete", label: "Complete job", next: "completed" },
      );
  }
  if (kind === "purchase" && status === "approved")
    transitions.push({
      action: "order",
      label: "Record order placed",
      next: "ordered",
    });
  if (kind === "purchase" && status === "ordered")
    transitions.push({
      action: "receive",
      label: "Receive full order",
      next: "received",
    });
  if (kind === "campaign" && status === "approved")
    transitions.push({
      action: "publish",
      label: "Record published",
      next: "published",
    });
  if (kind === "invoice" && status === "draft")
    transitions.push({
      action: "pay",
      label: "Record payment received",
      next: "paid",
    });
  if (
    [
      "draft",
      "rejected",
      "completed",
      "received",
      "published",
      "paid",
    ].includes(status)
  )
    transitions.push({ action: "archive", label: "Archive", next: "archived" });
  return transitions;
}
export function displayMoney(value: unknown, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    Number(value) || 0,
  );
}
