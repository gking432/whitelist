import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkItem, WorkStatus } from "@/lib/agents/types";
import { finishWork } from "@/lib/agents/store";
import { readEffectiveAuthority } from "@/lib/agents/authority";
import { checkSelectedSlot, type OfferedSlot } from "./availability";

async function saveState(
  admin: SupabaseClient,
  work: WorkItem,
  status: WorkStatus,
  summary: string,
  result: Record<string, unknown> = {},
) {
  await finishWork(admin, work, status, summary, result, 30);
  if (["blocked", "waiting_approval", "waiting_external"].includes(status)) {
    const { error } = await admin
      .from("business_conversations")
      .update({
        state:
          status === "blocked"
            ? "needs_attention"
            : status === "waiting_approval"
              ? "waiting_approval"
              : "open",
        next_action: summary,
        updated_at: new Date().toISOString(),
      })
      .eq("id", work.conversation_id!)
      .eq("partner_id", work.partner_id)
      .eq("client_id", work.client_id)
      .eq("revision", work.input.conversation_revision);
    if (error) throw new Error("Booking attention could not be recorded.");
  }
}

export async function trackBookingHandoff(
  admin: SupabaseClient,
  work: WorkItem,
) {
  const { data: child, error } = await admin
    .from("agent_work_items")
    .select("id,status,summary,result")
    .eq("id", String(work.result.booking_work_id))
    .eq("parent_id", work.id)
    .eq("kind", "booking_request")
    .eq("conversation_id", work.conversation_id!)
    .eq("partner_id", work.partner_id)
    .eq("client_id", work.client_id)
    .single();
  if (error) throw new Error("Scheduling handoff unavailable.");
  await finishWork(
    admin,
    work,
    child.status === "completed"
      ? "completed"
      : child.status === "cancelled"
        ? "cancelled"
        : "waiting_children",
    child.summary,
    {
      ...work.result,
      booking_status: child.status,
      booking_result: child.result,
    },
    30,
  );
}

// Scheduling is a deterministic specialist. It never needs another model to
// reinterpret the customer's choice, and never starts a new customer thread.
export async function processBookingRequest(
  admin: SupabaseClient,
  work: WorkItem,
) {
  if (work.kind !== "booking_request")
    throw new Error("Not a booking assignment.");
  if (work.approval_id) return trackBookingOutcome(admin, work);
  const [check, settings] = await Promise.all([
    admin.rpc("conversation_action_check", {
      p_conversation: work.conversation_id,
      p_revision: work.input.conversation_revision,
    }),
    admin
      .from("agent_team_settings")
      .select("scheduling_enabled")
      .eq("partner_id", work.partner_id)
      .eq("client_id", work.client_id)
      .single(),
  ]);
  if (check.error || settings.error)
    throw new Error("Scheduling settings unavailable.");
  if (!check.data?.allowed)
    return saveState(
      admin,
      work,
      "cancelled",
      check.data?.reason ?? "Conversation changed.",
    );
  if (!settings.data.scheduling_enabled)
    return saveState(
      admin,
      work,
      "blocked",
      "Scheduling is paused. Resume it before preparing a booking.",
    );
  const authority = await readEffectiveAuthority(admin, {
    partnerId: work.partner_id, clientId: work.client_id,
  }, "calendar", { phase: "draft",
    expectedRevision: typeof work.input.authority_revision === "number" ? work.input.authority_revision : undefined,
    connectionId: typeof work.input.calendar_connection_id === "string" ? work.input.calendar_connection_id : null });
  if (!authority.allowed) return saveState(admin, work, "blocked", authority.reason);
  const slot = work.input.slot as OfferedSlot;
  const available = await checkSelectedSlot(
    admin,
    { partnerId: work.partner_id, clientId: work.client_id },
    {
      slot,
      provider: String(work.input.provider),
      calendarConnectionId:
        typeof work.input.calendar_connection_id === "string"
          ? work.input.calendar_connection_id
          : null,
    },
  );
  if (!available)
    return saveState(
      admin,
      work,
      "blocked",
      "The selected time is no longer available. Offer fresh times in this conversation; nothing was booked.",
    );
  const latestAuthority = await readEffectiveAuthority(admin, {
    partnerId: work.partner_id, clientId: work.client_id,
  }, "calendar", { phase: "draft", expectedRevision: authority.revision,
    connectionId: typeof work.input.calendar_connection_id === "string" ? work.input.calendar_connection_id : null });
  if (!latestAuthority.allowed) return saveState(admin, work, "blocked", latestAuthority.reason);
  const { error } = await admin.rpc("propose_conversation_action", {
    p_partner: work.partner_id,
    p_client: work.client_id,
    p_id: work.conversation_id,
    p_revision: work.input.conversation_revision,
    p_kind: "booking",
    p_body: `Customer requested ${slot.label}. Scheduling checked this time. Approval books it after another availability check.`,
    p_metadata: {
      authority_revision: authority.revision,
      slot,
      provider: work.input.provider,
      timezone: work.input.timezone,
      calendar_connection_id: work.input.calendar_connection_id,
    },
    p_work: work.id,
    p_claim: work.claim_token,
  });
  if (error)
    throw new Error(
      "Booking context changed before approval could be prepared.",
    );
}

async function trackBookingOutcome(admin: SupabaseClient, work: WorkItem) {
  const [approval, job] = await Promise.all([
    admin
      .from("approval_items")
      .select("status,expires_at")
      .eq("id", work.approval_id!)
      .eq("partner_id", work.partner_id)
      .eq("client_id", work.client_id)
      .single(),
    admin
      .from("action_jobs")
      .select("status,external_ref,outcome_detail,attempt_count")
      .eq("approval_id", work.approval_id!)
      .eq("partner_id", work.partner_id)
      .eq("client_id", work.client_id)
      .maybeSingle(),
  ]);
  if (approval.error || job.error)
    throw new Error("Booking outcome unavailable.");
  const a = approval.data;
  if (
    a.status === "pending" &&
    (!a.expires_at || Date.parse(a.expires_at) > Date.now())
  )
    return saveState(
      admin,
      work,
      "waiting_approval",
      "The requested time is awaiting owner approval. It is not booked or held.",
    );
  if (!["approved", "edited_and_approved"].includes(a.status))
    return saveState(
      admin,
      work,
      "blocked",
      "The booking request was declined or expired. Continue with the customer in the original conversation.",
    );
  const result = {
    booking_approval_id: work.approval_id,
    booking_outcome: job.data?.status ?? null,
    external_ref: job.data?.external_ref ?? null,
  };
  if (!job.data || ["pending", "processing"].includes(job.data.status))
    return saveState(
      admin,
      work,
      "waiting_external",
      "Approved; waiting for the calendar result. Do not confirm a booking yet.",
      result,
    );
  if (job.data.status === "failed" && job.data.attempt_count < 5)
    return saveState(
      admin,
      work,
      "waiting_external",
      "The calendar action failed. The existing action queue controls retries; no booking confirmation is available yet.",
      result,
    );
  if (job.data.status !== "succeeded")
    return saveState(
      admin,
      work,
      "blocked",
      job.data.status === "uncertain"
        ? "The calendar outcome is uncertain. Check the existing booking before any retry or confirmation."
        : "The calendar did not confirm a booking. Review the action and offer a fresh time if needed; no confirmation was sent.",
      result,
    );
  const confirmation = await admin
    .from("approval_items")
    .select("id,status,expires_at")
    .eq("partner_id", work.partner_id)
    .eq("client_id", work.client_id)
    .contains("proposed_payload", { booking_approval_id: work.approval_id })
    .maybeSingle();
  if (confirmation.error) throw new Error("Booking confirmation unavailable.");
  if (!confirmation.data)
    return saveState(
      admin,
      work,
      "blocked",
      "The appointment is booked, but confirmation needs review in the original conversation.",
      { ...result, booked: true },
    );
  const c = confirmation.data;
  const completed = { ...result, booked: true, confirmation_approval_id: c.id };
  if (
    c.status === "pending" &&
    (!c.expires_at || Date.parse(c.expires_at) > Date.now())
  )
    return saveState(
      admin,
      work,
      "waiting_approval",
      "The appointment is booked. Its confirmation is awaiting owner approval on the original channel.",
      completed,
    );
  if (!["approved", "edited_and_approved"].includes(c.status))
    return saveState(
      admin,
      work,
      "blocked",
      "The appointment is booked, but its confirmation was declined or expired. Review customer follow-up.",
      completed,
    );
  const sent = await admin
    .from("action_jobs")
    .select("status")
    .eq("approval_id", c.id)
    .eq("partner_id", work.partner_id)
    .eq("client_id", work.client_id)
    .maybeSingle();
  if (sent.error) throw new Error("Confirmation delivery unavailable.");
  if (sent.data?.status === "succeeded")
    return saveState(
      admin,
      work,
      "completed",
      "Appointment booked and confirmation sent through the original conversation. Customer read status is unknown.",
      { ...completed, confirmation_sent: true },
    );
  if (!sent.data || ["pending", "processing"].includes(sent.data.status))
    return saveState(
      admin,
      work,
      "waiting_external",
      "Appointment booked; waiting for confirmation delivery on the original channel.",
      completed,
    );
  return saveState(
    admin,
    work,
    "blocked",
    "Appointment booked, but confirmation delivery needs review. Do not create another booking.",
    completed,
  );
}
