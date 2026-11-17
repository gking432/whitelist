import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { evaluateAuthority } from "../agents/authority.ts";
import type { BusinessAuthority } from "../business/context-contract.ts";
import type { ActivationPlan } from "../activation/types.ts";
import type { AvailabilityWindow } from "../scheduling/slots.ts";
import { sameIntakeRevision, type IntakeAdoptionActor, type IntakeAdoptionConnection, type IntakeAdoptionSource } from "./intake-adoption.ts";

export class IntakeProgressionError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
const version = z.iso.datetime({ offset: true }).refine((value) => !/\.\d{7}/.test(value));
export const IntakeProgressionCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("qualify_intake"), key: z.uuid(), connectionId: z.uuid(), recordId: z.uuid(), externalId: z.string().min(1).max(500),
    owner_request: z.record(z.string(), z.unknown()).optional(),
    expectedSourceUpdatedAt: version, expectedLeadUpdatedAt: version, expectedContactUpdatedAt: version,
    expectedAuthorityRevision: z.number().int().nonnegative(),
    qualification: z.object({ service: z.string().trim().max(200), preference: z.string().trim().max(500), identityConfirmed: z.boolean(), bookingRequested: z.boolean() }).strict(),
  }).strict(),
  z.object({ action: z.literal("select_intake_slot"), key: z.uuid(), workId: z.uuid(), expectedWorkRevision: z.number().int().positive(), slot: z.number().int().min(1).max(3), owner_request: z.record(z.string(), z.unknown()).optional() }).strict(),
]);
export type IntakeProgressionCommand = z.infer<typeof IntakeProgressionCommandSchema>;
export type QualifyIntakeCommand = Extract<IntakeProgressionCommand, { action: "qualify_intake" }>;
export type IntakeProgressionResult = { id: string; sourceRecordId: string; leadId: string; taskId: string; workId: string | null;
  state: "needs_details" | "needs_setup" | "queued"; missing: string[]; message: string; replayed: boolean };
const Result = z.object({ id: z.uuid(), sourceRecordId: z.uuid(), leadId: z.uuid(), taskId: z.uuid(), workId: z.uuid().nullable(),
  state: z.enum(["needs_details", "needs_setup", "queued"]), missing: z.array(z.string().min(1).max(100)).max(12), message: z.string().min(1).max(2000), replayed: z.boolean() }).strict();
export function parseIntakeProgressionCommand(raw: unknown): IntakeProgressionCommand {
  const parsed = IntakeProgressionCommandSchema.safeParse(raw);
  if (!parsed.success) throw new IntakeProgressionError("Review the inquiry versions and choose an explicit qualification or offered time.", 400);
  return parsed.data;
}

/** Saved native windows and the owner's activation choices are both upper
 * bounds. An empty intersection must never reach the slot engine, where an
 * empty windows array means use its generic default hours. */
export function reviewedInternalAvailabilityWindows(native: AvailabilityWindow[], activation: Pick<ActivationPlan, "status" | "booking_weekdays" | "booking_start_hour" | "booking_end_hour" | "booking_minutes"> | null): AvailabilityWindow[] {
  if (!activation) {
    if (!native.length) throw new Error("Set business availability before offering appointments.");
    return native;
  }
  if (activation.status !== "active" || !activation.booking_weekdays.length || !Number.isInteger(activation.booking_minutes) || activation.booking_minutes <= 0 || activation.booking_end_hour <= activation.booking_start_hour)
    throw new Error("Review the saved booking availability before offering appointments.");
  const owner = [...new Set(activation.booking_weekdays)].map((weekday): AvailabilityWindow => ({ weekday,
    start_time: `${String(activation.booking_start_hour).padStart(2, "0")}:00`, end_time: `${String(activation.booking_end_hour).padStart(2, "0")}:00`, appointment_minutes: activation.booking_minutes }));
  if (!native.length) return owner;
  const minutes = (time: string, start: boolean) => {
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(time);
    if (!match) throw new Error("Business availability contains an invalid clock time.");
    const hour = Number(match[1]), minute = Number(match[2]), second = Number(match[3] ?? 0);
    if (hour > 24 || minute > 59 || second > 59 || (hour === 24 && (minute || second))) throw new Error("Business availability contains an invalid clock time.");
    return hour * 60 + minute + (start && (second > 0 || /[1-9]/.test(match[4] ?? "")) ? 1 : 0);
  };
  const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const result = native.flatMap((window): AvailabilityWindow[] => {
    if (!activation.booking_weekdays.includes(window.weekday) || window.appointment_minutes !== activation.booking_minutes) return [];
    const start = Math.max(minutes(window.start_time, true), activation.booking_start_hour * 60);
    const end = Math.min(minutes(window.end_time, false), activation.booking_end_hour * 60);
    return end - start >= activation.booking_minutes ? [{ ...window, start_time: clock(start), end_time: clock(end) }] : [];
  });
  if (!result.length) throw new Error("Saved business availability and booking choices do not overlap. Align their days, hours and appointment length before offering times.");
  return result;
}
type Scoped = { partner_id: string; client_id: string };
export type IntakeQualificationContext = {
  source: IntakeAdoptionSource; connection: IntakeAdoptionConnection;
  lead: Scoped & { id: string; contact_id: string; status: string; updated_at: string };
  contact: Scoped & { id: string; updated_at: string; tags: string[] };
  link: Scoped & { connection_id: string; object_type: string; external_object_id: string; native_object_id: string;
    metadata: { source_record_id?: string; contact_id?: string; task_id?: string } };
  authority: BusinessAuthority;
};
export type IntakeQualificationPlan = {
  state: "needs_details" | "needs_setup" | "queued"; missing: string[]; message: string;
  taskId: string; leadId: string;
  work: null | { kind: "booking_request"; sourceLeadId: string; title: string; input: Record<string, unknown> };
};

/** Deliberate owner qualification only; a form's prose is never parsed into customer consent or a selected slot. */
export function planIntakeQualification(actor: IntakeAdoptionActor, raw: QualifyIntakeCommand, context: IntakeQualificationContext): IntakeQualificationPlan {
  if (!actor.canWrite) throw new IntakeProgressionError("Business owner write access is required.", 403);
  const command = parseIntakeProgressionCommand(raw);
  if (command.action !== "qualify_intake") throw new IntakeProgressionError("Choose a qualification command.", 400);
  const { source, connection, lead, contact, link, authority } = context;
  for (const record of [source, connection, lead, contact, link])
    if (record.partner_id !== actor.partnerId || record.client_id !== actor.clientId) throw new IntakeProgressionError("Inquiry records are unavailable in this workspace.", 404);
  if (source.id !== command.recordId || source.connection_id !== command.connectionId || connection.id !== command.connectionId ||
    source.external_object_id !== command.externalId || source.object_type !== "lead" || connection.provider_key !== "generic_inbound_webhook" ||
    source.native_object_id !== lead.id || lead.contact_id !== contact.id || link.connection_id !== connection.id || link.object_type !== "lead" ||
    link.external_object_id !== source.external_object_id || link.native_object_id !== lead.id || link.metadata.source_record_id !== source.id ||
    link.metadata.contact_id !== contact.id || !z.uuid().safeParse(link.metadata.task_id).success)
    throw new IntakeProgressionError("The source, adopted lead and selected contact no longer share the same recorded link.", 409);
  if (connection.status !== "connected" || connection.runtime_mode === "paused" || connection.config?.workspace_view_only !== true ||
    !source.canonical_data || source.canonical_data.deleted === true || !["new", "updated"].includes(String(source.canonical_data.status)))
    throw new IntakeProgressionError("The source is paused, disconnected, deleted or no longer eligible.", 409);
  if (!sameIntakeRevision(source.updated_at, command.expectedSourceUpdatedAt) || !sameIntakeRevision(lead.updated_at, command.expectedLeadUpdatedAt) ||
    !sameIntakeRevision(contact.updated_at, command.expectedContactUpdatedAt) || authority.revision !== command.expectedAuthorityRevision)
    throw new IntakeProgressionError("The inquiry, customer or authority changed. Review the current records before continuing.", 409);
  if (["scheduled", "won", "lost"].includes(lead.status)) throw new IntakeProgressionError("This lead is already scheduled or closed. Review its saved result before starting another booking.", 409);
  if (contact.tags.some((tag) => ["do_not_contact", "opt_out", "opted_out", "unsubscribed", "stop"].includes(tag.trim().toLowerCase().replace(/[\s-]+/g, "_"))))
    throw new IntakeProgressionError("This contact is suppressed. Review its instructions before requesting more work.", 409);
  const missing = [!command.qualification.service && "service", !command.qualification.identityConfirmed && "identity_confirmation", !command.qualification.bookingRequested && "appointment_request"].filter((item): item is string => !!item);
  const base = { taskId: link.metadata.task_id!, leadId: lead.id };
  if (missing.length) return { ...base, state: "needs_details", missing, work: null, message: "Qualification saved for human review. Confirm the service, customer identity and appointment request before scheduling; nothing was sent." };
  const allowed = evaluateAuthority({ authority, channel: "calendar", phase: "draft", expectedRevision: command.expectedAuthorityRevision });
  if (!allowed.allowed) return { ...base, state: "needs_setup", missing: ["calendar_authority"], work: null, message: `${allowed.reason} Qualification is saved; scheduling has not started.` };
  return { ...base, state: "queued", missing: [], message: "Scheduling queued to check real availability. No time is held or booked.", work: {
    kind: "booking_request", sourceLeadId: lead.id, title: `Check appointment times: ${command.qualification.service}`.slice(0, 180),
    input: { origin: "owner_intake", intake_record_id: source.id, intake_connection_id: connection.id, intake_external_id: source.external_object_id,
      source_updated_at: source.updated_at, lead_updated_at: lead.updated_at, contact_updated_at: contact.updated_at,
      authority_revision: authority.revision, identity_confirmed: true, booking_requested: true,
      service: command.qualification.service, preference: command.qualification.preference, task_id: link.metadata.task_id },
  } };
}

export type IntakeProgressionRepository = { apply(actor: IntakeAdoptionActor, command: IntakeProgressionCommand): Promise<unknown> };
export async function progressIntakeInquiry(repository: IntakeProgressionRepository, actor: IntakeAdoptionActor, raw: unknown): Promise<IntakeProgressionResult> {
  if (!actor.canWrite) throw new IntakeProgressionError("Business owner write access is required.", 403);
  const command = parseIntakeProgressionCommand(raw), parsed = Result.safeParse(await repository.apply(actor, command));
  if (!parsed.success || (parsed.data.state === "queued" && !parsed.data.workId) ||
    (command.action === "qualify_intake" && parsed.data.sourceRecordId !== command.recordId) ||
    (command.action === "select_intake_slot" && parsed.data.workId !== command.workId))
    throw new IntakeProgressionError("The saved progression could not be confirmed. Retry with the same request key.", 503);
  return parsed.data;
}
export function supabaseIntakeProgressionRepository(admin: SupabaseClient): IntakeProgressionRepository {
  return { async apply(actor, command) {
    const { data, error } = await admin.rpc("progress_owner_intake_inquiry", { p_partner: actor.partnerId, p_client: actor.clientId, p_actor: actor.actorId, p_command: command });
    if (error) {
      if (["40001", "23505"].includes(error.code)) throw new IntakeProgressionError("The inquiry, selected time or authority changed. Review current records before retrying.", 409);
      if (error.code === "22023") throw new IntakeProgressionError("Review qualification and select only a currently offered time.", 422);
      if (error.code === "42501") throw new IntakeProgressionError("Business owner write access is required.", 403);
      throw new IntakeProgressionError("Progression could not be saved. Retry with the same request key.", 503);
    }
    return data;
  } };
}
