import { redactAuditValue } from "@/lib/audit/redact";
import type { DeliveryOutcome } from "@/lib/delivery/customer-message";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import {
  createCalendarEvent,
  getBusyIntervals,
  type GoogleCalendarCredentials,
} from "@/lib/integrations/providers/google-calendar";
import { getGoogleWorkspaceBusyIntervals } from "@/lib/integrations/providers/google-workspace";
import { createMicrosoftCalendarEvent, getMicrosoftBusyIntervals } from "@/lib/integrations/providers/microsoft-365";
import type { WorkspaceCredentials } from "@/lib/integrations/providers/workspace-oauth";
import { EXTERNAL_CALENDAR_PROVIDER_KEYS } from "@/lib/scheduling/provider";
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

  const startTime = Date.parse(slot.start_iso);
  const endTime = Date.parse(slot.end_iso);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime || startTime <= Date.now()) {
    return { attempted: false, delivered: false, status: "failed", detail: "The approved slot is invalid or has passed. Request a new time before booking." };
  }

  const { data: connection } = await admin
    .from("integration_connections")
    .select(
      "id, runtime_mode, status, error_count, provider:integration_providers!inner(provider_key)",
    )
    .eq("client_id", booking.clientId)
    .eq("partner_id", booking.partnerId)
    .in("status", ["connected", "needs_attention"])
    .in("provider.provider_key", EXTERNAL_CALENDAR_PROVIDER_KEYS.includes(booking.payload.provider as typeof EXTERNAL_CALENDAR_PROVIDER_KEYS[number])
      ? [booking.payload.provider as string] : [...EXTERNAL_CALENDAR_PROVIDER_KEYS])
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

  if (booking.payload.scenario_lab === true) {
    await logEvent("dry_run", {
      note: "Scenario Lab booking approval recorded; no calendar was called.",
      simulated: true,
    });

    return {
      attempted: true,
      delivered: false,
      status: "dry_run",
      detail: `Scenario Lab approval recorded as a dry run. No real calendar was contacted. Slot: ${slot.label ?? slot.start_iso}.`,
    };
  }

  if (
    booking.payload.provider === "northstar_internal" ||
    (!connection && booking.payload.provider === "northstar_internal")
  ) {
    const internalRef = `northstar-${booking.approvalId}`;
    const { error } = await admin.rpc("book_internal_approved_appointment", { p_approval_id: booking.approvalId });
    if (error) {
      await logEvent("failed", {}, "The internal calendar rejected the booking. Recheck availability.");
      return { attempted: true, delivered: false, status: "failed", detail: "Nothing was booked. The internal calendar could not save this appointment; recheck its time and availability." };
    }
    await logEvent("sent", { note: "Booked in the business calendar.", internal_ref: internalRef });
    return { attempted: true, delivered: true, status: "succeeded", externalRef: internalRef,
      detail: `Appointment booked for ${slot.label ?? slot.start_iso}.` };
  }

  if (!connection) {
    await logEvent("skipped", {
      note: "No connected business calendar for this client.",
    });

    return {
      attempted: false,
      delivered: false,
      status: "skipped",
      detail:
        "Approved and recorded, but no business calendar is connected — book this manually and reconnect the calendar in Setup.",
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

  let providerAttempted = false;
  try {
    const credentials = await readProviderCredentials<GoogleCalendarCredentials & WorkspaceCredentials>(
      admin,
      connection.id,
    );

    if (!credentials?.refreshToken) {
      throw new Error(
        "Calendar authorization is incomplete. Reconnect it in Setup.",
      );
    }

    const contactName =
      typeof contact.name === "string" && contact.name ? contact.name : "Customer";
    const descriptionLines = [
      `Booked after human approval (approval ${booking.approvalId}).`,
      contact.phone ? `Phone: ${contact.phone}` : null,
      contact.email ? `Email: ${contact.email}` : null,
      contact.address ? `Address: ${contact.address}` : null,
    ].filter(Boolean);

    const providerKey = (connection.provider as unknown as { provider_key?: string } | null)?.provider_key;
    const busy = providerKey === "microsoft_365"
      ? await getMicrosoftBusyIntervals(credentials, slot.start_iso, slot.end_iso)
      : providerKey === "google_workspace"
        ? await getGoogleWorkspaceBusyIntervals(credentials, slot.start_iso, slot.end_iso)
        : await getBusyIntervals(credentials, slot.start_iso, slot.end_iso);
    if (busy.some((interval) => {
      const start = Date.parse(interval.start);
      const end = Date.parse(interval.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error("The calendar returned invalid availability.");
      return start < endTime && end > startTime;
    })) {
      await logEvent("skipped", { reason: "calendar_conflict" });
      return { attempted: false, delivered: false, status: "skipped", detail: "This time is no longer available. Nothing was booked; request another slot." };
    }
    const eventInput = {
      idempotencyKey: booking.approvalId,
      summary: `${contactName} — ${booking.clientName} appointment`,
      description: descriptionLines.join("\n"),
      startIso: slot.start_iso,
      endIso: slot.end_iso,
    };
    providerAttempted = true;
    const created = providerKey === "microsoft_365"
      ? await createMicrosoftCalendarEvent(credentials, eventInput)
      : await createCalendarEvent(credentials, eventInput);

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
      externalRef: created.eventId,
      detail: `Appointment booked on the connected calendar for ${slot.label ?? slot.start_iso} (event ${created.eventId}).`,
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
      status: providerAttempted ? "uncertain" : "failed",
      detail: providerAttempted ? "Calendar result is uncertain. Check the calendar before creating another booking; automatic retry is disabled." : `Approval recorded, but the booking failed: ${detail}`,
    };
  }
}
