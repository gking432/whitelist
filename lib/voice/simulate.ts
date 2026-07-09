import type { SupabaseClient } from "@supabase/supabase-js";

import { getKnowledgeProfile } from "@/lib/knowledge/profile";
import {
  buildVoiceAgentInstructions,
  isOpenAIRealtimeConfigured,
  runSimulatedAgentTurn,
  type VoiceAgentContext,
} from "@/lib/voice/providers/openai-realtime";
import {
  addTranscriptTurn,
  completeCallSession,
  createCallSession,
} from "@/lib/voice/sessions";
import {
  executeVoiceTool,
  VOICE_TOOL_DEFINITIONS,
  type VoiceToolContext,
} from "@/lib/voice/tools";

// Simulated voice calls (docs/21): the SAME agent instructions, tools, and
// call-session pipeline as a real OpenAI Realtime phone call, over text
// instead of audio. This is how the voice workflow is tested before any
// phone bridge (Twilio Voice / SIP) exists:
//   start → createCallSession (caller matching, disclosure, events)
//   caller turn → transcript turn + agent turn + REAL tool execution
//   complete → completeCallSession (AI summary, call.completed intake →
//              workflows → approvals → CRM sync, timeline note, events)
// Simulated sessions are honest: provider "openai_realtime_simulated" so
// nothing ever presents them as real telephony.

export const SIMULATED_PROVIDER = "openai_realtime_simulated";

const MAX_TOOL_ROUNDS = 5;
const MAX_TURNS = 60;

type ChatMessage = Parameters<
  typeof runSimulatedAgentTurn
>[0]["messages"][number];

async function buildInstructionsForSession(
  admin: SupabaseClient,
  session: {
    client_id: string;
    disclosure_mode: string;
    matched_contact_id: string | null;
    direction: string;
  },
  clientName: string,
): Promise<string> {
  const knowledge = await getKnowledgeProfile(admin, session.client_id);

  let matchedContact: VoiceAgentContext["matchedContact"] = null;

  if (session.matched_contact_id) {
    const { data: contact } = await admin
      .from("crm_contacts")
      .select("first_name, last_name, phone, email, address")
      .eq("id", session.matched_contact_id)
      .maybeSingle();

    if (contact) {
      matchedContact = {
        name:
          [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
          null,
        phone: contact.phone,
        email: contact.email,
        address: contact.address,
      };
    }
  }

  return buildVoiceAgentInstructions({
    clientName,
    knowledge,
    disclosureMode:
      session.disclosure_mode === "off" ||
      session.disclosure_mode === "minimal"
        ? session.disclosure_mode
        : "explicit",
    matchedContact,
    direction: session.direction === "outbound" ? "outbound" : "inbound",
  });
}

async function loadSession(admin: SupabaseClient, callSessionId: string) {
  const { data } = await admin
    .from("call_sessions")
    .select(
      "id, partner_id, client_id, provider, direction, status, disclosure_mode, matched_contact_id, from_number",
    )
    .eq("id", callSessionId)
    .maybeSingle();

  return data as {
    id: string;
    partner_id: string;
    client_id: string;
    provider: string;
    direction: string;
    status: string;
    disclosure_mode: string;
    matched_contact_id: string | null;
    from_number: string | null;
  } | null;
}

async function loadClientName(
  admin: SupabaseClient,
  clientId: string,
): Promise<string> {
  const { data } = await admin
    .from("client_businesses")
    .select("name")
    .eq("id", clientId)
    .maybeSingle();

  return data?.name ?? "the business";
}

// One agent turn with the in-request tool loop: the model may call tools,
// we execute them against the REAL executors, feed results back, and
// repeat until it produces speech (or asks to end the call).
async function runAgentWithTools(args: {
  admin: SupabaseClient;
  toolContext: VoiceToolContext;
  instructions: string;
  messages: ChatMessage[];
}): Promise<
  | {
      ok: true;
      reply: string | null;
      toolsUsed: { name: string; result: Record<string, unknown> }[];
      endCall: boolean;
    }
  | { ok: false; error: string }
> {
  const messages = [...args.messages];
  const toolsUsed: { name: string; result: Record<string, unknown> }[] = [];
  let endCall = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const turn = await runSimulatedAgentTurn({
      instructions: args.instructions,
      messages,
      tools: VOICE_TOOL_DEFINITIONS.map((definition) => ({
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
      })),
    });

    if (!turn.ok) {
      return { ok: false, error: turn.error };
    }

    if (turn.toolCalls.length === 0) {
      return { ok: true, reply: turn.text, toolsUsed, endCall };
    }

    messages.push({
      role: "assistant",
      content: turn.text,
      tool_calls: turn.toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        },
      })),
    });

    for (const call of turn.toolCalls) {
      const outcome = await executeVoiceTool(args.admin, args.toolContext, {
        name: call.name,
        arguments: call.arguments,
      });

      toolsUsed.push({ name: call.name, result: outcome.result });

      if (outcome.endCall) {
        endCall = true;
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(outcome.result),
      });
    }

    if (turn.text) {
      // The model spoke AND called tools; keep the speech.
      return { ok: true, reply: turn.text, toolsUsed, endCall };
    }
  }

  return { ok: true, reply: null, toolsUsed, endCall };
}

export async function startSimulatedCall(
  admin: SupabaseClient,
  input: {
    clientId: string;
    fromNumber?: string | null;
  },
): Promise<
  | {
      ok: true;
      callSessionId: string;
      greeting: string | null;
      toolsUsed: { name: string; result: Record<string, unknown> }[];
    }
  | { ok: false; error: string }
> {
  if (!isOpenAIRealtimeConfigured()) {
    return {
      ok: false,
      error:
        "OPENAI_API_KEY is not configured — the simulated voice harness needs it.",
    };
  }

  const { data: client } = await admin
    .from("client_businesses")
    .select("partner_id")
    .eq("id", input.clientId)
    .maybeSingle();

  if (!client) {
    return { ok: false, error: "Client not found." };
  }

  const created = await createCallSession(admin, {
    partnerId: client.partner_id,
    clientId: input.clientId,
    provider: SIMULATED_PROVIDER,
    direction: "inbound",
    fromNumber: input.fromNumber ?? null,
  });

  if (!created) {
    return { ok: false, error: "The call session could not be created." };
  }

  const session = await loadSession(admin, created.callSessionId);

  if (!session) {
    return { ok: false, error: "The call session could not be loaded." };
  }

  const clientName = await loadClientName(admin, session.client_id);
  const instructions = await buildInstructionsForSession(
    admin,
    session,
    clientName,
  );

  const result = await runAgentWithTools({
    admin,
    toolContext: {
      callSessionId: session.id,
      partnerId: session.partner_id,
      clientId: session.client_id,
      clientName,
    },
    instructions,
    messages: [
      {
        role: "user",
        content:
          "(The phone call has just connected. Greet the caller as the call answerer — do not wait for them to speak first.)",
      },
    ],
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  if (result.reply) {
    await addTranscriptTurn(admin, session.id, {
      role: "ai_assistant",
      content: result.reply,
    });
  }

  return {
    ok: true,
    callSessionId: session.id,
    greeting: result.reply,
    toolsUsed: result.toolsUsed,
  };
}

export async function runSimulatedCallerTurn(
  admin: SupabaseClient,
  callSessionId: string,
  callerText: string,
): Promise<
  | {
      ok: true;
      reply: string | null;
      toolsUsed: { name: string; result: Record<string, unknown> }[];
      endCall: boolean;
    }
  | { ok: false; error: string }
> {
  const session = await loadSession(admin, callSessionId);

  if (!session || session.provider !== SIMULATED_PROVIDER) {
    return { ok: false, error: "Simulated call session not found." };
  }

  if (session.status !== "in_progress") {
    return { ok: false, error: "This simulated call has already ended." };
  }

  await addTranscriptTurn(admin, callSessionId, {
    role: "caller",
    content: callerText,
  });

  // Rebuild the spoken history from the transcript (the source of truth);
  // tool-call plumbing stays inside each request.
  const { data: turnsData } = await admin
    .from("call_transcript_turns")
    .select("role, content")
    .eq("call_session_id", callSessionId)
    .order("seq", { ascending: true })
    .limit(MAX_TURNS);

  const turns = (turnsData ?? []) as { role: string; content: string }[];

  if (turns.length >= MAX_TURNS) {
    return {
      ok: true,
      reply:
        "This simulated call reached its length limit — complete it to run the post-call pipeline.",
      toolsUsed: [],
      endCall: true,
    };
  }

  const clientName = await loadClientName(admin, session.client_id);
  const instructions = await buildInstructionsForSession(
    admin,
    session,
    clientName,
  );

  const result = await runAgentWithTools({
    admin,
    toolContext: {
      callSessionId,
      partnerId: session.partner_id,
      clientId: session.client_id,
      clientName,
    },
    instructions,
    messages: turns.map((turn) => ({
      role: turn.role === "caller" ? ("user" as const) : ("assistant" as const),
      content: turn.content,
    })),
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  if (result.reply) {
    await addTranscriptTurn(admin, callSessionId, {
      role: "ai_assistant",
      content: result.reply,
    });
  }

  return {
    ok: true,
    reply: result.reply,
    toolsUsed: result.toolsUsed,
    endCall: result.endCall,
  };
}

// Complete the call through the real pipeline, then report everything it
// produced so the whole voice workflow is verifiable in one response.
export async function completeSimulatedCall(
  admin: SupabaseClient,
  callSessionId: string,
): Promise<
  | { ok: true; report: Record<string, unknown> }
  | { ok: false; error: string }
> {
  const session = await loadSession(admin, callSessionId);

  if (!session || session.provider !== SIMULATED_PROVIDER) {
    return { ok: false, error: "Simulated call session not found." };
  }

  const completion = await completeCallSession(admin, callSessionId);

  if (!completion) {
    return {
      ok: false,
      error: "The call could not be completed (it may already be finished).",
    };
  }

  const [{ data: finalSession }, { count: turnCount }] = await Promise.all([
    admin
      .from("call_sessions")
      .select("status, summary, crm_note, extracted, matched_contact_id")
      .eq("id", callSessionId)
      .maybeSingle(),
    admin
      .from("call_transcript_turns")
      .select("id", { count: "exact", head: true })
      .eq("call_session_id", callSessionId),
  ]);

  const { data: intakeEvent } = await admin
    .from("integration_events")
    .select("id, status, workflow_run_id")
    .eq("idempotency_key", `call-session-${callSessionId}`)
    .maybeSingle();

  const { data: events } = await admin
    .from("assistant_events")
    .select("event_type, approval_id, created_at")
    .eq("call_session_id", callSessionId)
    .order("created_at", { ascending: true })
    .limit(50);

  // Approvals the agent created mid-call (booking requests, drafts).
  const { data: approvals } = await admin
    .from("approval_items")
    .select("id, type, status, title")
    .eq("client_id", session.client_id)
    .contains("proposed_payload", { call_session_id: callSessionId })
    .limit(10);

  let timelineNotes = 0;

  if (finalSession?.matched_contact_id) {
    const { count } = await admin
      .from("crm_timeline_entries")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", finalSession.matched_contact_id)
      .eq("actor_type", "ai_assistant");

    timelineNotes = count ?? 0;
  }

  return {
    ok: true,
    report: {
      call_session_id: callSessionId,
      status: finalSession?.status ?? "completed",
      transcript_turns: turnCount ?? 0,
      summary: finalSession?.summary ?? null,
      crm_note: finalSession?.crm_note ?? null,
      summary_source: completion.ai,
      extracted: finalSession?.extracted ?? {},
      matched_contact_id: finalSession?.matched_contact_id ?? null,
      contact_timeline_ai_entries: timelineNotes,
      intake_event: intakeEvent
        ? {
            id: intakeEvent.id,
            status: intakeEvent.status,
            workflow_run_id: intakeEvent.workflow_run_id,
          }
        : null,
      approvals_from_call: approvals ?? [],
      assistant_events: (events ?? []).map((event) => event.event_type),
    },
  };
}
