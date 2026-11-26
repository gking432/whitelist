import { z } from "zod";

// Structured output contracts for the Lead Response Pack. Handlers persist
// these on workflow_runs, so treat changes as versioned: additive is safe,
// renames need a template version bump.

export const LeadIntakeAnalysisSchema = z.object({
  summary: z.string(),
  service_type: z.string(),
  urgency: z.enum(["emergency", "high", "medium", "low"]),
  urgency_reasoning: z.string(),
  lead_quality: z.enum(["hot", "warm", "cold"]),
  lead_quality_reasoning: z.string(),
  missing_fields: z.array(z.string()),
  recommended_next_action: z.string(),
  recommended_contact_window: z.string(),
  suggested_task: z.object({
    title: z.string(),
    description: z.string(),
    priority: z.enum(["urgent", "high", "medium", "low"]),
    due_in_minutes: z.number(),
  }),
  tags: z.array(z.string()),
});

export type LeadIntakeAnalysis = z.infer<typeof LeadIntakeAnalysisSchema>;

// Universal AI intake routing (docs/12): every inbound interaction is
// classified before workflows act on it.
export const INTAKE_CATEGORIES = [
  "sales",
  "customer_service",
  "scheduling",
  "estimate_quote",
  "urgent_emergency",
  "billing_admin",
  "review_reputation",
  "pr_media",
  "spam_vendor",
  "other",
] as const;

export const IntakeRoutingSchema = z.object({
  category: z.enum(INTAKE_CATEGORIES),
  urgency: z.enum(["emergency", "high", "medium", "low"]),
  confidence: z.enum(["high", "medium", "low"]),
  summary: z.string(),
  reasoning: z.string(),
  recommended_owner: z.enum([
    "sales",
    "office_admin",
    "service_manager",
    "owner_manager",
    "billing",
    "no_action_needed",
  ]),
  suggested_next_action: z.string(),
  requires_human_handoff: z.boolean(),
});

export type IntakeRouting = z.infer<typeof IntakeRoutingSchema>;

export const CustomerDraftSchema = z.object({
  channel: z.enum(["sms", "email"]),
  subject: z.string().nullable(),
  body: z.string(),
  internal_note: z.string(),
});

export type CustomerDraft = z.infer<typeof CustomerDraftSchema>;

// Every AI-or-fallback execution records how the output was produced so run
// detail can label it honestly.
export type AIExecutionInfo = {
  status: "ai" | "fallback";
  reason?: "not_configured" | "ai_failed";
  provider?: string;
  model?: string;
  latency_ms?: number;
  error?: string;
};
