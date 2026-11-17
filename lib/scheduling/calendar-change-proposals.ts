import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCurrentBookingReview, changeObject, type CalendarChangeScope } from "./calendar-change-context.ts";
import { computeOpenSlots, formatSlotLabel } from "./slots.ts";
import type { CustomerJourneyOffer, CustomerJourneySlot } from "../business/customer-journey-contract.ts";

export class CalendarChangeError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}
export async function prepareCalendarChangeOffer(admin: SupabaseClient, actor: CalendarChangeScope & { actorId: string }, bookingId: string, now = new Date()): Promise<CustomerJourneyOffer> {
  const current = await loadCurrentBookingReview(admin, actor, bookingId, now.toISOString());
  if (!current.review.writeAllowed || !current.payload) throw new CalendarChangeError(current.review.writeDetail);
  const [{ readActivationPlan }, { reviewedInternalAvailabilityWindows }] = await Promise.all([import("../activation/service"), import("../connections/intake-progression.ts")]);
  const activation = await readActivationPlan(admin, actor);
  if (!activation || activation.status !== "active" || !activation.bookings) throw new CalendarChangeError("Review and enable the current booking hours before changing this time.");
  const until = new Date(now.getTime() + 7 * 86400000);
  let busy: { start: string; end: string }[];
  const native = current.payload.provider === "northstar_internal";
  if (native) {
    const appointments = await admin.from("crm_appointments").select("start_at,end_at")
      .eq("partner_id", actor.partnerId).eq("client_id", actor.clientId).neq("id", current.payload.appointment_id)
      .in("status", ["booked", "proposed"]).gt("end_at", now.toISOString()).lt("start_at", until.toISOString());
    if (appointments.error) throw new CalendarChangeError("The internal calendar could not be checked.", 503);
    busy = (appointments.data ?? []).map((row) => ({ start: row.start_at, end: row.end_at }));
  } else {
    const [{ readProviderCredentials }, { getCalendarMutationOffer }] = await Promise.all([import("../integrations/credentials"), import("./calendar-mutation.ts")]);
    const credentials = await readProviderCredentials<Parameters<typeof getCalendarMutationOffer>[0]>(admin, current.payload.calendar_connection_id!);
    if (!credentials) throw new CalendarChangeError("Reconnect the exact calendar with write permission before changing its appointments.");
    const observed = await getCalendarMutationOffer(credentials, current.payload, { start_iso: now.toISOString(), end_iso: until.toISOString() });
    busy = observed.busy;
  }
  const nativeWindows = native ? await admin.from("crm_availability_windows").select("weekday,start_time,end_time,appointment_minutes")
    .eq("partner_id", actor.partnerId).eq("client_id", actor.clientId).eq("active", true) : { data: [], error: null };
  if (nativeWindows.error) throw new CalendarChangeError("Current business availability could not be checked.", 503);
  const windows = native ? reviewedInternalAvailabilityWindows(nativeWindows.data ?? [], activation) : activation.booking_weekdays.map((weekday) => ({
    weekday, start_time: `${String(activation.booking_start_hour).padStart(2, "0")}:00`, end_time: `${String(activation.booking_end_hour).padStart(2, "0")}:00`, appointment_minutes: activation.booking_minutes,
  }));
  const oldDuration = Date.parse(current.payload.old_slot.end_iso) - Date.parse(current.payload.old_slot.start_iso);
  const slots = computeOpenSlots(busy, { timezone: activation.timezone, now, durationMinutes: oldDuration / 60000,
    businessStartHour: activation.booking_start_hour, businessEndHour: activation.booking_end_hour, availabilityWindows: windows, maxSlots: 12, maxPerDay: 4 })
    .filter((slot) => Date.parse(slot.endIso) - Date.parse(slot.startIso) === oldDuration &&
      !(Date.parse(slot.startIso) === Date.parse(current.payload!.old_slot.start_iso) && Date.parse(slot.endIso) === Date.parse(current.payload!.old_slot.end_iso)))
    .slice(0, 3).map((slot) => ({ start_iso: slot.startIso, end_iso: slot.endIso, label: formatSlotLabel(slot.startIso, activation.timezone) }));
  if (!slots.length) throw new CalendarChangeError("No supported replacement times were returned. Review current business hours or choose a time in the source calendar.");
  // Recheck owner/context versions after provider reads before persisting an offer.
  const latest = await loadCurrentBookingReview(admin, actor, bookingId);
  if (latest.revision !== current.revision || !latest.review.writeAllowed) throw new CalendarChangeError("The appointment or instructions changed during availability checks. Refresh and review again.");
  const id = randomUUID(), expiresAt = new Date(Date.now() + 15 * 60000).toISOString();
  const saved = await admin.rpc("save_calendar_mutation_offer", { p_partner: actor.partnerId, p_client: actor.clientId, p_actor: actor.actorId,
    p_offer: { id, bookingApprovalId: bookingId, revision: current.revision, expiresAt, slots, payload: current.payload } });
  if (saved.error || saved.data !== id) throw new CalendarChangeError("The source-bound availability offer could not be saved. Try a fresh check.", 503);
  return { id, targetId: bookingId, revision: current.revision, expiresAt, provider: current.payload.provider, timezone: activation.timezone, slots,
    detail: "Replacement times use the original calendar and current business hours. Nothing is held or changed; owner approval and final availability checks are still required." };
}

export async function prepareCalendarChange(admin: SupabaseClient, actor: CalendarChangeScope & { actorId: string }, command: {
  action: "prepare_cancellation" | "prepare_time_change"; key: string; targetId: string; expectedRevision: string; offerId?: string; slot?: CustomerJourneySlot;
}) {
  const current = await loadCurrentBookingReview(admin, actor, command.targetId);
  if (!current.payload || !current.review.writeAllowed) throw new CalendarChangeError(current.review.writeDetail);
  if (current.revision !== command.expectedRevision) throw new CalendarChangeError("The current appointment, source or customer instructions changed. Review a fresh decision.");
  if (command.action === "prepare_time_change" && (!command.offerId || !command.slot)) throw new CalendarChangeError("Choose an exact saved replacement time.", 400);
  if (command.action === "prepare_cancellation" && (command.offerId || command.slot)) throw new CalendarChangeError("A cancellation cannot include a replacement time.", 400);
  const payload = { ...current.payload, mutation: command.action === "prepare_cancellation" ? "cancel" : "reschedule",
    ...(command.slot ? { new_slot: { start_iso: command.slot.start_iso, end_iso: command.slot.end_iso } } : {}) };
  const result = await admin.rpc("prepare_calendar_mutation", { p_partner: actor.partnerId, p_client: actor.clientId, p_actor: actor.actorId,
    p_command: { ...command, payload, owner_request: command } });
  if (result.error) {
    if (["40001", "22023", "23505"].includes(result.error.code)) throw new CalendarChangeError("The appointment changed or another decision already exists. Refresh current work before preparing another change.");
    throw new CalendarChangeError("The saved calendar proposal could not be confirmed. Retry the unchanged request.", 503);
  }
  const receipt = changeObject(result.data);
  if (typeof receipt.id !== "string" || receipt.bookingApprovalId !== command.targetId || typeof receipt.approvalId !== "string" || typeof receipt.message !== "string" || typeof receipt.replayed !== "boolean")
    throw new CalendarChangeError("The server did not confirm a saved calendar proposal. Retry unchanged.", 503);
  return receipt;
}
