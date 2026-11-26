import type { RecordKind } from "@/lib/business/types";
export type FieldDefinition = {
  key: string;
  label: string;
  type?: "number" | "date" | "email" | "url" | "textarea" | "select";
  options?: string[];
  hint?: string;
  default?: string | number;
};
export const KIND_LABELS: Record<RecordKind, string> = {
  campaign: "Campaign",
  opportunity: "Sourcing opportunity",
  supplier: "Supplier",
  product: "Inventory item",
  purchase: "Purchase request",
  job: "Action",
  goal: "Goal",
  knowledge: "Knowledge",
  brief: "Briefing",
  quote: "Quote",
  invoice: "Invoice",
};
export const RECORD_FIELDS: Record<RecordKind, FieldDefinition[]> = {
  campaign: [
    {
      key: "channel",
      label: "Channel",
      type: "select",
      options: ["Email", "SMS", "Social", "Website", "Other"],
    },
    { key: "audience", label: "Audience", hint: "Who should receive this?" },
    { key: "objective", label: "Goal" },
    { key: "budget", label: "Planned budget", type: "number", default: 0 },
  ],
  opportunity: [
    { key: "supplier", label: "Supplier or seller" },
    { key: "url", label: "Source URL", type: "url" },
    { key: "cost", label: "Purchase price", type: "number", default: 0 },
    { key: "shipping", label: "Shipping", type: "number", default: 0 },
    { key: "fees", label: "Other costs & fees", type: "number", default: 0 },
    {
      key: "resale",
      label: "Expected resale value",
      type: "number",
      default: 0,
      hint: "Your estimate, not a verified sale.",
    },
    { key: "condition", label: "Condition / evidence" },
  ],
  supplier: [
    { key: "contact", label: "Contact person" },
    { key: "email", label: "Email", type: "email" },
    { key: "website", label: "Website", type: "url" },
    {
      key: "lead_days",
      label: "Typical lead time (days)",
      type: "number",
      default: 0,
    },
  ],
  product: [
    { key: "sku", label: "SKU / reference" },
    { key: "quantity", label: "Units on hand", type: "number", default: 0 },
    {
      key: "reorder_point",
      label: "Reorder at or below",
      type: "number",
      default: 0,
    },
    { key: "target_stock", label: "Restock to", type: "number", default: 1 },
    { key: "unit_cost", label: "Unit cost", type: "number", default: 0 },
    { key: "price", label: "Selling price", type: "number", default: 0 },
    { key: "supplier", label: "Preferred supplier" },
  ],
  purchase: [
    { key: "supplier", label: "Supplier" },
    { key: "quantity", label: "Quantity", type: "number", default: 1 },
    { key: "unit_cost", label: "Unit cost", type: "number", default: 0 },
    { key: "shipping", label: "Shipping", type: "number", default: 0 },
    {
      key: "product_id",
      label: "Inventory item",
      type: "select",
      hint: "Receiving the full order adds its quantity to this item.",
    },
    { key: "order_reference", label: "Supplier quote / reference" },
  ],
  job: [
    { key: "assignee", label: "Responsible person" },
    { key: "due_date", label: "Due date", type: "date" },
    { key: "goal_id", label: "Moves this goal forward", type: "select" },
    {
      key: "priority",
      label: "Priority",
      type: "select",
      options: ["normal", "high", "low"],
    },
    {
      key: "checklist",
      label: "Checklist",
      type: "textarea",
      hint: "One step per line.",
    },
  ],
  goal: [
    {
      key: "period",
      label: "Timeframe",
      type: "select",
      options: ["monthly", "weekly", "daily", "custom"],
    },
    { key: "due_date", label: "Target date", type: "date" },
    { key: "current", label: "Current progress", type: "number", default: 0 },
    { key: "target", label: "Target", type: "number", default: 1 },
    {
      key: "unit",
      label: "Measured in",
      hint: "For example: appointments, orders, or dollars. Progress is updated by you.",
    },
  ],
  knowledge: [
    {
      key: "category",
      label: "Category",
      type: "select",
      options: [
        "FAQ",
        "Procedure",
        "Policy",
        "Service",
        "Other",
        "Industry update",
      ],
    },
    { key: "source_url", label: "Source link", type: "url" },
    { key: "publisher", label: "Publisher" },
    { key: "published_date", label: "Publication date", type: "date" },
  ],
  brief: [],
  quote: [
    { key: "customer", label: "Customer" },
    { key: "quantity", label: "Quantity", type: "number", default: 1 },
    { key: "unit_price", label: "Unit price", type: "number", default: 0 },
    { key: "valid_until", label: "Valid until", type: "date" },
  ],
  invoice: [
    { key: "customer", label: "Customer" },
    { key: "amount", label: "Amount due", type: "number", default: 0 },
    { key: "due_date", label: "Due date", type: "date" },
    { key: "reference", label: "Invoice reference" },
  ],
};
export const AREA_COPY = {
  home: {
    eyebrow: "Your business, in motion",
    title: "A little less on your plate.",
    description:
      "The work moving forward, the decisions that need you, and what happens next.",
  },
  marketing: {
    eyebrow: "Build demand",
    title: "Marketing",
    description:
      "Turn your offers and ideas into campaigns. Prepare, review, and keep track of what goes out.",
  },
  sourcing: {
    eyebrow: "Find the next opportunity",
    title: "Sourcing",
    description:
      "Keep the evidence together. Compare suppliers, buying costs, and potential returns.",
  },
  purchasing: {
    eyebrow: "Keep the business supplied",
    title: "Purchasing",
    description:
      "Plan replenishment, approve spending, and follow each order through to receipt.",
  },
  operations: {
    eyebrow: "Keep work moving",
    title: "Operations",
    description:
      "A clear home for jobs, responsibilities, deadlines, and the details that make work happen.",
  },
  customers: {
    eyebrow: "Know your customers",
    title: "Customers",
    description:
      "Shared records for you and your assistants. Keep context close without living in a CRM.",
  },
  automations: {
    eyebrow: "Choose what gets handled",
    title: "Your capabilities",
    description:
      "A useful team for your business. Start with a few, then add more when you need them.",
  },
  business: {
    eyebrow: "Built around you",
    title: "Your business",
    description:
      "Tell us how you work. Your assistants use these facts to prepare relevant, accurate work.",
  },
  approvals: {
    eyebrow: "You have the final say",
    title: "Needs your decision",
    description:
      "Review the actual work and its details before approving the next step.",
  },
};
