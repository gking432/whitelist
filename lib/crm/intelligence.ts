import type { AITenant } from "@/lib/ai/budget";
import { z } from "zod";

import {
  fallbackCustomerDraft,
  fallbackLeadIntakeAnalysis,
} from "@/lib/ai/fallbacks";
import {
  buildCustomerDraftPrompt,
  buildLeadIntakePrompt,
  CUSTOMER_DRAFT_SYSTEM_PROMPT,
  LEAD_INTAKE_SYSTEM_PROMPT,
} from "@/lib/ai/prompts";
import { generateStructured, isAIConfigured } from "@/lib/ai/provider";
import {
  CustomerDraftSchema,
  LeadIntakeAnalysisSchema,
  type AIExecutionInfo,
  type CustomerDraft,
  type LeadIntakeAnalysis,
} from "@/lib/ai/schemas";

async function structuredOrFallback<T>(input: {
  tenant?: AITenant;
  taskKey: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  fallback: () => T;
}): Promise<{ data: T; ai: AIExecutionInfo }> {
  if (!isAIConfigured()) {
    return {
      data: input.fallback(),
      ai: { status: "fallback", reason: "not_configured" },
    };
  }

  try {
    const result = await generateStructured({
      taskKey: input.taskKey,
      tenant: input.tenant,
      system: input.system,
      user: input.user,
      schema: input.schema,
    });

    return {
      data: result.data,
      ai: {
        status: "ai",
        provider: result.meta.provider,
        model: result.meta.model,
        latency_ms: result.meta.latencyMs,
      },
    };
  } catch (error) {
    return {
      data: input.fallback(),
      ai: {
        status: "fallback",
        reason: "ai_failed",
        error: error instanceof Error ? error.message : "AI request failed.",
      },
    };
  }
}

export async function analyzeManualLead(input: {
  tenant?: AITenant;
  businessName: string;
  data: Record<string, unknown>;
}): Promise<{ analysis: LeadIntakeAnalysis; ai: AIExecutionInfo }> {
  const result = await structuredOrFallback({
    tenant: input.tenant,
    taskKey: "crm_manual_lead_analysis",
    system: LEAD_INTAKE_SYSTEM_PROMPT,
    user: buildLeadIntakePrompt({
      businessName: input.businessName,
      eventType: "manual.lead_created",
      payloadJson: JSON.stringify(input.data, null, 2),
    }),
    schema: LeadIntakeAnalysisSchema,
    fallback: () =>
      fallbackLeadIntakeAnalysis({
        eventType: "manual.lead_created",
        data: input.data,
      }),
  });

  return { analysis: result.data, ai: result.ai };
}

export type DraftObjective =
  | "new_lead_response"
  | "missed_call_rescue"
  | "estimate_follow_up"
  | "appointment_confirmation"
  | "review_request";

export async function draftCrmMessage(input: {
  tenant?: AITenant;
  businessName: string;
  objective: DraftObjective;
  data: Record<string, unknown>;
}): Promise<{ draft: CustomerDraft; ai: AIExecutionInfo }> {
  const result = await structuredOrFallback({
    tenant: input.tenant,
    taskKey: `crm_${input.objective}_draft`,
    system: CUSTOMER_DRAFT_SYSTEM_PROMPT,
    user: buildCustomerDraftPrompt({
      businessName: input.businessName,
      draftKind: input.objective,
      eventType: "crm.manual_draft",
      payloadJson: JSON.stringify(input.data, null, 2),
    }),
    schema: CustomerDraftSchema,
    fallback: () =>
      fallbackCustomerDraft({
        draftKind: input.objective,
        businessName: input.businessName,
        data: input.data,
      }),
  });

  return { draft: result.data, ai: result.ai };
}

export const FeedbackAnalysisSchema = z.object({
  sentiment: z.enum(["positive", "mixed", "negative"]),
  risk_level: z.enum(["low", "medium", "high", "urgent"]),
  summary: z.string(),
  suggested_internal_action: z.string(),
  suggested_customer_response: z.string(),
  tags: z.array(z.string()),
});

export type FeedbackAnalysis = z.infer<typeof FeedbackAnalysisSchema>;

function feedbackFallback(input: {
  rating: number | null;
  text: string;
}): FeedbackAnalysis {
  const lower = input.text.toLowerCase();
  const urgent =
    /lawyer|attorney|bbb|fraud|unsafe|injury|never called|three times|refund/.test(
      lower,
    );
  const negative =
    urgent ||
    (input.rating !== null && input.rating <= 2) ||
    /angry|terrible|awful|disappointed|unhappy|complaint|still broken/.test(
      lower,
    );
  const positive =
    (input.rating !== null && input.rating >= 4) ||
    /great|excellent|amazing|professional|recommend|thank/.test(lower);
  const sentiment = negative ? "negative" : positive ? "positive" : "mixed";
  const riskLevel = urgent
    ? "urgent"
    : negative
      ? "high"
      : sentiment === "mixed"
        ? "medium"
        : "low";

  return {
    sentiment,
    risk_level: riskLevel,
    summary:
      sentiment === "negative"
        ? "Customer feedback signals dissatisfaction and needs prompt review."
        : sentiment === "positive"
          ? "Customer feedback is positive and may support a review or referral request."
          : "Customer feedback is mixed and includes an improvement opportunity.",
    suggested_internal_action:
      riskLevel === "urgent" || riskLevel === "high"
        ? "Assign a manager to review the history and contact the customer today."
        : sentiment === "positive"
          ? "Thank the customer and consider asking for a public review or referral."
          : "Review the concern with the responsible team and close the communication gap.",
    suggested_customer_response:
      sentiment === "negative"
        ? "Acknowledge the concern, apologize for the experience, and offer a direct manager follow-up."
        : "Thank the customer for the feedback and confirm the team has shared it internally.",
    tags: [sentiment, riskLevel, "customer_feedback"],
  };
}

export async function analyzeCrmFeedback(input: {
  tenant?: AITenant;
  businessName: string;
  source: string;
  rating: number | null;
  text: string;
}): Promise<{ analysis: FeedbackAnalysis; ai: AIExecutionInfo }> {
  const fallback = () =>
    feedbackFallback({ rating: input.rating, text: input.text });

  const result = await structuredOrFallback({
    tenant: input.tenant,
    taskKey: "crm_feedback_analysis",
    system: `You analyze customer feedback for a service business. Identify sentiment and operational risk, summarize the issue, recommend a concrete internal action, and draft a calm response. Never invent facts or make legal promises. Urgent safety, legal, repeated-contact, or public-reputation threats require urgent or high risk.`,
    user: `Business: ${input.businessName}
Source: ${input.source}
Rating: ${input.rating ?? "not provided"}
Feedback:
${input.text}`,
    schema: FeedbackAnalysisSchema,
    fallback,
  });

  return { analysis: result.data, ai: result.ai };
}

type QuoteRate = {
  unit: string;
  low: number;
  high: number;
  minimum: number;
};

const QUOTE_RATES: Record<string, QuoteRate> = {
  roofing: { unit: "square", low: 450, high: 750, minimum: 6500 },
  siding: { unit: "sq ft", low: 8, high: 16, minimum: 6000 },
  windows: { unit: "window", low: 700, high: 1600, minimum: 2500 },
  gutters: { unit: "linear ft", low: 12, high: 28, minimum: 1200 },
  bath: { unit: "project", low: 12000, high: 35000, minimum: 12000 },
  hvac: { unit: "system", low: 6500, high: 18000, minimum: 6500 },
  plumbing: { unit: "job", low: 500, high: 4500, minimum: 350 },
  electrical: { unit: "job", low: 500, high: 5000, minimum: 350 },
  landscaping: { unit: "project", low: 1500, high: 12000, minimum: 750 },
  other: { unit: "project", low: 1000, high: 10000, minimum: 500 },
};

export function buildBallparkQuote(input: {
  serviceType: string;
  quantity: number;
  complexity: "standard" | "complex" | "premium";
}) {
  const normalized = input.serviceType.toLowerCase().replaceAll(" ", "_");
  const matchingKey =
    Object.keys(QUOTE_RATES).find((key) => normalized.includes(key)) ?? "other";
  const rate = QUOTE_RATES[matchingKey];
  const quantity = Number.isFinite(input.quantity)
    ? Math.max(1, input.quantity)
    : 1;
  const multiplier =
    input.complexity === "premium"
      ? 1.35
      : input.complexity === "complex"
        ? 1.18
        : 1;
  const low = Math.round(
    Math.max(rate.minimum, rate.low * quantity * multiplier),
  );
  const high = Math.round(
    Math.max(rate.minimum * 1.25, rate.high * quantity * multiplier),
  );

  return {
    low,
    high,
    lineItems: [
      {
        label: `${input.serviceType || "Service"} scope`,
        quantity,
        unit: rate.unit,
        low,
        high,
      },
    ],
    assumptions: [
      "Internal ballpark only; final pricing requires an inspection.",
      `${input.complexity} complexity selected.`,
      "Permits, concealed damage, specialty materials, and change orders are not included unless noted.",
    ],
    summary: `${input.serviceType || "Project"} ballpark: $${low.toLocaleString()}–$${high.toLocaleString()}. Requires inspection before a final quote.`,
  };
}

