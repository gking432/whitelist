import { readProviderCredentials } from "@/lib/integrations/credentials";
import { authorityDeliveryBlock } from "@/lib/agents/delivery-guard";
import type { ActionPreflight } from "@/lib/jobs/action-preflight";
import {
  instagramReplyWindowOpen,
  sendInstagramText,
  type InstagramMessagingCredentials,
} from "@/lib/integrations/providers/instagram-messaging";
import type { SupabaseClient } from "@supabase/supabase-js";
import { slotFitsActivation } from "@/lib/activation/rules";
import { readActivationPlan } from "@/lib/activation/service";
import type { ActionJobRecord } from "@/lib/jobs/record";
import type { DeliveryOutcome } from "@/lib/delivery/customer-message";

export async function conversationDeliveryBlock(
  admin: SupabaseClient,
  job: ActionJobRecord,
): Promise<string | null> {
  const id = job.payload.conversation_id;
  if (id === undefined) return null;
  if (
    typeof id !== "string" ||
    !Number.isInteger(job.payload.conversation_revision)
  )
    return "Invalid conversation context.";
  const { data: c, error } = await admin
    .from("business_conversations")
    .select("id,channel,connection_id,external_thread_id,partner_id,client_id")
    .eq("id", id)
    .eq("partner_id", job.partner_id)
    .eq("client_id", job.client_id)
    .maybeSingle();
  if (error) throw new Error("Conversation could not be checked.");
  if (c) {
    const { data: connection, error: connectionError } = await admin
      .from("integration_connections")
      .select("config,runtime_mode")
      .eq("id", c.connection_id)
      .eq("partner_id", job.partner_id)
      .eq("client_id", job.client_id)
      .maybeSingle();
    if (connectionError) throw new Error("Connection settings unavailable.");
    if (
      connection?.config?.activation_managed === true &&
      (connection.runtime_mode !== "live" ||
        connection.config.conversation_intake_enabled !== true)
    )
      return "This customer channel is paused or no longer selected.";
  }
  if (
    !c ||
    c.channel !== job.payload.channel ||
    c.connection_id !== job.payload.connection_id ||
    c.external_thread_id !== job.payload.to
  )
    return "Approved action does not match its conversation.";
  if (job.payload.agent_work_id) {
    const work = await admin
      .from("agent_work_items")
      .select("id,status")
      .eq("id", String(job.payload.agent_work_id))
      .eq("conversation_id", id)
      .eq("partner_id", job.partner_id)
      .eq("client_id", job.client_id)
      .eq("approval_id", job.approval_id!)
      .maybeSingle();
    if (work.error) throw new Error("Assignment could not be checked.");
    if (!work.data || work.data.status === "cancelled")
      return "Agent assignment was stopped.";
  }
  const approval = await admin
    .from("approval_items")
    .select("expires_at")
    .eq("id", job.approval_id!)
    .eq("partner_id", job.partner_id)
    .eq("client_id", job.client_id)
    .single();
  if (approval.error) throw new Error("Approval expiry could not be checked.");
  if (
    approval.data.expires_at &&
    Date.parse(approval.data.expires_at) <= Date.now()
  )
    return "Conversation action expired. Prepare a fresh action.";
  const check = await admin.rpc("conversation_action_check", {
    p_conversation: id,
    p_revision: job.payload.conversation_revision,
    p_human: job.payload.human_authored === true,
  });
  if (check.error) throw new Error("Conversation guard unavailable.");
  if (!check.data?.allowed)
    return check.data?.reason ?? "Conversation needs review.";
  if (job.kind === "calendar.book") {
    const activation = await readActivationPlan(admin, {
      partnerId: job.partner_id,
      clientId: job.client_id,
    });
    const slot = job.payload.slot as
      | { start_iso?: string; end_iso?: string }
      | undefined;
    if (
      activation &&
      (activation.status !== "active" ||
        !activation.bookings ||
        activation.workspace_connection_id !==
          job.payload.calendar_connection_id ||
        !slotFitsActivation(
          activation,
          slot?.start_iso ?? "",
          slot?.end_iso ?? "",
        ))
    )
      return "Booking settings changed. Ask the customer to choose a new time.";
    const settings = await admin
      .from("agent_team_settings")
      .select("status,scheduling_enabled")
      .eq("client_id", job.client_id)
      .eq("partner_id", job.partner_id)
      .single();
    if (
      settings.error ||
      settings.data.status !== "active" ||
      !settings.data.scheduling_enabled
    )
      return "Scheduling is paused.";
  }
  return null;
}
export async function recordConversationDelivery(
  admin: SupabaseClient,
  job: ActionJobRecord,
  outcome: DeliveryOutcome,
) {
  if (!job.payload.conversation_id) return;
  const { error } = await admin.rpc("complete_conversation_message", {
    p_approval: job.approval_id,
    p_status:
      outcome.status === "succeeded"
        ? "sent"
        : outcome.status === "provider_pending"
          ? "uncertain"
          : outcome.status,
    p_body: job.payload.body,
    p_ref: outcome.externalRef ?? null,
  });
  if (error) throw new Error("Conversation delivery requires reconciliation.");
}
export async function deliverWebsiteReply(
  admin: SupabaseClient,
  job: ActionJobRecord,
  beforeSend?: ActionPreflight,
): Promise<DeliveryOutcome> {
  if (job.payload.channel === "instagram") {
    const outcome = await deliverInstagramReply(admin, job, beforeSend);
    await recordConversationDelivery(admin, job, outcome);
    return outcome;
  }
  if (job.payload.channel !== "website_chat")
    return {
      status: "skipped",
      attempted: false,
      delivered: false,
      detail: "This channel does not have a connected delivery adapter.",
    };
  const blocked = await beforeSend?.() ?? await authorityDeliveryBlock(admin, job) ?? await conversationDeliveryBlock(admin, job);
  if (blocked) return { attempted: false, delivered: false, status: "skipped", detail: blocked };
  const outcome: DeliveryOutcome = {
    status: "succeeded",
    attempted: true,
    delivered: true,
    externalRef: job.approval_id,
    detail:
      "Approved reply is available in the customer’s website conversation. This does not establish that it has been read.",
  };
  await recordConversationDelivery(admin, job, outcome);
  return outcome;
}
// A booking confirmation is created only after the existing calendar executor
// reports success. Stable approval metadata prevents duplicate confirmations.
export async function queueConversationBookingConfirmation(
  admin: SupabaseClient,
  job: ActionJobRecord,
) {
  const id = job.payload.conversation_id;
  if (typeof id !== "string") return;
  const { error } = await admin.rpc("confirm_conversation_booking", {
    p_approval: job.approval_id,
  });
  if (error)
    throw new Error("Booking completed; confirmation needs reconciliation.");
}

async function deliverInstagramReply(
  admin: SupabaseClient,
  job: ActionJobRecord,
  beforeSend?: ActionPreflight,
): Promise<DeliveryOutcome> {
  const connection = await admin
    .from("integration_connections")
    .select("runtime_mode,provider:integration_providers!inner(provider_key)")
    .eq("id", String(job.payload.connection_id))
    .eq("partner_id", job.partner_id)
    .eq("client_id", job.client_id)
    .eq("provider.provider_key", "instagram_messaging")
    .single();
  if (connection.error)
    return {
      status: "skipped",
      attempted: false,
      delivered: false,
      detail: "Instagram connection unavailable.",
    };
  const latest = await admin
    .from("business_conversation_messages")
    .select("created_at")
    .eq("conversation_id", String(job.payload.conversation_id))
    .eq("partner_id", job.partner_id)
    .eq("client_id", job.client_id)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error || !instagramReplyWindowOpen(latest.data?.created_at))
    return {
      status: "skipped",
      attempted: false,
      delivered: false,
      detail:
        "Instagram’s reply window has closed. Wait for a new customer message.",
    };
  const body = String(job.payload.body ?? "");
  if (body.length > 1000)
    return {
      status: "skipped",
      attempted: false,
      delivered: false,
      detail:
        "Instagram text replies are limited to 1,000 characters. Prepare a shorter reply.",
    };
  if (connection.data.runtime_mode !== "live")
    return {
      status: "dry_run",
      attempted: false,
      delivered: false,
      detail: "Instagram is not live. No message sent.",
    };
  const credentials =
    await readProviderCredentials<InstagramMessagingCredentials>(
      admin,
      String(job.payload.connection_id),
    );
  if (!credentials)
    return {
      status: "skipped",
      attempted: false,
      delivered: false,
      detail: "Reconnect Instagram before sending.",
    };
  const blocked = await beforeSend?.() ?? await authorityDeliveryBlock(admin, job) ?? await conversationDeliveryBlock(admin, job);
  if (blocked) return { attempted: false, delivered: false, status: "skipped", detail: blocked };
  let outcome: DeliveryOutcome;
  try {
    const ref = await sendInstagramText(
      credentials,
      String(job.payload.to),
      body,
    );
    outcome = {
      status: "succeeded",
      attempted: true,
      delivered: true,
      externalRef: ref,
      detail: "Instagram accepted the approved reply. Read status is unknown.",
    };
  } catch {
    outcome = {
      status: "uncertain",
      attempted: true,
      delivered: false,
      detail:
        "Instagram did not confirm acceptance. Check the inbox before any resend.",
    };
  }
  return outcome;
}
