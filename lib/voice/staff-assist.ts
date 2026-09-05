import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { generateStructured, isAIConfigured } from "@/lib/ai/provider";
import {
  buildKnowledgeBlock,
  getKnowledgeProfile,
  KNOWLEDGE_GUARDRAILS,
} from "@/lib/knowledge/profile";
import { updateCallSessionExtracted } from "@/lib/voice/sessions";
import { executeVoiceTool, type VoiceToolContext } from "@/lib/voice/tools";

const StaffAssistSchema = z.object({
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  service_need: z.string().nullable(),
  project_details: z.string().nullable(),
  urgency: z.enum(["emergency", "high", "medium", "low"]),
  appointment_intent: z.boolean(),
  appointment_preference: z.string().nullable(),
  missing_fields: z.array(z.string()),
  recommended_next_question: z.string(),
  live_summary: z.string(),
});

export type StaffAssist = z.infer<typeof StaffAssistSchema> & {
  source: "ai" | "fallback";
  slots: { label: string; start_iso: string; end_iso: string }[];
};

function firstMatch(text: string, pattern: RegExp): string | null {
  return text.match(pattern)?.[1]?.trim() ?? null;
}

function fallbackAssist(
  turns: { role: string; content: string }[],
  fromNumber: string | null,
  knownContact: {
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
  } | null,
): z.infer<typeof StaffAssistSchema> {
  const callerText = turns
    .filter((turn) => turn.role === "caller")
    .map((turn) => turn.content)
    .join(" ");
  const latest =
    [...turns].reverse().find((turn) => turn.role === "caller")?.content ?? "";
  const email = firstMatch(
    callerText,
    /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i,
  );
  const statedPhone = firstMatch(
    callerText,
    /(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/,
  );
  const address = firstMatch(
    callerText,
    /\b(\d{1,6}\s+[A-Za-z0-9.' -]+\s+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct)\b)/i,
  );
  const statedName =
    firstMatch(callerText, /\b(?:my name is|this is|i'?m)\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+)?)/i) ??
    null;
  const knownName = knownContact
    ? [knownContact.first_name, knownContact.last_name]
        .filter(Boolean)
        .join(" ") || null
    : null;
  const name = statedName ?? knownName;
  const resolvedAddress = address ?? knownContact?.address ?? null;
  const appointmentIntent =
    /\b(schedule|appointment|book|come out|availability|available|morning|afternoon|evening)\b/i.test(
      callerText,
    );
  const urgency = /\b(fire|gas leak|flood|flooding|burst|sparking|emergency)\b/i.test(
    callerText,
  )
    ? "emergency"
    : /\b(urgent|leak|leaking|no heat|no water|today|as soon as possible)\b/i.test(
          callerText,
        )
      ? "high"
      : "medium";
  const missingFields = [
    ["customer name", name],
    ["service address", resolvedAddress],
    ["service need", callerText ? latest : null],
  ]
    .filter(([, value]) => !value)
    .map(([label]) => label as string);

  return {
    name,
    phone: statedPhone ?? knownContact?.phone ?? fromNumber,
    email: email ?? knownContact?.email ?? null,
    address: resolvedAddress,
    service_need: callerText ? latest.slice(0, 500) : null,
    project_details: callerText ? callerText.slice(0, 1_500) : null,
    urgency,
    appointment_intent: appointmentIntent,
    appointment_preference: appointmentIntent ? latest : null,
    missing_fields: missingFields,
    recommended_next_question:
      missingFields.length > 0
        ? `Ask for the ${missingFields[0]}.`
        : appointmentIntent
          ? "Confirm which available appointment works best."
          : "Confirm the best next step before ending the call.",
    live_summary: latest || "Listening for the customer’s service need.",
  };
}

export async function analyzeStaffCall(
  admin: SupabaseClient,
  callSessionId: string,
): Promise<StaffAssist | null> {
  const { data: claim, error: claimError } = await admin.rpc("claim_staff_voice_analysis", {
    p_session_id: callSessionId,
  });
  if (claimError || !claim) return null;
  try {
  const { data: session } = await admin
    .from("call_sessions")
    .select(
      "id, partner_id, client_id, from_number, status, matched_contact_id",
    )
    .eq("id", callSessionId)
    .maybeSingle();

  if (!session || session.status !== "in_progress") return null;

  const [{ data: client }, { data: turnsData }, { data: knownContact }] =
    await Promise.all([
    admin
      .from("client_businesses")
      .select("name")
      .eq("id", session.client_id)
      .maybeSingle(),
    admin
      .from("call_transcript_turns")
      .select("role, content")
      .eq("call_session_id", callSessionId)
      .order("seq", { ascending: false })
      .limit(120),
    session.matched_contact_id
      ? admin
          .from("crm_contacts")
          .select("first_name, last_name, phone, email, address")
          .eq("id", session.matched_contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const turns = ((turnsData ?? []) as { role: string; content: string }[]).reverse();
  const fallback = fallbackAssist(turns, session.from_number, knownContact);
  let analysis = fallback;
  let source: StaffAssist["source"] = "fallback";

  if (isAIConfigured() && turns.length > 0) {
    try {
      const knowledge = await getKnowledgeProfile(admin, session.client_id);
      const result = await generateStructured({
        taskKey: "staff_call_live_assist",
        tenant: { partnerId: session.partner_id, clientId: session.client_id },
        system: `You assist a staff member during a live customer phone call.

${KNOWLEDGE_GUARDRAILS}

Extract only facts the caller actually stated. Keep live_summary to one concise sentence. missing_fields should include only information the staff member still needs to handle this service request. recommended_next_question must be one short, useful question. Detect scheduling intent and preserve the caller's timing constraints exactly.`,
        user: `${buildKnowledgeBlock(client?.name ?? "the business", knowledge)}

Known CRM customer:
${knownContact ? JSON.stringify(knownContact) : "No existing contact was matched."}

Live transcript:
${turns.map((turn) => `${turn.role}: ${turn.content}`).join("\n").slice(0, 16_000)}`,
        schema: StaffAssistSchema,
        maxTokens: 1_200,
      });
      analysis = result.data;
      source = "ai";
    } catch {
      analysis = fallback;
    }
  }

  const toolContext: VoiceToolContext = {
    callSessionId,
    partnerId: session.partner_id,
    clientId: session.client_id,
    clientName: client?.name ?? "the business",
  };

  await executeVoiceTool(admin, toolContext, {
    name: "save_contact_details",
    arguments: {
      name: analysis.name,
      phone: analysis.phone,
      email: analysis.email,
      address: analysis.address,
      service_need: analysis.service_need,
      project_details: analysis.project_details,
      urgency: analysis.urgency,
      appointment_preference: analysis.appointment_preference,
    },
  });

  let slots: StaffAssist["slots"] = [];

  if (analysis.appointment_intent) {
    const proposed = await executeVoiceTool(admin, toolContext, {
      name: "propose_slots",
      arguments: {
        preference_text:
          analysis.appointment_preference ?? analysis.service_need ?? "",
      },
    });
    const rawSlots = proposed.result.slots;

    if (Array.isArray(rawSlots)) {
      slots = rawSlots
        .map((slot) => slot as Record<string, unknown>)
        .filter(
          (slot) =>
            typeof slot.label === "string" &&
            typeof slot.start_iso === "string" &&
            typeof slot.end_iso === "string",
        )
        .map((slot) => ({
          label: slot.label as string,
          start_iso: slot.start_iso as string,
          end_iso: slot.end_iso as string,
        }));
    }
  }

  await updateCallSessionExtracted(admin, callSessionId, {
    staff_assist: {
      live_summary: analysis.live_summary,
      missing_fields: analysis.missing_fields,
      recommended_next_question: analysis.recommended_next_question,
      source,
    },
  });

  return { ...analysis, source, slots };
  } finally {
    await admin.from("call_sessions").update({ staff_analysis_lease_until: null })
      .eq("id", callSessionId).eq("staff_analysis_claim", claim);
  }

}
