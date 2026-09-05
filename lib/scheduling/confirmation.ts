import { emitAssistantEvent } from "@/lib/assistant/events";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// After a booking is approved (booked live or recorded as a dry run), the
// customer still needs to hear about it. This queues an approval-gated
// confirmation message draft — same gate as every other customer-facing
// send. Deterministic template (no AI needed for a confirmation) and
// best-effort: a failure here never breaks the booking result.

export async function queueBookingConfirmationDraft(input: {
  partnerId: string;
  clientId: string;
  clientName: string;
  workflowRunId: string | null;
  payload: Record<string, unknown>;
  bookedLive: boolean;
}): Promise<void> {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return;
  }

  try {
    const slot = (input.payload.slot ?? {}) as { label?: string };
    const contact = (input.payload.contact ?? {}) as {
      name?: string | null;
      phone?: string | null;
      email?: string | null;
    };

    const to = contact.phone ?? contact.email ?? null;

    if (!slot.label || !to) {
      return;
    }

    const channel = contact.phone ? "sms" : "email";
    const firstName = contact.name?.split(/\s+/)[0] ?? "there";
    const body = `Hi ${firstName}, this is ${input.clientName}. Your appointment is set for ${slot.label}. Reply here if you need to change it — see you then!`;

    const { data: approval, error } = await admin
      .from("approval_items")
      .insert({
        partner_id: input.partnerId,
        client_id: input.clientId,
        workflow_run_id: input.workflowRunId,
        type: "customer_message",
        status: "pending",
        title: `Appointment confirmation: ${contact.name ?? to}`,
        summary: `Confirms the ${input.bookedLive ? "booked" : "proposed (dry-run)"} appointment (${slot.label}) with the customer. Approving sends via the connected ${channel === "sms" ? "SMS" : "email"} provider in live mode.`,
        risk_level: "medium",
        proposed_payload: {
          channel,
          to,
          subject:
            channel === "email"
              ? `Your appointment with ${input.clientName}`
              : null,
          draft_source: "booking_confirmation_template",
        },
        editable_content: body,
      })
      .select("id")
      .single();

    if (error || !approval) {
      return;
    }

    await emitAssistantEvent({
      partnerId: input.partnerId,
      clientId: input.clientId,
      eventType: "draft_ready",
      payload: { title: `Appointment confirmation (${slot.label})` },
      workflowRunId: input.workflowRunId,
      approvalId: approval.id,
    });
  } catch {
    // Best-effort by design.
  }
}
