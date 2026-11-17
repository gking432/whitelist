import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { intakeJourneyRevision, type JourneyScope } from "./customer-journey-data.ts";
import { loadCurrentBookingReview, changeObject } from "../scheduling/calendar-change-context.ts";
import { prepareCalendarChange, CalendarChangeError } from "../scheduling/calendar-change-proposals.ts";

const Slot = z.object({ start_iso: z.iso.datetime({ offset: true }), end_iso: z.iso.datetime({ offset: true }), label: z.string().min(1).max(500) }).strict();
export const JourneyCommand = z.object({
  action: z.enum(["progress_inquiry", "select_intake_slot", "recover_confirmation", "prepare_reminder", "request_cancellation", "prepare_cancellation", "prepare_time_change", "prepare_rebooking", "qualify_rebooking"]),
  key: z.uuid(), targetId: z.uuid(), expectedRevision: z.string().min(1).max(1500),
  qualification: z.object({ service: z.string().trim().min(1).max(200), preference: z.string().trim().max(500).optional(), identityConfirmed: z.literal(true), bookingRequested: z.literal(true), instructionsReviewed: z.literal(true).optional() }).strict().optional(),
  offerId: z.uuid().optional(), slot: Slot.optional(),
}).strict();
export class JourneyCommandError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function sameJourneyRequest(left: unknown, right: unknown): boolean {
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)])) : value;
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}
export function selectStoredJourneySlot(offer: unknown, selected: z.infer<typeof Slot>, now = new Date().toISOString()) {
  const saved = object(offer);
  if (typeof saved.expires_at !== "string" || !Number.isFinite(Date.parse(saved.expires_at)) || Date.parse(saved.expires_at) <= Date.parse(now))
    throw new JourneyCommandError("These times expired. Ask scheduling for fresh availability.");
  const slots = Array.isArray(saved.slots) ? saved.slots : [];
  const index = slots.findIndex((raw) => { const slot = object(raw); return slot.start_iso === selected.start_iso && slot.end_iso === selected.end_iso && slot.label === selected.label; });
  if (index < 0 || index > 2) throw new JourneyCommandError("Choose an exact time offered by scheduling.");
  return index + 1;
}
export async function executeJourneyCommand(admin: SupabaseClient, actor: JourneyScope & { actorId: string; canWrite: boolean }, raw: unknown) {
  if (!actor.canWrite) throw new JourneyCommandError("Business owner write access is required.", 403);
  const parsed = JourneyCommand.safeParse(raw);
  if (!parsed.success) throw new JourneyCommandError("Review the current customer work and request.", 400);
  const command = parsed.data;
  const scoped = <Columns extends string>(table: string, columns: Columns) => admin.from(table).select(columns).eq("partner_id", actor.partnerId).eq("client_id", actor.clientId);
  let rpc = "apply_booking_lifecycle_command";
  let payload: Record<string, unknown> = command;
  if (["prepare_cancellation", "prepare_time_change", "qualify_rebooking", "request_cancellation"].includes(command.action)) {
    const prior = await scoped("business_owner_commands", "actor_id,command,result").eq("request_key", command.key).maybeSingle();
    if (prior.error) throw new JourneyCommandError("Saved decisions could not be checked. Retry unchanged.", 503);
    if (prior.data) {
      const stored = object(prior.data.command);
      if (prior.data.actor_id !== actor.actorId || !sameJourneyRequest(stored.owner_request ?? stored, command)) throw new JourneyCommandError("This request key belongs to a different decision.");
      return confirmResult({ ...object(prior.data.result), replayed: true }, "bookingApprovalId", command.targetId);
    }
  }
  if (command.action === "prepare_cancellation" || command.action === "prepare_time_change") {
    if (command.qualification) throw new JourneyCommandError("Calendar changes use their exact reviewed appointment and offer.", 400);
    try { return await prepareCalendarChange(admin, actor, { ...command, action: command.action }); }
    catch (error) { if (error instanceof CalendarChangeError) throw new JourneyCommandError(error.message, error.status); throw error; }
  }
  if (command.action === "prepare_rebooking") throw new JourneyCommandError("Review the current customer identity, instructions and appointment request before rebooking.", 400);
  if (command.action === "qualify_rebooking") {
    if (!command.qualification?.instructionsReviewed || command.offerId || command.slot) throw new JourneyCommandError("Explicitly review the current customer instructions before requesting another appointment.", 400);
    const current = await loadCurrentBookingReview(admin, actor, command.targetId);
    if (current.revision !== command.expectedRevision) throw new JourneyCommandError("The customer instructions or booking changed. Refresh and review again.");
    rpc = "review_customer_rebooking";
    payload = { action: "qualify_rebooking", key: command.key, bookingApprovalId: command.targetId,
      expectedAppointmentUpdatedAt: current.appointment.updated_at, expectedLeadUpdatedAt: current.lead.updated_at, expectedContactUpdatedAt: current.contact.updated_at,
      sourceRecordId: current.source?.id ?? null, sourceConnectionId: current.source?.connection_id ?? null, externalId: current.source?.external_object_id ?? null,
      expectedSourceUpdatedAt: current.source?.updated_at ?? null, conversationId: current.conversation?.id ?? null, expectedConversationRevision: current.conversation?.revision ?? null,
      expectedActivityId: current.activity?.id ?? null, expectedActivityAt: current.activity?.created_at ?? null, expectedAuthorityRevision: current.authorityRevision,
      qualification: { ...command.qualification, preference: command.qualification.preference ?? "" }, owner_request: command };
  } else if (command.action === "request_cancellation") {
    const current = await loadCurrentBookingReview(admin, actor, command.targetId);
    if (current.revision !== command.expectedRevision && current.appointment.updated_at !== command.expectedRevision) throw new JourneyCommandError("The appointment changed. Review the current cancellation request.");
    rpc = "save_calendar_change_handoff";
    payload = { ...command, expectedRevision: current.appointment.updated_at, owner_request: command };
  } else
  if (command.action === "progress_inquiry") {
    if (!command.qualification || command.qualification.instructionsReviewed !== undefined || command.offerId || command.slot) throw new JourneyCommandError("Review the customer and booking request first.", 400);
    // A committed response may have been lost. Replay the already-authorized
    // exact public request before source/contact freshness changes are checked.
    const prior = await scoped("business_owner_commands", "actor_id,command,result").eq("request_key", command.key).maybeSingle();
    if (prior.error) throw new JourneyCommandError("Saved decisions could not be checked. Retry the same request.", 503);
    if (prior.data) {
      const stored = object(prior.data.command);
      if (prior.data.actor_id !== actor.actorId || !sameJourneyRequest(stored.owner_request, command))
        throw new JourneyCommandError("This request key belongs to a different decision.");
      return confirmResult({ ...object(prior.data.result), replayed: true }, "leadId", command.targetId);
    }
    const [lead, source, settings] = await Promise.all([
      scoped("crm_leads", "id,contact_id,updated_at").eq("id", command.targetId).maybeSingle(),
      scoped("integration_canonical_records", "id,connection_id,external_object_id,updated_at").eq("object_type", "lead").eq("native_object_id", command.targetId).limit(2),
      scoped("agent_team_settings", "authority_revision").maybeSingle(),
    ]);
    if (lead.error || source.error || settings.error) throw new JourneyCommandError("Current inquiry evidence could not be checked.", 503);
    if (!lead.data || source.data?.length !== 1) throw new JourneyCommandError("The exact adopted inquiry source is unavailable.");
    const contact = await scoped("crm_contacts", "id,updated_at").eq("id", lead.data.contact_id).maybeSingle();
    if (contact.error || !contact.data) throw new JourneyCommandError("The selected customer is unavailable.");
    const sourceRow = source.data[0], authority = Number(settings.data?.authority_revision ?? 0);
    if (intakeJourneyRevision(sourceRow, lead.data, contact.data, authority) !== command.expectedRevision)
      throw new JourneyCommandError("The inquiry, customer or authority changed. Refresh and review again.");
    rpc = "progress_owner_intake_inquiry";
    payload = { action: "qualify_intake", key: command.key, connectionId: sourceRow.connection_id, recordId: sourceRow.id,
      externalId: sourceRow.external_object_id, expectedSourceUpdatedAt: sourceRow.updated_at, expectedLeadUpdatedAt: lead.data.updated_at,
      expectedContactUpdatedAt: contact.data.updated_at, expectedAuthorityRevision: authority, qualification: { ...command.qualification, preference: command.qualification.preference ?? "" }, owner_request: command };
  } else if (command.action === "select_intake_slot") {
    if (!command.slot || command.qualification || command.offerId !== command.targetId || !/^\d+$/.test(command.expectedRevision))
      throw new JourneyCommandError("Choose a currently offered appointment time.", 400);
    // Replay is also enforced atomically by the RPC, before current versions.
    const prior = await scoped("business_owner_commands", "actor_id,command,result").eq("request_key", command.key).maybeSingle();
    if (prior.error) throw new JourneyCommandError("Saved decisions could not be checked.", 503);
    if (prior.data) {
      if (prior.data.actor_id !== actor.actorId || !sameJourneyRequest(object(prior.data.command).owner_request, command)) throw new JourneyCommandError("This request key belongs to another choice.");
      return confirmResult({ ...object(prior.data.result), replayed: true }, "workId", command.targetId);
    }
    const work = await scoped("agent_work_items", "id,result,input,revision").eq("id", command.targetId).eq("kind", "booking_request").maybeSingle();
    if (work.error || !work.data) throw new JourneyCommandError("The scheduling assignment is unavailable.");
    if (String(work.data.revision) !== command.expectedRevision) throw new JourneyCommandError("The offered times changed. Refresh before choosing.");
    rpc = changeObject(work.data.input).origin === "owner_conversation" ? "select_customer_rebooking_slot" : "progress_owner_intake_inquiry";
    payload = { action: "select_intake_slot", key: command.key, workId: command.targetId, expectedWorkRevision: Number(command.expectedRevision),
      slot: selectStoredJourneySlot(object(work.data.result).offer, command.slot), owner_request: command };
  } else if (command.qualification || command.offerId || command.slot) throw new JourneyCommandError("This decision does not accept booking details.", 400);
  const { data, error } = await admin.rpc(rpc, { p_partner: actor.partnerId, p_client: actor.clientId, p_actor: actor.actorId, p_command: payload });
  if (error) {
    if (["40001", "22023", "23505", "P0002"].includes(error.code)) throw new JourneyCommandError("Customer work changed or needs setup. Refresh and review the current source before a new decision.");
    throw new JourneyCommandError("The saved decision could not be confirmed. Retry the same request.", 503);
  }
  return confirmResult(data, command.action === "progress_inquiry" ? "leadId" : command.action === "select_intake_slot" ? "workId" : "bookingApprovalId", command.targetId);
}
function confirmResult(value: unknown, field: string, targetId: string) {
  const receipt = z.object({ id: z.uuid(), message: z.string().min(1), replayed: z.boolean() }).passthrough().safeParse(value);
  if (!receipt.success || receipt.data[field] !== targetId) throw new JourneyCommandError("The server did not confirm the saved customer decision. Retry the unchanged request.", 503);
  return receipt.data;
}
