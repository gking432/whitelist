import { z } from "zod";

import { generateStructured, isAIConfigured } from "@/lib/ai/provider";
import type { AIExecutionInfo } from "@/lib/ai/schemas";
import {
  buildKnowledgeBlock,
  KNOWLEDGE_GUARDRAILS,
  type KnowledgeProfile,
} from "@/lib/knowledge/profile";

// Website chat assistant brain. AI with a deterministic scripted fallback
// (never dies without a reply). The assistant's job is customer service +
// lead capture: answer ONLY from approved knowledge, collect contact and
// job details, and honestly say the team will confirm anything unknown.

export const ChatReplySchema = z.object({
  reply: z.string(),
  extracted: z.object({
    name: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    service_need: z.string().nullable(),
    urgency: z.enum(["emergency", "high", "medium", "low"]).nullable(),
    appointment_preference: z.string().nullable(),
  }),
  conversation_complete: z.boolean(),
  handoff_requested: z.boolean(),
});

export type ChatReply = z.infer<typeof ChatReplySchema>;

export type TranscriptTurn = {
  role: "visitor" | "assistant";
  content: string;
  at: string;
};

export type SessionFields = {
  visitor_name: string | null;
  visitor_phone: string | null;
  visitor_email: string | null;
  visitor_address: string | null;
  service_need: string | null;
  urgency: string | null;
  appointment_preference: string | null;
};

const CHAT_SYSTEM_PROMPT = `You are a website chat assistant for a home service business. You act as a friendly customer service and intake rep.

${KNOWLEDGE_GUARDRAILS}

Behavior rules:
- Keep every reply under 80 words. Ask at most one question per reply.
- Your goals, in order: (1) answer the visitor's question from approved knowledge, (2) collect name, phone, email, address, what they need done, urgency, and preferred appointment times, (3) confirm the team will follow up.
- Never book, promise, or confirm an appointment time — say the team will confirm. Never send anything on the visitor's behalf.
- If the visitor asks for a human, set handoff_requested true and tell them the team will reach out.
- Extract any contact/job details the visitor has shared (across the whole conversation) into the extracted fields; null when unknown.
- Set conversation_complete true once you have at least a phone or email plus what they need, and you have told them what happens next.`;

export function buildChatUserPrompt(input: {
  clientName: string;
  knowledge: KnowledgeProfile | null;
  transcript: TranscriptTurn[];
  visitorMessage: string;
}): string {
  const history = input.transcript
    .slice(-16)
    .map((turn) => `${turn.role === "visitor" ? "Visitor" : "Assistant"}: ${turn.content}`)
    .join("\n");

  return `${buildKnowledgeBlock(input.clientName, input.knowledge)}

Conversation so far:
${history || "(none yet)"}

Visitor's new message:
${input.visitorMessage}

Reply as the assistant for ${input.clientName}.`;
}

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_PATTERN = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

// Scripted fallback: one field at a time, honest about being unable to
// answer open questions without the team.
export function fallbackChatReply(
  fields: SessionFields,
  visitorMessage: string,
  disclosure: string | null,
  isFirstMessage: boolean,
): ChatReply {
  const email = visitorMessage.match(EMAIL_PATTERN)?.[0] ?? null;
  const phone = visitorMessage.match(PHONE_PATTERN)?.[0] ?? null;

  const extracted: ChatReply["extracted"] = {
    name: null,
    phone,
    email,
    address: null,
    service_need: null,
    urgency: null,
    appointment_preference: null,
  };

  // Assign free text to whichever field we asked for last.
  const trimmed = visitorMessage.trim();

  if (!fields.service_need && !isFirstMessage && trimmed && !email && !phone) {
    extracted.service_need = trimmed.slice(0, 300);
  } else if (
    fields.service_need &&
    !fields.visitor_name &&
    trimmed &&
    !email &&
    !phone &&
    trimmed.split(/\s+/).length <= 6
  ) {
    extracted.name = trimmed;
  } else if (
    fields.visitor_name &&
    (fields.visitor_phone || phone || fields.visitor_email || email) &&
    !fields.appointment_preference &&
    trimmed &&
    !email &&
    !phone
  ) {
    extracted.appointment_preference = trimmed.slice(0, 200);
  }

  const merged = {
    service_need: fields.service_need ?? extracted.service_need,
    name: fields.visitor_name ?? extracted.name,
    phone: fields.visitor_phone ?? extracted.phone,
    email: fields.visitor_email ?? extracted.email,
    appointment_preference:
      fields.appointment_preference ?? extracted.appointment_preference,
  };

  let reply: string;
  let complete = false;

  if (isFirstMessage) {
    reply = `${disclosure ?? "Hi! I'm the AI assistant for this business."} What can we help you with today?`;
  } else if (!merged.service_need) {
    reply = "Got it — can you tell me a bit about what you need done?";
  } else if (!merged.name) {
    reply = "Thanks! Who am I speaking with?";
  } else if (!merged.phone && !merged.email) {
    reply = `Thanks, ${merged.name}. What's the best phone number (or email) to reach you?`;
  } else if (!merged.appointment_preference) {
    reply =
      "Perfect. Are there days or times that work best for a visit? The team will confirm the exact time.";
  } else {
    reply = `Great — I've got everything the team needs. Someone from the business will reach out shortly to confirm. Anything else I can note for them?`;
    complete = true;
  }

  return {
    reply,
    extracted,
    conversation_complete: complete,
    handoff_requested: /human|person|someone real|talk to a/i.test(visitorMessage),
  };
}

export async function generateChatReply(input: {
  clientName: string;
  knowledge: KnowledgeProfile | null;
  fields: SessionFields;
  transcript: TranscriptTurn[];
  visitorMessage: string;
  isFirstMessage: boolean;
}): Promise<{ data: ChatReply; ai: AIExecutionInfo }> {
  const disclosure =
    input.knowledge?.ai_disclosure ??
    `Hi! I'm ${input.clientName}'s AI assistant. I can answer questions and take your details — a human confirms everything.`;

  if (!isAIConfigured()) {
    return {
      data: fallbackChatReply(
        input.fields,
        input.visitorMessage,
        disclosure,
        input.isFirstMessage,
      ),
      ai: { status: "fallback", reason: "not_configured" },
    };
  }

  try {
    const result = await generateStructured({
      taskKey: "website_chat_reply",
      system: CHAT_SYSTEM_PROMPT,
      user: buildChatUserPrompt({
        clientName: input.clientName,
        knowledge: input.knowledge,
        transcript: input.transcript,
        visitorMessage: input.visitorMessage,
      }),
      schema: ChatReplySchema,
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
      data: fallbackChatReply(
        input.fields,
        input.visitorMessage,
        disclosure,
        input.isFirstMessage,
      ),
      ai: {
        status: "fallback",
        reason: "ai_failed",
        error: error instanceof Error ? error.message : "AI request failed.",
      },
    };
  }
}
