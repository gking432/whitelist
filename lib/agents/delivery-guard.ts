import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionJobRecord } from "../jobs/record";
import { checkFollowup } from "./store";
import { authorityChannel, readEffectiveAuthority, readInternalBookingAuthority } from "./authority";

/** Applies to approved actions even when they were created before a stop. */
export async function authorityDeliveryBlock(
  admin: SupabaseClient,
  job: ActionJobRecord,
): Promise<string | null> {
  const channel = job.kind === "calendar.book" ? "calendar"
    : job.kind === "email.send" ? "email"
    : job.kind === "sms.send" ? "sms" : authorityChannel(job.payload.channel);
  const revision = job.payload.authority_revision;
  if (revision !== undefined && (!Number.isInteger(revision) || Number(revision) < 0))
    return "Invalid owner authority revision. Prepare a fresh action.";
  if (!channel) {
    // Existing connector actions retain their own capability checks. A saved
    // global pause still stops outgoing work; collecting inbound stays separate.
    const settings = await admin.from("agent_team_settings")
      .select("status,authority_revision")
      .eq("partner_id", job.partner_id).eq("client_id", job.client_id).maybeSingle();
    if (settings.error) throw new Error("Current owner authority could not be verified.");
    if (settings.data?.status === "paused") return "The team is paused. No outgoing action was performed.";
    if (revision !== undefined && revision !== (settings.data?.authority_revision ?? 0))
      return "Owner authority changed. Prepare and review a fresh action.";
    const connectionId = job.connection_id ?? job.payload.connection_id;
    if (typeof connectionId === "string") {
      const account = await admin.from("integration_connections").select("config")
        .eq("partner_id", job.partner_id).eq("client_id", job.client_id).eq("id", connectionId).maybeSingle();
      if (account.error) throw new Error("The approved account could not be verified.");
      if (!account.data || account.data.config?.workspace_view_only === true)
        return "The approved account is unavailable or read only. No outgoing action was performed.";
    }
    return null;
  }
  if (job.kind === "calendar.book" && job.payload.provider === "northstar_internal") {
    const internal = await readInternalBookingAuthority(admin, {
      partnerId: job.partner_id, clientId: job.client_id,
    }, { approvalId: job.approval_id ?? "", expectedRevision: revision === undefined ? undefined : Number(revision) });
    return internal.allowed ? null : internal.reason;
  }
  const check = await readEffectiveAuthority(admin, {
    partnerId: job.partner_id, clientId: job.client_id,
  }, channel, {
    phase: "execute",
    approved: !!job.approval_id,
    expectedRevision: revision === undefined ? undefined : Number(revision),
    connectionId: channel === "calendar"
      ? String(job.payload.calendar_connection_id ?? job.connection_id ?? "") || null
      : String(job.payload.connection_id ?? job.connection_id ?? "") || null,
  });
  return check.allowed ? null : check.reason;
}

export async function agentDeliveryBlock(
  admin: SupabaseClient,
  job: ActionJobRecord,
): Promise<string | null> {
  const workId = job.payload.agent_work_id;
  if (workId === undefined) return null; // Existing non-agent actions retain their existing behavior.
  if (typeof workId !== "string")
    return "Invalid agent assignment; nothing was sent.";
  const { data: work, error } = await admin
    .from("agent_work_items")
    .select("id,approval_id")
    .eq("id", workId)
    .eq("partner_id", job.partner_id)
    .eq("client_id", job.client_id)
    .maybeSingle();
  if (error)
    throw new Error("Agent assignment could not be checked before delivery.");
  if (!work || work.approval_id !== job.approval_id)
    return "The approved action does not match its agent assignment; nothing was sent.";
  const check = await checkFollowup(admin, work.id);
  return check.allowed ? null : check.reason;
}
