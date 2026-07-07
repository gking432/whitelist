import { redactAuditValue } from "@/lib/audit/redact";
import type { DeliveryOutcome } from "@/lib/delivery/customer-message";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import {
  createCalendarEvent,
  type GoogleCalendarCredentials,
} from "@/lib/integrations/providers/google-calendar";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Books the approved appointment. Hard rules (mirrors SMS delivery):
// - Called ONLY from approval resolution — never from the engine.
// - Creates the calendar event ONLY when the calendar connection is live;
//   otherwise it records an honest dry run.
// - Every outcome is logged as an outbound integration event.

type ApprovedBooking = {
  approvalId: string;
  partnerId: string;
  clientId: string;
  workflowRunId: string | null;
  payload: Record<string, unknown>;
  clientName: string;
};

type SlotPayload = {
  start_iso?: string;
  end_iso?: string;
  label?: string;
};

export async function bookApprovedAppointment(
  booking: ApprovedBooking,
): Promise<DeliveryOutcome> {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return {
      attempted: false,
      delivered: false,
      status: "skipped",
      detail:
        "Booking skipped: the server is not configured for calendar access.",
    };
  }

  const slot = (booking.payload.slot ?? {}) as SlotPayload;
  const contact = (booking.payload.contact ?? {}) as Record<string, unknown>;

  if (!slot.start_iso || !slot.end_iso) {
    return {
      attempted: false,
      delivered: false,
      status: "skipped",
      detail:
        "Approved and recorded, but the proposal is missing its time slot — nothing was booked.",
    };
  }

  const { data: connection } = await admin
    .from("integration_connections")
    .select(
      "id, runtime_mode, status, error_count, provider:integration_providers!inner(provider_key)",
    )
    .eq("client_id", booking.clientId)
    .eq("partner_id", booking.partnerId)
    .in("status", ["connected", "needs_attention"])
    .eq("provider.provider_key", "google_calendar")
    .limit(1)
    .maybeSingle();

  const logEvent = async (
    status: "sent" | "dry_run" | "failed" | "skipped",
    response: Record<string, unknown>,
    errorMessage?: string,
  ) => {
    await admin.from("integration_events").insert({
      partner_id: booking.partnerId,
      client_id: booking.clientId,
      connection_id: connection?.id ?? null,
      workflow_run_id: booking.workflowRunId,
      direction: "outbound",
      event_type: "calendar.event_created",
      status,
      request_payload: redactAuditValue({
        slot,
        contact,
        approval_id: booking.approvalId,
      }),
      response_payload: redactAuditValue(response),
      error_message: errorMessage ?? null,
      redacted: true,
    });
  };

  if (!connection) {
    await logEvent("skipped", {
      note: "No connected Google Calendar for this client.",
    });

    return {
      attempted: false,
      delivered: false,
      status: "skipped",
      detail:
        "Approved and recorded, but no Google Calendar is connected — book this manually and reconnect the calendar in Setup.",
    };
  }

  if (connection.runtime_mode !== "live") {
    await logEvent("dry_run", {
      note: "Calendar connection is not in live mode; the event was not created.",
    });

    return {
      attempted: true,
      delivered: false,
      status: "dry_run",
      detail: `Approved and recorded as a dry run — the calendar connection is in ${connection.runtime_mode.replaceAll("_", " ")} mode. Switch it to live to book for real. Slot: ${slot.label ?? slot.start_iso}.`,
    };
  }

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

    const contactName =
      typeof contact.name === "string" && contact.name ? contact.name : "Customer";
    const descriptionLines = [
      `Booked via Northstar after human approval (approval ${booking.approvalId}).`,
      contact.phone ? `Phone: ${contact.phone}` : null,
      contact.email ? `Email: ${contact.email}` : null,
      contact.address ? `Address: ${contact.address}` : null,
    ].filter(Boolean);

    const created = await createCalendarEvent(credentials, {
      summary: `${contactName} — ${booking.clientName} appointment`,
      description: descriptionLines.join("\n"),
      startIso: slot.start_iso,
      endIso: slot.end_iso,
    });

    await logEvent("sent", {
      event_id: created.eventId,
      html_link: created.htmlLink,
    });

    await admin
      .from("integration_connections")
      .update({ last_success_at: new Date().toISOString(), status: "connected" })
      .eq("id", connection.id);

    return {
      attempted: true,
      delivered: true,
      status: "succeeded",
      detail: `Appointment booked on Google Calendar for ${slot.label ?? slot.start_iso} (event ${created.eventId}).`,
    };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Calendar booking failed.";

    await logEvent("failed", {}, detail);

    await admin
      .from("integration_connections")
      .update({
        status: "needs_attention",
        last_failure_at: new Date().toISOString(),
        error_count: (connection.error_count ?? 0) + 1,
        health_summary: `Last booking failed: ${detail}`,
      })
      .eq("id", connection.id);

    return {
      attempted: true,
      delivered: false,
      status: "failed",
      detail: `Approval recorded, but the booking failed: ${detail}`,
    };
  }
}
