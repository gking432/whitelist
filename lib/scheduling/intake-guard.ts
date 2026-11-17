import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionJobRecord } from "../jobs/record.ts";

export async function intakeBookingSourceBlock(admin: SupabaseClient, originPayload: Record<string, unknown>, originApprovalId: string, allowCompleted = false): Promise<string | null> {
  if (!["owner_intake", "owner_conversation"].includes(String(originPayload.origin))) return null;
  const conversationOrigin = originPayload.origin === "owner_conversation";
  const workId = conversationOrigin ? originPayload.customer_rebooking_work_id : originPayload.intake_work_id;
  if (typeof workId !== "string" || !originApprovalId)
    return "The reviewed intake scheduling assignment is unavailable. Nothing was booked or sent.";
  const { data, error } = await admin.rpc(conversationOrigin ? "customer_rebooking_action_check" : "intake_booking_action_check", {
    p_work: workId, p_approval: originApprovalId, p_allow_completed: allowCompleted,
  });
  if (error || !data || typeof data.allowed !== "boolean") throw new Error("The current intake scheduling source could not be verified.");
  return data.allowed ? null : typeof data.reason === "string" ? data.reason : "The inquiry, customer request or scheduling authority changed.";
}

/** Original booking checks require the live assignment; follow-ups explicitly
 * check its completed original receipt instead of granting a new booking. */
export function intakeBookingDeliveryBlock(admin: SupabaseClient, job: ActionJobRecord) {
  return job.kind === "calendar.book" ? intakeBookingSourceBlock(admin, job.payload, job.approval_id ?? "") : Promise.resolve(null);
}
