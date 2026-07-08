import type { SupabaseClient } from "@supabase/supabase-js";

import { redactAuditValue } from "@/lib/audit/redact";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import {
  getBusyIntervals,
  type GoogleCalendarCredentials,
} from "@/lib/integrations/providers/google-calendar";
import { getKnowledgeProfile } from "@/lib/knowledge/profile";
import {
  describeConstraints,
  parseSchedulingConstraints,
} from "@/lib/scheduling/constraints";
import {
  computeOpenSlots,
  formatSlotLabel,
} from "@/lib/scheduling/slots";
import type { RunStep } from "@/lib/workflows/handlers";

// Appointment proposal step for the run engine: when an interaction is a
// scheduling request and the client has a connected calendar, read REAL
// availability and create an approval-gated booking proposal. Nothing is
// booked here — the calendar event is created only when a human approves
// (and only in live mode; see lib/scheduling/book-approved.ts).
// Never throws: failures log an event and surface as a step.

type ProposalInput = {
  partnerId: string;
  clientId: string;
  runId: string;
  templateKey: string;
  clientName: string;
  eventType: string;
  eventData: Record<string, unknown>;
  routingCategory: string | null;
};

export type BookingProposalResult = {
  step: RunStep;
  booking: Record<string, unknown>;
};

const SCHEDULING_CATEGORIES = new Set(["scheduling"]);
const SCHEDULING_EVENTS = new Set([
  "appointment.requested",
  "scheduling.requested",
]);

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isSchedulingIntent(
  eventType: string,
  routingCategory: string | null,
): boolean {
  return (
    SCHEDULING_EVENTS.has(eventType) ||
    (routingCategory !== null && SCHEDULING_CATEGORIES.has(routingCategory))
  );
}

export async function proposeBookingFromRun(
  admin: SupabaseClient,
  input: ProposalInput,
): Promise<BookingProposalResult | null> {
  // Only the router run proposes bookings (one proposal per interaction,
  // not one per matched workflow).
  if (input.templateKey !== "ai_intake_router") {
    return null;
  }

  if (!isSchedulingIntent(input.eventType, input.routingCategory)) {
    return null;
  }

  const { data: connection } = await admin
    .from("integration_connections")
    .select(
      "id, runtime_mode, status, provider:integration_providers!inner(provider_key)",
    )
    .eq("client_id", input.clientId)
    .eq("partner_id", input.partnerId)
    .in("status", ["connected", "needs_attention"])
    .eq("provider.provider_key", "google_calendar")
    .limit(1)
    .maybeSingle();

  if (!connection) {
    return {
      step: {
        name: "Booking proposal skipped",
        detail:
          "This looks like a scheduling request, but no calendar is connected — connect Google Calendar in Setup to propose real slots.",
      },
      booking: { status: "skipped", reason: "no_calendar_connection" },
    };
  }

  // One open proposal per client at a time keeps the approval queue sane.
  const { data: existingPending } = await admin
    .from("approval_items")
    .select("id")
    .eq("client_id", input.clientId)
    .eq("type", "appointment_booking")
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();

  if (existingPending) {
    return {
      step: {
        name: "Booking proposal skipped",
        detail:
          "A booking proposal is already waiting for approval for this client.",
      },
      booking: { status: "skipped", reason: "proposal_already_pending" },
    };
  }

  const logEvent = async (
    status: "processed" | "failed",
    eventType: string,
    payload: Record<string, unknown>,
    errorMessage?: string,
  ) => {
    await admin.from("integration_events").insert({
      partner_id: input.partnerId,
      client_id: input.clientId,
      connection_id: connection.id,
      workflow_run_id: input.runId,
      direction: "outbound",
      event_type: eventType,
      status,
      request_payload: redactAuditValue(payload),
      error_message: errorMessage ?? null,
      redacted: true,
    });
  };

  try {
    const credentials = await readProviderCredentials<GoogleCalendarCredentials>(
      admin,
      connection.id,
    );

    if (!credentials?.refreshToken) {
      throw new Error(
        "Google Calendar authorization is incomplete. Reconnect it in Setup.",
      );
    }

    const { data: client } = await admin
      .from("client_businesses")
      .select("timezone")
      .eq("id", input.clientId)
      .maybeSingle();

    const timezone = client?.timezone ?? "America/New_York";
    const now = new Date();
    const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Business booking window + visit length from the approved knowledge
    // profile; customer constraints ("after 5", "not tomorrow", "mornings")
    // tighten the window further, never widen it.
    const knowledge = await getKnowledgeProfile(admin, input.clientId);
    const constraintText = [
      asString(input.eventData.appointment_preference),
      asString(input.eventData.message),
    ]
      .filter(Boolean)
      .join(". ");
    const constraints = parseSchedulingConstraints(constraintText);
    const constraintsDescription = describeConstraints(constraints);

    // REAL availability from the connected calendar.
    const busy = await getBusyIntervals(
      credentials,
      now.toISOString(),
      weekOut.toISOString(),
    );

    let slots = computeOpenSlots(busy, {
      timezone,
      maxSlots: 3,
      businessStartHour: knowledge?.booking_hours_start ?? 9,
      businessEndHour: knowledge?.booking_hours_end ?? 17,
      durationMinutes: knowledge?.appointment_duration_minutes ?? 60,
      constraints,
    });

    // If the customer's constraints leave nothing open, fall back to the
    // plain business window and say so honestly.
    let constraintsRelaxed = false;

    if (slots.length === 0 && constraintsDescription) {
      slots = computeOpenSlots(busy, {
        timezone,
        maxSlots: 3,
        businessStartHour: knowledge?.booking_hours_start ?? 9,
        businessEndHour: knowledge?.booking_hours_end ?? 17,
        durationMinutes: knowledge?.appointment_duration_minutes ?? 60,
      });
      constraintsRelaxed = slots.length > 0;
    }

    if (slots.length === 0) {
      await logEvent("processed", "calendar.slots_proposed", {
        note: "No open slots found in the next 7 business days.",
      });

      return {
        step: {
          name: "No open slots",
          detail:
            "The connected calendar has no open business-hours slots in the next 7 days. Book manually or free up the calendar.",
        },
        booking: { status: "no_slots" },
      };
    }

    const labeled = slots.map((slot) => ({
      start_iso: slot.startIso,
      end_iso: slot.endIso,
      label: formatSlotLabel(slot.startIso, timezone),
    }));
    const [primary, ...alternatives] = labeled;

    const contactName =
      asString(input.eventData.name) ||
      asString(input.eventData.full_name) ||
      "the customer";

    const { error: approvalError } = await admin.from("approval_items").insert({
      partner_id: input.partnerId,
      client_id: input.clientId,
      workflow_run_id: input.runId,
      type: "appointment_booking",
      status: "pending",
      title: `Book appointment: ${contactName} — ${primary.label}`,
      summary: `Approving books ${primary.label} (${timezone}) on the connected Google Calendar${
        connection.runtime_mode === "live"
          ? ""
          : " — the connection is not live, so approval records a dry run"
      }. Open alternatives: ${
        alternatives.map((slot) => slot.label).join("; ") || "none"
      }. Slots come from real calendar availability${
        constraintsDescription
          ? constraintsRelaxed
            ? `. NOTE: the customer asked for ${constraintsDescription}, but nothing was open there — these ignore that preference; confirm with the customer`
            : `, honoring the customer's preference (${constraintsDescription})`
          : ""
      }.`,
      risk_level: "high",
      proposed_payload: {
        kind: "appointment_booking",
        provider: "google_calendar",
        timezone,
        duration_minutes: knowledge?.appointment_duration_minutes ?? 60,
        constraints_understood: constraintsDescription,
        slot: primary,
        alternatives,
        contact: {
          name: asString(input.eventData.name) || null,
          phone: asString(input.eventData.phone) || null,
          email: asString(input.eventData.email) || null,
          address: asString(input.eventData.address) || null,
        },
      },
      editable_content: null,
    });

    if (approvalError) {
      throw new Error("The booking proposal could not be queued for approval.");
    }

    await logEvent("processed", "calendar.slots_proposed", {
      slot: primary,
      alternatives,
      timezone,
    });

    return {
      step: {
        name: "Booking proposed",
        detail: `Found ${labeled.length} real open slot${labeled.length === 1 ? "" : "s"}; proposed ${primary.label}. Waiting for approval — nothing is booked yet.`,
      },
      booking: {
        status: "proposed",
        slot: primary,
        alternatives,
        timezone,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Slot proposal failed.";

    await logEvent("failed", "calendar.slots_proposal_failed", {}, message);

    return {
      step: {
        name: "Booking proposal failed",
        detail: `${message} The run itself completed; fix the calendar connection and future scheduling requests will propose slots.`,
      },
      booking: { status: "failed", error: message },
    };
  }
}
