// Workflow handlers for the Lead Response Pack. Each handler is AI-capable
// with a deterministic fallback: if the AI provider is not configured or a
// call fails, the handler still produces schema-shaped output, labeled
// status: "fallback" so run detail never presents rule-based output as model
// output. Handlers receive redacted payloads and stay pure of HTTP concerns.

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
import {
  generateStructured,
  isAIConfigured,
} from "@/lib/ai/provider";
import {
  CustomerDraftSchema,
  LeadIntakeAnalysisSchema,
  type AIExecutionInfo,
  type CustomerDraft,
} from "@/lib/ai/schemas";
import type { z } from "zod";

export type RunStep = {
  name: string;
  detail: string;
};

export type ApprovalDraft = {
  type: string;
  title: string;
  summary: string;
  riskLevel: "low" | "medium" | "high";
  editableContent: string | null;
  proposedPayload: Record<string, unknown>;
};

export type HandlerResult = {
  steps: RunStep[];
  summary: string;
  output: Record<string, unknown>;
  ai?: AIExecutionInfo;
  approvalDraft?: ApprovalDraft;
};

export type HandlerContext = {
  eventType: string;
  data: Record<string, unknown>;
  settings: Record<string, unknown>;
  clientName: string;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Runs the structured AI call, degrading to the deterministic fallback on
// missing credentials or any AI failure. Never throws.
async function structuredWithFallback<T>(args: {
  taskKey: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  fallback: () => T;
}): Promise<{ data: T; ai: AIExecutionInfo }> {
  if (!isAIConfigured()) {
    return {
      data: args.fallback(),
      ai: { status: "fallback", reason: "not_configured" },
    };
  }

  try {
    const result = await generateStructured({
      taskKey: args.taskKey,
      system: args.system,
      user: args.user,
      schema: args.schema,
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
      data: args.fallback(),
      ai: {
        status: "fallback",
        reason: "ai_failed",
        error:
          error instanceof Error ? error.message : "AI request failed.",
      },
    };
  }
}

function aiStepDetail(ai: AIExecutionInfo): string {
  if (ai.status === "ai") {
    return `AI-generated output (${ai.provider}/${ai.model}).`;
  }

  return ai.reason === "not_configured"
    ? "Deterministic fallback output — AI provider is not configured."
    : `Deterministic fallback output — the AI call failed (${ai.error ?? "unknown error"}).`;
}

async function handleLeadIntake(context: HandlerContext): Promise<HandlerResult> {
  const configuredKeywords = asString(context.settings.high_urgency_keywords);
  const urgencyKeywords = configuredKeywords
    ? configuredKeywords
        .split(",")
        .map((keyword) => keyword.trim())
        .filter(Boolean)
    : undefined;

  const { data: analysis, ai } = await structuredWithFallback({
    taskKey: "lead_intake_analysis",
    system: LEAD_INTAKE_SYSTEM_PROMPT,
    user: buildLeadIntakePrompt({
      businessName: context.clientName,
      eventType: context.eventType,
      payloadJson: JSON.stringify(context.data, null, 2),
    }),
    schema: LeadIntakeAnalysisSchema,
    fallback: () =>
      fallbackLeadIntakeAnalysis({
        eventType: context.eventType,
        data: context.data,
        urgencyKeywords,
      }),
  });

  return {
    steps: [
      { name: "Received event", detail: `Trigger: ${context.eventType}` },
      { name: "Analyzed lead", detail: aiStepDetail(ai) },
      {
        name: "Classified and recommended",
        detail: `Urgency ${analysis.urgency}, quality ${analysis.lead_quality}.${
          analysis.missing_fields.length > 0
            ? ` Missing fields: ${analysis.missing_fields.join(", ")}.`
            : " All primary fields present."
        }`,
      },
      {
        name: "Suggested follow-up task",
        detail: `${analysis.suggested_task.title} (${analysis.suggested_task.priority}, due in ${analysis.suggested_task.due_in_minutes} min).`,
      },
    ],
    summary: `Lead intake: ${analysis.urgency} urgency, ${analysis.lead_quality} quality. ${analysis.recommended_next_action}`,
    output: { analysis },
    ai,
  };
}

type DraftKind =
  | "missed_call_rescue"
  | "estimate_follow_up"
  | "appointment_confirmation"
  | "review_request";

function draftHandler(options: {
  draftKind: DraftKind;
  approvalType: string;
  riskLevel: "low" | "medium" | "high";
  titlePrefix: string;
}) {
  return async (context: HandlerContext): Promise<HandlerResult> => {
    const customTemplate =
      asString(context.settings.message_template) || undefined;

    const { data: draft, ai } = await structuredWithFallback<CustomerDraft>({
      taskKey: `${options.draftKind}_draft`,
      system: CUSTOMER_DRAFT_SYSTEM_PROMPT,
      user: buildCustomerDraftPrompt({
        businessName: context.clientName,
        draftKind: options.draftKind,
        eventType: context.eventType,
        payloadJson: JSON.stringify(context.data, null, 2),
        customTemplate,
      }),
      schema: CustomerDraftSchema,
      fallback: () =>
        fallbackCustomerDraft({
          draftKind: options.draftKind,
          businessName: context.clientName,
          data: context.data,
          customTemplate,
        }),
    });

    const name =
      asString(context.data.name) || asString(context.data.full_name);
    const phone = asString(context.data.phone);
    const email = asString(context.data.email);
    const recipient = name || phone || email || "the customer";

    return {
      steps: [
        { name: "Received event", detail: `Trigger: ${context.eventType}` },
        { name: "Prepared message draft", detail: aiStepDetail(ai) },
        {
          name: "Queued for approval",
          detail:
            "Customer-facing drafts require human review; nothing is sent without an approval and a delivery integration.",
        },
      ],
      summary: `${options.titlePrefix} draft prepared for ${recipient} (${draft.channel.toUpperCase()}).`,
      output: { draft, recipient: { name, phone, email } },
      ai,
      approvalDraft: {
        type: options.approvalType,
        title: `${options.titlePrefix}: ${recipient}`,
        summary: `Review the drafted ${draft.channel.toUpperCase()} to ${recipient} for ${context.clientName}. ${draft.internal_note}`,
        riskLevel: options.riskLevel,
        editableContent: draft.body,
        proposedPayload: {
          channel: draft.channel,
          to: phone || email || null,
          subject: draft.subject,
          draft_source:
            ai.status === "ai" ? "ai_generated" : "rule_based_template",
        },
      },
    };
  };
}

async function handleSyncFailureAlert(
  context: HandlerContext,
): Promise<HandlerResult> {
  const system = asString(context.data.system) || "external system";
  const detail =
    asString(context.data.error_message) ||
    asString(context.data.message) ||
    "No failure detail supplied.";

  return {
    steps: [
      { name: "Received event", detail: `Trigger: ${context.eventType}` },
      { name: "Recorded sync issue", detail: `Source: ${system}. ${detail}` },
    ],
    summary: `Sync failure reported by ${system}.`,
    output: {
      issue: {
        system,
        detail,
        next_action:
          "Review the connection's recent events and the external system's sync configuration.",
      },
    },
  };
}

export const templateHandlers: Record<
  string,
  (context: HandlerContext) => Promise<HandlerResult>
> = {
  new_lead_intake: handleLeadIntake,
  missed_call_rescue: draftHandler({
    draftKind: "missed_call_rescue",
    approvalType: "customer_message",
    riskLevel: "high",
    titlePrefix: "Missed-call follow-up",
  }),
  estimate_follow_up: draftHandler({
    draftKind: "estimate_follow_up",
    approvalType: "customer_message",
    riskLevel: "high",
    titlePrefix: "Estimate follow-up",
  }),
  appointment_reminder: draftHandler({
    draftKind: "appointment_confirmation",
    approvalType: "customer_message",
    riskLevel: "medium",
    titlePrefix: "Appointment confirmation",
  }),
  review_request: draftHandler({
    draftKind: "review_request",
    approvalType: "customer_message",
    riskLevel: "medium",
    titlePrefix: "Review request",
  }),
  sync_failure_alert: handleSyncFailureAlert,
};
