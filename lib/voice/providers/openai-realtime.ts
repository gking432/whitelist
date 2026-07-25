// OpenAI Realtime voice provider (docs/21). Adapted from the Northstar CRM
// demo's realtime architecture (session minting, event handling, prompt
// style) into the multi-tenant platform:
// - The API key NEVER leaves the server; browsers/SIP bridges get only a
//   short-lived client secret minted here.
// - Instructions are built per client from the approved Knowledge profile —
//   no personas, businesses, or scenarios are hardcoded.
// - The agent acts through tools (lib/voice/tools.ts) that hit Northstar's
//   real actions with the same tenancy/approval/audit rules as everything
//   else. It can REQUEST bookings and messages; humans approve them.

import type { KnowledgeProfile } from "@/lib/knowledge/profile";
import {
  buildKnowledgeBlock,
  KNOWLEDGE_GUARDRAILS,
} from "@/lib/knowledge/profile";

// gpt-realtime is the full ChatGPT-voice-quality model; gpt-realtime-mini
// is the cheaper option. Configurable via OPENAI_REALTIME_MODEL.
const DEFAULT_REALTIME_MODEL = "gpt-realtime";
const DEFAULT_REALTIME_VOICE = "marin";
// Text model used by the simulated-call harness (same instructions+tools,
// text transport instead of audio).
const DEFAULT_SIM_MODEL = "gpt-4o-mini";

export function getOpenAIKey(): string | null {
  return process.env.OPENAI_API_KEY?.trim() || null;
}

export function getRealtimeModel(): string {
  return process.env.OPENAI_REALTIME_MODEL?.trim() || DEFAULT_REALTIME_MODEL;
}

export function getRealtimeVoice(): string {
  return process.env.OPENAI_REALTIME_VOICE?.trim() || DEFAULT_REALTIME_VOICE;
}

export function getSimulationModel(): string {
  return process.env.OPENAI_SIM_MODEL?.trim() || DEFAULT_SIM_MODEL;
}

export function isOpenAIRealtimeConfigured(): boolean {
  return Boolean(getOpenAIKey());
}

// ---------------------------------------------------------------------------
// Instructions. Deliberately SHORT (demo lesson: realtime models sound
// natural with a light touch; over-scripting makes them robotic). Persona +
// known facts + turn-taking + hard boundaries, all from tenant data.
// ---------------------------------------------------------------------------

const TURN_TAKING = `CRITICAL — this is a phone call, so take turns like a human:
- Say ONE short thing, then STOP and let them respond. Never stack two of your own messages in a row.
- Don't read lists or dump several facts at once. One question or statement at a time.
- Actually wait for their answer before moving on.`;

export type VoiceAgentContext = {
  clientName: string;
  knowledge: KnowledgeProfile | null;
  disclosureMode: "off" | "explicit" | "minimal";
  matchedContact: {
    name: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
  } | null;
  direction: "inbound" | "outbound";
};

export function buildVoiceAgentInstructions(
  context: VoiceAgentContext,
): string {
  const disclosure =
    context.disclosureMode === "explicit"
      ? (context.knowledge?.ai_disclosure ??
        `Open by disclosing you are an AI: "Hi, you've reached ${context.clientName} — I'm their AI assistant. I can get you booked in, or press on and a human will call you back."`)
      : `If asked, say honestly that you are an AI assistant. Do not volunteer it otherwise.`;

  const knownFacts = context.matchedContact
    ? `This caller matches an existing customer record — greet them accordingly and do NOT re-ask what we already know:
${[
  context.matchedContact.name && `- Name: ${context.matchedContact.name}`,
  context.matchedContact.phone && `- Phone: ${context.matchedContact.phone}`,
  context.matchedContact.email && `- Email: ${context.matchedContact.email}`,
  context.matchedContact.address &&
    `- Address: ${context.matchedContact.address}`,
]
  .filter(Boolean)
  .join("\n")}`
    : `This caller is not matched to an existing record. Collect naturally, one thing at a time, as the conversation allows: name, phone, email, address, what they need done, how urgent it is, project details, and appointment preferences. Use the save_contact_details tool as you learn things.`;

  return `You are the phone assistant for ${context.clientName}, a home service business. Talk like a warm, genuine person on the phone — natural, relaxed, brief.

${disclosure}

${knownFacts}

Scheduling: when the caller wants a visit, use the propose_slots tool to get REAL open times, offer at most two of them, and NEVER invent or agree to any time that the tool did not return. When they pick one, use request_booking with that exact slot — then tell them the team will confirm it shortly. You request bookings; a human approves them. Never claim anything is finally booked.

Tools: use lookup_contact early if you have a phone or email. Use add_note for anything the team should know. If the caller is upset, asks for a human, or the situation matches the escalation rules, use escalate and tell them a person will call back.

${TURN_TAKING}

${KNOWLEDGE_GUARDRAILS}

${buildKnowledgeBlock(context.clientName, context.knowledge)}`;
}

// ---------------------------------------------------------------------------
// Ephemeral session minting (GA API with beta fallback, adapted from the
// demo). Used by future browser call windows and SIP bridges — the caller
// gets a short-lived client secret, never the API key.
// ---------------------------------------------------------------------------

export type RealtimeMint = {
  ok: true;
  clientSecret: string;
  webrtcUrl: string;
  api: "ga" | "beta";
  model: string;
};

export type RealtimeMintFailure = { ok: false; error: string };

export async function mintRealtimeClientSecret(args: {
  instructions: string;
  tools?: Record<string, unknown>[];
}): Promise<RealtimeMint | RealtimeMintFailure> {
  const apiKey = getOpenAIKey();

  if (!apiKey) {
    return { ok: false, error: "OPENAI_API_KEY is not configured." };
  }

  const model = getRealtimeModel();
  const voice = getRealtimeVoice();

  // GA mint first.
  try {
    const session: Record<string, unknown> = {
      type: "realtime",
      model,
      instructions: args.instructions,
      audio: {
        input: {
          transcription: { model: "gpt-4o-mini-transcribe" },
          // Server-side VAD so the assistant waits for the caller to finish.
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 800,
          },
        },
        output: { voice },
      },
    };

    if (args.tools && args.tools.length > 0) {
      session.tools = args.tools;
      session.tool_choice = "auto";
    }

    const response = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ session }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    const text = await response.text();

    if (response.ok) {
      const data = JSON.parse(text) as {
        value?: string;
        client_secret?: { value?: string };
      };
      const value = data.value ?? data.client_secret?.value;

      if (value) {
        return {
          ok: true,
          clientSecret: value,
          webrtcUrl: `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`,
          api: "ga",
          model,
        };
      }
    }
  } catch {
    // fall through to beta
  }

  // Beta fallback (older projects).
  try {
    const betaVoice = ["cedar", "marin"].includes(voice) ? "sage" : voice;
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1",
      },
      body: JSON.stringify({
        model,
        instructions: args.instructions,
        voice: betaVoice,
        input_audio_transcription: { model: "whisper-1" },
        ...(args.tools && args.tools.length > 0
          ? { tools: args.tools, tool_choice: "auto" }
          : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const text = await response.text();

    if (response.ok) {
      const data = JSON.parse(text) as { client_secret?: { value?: string } };
      const value = data.client_secret?.value;

      if (value) {
        return {
          ok: true,
          clientSecret: value,
          webrtcUrl: `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
          api: "beta",
          model,
        };
      }
    }

    return {
      ok: false,
      error: `Realtime session mint failed (${response.status}).`,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Realtime mint request failed.",
    };
  }
}

// ---------------------------------------------------------------------------
// Simulated agent turns: the same instructions + tools over text transport
// (chat completions with tool calling). This is what the dev harness uses
// to exercise the FULL call pipeline before any phone bridge exists.
// ---------------------------------------------------------------------------

export type SimulatedToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type SimulatedTurnResult =
  | {
      ok: true;
      text: string | null;
      toolCalls: SimulatedToolCall[];
    }
  | { ok: false; error: string };

type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export async function runSimulatedAgentTurn(args: {
  instructions: string;
  messages: ChatMessage[];
  tools: Record<string, unknown>[];
}): Promise<SimulatedTurnResult> {
  const apiKey = getOpenAIKey();

  if (!apiKey) {
    return { ok: false, error: "OPENAI_API_KEY is not configured." };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getSimulationModel(),
        messages: [
          { role: "system", content: args.instructions },
          ...args.messages,
        ],
        tools: args.tools.map((tool) => ({ type: "function", function: tool })),
        tool_choice: "auto",
        max_tokens: 400,
      }),
      // Twilio Voice webhooks have a hard 15-second response ceiling. Keep
      // the model call below that so the route still has time for tools and
      // a TwiML response.
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `OpenAI returned ${response.status} for the simulated turn.`,
      };
    }

    const body = (await response.json()) as {
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: {
            id: string;
            function: { name: string; arguments: string };
          }[];
        };
      }[];
    };

    const message = body.choices?.[0]?.message;
    const toolCalls: SimulatedToolCall[] = (message?.tool_calls ?? []).map(
      (call) => {
        let parsed: Record<string, unknown> = {};

        try {
          parsed = JSON.parse(call.function.arguments) as Record<
            string,
            unknown
          >;
        } catch {
          parsed = {};
        }

        return { id: call.id, name: call.function.name, arguments: parsed };
      },
    );

    return {
      ok: true,
      text: message?.content?.trim() || null,
      toolCalls,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Simulated turn failed.",
    };
  }
}

export async function testOpenAIRealtimeConnection(): Promise<{
  ok: boolean;
  detail: string;
}> {
  const apiKey = getOpenAIKey();

  if (!apiKey) {
    return { ok: false, detail: "OPENAI_API_KEY is not configured." };
  }

  try {
    const response = await fetch(
      `https://api.openai.com/v1/models/${encodeURIComponent(getRealtimeModel())}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (response.ok) {
      return {
        ok: true,
        detail: `OpenAI key accepted; model ${getRealtimeModel()} is available.`,
      };
    }

    if (response.status === 404) {
      return {
        ok: false,
        detail: `The key works but model ${getRealtimeModel()} is not available to this project — set OPENAI_REALTIME_MODEL to one you have access to.`,
      };
    }

    return {
      ok: false,
      detail:
        response.status === 401
          ? "OpenAI rejected the API key."
          : `OpenAI returned ${response.status}.`,
    };
  } catch {
    return { ok: false, detail: "Could not reach OpenAI." };
  }
}
