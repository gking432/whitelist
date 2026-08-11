import { z } from "zod";

import { generateStructured } from "@/lib/ai/provider";
import { fallbackSupportTriage } from "@/lib/support/routing";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  SUPPORT_ROUTES,
  type SupportHealthContext,
  type SupportOrigin,
  type SupportTriage,
} from "@/lib/support/types";

const TriageSchema = z.object({
  category: z.enum(SUPPORT_CATEGORIES),
  priority: z.enum(SUPPORT_PRIORITIES),
  summary: z.string(),
  diagnosis: z.string(),
  recommendedAction: z.string(),
  recommendedRoute: z.enum(SUPPORT_ROUTES),
  confidence: z.enum(["low", "medium", "high"]),
});

const SYSTEM_PROMPT = `You triage support requests for a white-label automation platform used by home service businesses.

Classify the issue and recommend the next action. Never invent a diagnosis. Account-health context is evidence, not proof.

Routing rules:
- A client request always routes to its white-label partner first.
- Setup and how-to questions from partners may route to support_ai.
- Confirmed bugs, new connectors, and feature requests may route to codex, but a human owner must approve any code task and release.
- Billing, security, permissions, critical incidents, uncertainty, and policy decisions route to owner.
- No code is deployed automatically.`;

export async function analyzeSupportTicket(input: {
  origin: SupportOrigin;
  title: string;
  description: string;
  affectedArea?: string | null;
  health: SupportHealthContext;
}): Promise<{ triage: SupportTriage; source: "ai" | "fallback"; metadata: Record<string, unknown> }> {
  const fallback = fallbackSupportTriage(input);

  try {
    const result = await generateStructured({
      taskKey: "support_triage",
      system: SYSTEM_PROMPT,
      user: JSON.stringify({
        origin: input.origin,
        title: input.title,
        description: input.description,
        affected_area: input.affectedArea ?? null,
        account_health: input.health,
      }),
      schema: TriageSchema,
      maxTokens: 1400,
    });

    const triage = result.data as SupportTriage;
    if (input.origin === "client") triage.recommendedRoute = "partner";
    if (triage.priority === "critical" && input.origin !== "client") triage.recommendedRoute = "owner";

    return {
      triage,
      source: "ai",
      metadata: {
        provider: result.meta.provider,
        model: result.meta.model,
        latency_ms: result.meta.latencyMs,
      },
    };
  } catch (error) {
    return {
      triage: fallback,
      source: "fallback",
      metadata: {
        reason: error instanceof Error ? error.name : "ai_unavailable",
      },
    };
  }
}
