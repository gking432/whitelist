import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

// Server-side AI provider layer. Every model call in the platform goes
// through generateStructured so provider selection, validation, metadata,
// and failure behavior live in one place.
//
// Rules (docs/11):
// - server-side only; never import from client components.
// - callers must catch AIUnavailableError/AIResponseError and fall back to
//   deterministic output — a workflow run must never die because AI did.
// - prompt inputs must already be redacted by the caller (the engine passes
//   the redacted event payload stored on the integration event).

export class AIUnavailableError extends Error {
  constructor(message = "AI provider is not configured.") {
    super(message);
    this.name = "AIUnavailableError";
  }
}

export class AIResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIResponseError";
  }
}

export type AICallMetadata = {
  provider: "anthropic";
  model: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type StructuredAIResult<T> = {
  data: T;
  meta: AICallMetadata;
};

const DEFAULT_MODEL = "claude-opus-4-8";

export function isAIConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function aiModelId(): string {
  return process.env.AI_MODEL || DEFAULT_MODEL;
}

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new AIUnavailableError();
  }

  if (!cachedClient) {
    // Workflow runs execute synchronously inside webhook handling today, so
    // keep the per-call ceiling tight; the engine falls back deterministically
    // on timeout.
    cachedClient = new Anthropic({
      apiKey,
      timeout: 60_000,
      maxRetries: 1,
    });
  }

  return cachedClient;
}

export async function generateStructured<T>(args: {
  taskKey: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}): Promise<StructuredAIResult<T>> {
  const client = getClient();
  const model = aiModelId();
  const startedAt = Date.now();

  try {
    const response = await client.messages.parse({
      model,
      max_tokens: args.maxTokens ?? 4096,
      thinking: { type: "adaptive" },
      // These are small, well-specified extraction/drafting tasks; low effort
      // keeps webhook-path latency and cost predictable.
      output_config: {
        effort: "low",
        format: zodOutputFormat(args.schema),
      },
      system: args.system,
      messages: [{ role: "user", content: args.user }],
    });

    if (response.stop_reason === "refusal") {
      throw new AIResponseError("The AI provider declined this request.");
    }

    const parsed = response.parsed_output;

    if (parsed === null || parsed === undefined) {
      throw new AIResponseError(
        "AI output did not match the expected schema.",
      );
    }

    return {
      data: parsed,
      meta: {
        provider: "anthropic",
        model: response.model ?? model,
        latencyMs: Date.now() - startedAt,
        inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
      },
    };
  } catch (error) {
    if (
      error instanceof AIResponseError ||
      error instanceof AIUnavailableError
    ) {
      throw error;
    }

    if (error instanceof Anthropic.APIError) {
      throw new AIResponseError(
        `AI request failed (${error.status ?? "network"}): ${error.name}`,
      );
    }

    throw new AIResponseError(
      error instanceof Error ? error.message : "AI request failed.",
    );
  }
}
