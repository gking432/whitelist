// AI Voice provider abstraction — CONTRACT ONLY (Phase 4 of docs/11).
// No implementation exists in this release and nothing implies real
// telephony until a provider adapter is connected. These contracts are
// shaped so the voice layer plugs into the existing workflow architecture:
// a completed call becomes an integration_event (event_type "call.completed")
// that the run engine matches like any other trigger, and voice outputs
// (CRM note, follow-up draft) flow through workflow_runs + approval_items.
//
// Northstar reference concepts carried over: transcript turns separate from
// the clean CRM note, known-caller matching, extracted intake fields, and a
// confirmation draft prepared after the call (approval-gated).

import { z } from "zod";
import type { RuntimeMode } from "@/lib/clients/constants";

export type CallDirection = "inbound" | "outbound_callback";

export type CallSessionStatus =
  | "ringing"
  | "in_progress"
  | "completed"
  | "failed"
  | "no_answer"
  | "voicemail";

export type TranscriptTurn = {
  role: "assistant" | "caller" | "human_rep";
  text: string;
  atMs: number;
};

// Tenant-scoped call session. The full transcript is stored separately from
// the CRM-ready summary and is subject to the same redaction rules as
// integration event payloads.
export type CallSession = {
  id: string;
  partnerId: string;
  clientId: string;
  connectionId: string;
  direction: CallDirection;
  status: CallSessionStatus;
  runtimeMode: RuntimeMode;
  callerNumber: string | null;
  matchedCustomerRef: CallerMatch | null;
  startedAt: string;
  endedAt: string | null;
};

// Known-caller matching happens against the client's external CRM through
// the CRM sync adapter — this platform is not the system of record.
export type CallerMatch = {
  source: "external_crm" | "platform_history";
  externalObjectType: string;
  externalObjectId: string;
  displayName: string | null;
  confidence: "exact_number" | "fuzzy";
};

// Structured output of the post-call summarization workflow (AI with
// deterministic fallback, same pattern as lib/ai/provider.ts callers).
export const CallSummarySchema = z.object({
  summary: z.string(),
  crm_note: z.string(),
  customer_intent: z.string(),
  service_type: z.string(),
  urgency: z.enum(["emergency", "high", "medium", "low"]),
  appointment_requested: z.boolean(),
  appointment_time_text: z.string().nullable(),
  extracted_fields: z.object({
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    address: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    zip_code: z.string().nullable(),
    preferred_contact_method: z.string().nullable(),
  }),
  follow_up_draft: z.string().nullable(),
});

export type CallSummary = z.infer<typeof CallSummarySchema>;

// Provider adapter contract. Implementations (Twilio Voice + a realtime
// speech model, etc.) live server-side; credentials go through
// integration_secrets like every other connection.
export interface VoiceProvider {
  providerKey: string;

  // Inbound answering: the provider webhook creates a CallSession; the
  // adapter streams/collects transcript turns until the call ends.
  handleInboundCall(input: {
    connectionId: string;
    callerNumber: string;
    providerCallRef: string;
  }): Promise<{ sessionId: string }>;

  // Outbound callback (speed-to-lead is a use case of this, not a separate
  // product): only permitted in live runtime mode with an approval policy
  // that allows automated calls.
  startOutboundCallback(input: {
    connectionId: string;
    toNumber: string;
    reason: "lead_callback" | "reschedule" | "reminder";
    contextRunId: string | null;
  }): Promise<{ sessionId: string }>;

  endSession(sessionId: string): Promise<void>;
}

// Completion pipeline contract: turn a finished session into workflow
// inputs. Implementation lands with Phase 4; the engine already supports the
// trigger event side.
export interface CallCompletionPipeline {
  // 1. Persist transcript (redacted) + summary (CallSummarySchema via AI
  //    with fallback). 2. Write an integration_event `call.completed` with
  //    the summary as payload. 3. Let runWorkflowsForEvent create runs,
  //    approvals (follow-up draft), and CRM sync payloads.
  completeCall(sessionId: string): Promise<{ integrationEventId: string }>;
}
