// Website AI chat assistant contract (docs/12 "Website AI Chat
// Assistant"). The hosted widget and iframe embed both use this shape:
//
// - Every chat connection is an inbound-capable integration connection
//   (provider "northstar_web_chat") with a generated endpoint + credential
//   on the shared secured intake path.
// - A finished conversation becomes an integration_event
//   ("chat.conversation_completed") whose payload is the ChatIntakeResult.
// - The AI Intake Routing workflow classifies it (sales, service,
//   scheduling, urgent, billing, PR, spam, …) and downstream workflows,
//   approvals, and CRM sync act on it.
// - Everything the assistant does is attributed to the "AI Assistant" actor
//   in CRM notes and audit events; customer-facing sends stay approval-gated.

import { z } from "zod";
import type { IntakeRouting } from "@/lib/ai/schemas";
import type { RuntimeMode } from "@/lib/clients/constants";

export type ChatSessionStatus =
  | "active"
  | "completed"
  | "abandoned"
  | "handed_off";

export type ChatMessage = {
  role: "assistant" | "visitor" | "human_agent";
  text: string;
  atMs: number;
};

// Tenant-scoped chat session. Transcripts follow the same redaction rules as
// other integration payloads; the clean summary is what reaches the CRM.
export type ChatSession = {
  id: string;
  partnerId: string;
  clientId: string;
  connectionId: string;
  status: ChatSessionStatus;
  runtimeMode: RuntimeMode;
  pageUrl: string | null;
  startedAt: string;
  endedAt: string | null;
};

// Structured outcome of a conversation — the payload posted to the client's
// web chat intake connection as a "chat.conversation_completed" event.
export const ChatIntakeResultSchema = z.object({
  summary: z.string(),
  transcript_message_count: z.number(),
  collected: z.object({
    name: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    service_type: z.string().nullable(),
    message: z.string().nullable(),
    preferred_time_text: z.string().nullable(),
  }),
  qualified: z.boolean(),
  handed_off_to_human: z.boolean(),
  handoff_reason: z.string().nullable(),
});

export type ChatIntakeResult = z.infer<typeof ChatIntakeResultSchema>;

// What the assistant is allowed to say/do for one client. Content comes from
// partner-approved business information only — the assistant never invents
// pricing, availability, or guarantees.
export type ChatAssistantConfig = {
  clientId: string;
  businessName: string;
  approvedFacts: string[]; // services, hours, service area, FAQ answers
  disclosure: "explicit" | "minimal" | "off"; // per docs/12 disclosure modes
  collectFields: ("name" | "phone" | "email" | "address" | "service_type")[];
  canSuggestAppointments: boolean; // requires a calendar provider connection
  handoffContact: string | null;
};

// Provider adapter contract. The embed/widget, hosted chat page, and
// platform plugins all drive the same interface.
export interface ChatAssistantProvider {
  providerKey: string; // "northstar_web_chat" today

  startSession(input: {
    connectionId: string;
    pageUrl: string | null;
  }): Promise<{ sessionId: string }>;

  // Each visitor turn produces the assistant's reply plus updated collected
  // fields. Replies come from AI with deterministic fallback, like every
  // other AI surface in the platform.
  handleVisitorMessage(input: {
    sessionId: string;
    text: string;
  }): Promise<{ reply: string; collected: ChatIntakeResult["collected"] }>;

  requestHumanHandoff(input: {
    sessionId: string;
    reason: string;
  }): Promise<void>;

  // Ends the session, builds the ChatIntakeResult, posts it to the client's
  // intake endpoint, and lets AI Intake Routing take over.
  completeSession(sessionId: string): Promise<{
    result: ChatIntakeResult;
    routing: IntakeRouting | null;
    integrationEventId: string;
  }>;
}
