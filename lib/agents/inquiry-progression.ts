import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { WorkItem, WorkStatus } from "./types.ts";

const Slot = z.object({ start_iso: z.iso.datetime({ offset: true }), end_iso: z.iso.datetime({ offset: true }), label: z.string().min(1).max(300) }).strict();
export const IntakeSchedulingOfferSchema = z.object({
  slots: z.array(Slot).max(3), timezone: z.string().min(1).max(100),
  provider: z.enum(["northstar_internal", "google_calendar", "google_workspace", "microsoft_365"]),
  calendar_connection_id: z.uuid().nullable(), checked_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }),
}).strict();
export type IntakeSchedulingOffer = z.infer<typeof IntakeSchedulingOfferSchema>;
export type IntakeSchedulingWork = Pick<WorkItem, "id" | "kind" | "partner_id" | "client_id" | "conversation_id" | "source_lead_id" | "approval_id" | "claim_token" | "revision" | "input" | "result">;
export type IntakeSchedulingCheck = { allowed: boolean; reason: string; contact?: { id: string; name: string; email: string | null; phone: string | null }; leadId?: string; taskId?: string };
export type IntakeBookingOutcome = {
  approval: { status: string; expires_at: string | null };
  job: { id: string; status: string; external_ref: string | null; outcome_detail: string | null; attempt_count: number } | null;
};
export type IntakeSchedulingDependencies = {
  now(): Date;
  check(work: IntakeSchedulingWork): Promise<IntakeSchedulingCheck>;
  authority(work: IntakeSchedulingWork, offer?: IntakeSchedulingOffer): Promise<{ allowed: boolean; reason: string; revision: number }>;
  availability(work: IntakeSchedulingWork): Promise<Omit<IntakeSchedulingOffer, "expires_at">>;
  available(work: IntakeSchedulingWork, offer: IntakeSchedulingOffer, slot: IntakeSchedulingOffer["slots"][number]): Promise<boolean>;
  saveOffer(work: IntakeSchedulingWork, offer: IntakeSchedulingOffer): Promise<void>;
  propose(work: IntakeSchedulingWork, metadata: Record<string, unknown>): Promise<void>;
  outcome(work: IntakeSchedulingWork): Promise<IntakeBookingOutcome>;
  finish(work: IntakeSchedulingWork, status: WorkStatus, summary: string, result: Record<string, unknown>): Promise<void>;
};

export function intakeBookingOutcome(outcome: IntakeBookingOutcome, now: Date, origin: "owner_intake" | "owner_conversation" = "owner_intake"): { status: WorkStatus; summary: string; result: Record<string, unknown> } {
  const { job, approval } = outcome;
  const result = { booking_outcome: job?.status ?? null, action_id: job?.id ?? null, external_ref: job?.external_ref ?? null };
  // Observe accepted/uncertain operations before considering changed approval
  // or source state. A stopped instruction cannot undo a provider operation.
  if (job?.status === "succeeded") return job.external_ref
    ? { status: "completed", summary: origin === "owner_conversation" ? "Appointment booked with a recorded result. Review confirmation in the original customer conversation; this scheduling assignment sent no message." : "Appointment booked with a recorded result. Confirm it with the customer manually; no message was sent from the form.", result: { ...result, booked: true, needs_human_confirmation: true } }
    : { status: "blocked", summary: "The action reports success without a booking receipt. Reconcile that action before any retry or customer confirmation.", result };
  if (job?.status === "uncertain") return { status: "blocked", summary: "The booking outcome is uncertain. Reconcile the existing action before retrying or confirming anything.", result };
  if (job && ["processing", "provider_pending"].includes(job.status)) return { status: "waiting_external", summary: "The existing calendar action is processing. No confirmed booking receipt is available yet.", result };
  if (["rejected", "expired", "cancelled"].includes(approval.status) || (approval.status === "pending" && !!approval.expires_at && Date.parse(approval.expires_at) <= now.getTime()))
    return { status: "blocked", summary: "The booking decision was declined or expired. Request fresh availability before proposing another booking.", result };
  if (job?.status === "failed") return { status: job.attempt_count < 5 ? "waiting_external" : "blocked", summary: "The calendar action failed. Its existing action queue controls retries; no booking has been confirmed.", result };
  if (job && !["pending"].includes(job.status)) return { status: "blocked", summary: "The calendar action did not confirm a booking. Review its recorded result before proceeding.", result };
  if (approval.status === "pending") return { status: "waiting_approval", summary: "The selected appointment is awaiting owner approval. It is not booked or held.", result };
  if (["approved", "edited_and_approved"].includes(approval.status)) return { status: "waiting_external", summary: "The appointment was approved; waiting for the existing calendar action and its receipt.", result };
  return { status: "blocked", summary: "The saved booking decision could not be interpreted. Review it before any further action.", result };
}

function checkedOffer(raw: unknown, now: Date, allowExpired = false): IntakeSchedulingOffer {
  const offer = IntakeSchedulingOfferSchema.parse(raw);
  new Intl.DateTimeFormat("en", { timeZone: offer.timezone });
  const checked = Date.parse(offer.checked_at), expires = Date.parse(offer.expires_at);
  if (checked > now.getTime() + 300000 || expires <= checked || expires > checked + 15 * 60000 || (!allowExpired && expires <= now.getTime()) ||
    (offer.provider === "northstar_internal" ? offer.calendar_connection_id !== null : !offer.calendar_connection_id)) throw new Error("Availability is expired or its calendar binding is invalid.");
  if (new Set(offer.slots.map((slot) => `${slot.start_iso}:${slot.end_iso}`)).size !== offer.slots.length ||
    offer.slots.some((slot) => Date.parse(slot.end_iso) <= Date.parse(slot.start_iso) || Date.parse(slot.start_iso) <= now.getTime())) throw new Error("Availability contains invalid or elapsed times.");
  return offer;
}

/** Model-free scheduling specialist over the existing durable assignment and
 * approval/outbox. Every mutation is claim-bound in the production repository. */
export async function runIntakeScheduling(work: IntakeSchedulingWork, dependencies: IntakeSchedulingDependencies): Promise<void> {
  const origin = work.input.origin;
  if (origin !== "owner_intake" && origin !== "owner_conversation") throw new Error("This is not an owner-reviewed scheduling assignment.");
  if (work.kind !== "booking_request" || !work.source_lead_id || !work.claim_token ||
    (origin === "owner_intake" ? work.conversation_id !== null : !work.conversation_id ||
      work.input.conversation_id !== work.conversation_id || work.input.instructions_reviewed !== true || !work.input.rebooking_origin_approval_id))
    throw new Error("This is not a claimed owner-reviewed scheduling assignment.");
  if (work.approval_id) {
    const outcome = intakeBookingOutcome(await dependencies.outcome(work), dependencies.now(), origin);
    await dependencies.finish(work, outcome.status, outcome.summary, { ...work.result, ...outcome.result });
    return;
  }
  const eligible = await dependencies.check(work);
  if (!eligible.allowed) {
    await dependencies.finish(work, "cancelled", eligible.reason, { ...work.result, phase: "interrupted" });
    return;
  }
  const authority = await dependencies.authority(work);
  if (!authority.allowed) {
    await dependencies.finish(work, "blocked", authority.reason, { ...work.result, phase: "needs_setup" });
    return;
  }
  const selected = work.input.slot !== undefined;
  if (!selected && work.result.offer) {
    try {
      const offer = checkedOffer(work.result.offer, dependencies.now());
      await dependencies.finish(work, "waiting_approval", "Choose one of the saved available times. No appointment is held or booked.", { ...work.result, phase: "choose_slot", offer });
    } catch {
      await dependencies.finish(work, "blocked", "The saved availability expired. Request a fresh check before choosing a time; nothing was booked.", { ...work.result, phase: "needs_availability" });
    }
    return;
  }
  if (!selected) {
    let offer: IntakeSchedulingOffer;
    try {
      const available = await dependencies.availability(work);
      offer = checkedOffer({ ...available, expires_at: new Date(Date.parse(available.checked_at) + 15 * 60000).toISOString() }, dependencies.now());
    } catch {
      await dependencies.finish(work, "blocked", "Calendar availability could not be checked. Review business availability and calendar access, then request a fresh check; nothing was booked.", { ...work.result, phase: "needs_setup" });
      return;
    }
    const after = await dependencies.check(work), latest = await dependencies.authority(work, offer);
    if (!after.allowed || !latest.allowed || latest.revision !== authority.revision) {
      await dependencies.finish(work, "blocked", !after.allowed ? after.reason : !latest.allowed ? latest.reason : "Authority changed during availability checks.", { ...work.result, phase: "interrupted" });
      return;
    }
    if (!offer.slots.length) {
      await dependencies.finish(work, "blocked", "No supported available times were returned. Review calendar access or change the preference; nothing was booked.", { ...work.result, phase: "needs_availability" });
      return;
    }
    await dependencies.saveOffer(work, offer);
    return;
  }
  let offer: IntakeSchedulingOffer, slot: IntakeSchedulingOffer["slots"][number];
  try {
    // Selection was revision/expiry checked by the owner command. Recheck the
    // exact saved slot and current availability before preparing an approval.
    offer = checkedOffer(work.result.offer, dependencies.now(), true);
    const index = work.input.selection_index;
    if (!Number.isInteger(index) || Number(index) < 1 || Number(index) > 3) throw new Error("Missing explicit owner selection.");
    slot = offer.slots[Number(index) - 1];
    const selectedSlot = Slot.parse(work.input.slot);
    if (!slot || slot.start_iso !== selectedSlot.start_iso || slot.end_iso !== selectedSlot.end_iso || slot.label !== selectedSlot.label ||
      work.input.provider !== offer.provider || work.input.calendar_connection_id !== offer.calendar_connection_id || work.input.timezone !== offer.timezone)
      throw new Error("The selection does not match its saved calendar offer.");
  } catch {
    await dependencies.finish(work, "blocked", "The selected time does not match its saved offer. Request fresh availability; nothing was booked.", { ...work.result, phase: "needs_availability" });
    return;
  }
  let stillAvailable: boolean;
  try { stillAvailable = await dependencies.available(work, offer, slot); }
  catch {
    await dependencies.finish(work, "blocked", "Calendar access could not be verified for the selected time. Restore access and request fresh availability; nothing was booked.", { ...work.result, phase: "needs_setup" });
    return;
  }
  if (!stillAvailable) {
    await dependencies.finish(work, "blocked", "That time is no longer available. Request fresh choices; nothing was booked.", { ...work.result, phase: "needs_availability" });
    return;
  }
  const after = await dependencies.check(work), latest = await dependencies.authority(work, offer);
  if (!after.allowed || !latest.allowed || latest.revision !== authority.revision || !after.contact || !after.leadId || !after.taskId) {
    await dependencies.finish(work, "blocked", !after.allowed ? after.reason : !latest.allowed ? latest.reason : "Customer context or authority changed before proposal.", { ...work.result, phase: "interrupted" });
    return;
  }
  await dependencies.propose(work, {
    ...(origin === "owner_intake" ? { origin, intake_work_id: work.id, intake_record_id: work.input.intake_record_id, intake_connection_id: work.input.intake_connection_id,
      intake_external_id: work.input.intake_external_id, source_updated_at: work.input.source_updated_at } : {
      origin, customer_rebooking_work_id: work.id, conversation_id: work.conversation_id, conversation_revision: work.input.conversation_revision,
      source_connection_id: work.input.source_connection_id, activity_id: work.input.activity_id, activity_at: work.input.activity_at,
    }),
    rebooking_origin_approval_id: work.input.rebooking_origin_approval_id, qualified_at: work.input.qualified_at,
    instructions_reviewed: work.input.instructions_reviewed, lead_updated_at: work.input.lead_updated_at,
    contact_updated_at: work.input.contact_updated_at, authority_revision: latest.revision,
    contact_id: after.contact.id, lead_id: after.leadId, task_id: after.taskId, contact: after.contact,
    identity_confirmed: true, booking_requested: true, service: work.input.service,
    slot, provider: offer.provider, calendar_connection_id: offer.calendar_connection_id, timezone: offer.timezone,
  });
}

export async function processIntakeBookingRequest(admin: SupabaseClient, work: WorkItem) {
  if (work.input.origin !== "owner_intake") throw new Error("Not an adopted-inquiry assignment.");
  return processOwnerScheduling(admin, work, "intake");
}

/** Owner choices reuse the verified original thread, but do not assert that an
 * offer was sent to the customer or send a confirmation as a side effect. */
export async function processCustomerRebooking(admin: SupabaseClient, work: WorkItem) {
  if (work.input.origin !== "owner_conversation") throw new Error("Not an owner-reviewed conversation rebooking.");
  return processOwnerScheduling(admin, work, "customer_rebooking");
}

async function processOwnerScheduling(admin: SupabaseClient, work: WorkItem, path: "intake" | "customer_rebooking") {
  const [{ availableSlots, checkSelectedSlot }, { readEffectiveAuthority }, { finishWork }] = await Promise.all([
    import("../conversations/availability.ts"), import("./authority.ts"), import("./store.ts"),
  ]);
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const result = await admin.rpc(name, args);
    if (result.error) throw new Error("The inquiry scheduling operation could not be saved. Its source or assignment may have changed.");
    return result.data;
  };
  await runIntakeScheduling(work, {
    now: () => new Date(),
    check: async (item) => {
      const data = await rpc(path === "intake" ? "intake_scheduling_check" : "customer_rebooking_scheduling_check", { p_work: item.id, p_claim: item.claim_token });
      if (!data || typeof data.allowed !== "boolean" || typeof data.reason !== "string") throw new Error("Inquiry eligibility could not be confirmed.");
      return data;
    },
    authority: (item, offer) => readEffectiveAuthority(admin, { partnerId: item.partner_id, clientId: item.client_id }, "calendar", {
      phase: "draft", expectedRevision: Number(item.input.authority_revision), connectionId: offer?.calendar_connection_id,
      internalCalendar: !offer || offer.provider === "northstar_internal",
    }),
    availability: (item) => availableSlots(admin, { partnerId: item.partner_id, clientId: item.client_id }, String(item.input.preference ?? "")),
    available: (item, offer, slot) => checkSelectedSlot(admin, { partnerId: item.partner_id, clientId: item.client_id }, { slot, provider: offer.provider, calendarConnectionId: offer.calendar_connection_id }),
    saveOffer: async (item, offer) => { if (await rpc(path === "intake" ? "save_intake_scheduling_offer" : "save_customer_rebooking_offer", { p_work: item.id, p_claim: item.claim_token, p_offer: offer }) !== true) throw new Error("The availability offer was not committed."); },
    propose: async (item, metadata) => { if (await rpc(path === "intake" ? "propose_intake_booking" : "propose_customer_rebooking", { p_work: item.id, p_claim: item.claim_token, p_metadata: metadata }) !== true) throw new Error("The booking proposal was not committed."); },
    outcome: async (item) => {
      const [approval, job] = await Promise.all([
        admin.from("approval_items").select("status,expires_at").eq("id", item.approval_id!).eq("partner_id", item.partner_id).eq("client_id", item.client_id).single(),
        admin.from("action_jobs").select("id,status,external_ref,outcome_detail,attempt_count").eq("approval_id", item.approval_id!).eq("partner_id", item.partner_id).eq("client_id", item.client_id).maybeSingle(),
      ]);
      if (approval.error || job.error) throw new Error("The existing booking result could not be verified.");
      return { approval: approval.data, job: job.data };
    },
    finish: (item, status, summary, result) => finishWork(admin, item as WorkItem, status, summary, result, 120),
  });
}
