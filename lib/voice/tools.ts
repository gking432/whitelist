import type { SupabaseClient } from "@supabase/supabase-js";

import { emitAssistantEvent } from "@/lib/assistant/events";
import { redactAuditValue } from "@/lib/audit/redact";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import {
  getBusyIntervals,
  type GoogleCalendarCredentials,
} from "@/lib/integrations/providers/google-calendar";
import { getGoogleWorkspaceBusyIntervals } from "@/lib/integrations/providers/google-workspace";
import { getMicrosoftBusyIntervals } from "@/lib/integrations/providers/microsoft-365";
import type { WorkspaceCredentials } from "@/lib/integrations/providers/workspace-oauth";
import { getKnowledgeProfile } from "@/lib/knowledge/profile";
import {
  describeConstraints,
  parseSchedulingConstraints,
} from "@/lib/scheduling/constraints";
import { computeOpenSlots, formatSlotLabel } from "@/lib/scheduling/slots";
import {
  EXTERNAL_CALENDAR_PROVIDER_KEYS,
  type ExternalCalendarProvider,
} from "@/lib/scheduling/provider";

// Voice agent tools (docs/21). The OpenAI Realtime agent (and the
// simulated harness) act ONLY through these executors, which hit the same
// Northstar rails as every other surface:
// - Bookings and customer messages become PENDING approval items — the
//   agent requests, a human approves, and delivery/booking still checks
//   live mode at execution time. The agent can never send or book directly.
// - Every write is tenant-scoped by the call session's partner/client and
//   attributed to the ai_assistant actor.
// - Everything the agent does mid-call is appended to the call session's
//   tool log (redacted), so the audit trail survives the call.

export type VoiceToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

// One canonical definition list. The simulated harness passes these to
// chat completions (wrapped as {type:"function", function}); the realtime
// session flattens them ({type:"function", ...def}) via toRealtimeTools.
export const VOICE_TOOL_DEFINITIONS: VoiceToolDefinition[] = [
  {
    name: "lookup_contact",
    description:
      "Look up an existing customer record by phone number or email. Use early in the call when you learn either one, so you do not re-ask for details we already have.",
    parameters: {
      type: "object",
      properties: {
        phone: { type: "string", description: "Phone number as the caller stated it." },
        email: { type: "string", description: "Email address." },
      },
      required: [],
    },
  },
  {
    name: "save_contact_details",
    description:
      "Save details the caller shares (name, phone, email, address, what they need, urgency, project details, appointment preferences). Call this as you learn things — it is how the team gets the information after the call.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        address: { type: "string" },
        service_need: {
          type: "string",
          description: "What the caller needs done, in their words.",
        },
        urgency: {
          type: "string",
          enum: ["emergency", "high", "medium", "low"],
        },
        project_details: {
          type: "string",
          description: "Any extra job details worth passing to the team.",
        },
        appointment_preference: {
          type: "string",
          description:
            "When the caller prefers a visit, e.g. 'mornings', 'after 5', 'not tomorrow'.",
        },
      },
      required: [],
    },
  },
  {
    name: "add_note",
    description:
      "Leave a short internal note for the team about something on this call that the other tools do not capture.",
    parameters: {
      type: "object",
      properties: {
        note: { type: "string", description: "The note, 1-3 sentences." },
      },
      required: ["note"],
    },
  },
  {
    name: "propose_slots",
    description:
      "Get REAL open appointment slots from the business calendar. Offer the caller at most two of the returned slots. Never offer a time this tool did not return.",
    parameters: {
      type: "object",
      properties: {
        preference_text: {
          type: "string",
          description:
            "The caller's timing preference in their words, e.g. 'after 5 on a weekday'.",
        },
      },
      required: [],
    },
  },
  {
    name: "request_booking",
    description:
      "Request a booking for a slot the caller picked. The slot MUST be one returned by propose_slots (exact start_iso). This creates a request for the team to approve — tell the caller the team will confirm shortly; never say it is booked.",
    parameters: {
      type: "object",
      properties: {
        start_iso: {
          type: "string",
          description: "start_iso of the chosen slot, exactly as returned by propose_slots.",
        },
      },
      required: ["start_iso"],
    },
  },
  {
    name: "request_confirmation_message",
    description:
      "Draft a follow-up SMS or email to the caller (e.g. confirming what was discussed, or written details they asked for). The draft goes to the team for approval before anything is sent — tell the caller it will come from the team shortly.",
    parameters: {
      type: "object",
      properties: {
        channel: { type: "string", enum: ["sms", "email"] },
        to: {
          type: "string",
          description: "The caller's phone number (sms) or email address (email).",
        },
        subject: {
          type: "string",
          description: "Email subject. Ignored for SMS.",
        },
        body: { type: "string", description: "The message text." },
      },
      required: ["channel", "to", "body"],
    },
  },
  {
    name: "escalate",
    description:
      "Flag this call for immediate human follow-up: the caller is upset, asks for a person, or the situation matches the business's escalation or emergency rules. Tell the caller a person will call them back.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Why this needs a human." },
        urgency: {
          type: "string",
          enum: ["emergency", "high", "medium", "low"],
        },
      },
      required: ["reason"],
    },
  },
  {
    name: "end_call",
    description:
      "End the call after you have said goodbye. Use once the caller's needs are handled or they say they are done.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "One line on why the call is ending.",
        },
      },
      required: [],
    },
  },
];

// Realtime GA session tools are flat function objects (no nested
// `function` wrapper like chat completions).
export function toRealtimeTools(
  definitions: VoiceToolDefinition[] = VOICE_TOOL_DEFINITIONS,
): Record<string, unknown>[] {
  return definitions.map((definition) => ({
    type: "function",
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
  }));
}

export type VoiceToolContext = {
  callSessionId: string;
  partnerId: string;
  clientId: string;
  clientName: string;
};

export type VoiceToolOutcome = {
  // JSON-serializable result handed back to the model as the tool output.
  result: Record<string, unknown>;
  // Signals the transport (harness or realtime bridge) to hang up and run
  // completeCallSession.
  endCall?: boolean;
};

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function getSession(admin: SupabaseClient, callSessionId: string) {
  const { data } = await admin
    .from("call_sessions")
    .select("id, partner_id, client_id, matched_contact_id, extracted, from_number, status")
    .eq("id", callSessionId)
    .maybeSingle();

  return data as {
    id: string;
    partner_id: string;
    client_id: string;
    matched_contact_id: string | null;
    extracted: Record<string, unknown>;
    from_number: string | null;
    status: string;
  } | null;
}

// Read-modify-write merge into call_sessions.extracted. The voice tools
// are the only writer while a call is in progress, so last-write-wins per
// call is fine; completeCallSession later merges its own summary fields.
async function mergeExtracted(
  admin: SupabaseClient,
  callSessionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const session = await getSession(admin, callSessionId);

  if (!session) {
    return;
  }

  await admin
    .from("call_sessions")
    .update({
      extracted: redactAuditValue({ ...session.extracted, ...patch }),
    })
    .eq("id", callSessionId);
}

async function appendToolLog(
  admin: SupabaseClient,
  callSessionId: string,
  entry: Record<string, unknown>,
): Promise<void> {
  const session = await getSession(admin, callSessionId);

  if (!session) {
    return;
  }

  const log = Array.isArray(session.extracted.tool_log)
    ? (session.extracted.tool_log as unknown[])
    : [];

  await admin
    .from("call_sessions")
    .update({
      extracted: redactAuditValue({
        ...session.extracted,
        tool_log: [...log.slice(-49), { ...entry, at: new Date().toISOString() }],
      }),
    })
    .eq("id", callSessionId);
}

type ProposedSlot = { start_iso: string; end_iso: string; label: string };

async function lookupContact(
  admin: SupabaseClient,
  context: VoiceToolContext,
  args: Record<string, unknown>,
): Promise<VoiceToolOutcome> {
  const phone = asTrimmedString(args.phone);
  const email = asTrimmedString(args.email);

  if (!phone && !email) {
    return {
      result: { found: false, note: "Provide a phone or email to look up." },
    };
  }

  let contact: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
  } | null = null;

  if (email) {
    const { data } = await admin
      .from("crm_contacts")
      .select("id, first_name, last_name, email, phone, address")
      .eq("client_id", context.clientId)
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    contact = data;
  }

  if (!contact && phone) {
    const { data } = await admin
      .from("crm_contacts")
      .select("id, first_name, last_name, email, phone, address")
      .eq("client_id", context.clientId)
      .eq("phone", phone)
      .limit(1)
      .maybeSingle();

    contact = data;
  }

  if (!contact) {
    return { result: { found: false } };
  }

  await admin
    .from("call_sessions")
    .update({ matched_contact_id: contact.id })
    .eq("id", context.callSessionId);

  return {
    result: {
      found: true,
      name:
        [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
        null,
      phone: contact.phone,
      email: contact.email,
      address: contact.address,
    },
  };
}

async function saveContactDetails(
  admin: SupabaseClient,
  context: VoiceToolContext,
  args: Record<string, unknown>,
): Promise<VoiceToolOutcome> {
  const session = await getSession(admin, context.callSessionId);

  if (!session) {
    return { result: { saved: false, error: "Call session not found." } };
  }

  const name = asTrimmedString(args.name);
  const phone = asTrimmedString(args.phone) ?? session.from_number;
  const email = asTrimmedString(args.email);
  const address = asTrimmedString(args.address);

  // Everything lands on the session so completeCallSession's summary and
  // the call.completed intake event carry it even if no contact exists.
  const collected = {
    ...(typeof session.extracted.voice_collected === "object" &&
    session.extracted.voice_collected !== null
      ? (session.extracted.voice_collected as Record<string, unknown>)
      : {}),
    ...(name ? { name } : {}),
    ...(asTrimmedString(args.phone) ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(address ? { address } : {}),
    ...(asTrimmedString(args.service_need)
      ? { service_need: asTrimmedString(args.service_need) }
      : {}),
    ...(asTrimmedString(args.urgency)
      ? { urgency: asTrimmedString(args.urgency) }
      : {}),
    ...(asTrimmedString(args.project_details)
      ? { project_details: asTrimmedString(args.project_details) }
      : {}),
    ...(asTrimmedString(args.appointment_preference)
      ? { appointment_preference: asTrimmedString(args.appointment_preference) }
      : {}),
  };

  await mergeExtracted(admin, context.callSessionId, {
    voice_collected: collected,
  });

  let contactId = session.matched_contact_id;
  let contactAction: "created" | "updated" | "none" = "none";

  if (contactId) {
    // Additive: only fill fields that are currently empty.
    const { data: existing } = await admin
      .from("crm_contacts")
      .select("first_name, last_name, email, phone, address")
      .eq("id", contactId)
      .maybeSingle();

    if (existing) {
      const [firstName, ...rest] = (name ?? "").split(/\s+/);
      const patch: Record<string, string> = {};

      if (!existing.first_name && firstName) patch.first_name = firstName;
      if (!existing.last_name && rest.length > 0)
        patch.last_name = rest.join(" ");
      if (!existing.email && email) patch.email = email;
      if (!existing.phone && phone) patch.phone = phone;
      if (!existing.address && address) patch.address = address;

      if (Object.keys(patch).length > 0) {
        await admin.from("crm_contacts").update(patch).eq("id", contactId);
        contactAction = "updated";
      }
    }
  } else if (phone || email) {
    const [firstName, ...rest] = (name ?? "").split(/\s+/);
    const { data: created } = await admin
      .from("crm_contacts")
      .insert({
        partner_id: context.partnerId,
        client_id: context.clientId,
        first_name: firstName || null,
        last_name: rest.length > 0 ? rest.join(" ") : null,
        email,
        phone,
        address,
        source: "call.completed",
      })
      .select("id")
      .single();

    if (created) {
      contactId = created.id;
      contactAction = "created";
      await admin
        .from("call_sessions")
        .update({ matched_contact_id: contactId })
        .eq("id", context.callSessionId);
    }
  }

  return {
    result: {
      saved: true,
      contact: contactAction,
    },
  };
}

async function addNote(
  admin: SupabaseClient,
  context: VoiceToolContext,
  args: Record<string, unknown>,
): Promise<VoiceToolOutcome> {
  const note = asTrimmedString(args.note);

  if (!note) {
    return { result: { saved: false, error: "The note was empty." } };
  }

  const session = await getSession(admin, context.callSessionId);
  const notes = Array.isArray(session?.extracted.call_notes)
    ? (session.extracted.call_notes as unknown[])
    : [];

  await mergeExtracted(admin, context.callSessionId, {
    call_notes: [...notes.slice(-19), note],
  });

  if (session?.matched_contact_id) {
    await admin.from("crm_timeline_entries").insert({
      partner_id: context.partnerId,
      client_id: context.clientId,
      contact_id: session.matched_contact_id,
      kind: "note",
      actor_type: "ai_assistant",
      title: "AI Assistant noted during a call",
      body: note,
    });
  }

  return { result: { saved: true } };
}

async function proposeSlots(
  admin: SupabaseClient,
  context: VoiceToolContext,
  args: Record<string, unknown>,
): Promise<VoiceToolOutcome> {
  const { data: client } = await admin
    .from("client_businesses")
    .select("timezone")
    .eq("id", context.clientId)
    .maybeSingle();
  const timezone = client?.timezone ?? "America/New_York";
  const knowledge = await getKnowledgeProfile(admin, context.clientId);
  const constraints = parseSchedulingConstraints(
    asTrimmedString(args.preference_text) ?? "",
  );
  const constraintsDescription = describeConstraints(constraints);
  const now = new Date();
  const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const { data: connection } = await admin
    .from("integration_connections")
    .select(
      "id, runtime_mode, status, provider:integration_providers!inner(provider_key)",
    )
    .eq("client_id", context.clientId)
    .eq("partner_id", context.partnerId)
    .in("status", ["connected", "needs_attention"])
    .in("provider.provider_key", [...EXTERNAL_CALENDAR_PROVIDER_KEYS])
    .limit(1)
    .maybeSingle();

  try {
    let busy: { start: string; end: string }[];
    let source: ExternalCalendarProvider | "northstar_internal";
    let businessStartHour = knowledge?.booking_hours_start ?? 9;
    let businessEndHour = knowledge?.booking_hours_end ?? 17;
    let durationMinutes = knowledge?.appointment_duration_minutes ?? 60;

    if (connection) {
      const credentials =
        await readProviderCredentials<GoogleCalendarCredentials & WorkspaceCredentials>(
          admin,
          connection.id,
        );

      if (!credentials?.refreshToken) {
        throw new Error("Calendar authorization is incomplete.");
      }

      const providerKey = (connection.provider as unknown as { provider_key?: string } | null)?.provider_key as ExternalCalendarProvider | undefined;
      source = providerKey ?? "google_calendar";
      busy = source === "microsoft_365"
        ? await getMicrosoftBusyIntervals(credentials, now.toISOString(), weekOut.toISOString())
        : source === "google_workspace"
          ? await getGoogleWorkspaceBusyIntervals(credentials, now.toISOString(), weekOut.toISOString())
          : await getBusyIntervals(credentials, now.toISOString(), weekOut.toISOString());
    } else {
      const [{ data: appointments }, { data: windows }] = await Promise.all([
        admin
          .from("crm_appointments")
          .select("start_at, end_at")
          .eq("client_id", context.clientId)
          .in("status", ["proposed", "booked"])
          .gte("end_at", now.toISOString())
          .lte("start_at", weekOut.toISOString()),
        admin
          .from("crm_availability_windows")
          .select("start_time, end_time, appointment_minutes")
          .eq("client_id", context.clientId)
          .eq("active", true)
          .order("start_time", { ascending: true }),
      ]);

      busy = (appointments ?? []).map((appointment) => ({
        start: appointment.start_at,
        end: appointment.end_at,
      }));
      source = "northstar_internal";

      if (windows && windows.length > 0) {
        const startHours = windows.map((window) =>
          Number(String(window.start_time).slice(0, 2)),
        );
        const endHours = windows.map((window) =>
          Number(String(window.end_time).slice(0, 2)),
        );
        businessStartHour = Math.min(...startHours);
        businessEndHour = Math.max(...endHours);
        durationMinutes = windows[0].appointment_minutes ?? durationMinutes;
      }
    }

    let slots = computeOpenSlots(busy, {
      timezone,
      maxSlots: 3,
      businessStartHour,
      businessEndHour,
      durationMinutes,
      constraints,
    });

    let constraintsRelaxed = false;

    if (slots.length === 0 && constraintsDescription) {
      slots = computeOpenSlots(busy, {
        timezone,
        maxSlots: 3,
        businessStartHour,
        businessEndHour,
        durationMinutes,
      });
      constraintsRelaxed = slots.length > 0;
    }

    if (slots.length === 0) {
      return {
        result: {
          status: "no_slots",
          say: "Nothing is open in the next week. Offer to have the team call back to find a time.",
        },
      };
    }

    const labeled: ProposedSlot[] = slots.map((slot) => ({
      start_iso: slot.startIso,
      end_iso: slot.endIso,
      label: formatSlotLabel(slot.startIso, timezone),
    }));

    // Remembered on the session so request_booking can verify the caller's
    // pick is a slot we actually offered — the agent cannot book times the
    // calendar never returned.
    await mergeExtracted(admin, context.callSessionId, {
      proposed_slots: labeled,
      proposed_slots_timezone: timezone,
      proposed_slots_connection_id: connection?.id ?? null,
      proposed_slots_provider: source,
      proposed_slots_constraints: constraintsDescription || null,
      proposed_slots_constraints_relaxed: constraintsRelaxed,
    });

    return {
      result: {
        status: "ok",
        source,
        timezone,
        slots: labeled,
        ...(constraintsRelaxed
          ? {
              note: `Nothing was open matching "${constraintsDescription}" — these ignore that preference; tell the caller honestly.`,
            }
          : constraintsDescription
            ? { note: `These honor the caller's preference (${constraintsDescription}).` }
            : {}),
      },
    };
  } catch (error) {
    return {
      result: {
        status: "failed",
        error:
          error instanceof Error ? error.message : "Slot lookup failed.",
        say: "You cannot see the calendar right now. Offer a callback from the team to set a time.",
      },
    };
  }
}

async function requestBooking(
  admin: SupabaseClient,
  context: VoiceToolContext,
  args: Record<string, unknown>,
): Promise<VoiceToolOutcome> {
  const startIso = asTrimmedString(args.start_iso);
  const session = await getSession(admin, context.callSessionId);

  if (!session) {
    return { result: { status: "failed", error: "Call session not found." } };
  }

  const proposed = Array.isArray(session.extracted.proposed_slots)
    ? (session.extracted.proposed_slots as ProposedSlot[])
    : [];
  const chosen = proposed.find((slot) => slot.start_iso === startIso);

  if (!chosen) {
    return {
      result: {
        status: "invalid_slot",
        error:
          "That time is not one of the slots propose_slots returned. Call propose_slots and offer only its returned slots.",
      },
    };
  }

  // One open booking request per client keeps the approval queue sane
  // (same rule as the workflow path).
  const { data: existingPending } = await admin
    .from("approval_items")
    .select("id")
    .eq("client_id", context.clientId)
    .eq("type", "appointment_booking")
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();

  if (existingPending) {
    return {
      result: {
        status: "already_pending",
        say: "A booking request is already waiting for the team. Tell the caller the team will confirm their time shortly.",
      },
    };
  }

  const collected =
    typeof session.extracted.voice_collected === "object" &&
    session.extracted.voice_collected !== null
      ? (session.extracted.voice_collected as Record<string, unknown>)
      : {};
  const timezone =
    asTrimmedString(session.extracted.proposed_slots_timezone) ??
    "America/New_York";
  const contactName = asTrimmedString(collected.name) ?? "the caller";
  const knowledge = await getKnowledgeProfile(admin, context.clientId);

  const { data: approval, error } = await admin
    .from("approval_items")
    .insert({
      partner_id: context.partnerId,
      client_id: context.clientId,
      workflow_run_id: null,
      type: "appointment_booking",
      status: "pending",
      title: `Book appointment: ${contactName} — ${chosen.label}`,
      summary: `The AI phone assistant took this request on a call. Approving books ${chosen.label} (${timezone}) in ${
        asTrimmedString(session.extracted.proposed_slots_provider) ===
        "northstar_internal"
          ? "Northstar's internal calendar"
          : "the connected Google Calendar"
      }. Slots came from current availability${
        asTrimmedString(session.extracted.proposed_slots_constraints)
          ? session.extracted.proposed_slots_constraints_relaxed === true
            ? `. NOTE: the caller asked for ${session.extracted.proposed_slots_constraints}, but nothing was open there — confirm with them`
            : `, honoring the caller's preference (${session.extracted.proposed_slots_constraints})`
          : ""
      }.`,
      risk_level: "high",
      proposed_payload: {
        kind: "appointment_booking",
        provider:
          asTrimmedString(session.extracted.proposed_slots_provider) ??
          "google_calendar",
        timezone,
        duration_minutes: knowledge?.appointment_duration_minutes ?? 60,
        constraints_understood:
          asTrimmedString(session.extracted.proposed_slots_constraints),
        slot: chosen,
        alternatives: proposed.filter(
          (slot) => slot.start_iso !== chosen.start_iso,
        ),
        contact: {
          name: asTrimmedString(collected.name),
          phone: asTrimmedString(collected.phone) ?? session.from_number,
          email: asTrimmedString(collected.email),
          address: asTrimmedString(collected.address),
        },
        source: "voice_agent",
        call_session_id: context.callSessionId,
      },
      editable_content: null,
    })
    .select("id")
    .single();

  if (error || !approval) {
    return {
      result: {
        status: "failed",
        error: "The booking request could not be queued.",
        say: "Apologize and offer a callback from the team to set the time.",
      },
    };
  }

  await emitAssistantEvent({
    partnerId: context.partnerId,
    clientId: context.clientId,
    eventType: "booking_proposed",
    payload: { slot_label: chosen.label, source: "voice_agent" },
    approvalId: approval.id,
    callSessionId: context.callSessionId,
  });
  await emitAssistantEvent({
    partnerId: context.partnerId,
    clientId: context.clientId,
    eventType: "approval_needed",
    payload: { type: "appointment_booking", title: `Book ${chosen.label}` },
    approvalId: approval.id,
    callSessionId: context.callSessionId,
  });

  return {
    result: {
      status: "requested",
      slot: chosen,
      say: "Tell the caller the request is in and the team will confirm shortly. Do NOT say it is booked.",
    },
  };
}

async function requestConfirmationMessage(
  admin: SupabaseClient,
  context: VoiceToolContext,
  args: Record<string, unknown>,
): Promise<VoiceToolOutcome> {
  const channel = asTrimmedString(args.channel);
  const to = asTrimmedString(args.to);
  const body = asTrimmedString(args.body);

  if ((channel !== "sms" && channel !== "email") || !to || !body) {
    return {
      result: {
        status: "failed",
        error: "channel (sms|email), to, and body are required.",
      },
    };
  }

  const { data: approval, error } = await admin
    .from("approval_items")
    .insert({
      partner_id: context.partnerId,
      client_id: context.clientId,
      workflow_run_id: null,
      type: "customer_message",
      status: "pending",
      title: `Call follow-up ${channel.toUpperCase()}: ${to}`,
      summary: `Drafted by the AI phone assistant during a call. Approving sends via the connected ${channel === "sms" ? "SMS" : "email"} provider — live mode only; otherwise a dry run is recorded.`,
      risk_level: "medium",
      proposed_payload: {
        channel,
        to,
        subject:
          channel === "email"
            ? (asTrimmedString(args.subject) ??
              `A message from ${context.clientName}`)
            : null,
        draft_source: "voice_agent",
        call_session_id: context.callSessionId,
      },
      editable_content: body,
    })
    .select("id")
    .single();

  if (error || !approval) {
    return {
      result: { status: "failed", error: "The draft could not be queued." },
    };
  }

  await emitAssistantEvent({
    partnerId: context.partnerId,
    clientId: context.clientId,
    eventType: "draft_ready",
    payload: { channel, source: "voice_agent" },
    approvalId: approval.id,
    callSessionId: context.callSessionId,
  });
  await emitAssistantEvent({
    partnerId: context.partnerId,
    clientId: context.clientId,
    eventType: "approval_needed",
    payload: { type: "customer_message", channel },
    approvalId: approval.id,
    callSessionId: context.callSessionId,
  });

  return {
    result: {
      status: "drafted",
      say: "Tell the caller the team will send it shortly after a quick review.",
    },
  };
}

async function escalate(
  admin: SupabaseClient,
  context: VoiceToolContext,
  args: Record<string, unknown>,
): Promise<VoiceToolOutcome> {
  const reason = asTrimmedString(args.reason) ?? "Caller needs a human.";
  const urgency = asTrimmedString(args.urgency) ?? "high";

  await mergeExtracted(admin, context.callSessionId, {
    escalated: { reason, urgency },
  });

  const session = await getSession(admin, context.callSessionId);

  if (session?.matched_contact_id) {
    await admin.from("crm_timeline_entries").insert({
      partner_id: context.partnerId,
      client_id: context.clientId,
      contact_id: session.matched_contact_id,
      kind: "note",
      actor_type: "ai_assistant",
      title: "AI Assistant escalated a call",
      body: reason,
    });
  }

  await emitAssistantEvent({
    partnerId: context.partnerId,
    clientId: context.clientId,
    eventType: "escalation_needed",
    payload: { reason, urgency, source: "voice_agent" },
    callSessionId: context.callSessionId,
  });

  return {
    result: {
      status: "escalated",
      say: "Reassure the caller that a person will call them back promptly.",
    },
  };
}

export async function executeVoiceTool(
  admin: SupabaseClient,
  context: VoiceToolContext,
  call: { name: string; arguments: Record<string, unknown> },
): Promise<VoiceToolOutcome> {
  let outcome: VoiceToolOutcome;

  try {
    switch (call.name) {
      case "lookup_contact":
        outcome = await lookupContact(admin, context, call.arguments);
        break;
      case "save_contact_details":
        outcome = await saveContactDetails(admin, context, call.arguments);
        break;
      case "add_note":
        outcome = await addNote(admin, context, call.arguments);
        break;
      case "propose_slots":
        outcome = await proposeSlots(admin, context, call.arguments);
        break;
      case "request_booking":
        outcome = await requestBooking(admin, context, call.arguments);
        break;
      case "request_confirmation_message":
        outcome = await requestConfirmationMessage(
          admin,
          context,
          call.arguments,
        );
        break;
      case "escalate":
        outcome = await escalate(admin, context, call.arguments);
        break;
      case "end_call":
        outcome = {
          result: { status: "ending" },
          endCall: true,
        };
        break;
      default:
        outcome = {
          result: { error: `Unknown tool: ${call.name}` },
        };
    }
  } catch (error) {
    outcome = {
      result: {
        error:
          error instanceof Error
            ? error.message
            : "The tool failed unexpectedly.",
      },
    };
  }

  await appendToolLog(admin, context.callSessionId, {
    tool: call.name,
    args: call.arguments,
    result: outcome.result,
  });

  return outcome;
}
