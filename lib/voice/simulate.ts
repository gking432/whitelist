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

function scriptedName(text: string): string | null {
  const match = text.match(
    /\b(?:i am|i'm|this is|my name is)\s+([a-z][a-z'-]+(?:\s+[a-z][a-z'-]+)?)/i,
  );
  return match?.[1]?.replace(/\b\w/g, (letter) => letter.toUpperCase()) ?? null;
}

function scriptedEmail(text: string): string | null {
  return (
    text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null
  );
}

function scriptedPhone(text: string): string | null {
  return (
    text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)?.[0] ??
    null
  );
}

function scriptedAddress(text: string): string | null {
  return (
    text.match(
      /\b\d{1,6}\s+[A-Za-z0-9.' -]+\s(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct)\b/i,
    )?.[0] ?? null
  );
}

async function runScriptedAgentTurn(
  admin: SupabaseClient,
  context: VoiceToolContext,
  callerText: string,
): Promise<{
  ok: true;
  reply: string | null;
  toolsUsed: { name: string; result: Record<string, unknown> }[];
  endCall: boolean;
}> {
  const lower = callerText.toLowerCase();
  const toolsUsed: { name: string; result: Record<string, unknown> }[] = [];
  const emergency =
    /emergency|flood|burst|fire|gas leak|no heat|freezing|sparking|furnace.{0,24}(stopped|not working|isn't working)/.test(
      lower,
    );
  const scheduling =
    /appointment|schedule|book|available|morning|afternoon|evening|after \d|monday|tuesday|wednesday|thursday|friday/.test(
      lower,
    );
  const endCall = /\b(?:goodbye|bye|that's all|that is all|no thanks)\b/.test(
    lower,
  );
  const acknowledgement =
    /^(?:that works|first one|second one|take the|book it|sounds good|okay|ok|yes)\b/.test(
      lower.trim(),
    );
  const { data: sessionState } = await admin
    .from("call_sessions")
    .select("extracted")
    .eq("id", context.callSessionId)
    .maybeSingle();
  const existingCollected = (sessionState?.extracted?.voice_collected ??
    {}) as Record<string, unknown>;
  const collected: Record<string, unknown> = {
    ...(scriptedName(callerText) ? { name: scriptedName(callerText) } : {}),
    ...(scriptedEmail(callerText)
      ? { email: scriptedEmail(callerText) }
      : {}),
    ...(scriptedPhone(callerText)
      ? { phone: scriptedPhone(callerText) }
      : {}),
    ...(scriptedAddress(callerText)
      ? { address: scriptedAddress(callerText) }
      : {}),
    ...(callerText.trim() &&
    !acknowledgement &&
    !endCall &&
    !existingCollected.service_need
      ? {
          service_need: callerText.trim().slice(0, 500),
          project_details: callerText.trim().slice(0, 1000),
        }
      : {}),
    ...(emergency ? { urgency: "emergency" } : {}),
    ...(scheduling && !acknowledgement && !endCall
      ? { appointment_preference: callerText.trim().slice(0, 300) }
      : {}),
  };

  if (Object.keys(collected).length > 0) {
    const saved = await executeVoiceTool(admin, context, {
      name: "save_contact_details",
      arguments: collected,
    });
    toolsUsed.push({ name: "save_contact_details", result: saved.result });
  }

  if (emergency) {
    const escalated = await executeVoiceTool(admin, context, {
      name: "escalate",
      arguments: {
        reason: callerText.slice(0, 500),
        urgency: "emergency",
      },
    });
    toolsUsed.push({ name: "escalate", result: escalated.result });
    return {
      ok: true,
      reply:
        "I marked this as urgent for the team. If anyone is in immediate danger, call emergency services now. I cannot transfer this call or promise a callback time.",
      toolsUsed,
      endCall: false,
    };
  }

  const proposed = Array.isArray(sessionState?.extracted?.proposed_slots)
    ? (sessionState.extracted.proposed_slots as {
        start_iso: string;
        label: string;
      }[])
    : [];
  const selecting =
    proposed.length > 0 &&
    /\b(?:that works|first one|second one|take the|book it|sounds good)\b/.test(
      lower,
    );

  if (selecting) {
    const chosen = /\bsecond\b/.test(lower)
      ? (proposed[1] ?? proposed[0])
      : proposed[0];
    const booking = await executeVoiceTool(admin, context, {
      name: "request_booking",
      arguments: { start_iso: chosen.start_iso },
    });
    toolsUsed.push({ name: "request_booking", result: booking.result });
    return {
      ok: true,
      reply: ["requested", "already_pending"].includes(String(booking.result.status))
        ? `Your request is awaiting team review. It still requires approval and confirmation before it is booked.`
        : "I could not save that booking request. Please contact the business directly to confirm a time.",
      toolsUsed,
      endCall: false,
    };
  }

  if (scheduling) {
    const slots = await executeVoiceTool(admin, context, {
      name: "propose_slots",
      arguments: { preference_text: callerText.slice(0, 500) },
    });
    toolsUsed.push({ name: "propose_slots", result: slots.result });
    const choices = Array.isArray(slots.result.slots)
      ? (slots.result.slots as { label?: string }[])
          .slice(0, 2)
          .map((slot) => slot.label)
          .filter(Boolean)
      : [];

    return {
      ok: true,
      reply:
        choices.length > 0
          ? `Based on what you said and the current calendar, I can offer ${choices.join(" or ")}. Which works better?`
          : "I saved your scheduling preference. The team needs to review availability before confirming a booking.",
      toolsUsed,
      endCall: false,
    };
  }

  if (endCall) {
    const ended = await executeVoiceTool(admin, context, {
      name: "end_call",
      arguments: { reason: "Caller finished the conversation." },
    });
    toolsUsed.push({ name: "end_call", result: ended.result });
    return {
      ok: true,
      reply: `Thanks for calling ${context.clientName}. The team has your information. Goodbye.`,
      toolsUsed,
      endCall: true,
    };
  }

  return {
    ok: true,
    reply:
      "I saved that for the team. What name, address, and preferred appointment time should I include?",
    toolsUsed,
    endCall: false,
  };
}

// One agent turn with the in-request tool loop: the model may call tools,
// we execute them against the REAL executors, feed results back, and
// repeat until it produces speech (or asks to end the call).
async function runAgentWithTools(args: {
  admin: SupabaseClient;
  toolContext: VoiceToolContext;
  instructions: string;
  messages: ChatMessage[];
  maxToolRounds?: number;
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
  const maxToolRounds = Math.max(
    1,
    Math.min(args.maxToolRounds ?? MAX_TOOL_ROUNDS, MAX_TOOL_ROUNDS),
  );

  for (let round = 0; round < maxToolRounds; round += 1) {
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

  const lastTool = toolsUsed.at(-1);
  let reply: string | null = null;

  if (lastTool?.name === "propose_slots") {
    const choices = Array.isArray(lastTool.result.slots)
      ? (lastTool.result.slots as { label?: string }[])
          .slice(0, 2)
          .map((slot) => slot.label)
          .filter(Boolean)
      : [];
    reply =
      choices.length > 0
        ? `I can offer ${choices.join(" or ")}. Which works better?`
        : "I saved your scheduling preference. The team needs to review availability before confirming a booking.";
  } else if (lastTool?.name === "request_booking") {
    reply = ["requested", "already_pending"].includes(String(lastTool.result.status))
      ? "Your request is awaiting team review. It requires approval and confirmation before it is booked."
      : "I could not save that booking request. Please contact the business directly to confirm a time.";
  } else if (lastTool?.name === "escalate") {
    reply =
      "I requested a callback from the team. I cannot transfer this call or promise a callback time.";
  } else if (lastTool?.name === "end_call") {
    reply = `Thanks for calling ${args.toolContext.clientName}. Goodbye.`;
  } else if (toolsUsed.length > 0) {
    reply =
      "I saved that for the team. What else should I include before they follow up?";
  }

  return { ok: true, reply, toolsUsed, endCall };
}

export async function startTextVoiceCall(
  admin: SupabaseClient,
  input: {
    clientId: string;
    provider: string;
    connectionId?: string | null;
    fromNumber?: string | null;
    toNumber?: string | null;
    externalRef?: string | null;
    handlingMode?: "ai_answered" | "staff_assisted";
    generateGreeting?: boolean;
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
    connectionId: input.connectionId,
    provider: input.provider,
    direction: "inbound",
    fromNumber: input.fromNumber ?? null,
    toNumber: input.toNumber ?? null,
    externalRef: input.externalRef ?? null,
    handlingMode: input.handlingMode ?? "ai_answered",
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

  const result = input.generateGreeting === false
    ? {
        ok: true as const,
        reply: null,
        toolsUsed: [],
        endCall: false,
      }
    : isOpenAIRealtimeConfigured()
    ? await runAgentWithTools({
        admin,
        toolContext: {
          callSessionId: session.id,
          partnerId: session.partner_id,
          clientId: session.client_id,
          clientName,
        },
        instructions,
        maxToolRounds:
          input.provider === "twilio_voice" ? 1 : MAX_TOOL_ROUNDS,
        messages: [
          {
            role: "user",
            content:
              "(The phone call has just connected. Greet the caller as the call answerer — do not wait for them to speak first.)",
          },
        ],
      })
    : {
        ok: true as const,
        reply: `Hi, you've reached ${clientName}. I'm the AI scheduling assistant. How can I help today?`,
        toolsUsed: [],
        endCall: false,
      };

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

export async function startSimulatedCall(
  admin: SupabaseClient,
  input: {
    clientId: string;
    fromNumber?: string | null;
  },
) {
  return startTextVoiceCall(admin, {
    ...input,
    provider: SIMULATED_PROVIDER,
  });
}

export async function runTextVoiceCallerTurn(
  admin: SupabaseClient,
  callSessionId: string,
  callerText: string,
  provider: string,
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

  if (!session || session.provider !== provider) {
    return { ok: false, error: "Voice call session not found." };
  }

  if (session.status !== "in_progress") {
    return { ok: false, error: "This voice call has already ended." };
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
        "We have reached the call time limit. I will save your request for the team. Thank you for calling.",
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

  const toolContext = {
    callSessionId,
    partnerId: session.partner_id,
    clientId: session.client_id,
    clientName,
  };
  const result = isOpenAIRealtimeConfigured()
    ? await runAgentWithTools({
        admin,
        toolContext,
        instructions,
        maxToolRounds:
          provider === "twilio_voice" ? 1 : MAX_TOOL_ROUNDS,
        messages: turns.map((turn) => ({
          role:
            turn.role === "caller" ? ("user" as const) : ("assistant" as const),
          content: turn.content,
        })),
      })
    : await runScriptedAgentTurn(admin, toolContext, callerText);

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

export async function runSimulatedCallerTurn(
  admin: SupabaseClient,
  callSessionId: string,
  callerText: string,
) {
  return runTextVoiceCallerTurn(
    admin,
    callSessionId,
    callerText,
    SIMULATED_PROVIDER,
  );
}

// Complete the call through the real pipeline, then report everything it
// produced so the whole voice workflow is verifiable in one response.
export async function completeTextVoiceCall(
  admin: SupabaseClient,
  callSessionId: string,
  provider: string,
): Promise<
  | { ok: true; report: Record<string, unknown> }
  | { ok: false; error: string }
> {
  const session = await loadSession(admin, callSessionId);

  if (!session || session.provider !== provider) {
    return { ok: false, error: "Voice call session not found." };
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

export async function completeSimulatedCall(
  admin: SupabaseClient,
  callSessionId: string,
) {
  return completeTextVoiceCall(admin, callSessionId, SIMULATED_PROVIDER);
}
