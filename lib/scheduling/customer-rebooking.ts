import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { evaluateAuthority } from "../agents/authority.ts";
import type { BusinessAuthority } from "../business/context-contract.ts";
import { sameIntakeRevision, type IntakeAdoptionActor } from "../connections/intake-adoption.ts";

const version = z.iso.datetime({ offset: true }).refine((value) => !/\.\d{7}/.test(value));
const qualification = z.object({ service: z.string().trim().min(1).max(200), preference: z.string().trim().max(500),
  identityConfirmed: z.literal(true), bookingRequested: z.literal(true), instructionsReviewed: z.literal(true) }).strict();
export const CustomerRebookingCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("qualify_rebooking"), key: z.uuid(), bookingApprovalId: z.uuid(),
    expectedAppointmentUpdatedAt: version, expectedLeadUpdatedAt: version, expectedContactUpdatedAt: version,
    sourceRecordId: z.uuid().nullable(), sourceConnectionId: z.uuid().nullable(), externalId: z.string().min(1).max(500).nullable(), expectedSourceUpdatedAt: version.nullable(),
    conversationId: z.uuid().nullable(), expectedConversationRevision: z.number().int().positive().nullable(),
    expectedActivityId: z.uuid().nullable(), expectedActivityAt: version.nullable(), expectedAuthorityRevision: z.number().int().nonnegative(),
    qualification, owner_request: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  z.object({ action: z.literal("select_intake_slot"), key: z.uuid(), workId: z.uuid(), expectedWorkRevision: z.number().int().positive(),
    slot: z.number().int().min(1).max(3), owner_request: z.record(z.string(), z.unknown()).optional() }).strict(),
]);
export type CustomerRebookingCommand = z.infer<typeof CustomerRebookingCommandSchema>;
export type QualifyCustomerRebooking = Extract<CustomerRebookingCommand, { action: "qualify_rebooking" }>;
export class CustomerRebookingError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export function parseCustomerRebookingCommand(raw: unknown): CustomerRebookingCommand {
  const command = CustomerRebookingCommandSchema.safeParse(raw);
  if (!command.success) throw new CustomerRebookingError("Review current instructions and explicitly confirm the customer, service and new appointment request.", 400);
  return command.data;
}
type Scoped = { partner_id: string; client_id: string };
export type CustomerRebookingContext = {
  original: Scoped & { id: string; contactId: string; leadId: string; sourceRecordId: string | null; sourceConnectionId: string | null; externalId: string | null; conversationId: string | null; receipt: string | null; outcome: string };
  appointment: Scoped & { approvalId: string; contactId: string; leadId: string | null; updatedAt: string; status: string; endAt: string; completedAt: string | null };
  lead: Scoped & { id: string; contactId: string; updatedAt: string; status: string };
  contact: Scoped & { id: string; updatedAt: string; tags: string[] };
  source: null | (Scoped & { id: string; connectionId: string; externalId: string; updatedAt: string; nativeLeadId: string; linkedContactId: string; eligible: boolean; taskId: string });
  conversation: null | (Scoped & { id: string; connectionId: string | null; revision: number; contactId: string; leadId: string | null; identityStatus: string; mode: string; optedOut: boolean; state: string });
  activity: { id: string; at: string } | null;
  customerHandlingBlocked: boolean;
  competingAcceptedBooking: boolean;
  taskId: string;
  authority: BusinessAuthority;
};
export type CustomerRebookingPlan = {
  state: "queued" | "needs_setup"; missing: string[]; taskId: string; leadId: string; message: string;
  work: { kind: "booking_request"; conversationId: string | null; sourceLeadId: string; input: Record<string, unknown> };
};

/** This is a review of current evidence at an existing exact customer link.
 * Earlier qualification is deliberately never copied into the new assignment. */
export function planCustomerRebooking(actor: IntakeAdoptionActor, raw: QualifyCustomerRebooking, context: CustomerRebookingContext, now: Date): CustomerRebookingPlan {
  if (!actor.canWrite) throw new CustomerRebookingError("Business owner write access is required.", 403);
  const command = parseCustomerRebookingCommand(raw);
  if (command.action !== "qualify_rebooking") throw new CustomerRebookingError("Review the booking before choosing a time.", 400);
  const { original, appointment, lead, contact, source, conversation, authority } = context;
  for (const row of [original, appointment, lead, contact, source, conversation]) {
    if (row && (row.partner_id !== actor.partnerId || row.client_id !== actor.clientId)) throw new CustomerRebookingError("Booking evidence is unavailable in this workspace.", 404);
  }
  if (original.id !== command.bookingApprovalId || appointment.approvalId !== original.id || original.outcome !== "succeeded" || !original.receipt ||
    original.contactId !== contact.id || original.leadId !== lead.id || lead.contactId !== contact.id || appointment.contactId !== contact.id ||
    (appointment.leadId !== null && appointment.leadId !== lead.id) || !["cancelled", "completed"].includes(appointment.status) ||
    (appointment.status === "completed" && (!appointment.completedAt || Date.parse(appointment.completedAt) > now.getTime() || Date.parse(appointment.endAt) > now.getTime())) ||
    ["won", "lost"].includes(lead.status) || context.competingAcceptedBooking)
    throw new CustomerRebookingError("Review the recorded prior booking or competing action before requesting another appointment.", 409);
  if (!sameIntakeRevision(appointment.updatedAt, command.expectedAppointmentUpdatedAt) || !sameIntakeRevision(lead.updatedAt, command.expectedLeadUpdatedAt) ||
    !sameIntakeRevision(contact.updatedAt, command.expectedContactUpdatedAt) || authority.revision !== command.expectedAuthorityRevision ||
    (context.activity?.id ?? null) !== command.expectedActivityId || (context.activity ? !command.expectedActivityAt || !sameIntakeRevision(context.activity.at, command.expectedActivityAt) : command.expectedActivityAt !== null))
    throw new CustomerRebookingError("Customer instructions or booking evidence changed. Review the current records.", 409);
  if (context.customerHandlingBlocked || contact.tags.some((tag) => ["do_not_contact", "opt_out", "opted_out", "unsubscribed", "stop"].includes(tag.trim().toLowerCase().replace(/[\s-]+/g, "_"))))
    throw new CustomerRebookingError("Review the customer's suppression or human handling instructions before scheduling.", 409);
  let sourcePins: Record<string, unknown>;
  if (original.sourceRecordId) {
    if (!source || conversation || command.conversationId !== null || command.expectedConversationRevision !== null ||
      original.conversationId !== null || source.id !== original.sourceRecordId || source.id !== command.sourceRecordId ||
      source.connectionId !== original.sourceConnectionId || source.connectionId !== command.sourceConnectionId || source.externalId !== original.externalId || source.externalId !== command.externalId ||
      !source.eligible || source.nativeLeadId !== lead.id || source.linkedContactId !== contact.id || source.taskId !== context.taskId || !command.expectedSourceUpdatedAt || !sameIntakeRevision(source.updatedAt, command.expectedSourceUpdatedAt))
      throw new CustomerRebookingError("The current inquiry must retain its exact adopted source and customer link.", 409);
    sourcePins = { origin: "owner_intake", intake_record_id: source.id, intake_connection_id: source.connectionId, intake_external_id: source.externalId, source_updated_at: source.updatedAt };
  } else {
    if (!conversation || source || command.sourceRecordId !== null || command.sourceConnectionId !== null || command.externalId !== null || command.expectedSourceUpdatedAt !== null ||
      conversation.id !== original.conversationId || conversation.id !== command.conversationId || conversation.revision !== command.expectedConversationRevision ||
      conversation.contactId !== contact.id || (conversation.leadId !== null && conversation.leadId !== lead.id) || conversation.identityStatus !== "owner_verified" || conversation.mode !== "agent" || conversation.optedOut || conversation.state === "closed")
      throw new CustomerRebookingError("Review or resume the exact verified customer conversation before scheduling.", 409);
    sourcePins = { origin: "owner_conversation", conversation_id: conversation.id, conversation_revision: conversation.revision, source_connection_id: conversation.connectionId };
  }
  const permitted = evaluateAuthority({ authority, channel: "calendar", phase: "draft", expectedRevision: command.expectedAuthorityRevision });
  const state = permitted.allowed ? "queued" as const : "needs_setup" as const;
  return { state, missing: permitted.allowed ? [] : ["calendar_authority"], taskId: context.taskId, leadId: lead.id,
    message: permitted.allowed ? "Scheduling will check fresh times for owner review. No appointment is held, booked or messaged." : `${permitted.reason} Current qualification is saved for setup review.`,
    work: { kind: "booking_request" as const, conversationId: conversation?.id ?? null, sourceLeadId: lead.id,
      input: { ...sourcePins, rebooking_origin_approval_id: original.id, lead_updated_at: lead.updatedAt, contact_updated_at: contact.updatedAt,
        activity_id: context.activity?.id ?? null, activity_at: context.activity?.at ?? null, authority_revision: authority.revision,
        identity_confirmed: true, booking_requested: true, instructions_reviewed: true, service: command.qualification.service,
        preference: command.qualification.preference, task_id: context.taskId, qualified_at: now.toISOString() } } };
}

export type CustomerRebookingResult = { id: string; bookingApprovalId: string; leadId: string; taskId: string; workId: string; state: "queued" | "needs_setup"; missing: string[]; message: string; replayed: boolean };
const Result = z.object({ id: z.uuid(), bookingApprovalId: z.uuid(), leadId: z.uuid(), taskId: z.uuid(), workId: z.uuid(), state: z.enum(["queued", "needs_setup"]), missing: z.array(z.string()).max(12), message: z.string().min(1).max(2000), replayed: z.boolean() }).strict();
export type CustomerRebookingRepository = { apply(actor: IntakeAdoptionActor, command: CustomerRebookingCommand): Promise<unknown> };
export async function reviewCustomerRebooking(repository: CustomerRebookingRepository, actor: IntakeAdoptionActor, raw: unknown): Promise<CustomerRebookingResult> {
  if (!actor.canWrite) throw new CustomerRebookingError("Business owner write access is required.", 403);
  const command = parseCustomerRebookingCommand(raw), result = Result.safeParse(await repository.apply(actor, command));
  if (!result.success || (command.action === "qualify_rebooking" ? result.data.bookingApprovalId !== command.bookingApprovalId : result.data.workId !== command.workId))
    throw new CustomerRebookingError("The saved scheduling review could not be confirmed. Retry the same request key.", 503);
  return result.data;
}
export function supabaseCustomerRebookingRepository(admin: SupabaseClient): CustomerRebookingRepository {
  return { async apply(actor, command) {
    const { data, error } = await admin.rpc(command.action === "qualify_rebooking" ? "review_customer_rebooking" : "select_customer_rebooking_slot", {
      p_partner: actor.partnerId, p_client: actor.clientId, p_actor: actor.actorId, p_command: command,
    });
    if (error) throw new CustomerRebookingError(["40001", "23505"].includes(error.code) ? "Customer instructions, availability or booking state changed. Review current records." : "The review could not be saved. Retry the same request key.", ["40001", "23505"].includes(error.code) ? 409 : error.code === "22023" ? 422 : 503);
    return data;
  } };
}
