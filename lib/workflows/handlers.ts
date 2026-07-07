// Workflow handlers for the Lead Response Pack. Each handler is AI-capable
// with a deterministic fallback: if the AI provider is not configured or a
// call fails, the handler still produces schema-shaped output, labeled
// status: "fallback" so run detail never presents rule-based output as model
// output. Handlers receive redacted payloads and stay pure of HTTP concerns.

import {
  fallbackCustomerDraft,
  fallbackIntakeRouting,
  fallbackLeadIntakeAnalysis,
} from "@/lib/ai/fallbacks";
import {
  buildCustomerDraftPrompt,
  buildIntakeRoutingPrompt,
  buildLeadIntakePrompt,
  CUSTOMER_DRAFT_SYSTEM_PROMPT,
  INTAKE_ROUTING_SYSTEM_PROMPT,
  LEAD_INTAKE_SYSTEM_PROMPT,
} from "@/lib/ai/prompts";
import {
  generateStructured,
  isAIConfigured,
} from "@/lib/ai/provider";
import {
  CustomerDraftSchema,
  IntakeRoutingSchema,
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

  const steps: RunStep[] = [
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
  ];

  const name =
    asString(context.data.name) || asString(context.data.full_name);
  const phone = asString(context.data.phone);
  const email = asString(context.data.email);
  const recipient = name || phone || email || "the customer";

  // Speed-to-lead: fresh leads get an approval-gated first-response draft.
  // Missed calls are excluded — the missed-call rescue workflow drafts
  // those, and one interaction should produce one draft.
  const wantsFirstResponse =
    !context.eventType.startsWith("missed_call.") &&
    !context.eventType.startsWith("call.") &&
    Boolean(phone || email);

  let firstResponse: CustomerDraft | null = null;
  let draftAi: AIExecutionInfo | null = null;

  if (wantsFirstResponse) {
    const customTemplate =
      asString(context.settings.message_template) || undefined;

    const draftResult = await structuredWithFallback<CustomerDraft>({
      taskKey: "new_lead_response_draft",
      system: CUSTOMER_DRAFT_SYSTEM_PROMPT,
      user: buildCustomerDraftPrompt({
        businessName: context.clientName,
        draftKind: "new_lead_response",
        eventType: context.eventType,
        payloadJson: JSON.stringify(context.data, null, 2),
        customTemplate,
      }),
      schema: CustomerDraftSchema,
      fallback: () =>
        fallbackCustomerDraft({
          draftKind: "new_lead_response",
          businessName: context.clientName,
          data: context.data,
          customTemplate,
        }),
    });

    firstResponse = draftResult.data;
    draftAi = draftResult.ai;

    steps.push(
      { name: "Prepared first response", detail: aiStepDetail(draftAi) },
      {
        name: "Queued for approval",
        detail:
          "The first-response draft waits for human approval; nothing is sent automatically.",
      },
    );
  }

  return {
    steps,
    summary: `Lead intake: ${analysis.urgency} urgency, ${analysis.lead_quality} quality. ${analysis.recommended_next_action}`,
    output: {
      analysis,
      ...(firstResponse
        ? { draft: firstResponse, recipient: { name, phone, email } }
        : {}),
    },
    ai,
    ...(firstResponse
      ? {
          approvalDraft: {
            type: "customer_message",
            title: `First response: ${recipient}`,
            summary: `Review the drafted first ${firstResponse.channel.toUpperCase()} response to ${recipient} for ${context.clientName}. ${firstResponse.internal_note}`,
            riskLevel: "high" as const,
            editableContent: firstResponse.body,
            proposedPayload: {
              channel: firstResponse.channel,
              to: phone || email || null,
              subject: firstResponse.subject,
              draft_source:
                draftAi?.status === "ai" ? "ai_generated" : "rule_based_template",
            },
          },
        }
      : {}),
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

// Universal intake router: classifies every inbound interaction so the
// right people and workflows see it (docs/12 "Universal AI Intake Routing").
// Internal routing decision only — no customer-facing output, no approval.
async function handleIntakeRouting(
  context: HandlerContext,
): Promise<HandlerResult> {
  const configuredKeywords = asString(context.settings.urgent_keywords);
  const urgentKeywords = configuredKeywords
    ? configuredKeywords
        .split(",")
        .map((keyword) => keyword.trim())
        .filter(Boolean)
    : undefined;

  const { data: routing, ai } = await structuredWithFallback({
    taskKey: "intake_routing",
    system: INTAKE_ROUTING_SYSTEM_PROMPT,
    user: buildIntakeRoutingPrompt({
      businessName: context.clientName,
      eventType: context.eventType,
      payloadJson: JSON.stringify(context.data, null, 2),
    }),
    schema: IntakeRoutingSchema,
    fallback: () =>
      fallbackIntakeRouting({
        eventType: context.eventType,
        data: context.data,
        urgentKeywords,
      }),
  });

  return {
    steps: [
      { name: "Received interaction", detail: `Channel: ${context.eventType}` },
      { name: "Classified intake", detail: aiStepDetail(ai) },
      {
        name: "Routed",
        detail: `${routing.category.replaceAll("_", " ")} → ${routing.recommended_owner.replaceAll("_", " ")} (${routing.urgency} urgency, ${routing.confidence} confidence).${
          routing.requires_human_handoff ? " Human handoff required." : ""
        }`,
      },
    ],
    summary: `Intake routed to ${routing.category.replaceAll("_", " ")} (${routing.urgency}). ${routing.suggested_next_action}`,
    output: { routing },
    ai,
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
  ai_intake_router: handleIntakeRouting,
  sync_failure_alert: handleSyncFailureAlert,
};
