import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export class IntakeAdoptionError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

// Postgres source revisions retain microseconds. Never round a version through
// Date.parse alone: distinct source writes can share one JavaScript millisecond.
const revision = z.iso.datetime({ offset: true }).refine((value) => !/\.\d{7}/.test(value), "Use the exact source revision.");
export const IntakeAdoptionCommandSchema = z.object({
  action: z.literal("adopt_intake"), key: z.uuid(), connectionId: z.uuid(), recordId: z.uuid(),
  externalId: z.string().trim().min(1).max(500), expectedUpdatedAt: revision,
  contact: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("create") }).strict(),
    z.object({ mode: z.literal("existing"), id: z.uuid(), expectedUpdatedAt: revision }).strict(),
  ]),
}).strict();
export type IntakeAdoptionCommand = z.infer<typeof IntakeAdoptionCommandSchema>;
export type IntakeAdoptionActor = { partnerId: string; clientId: string; actorId: string; canWrite: boolean };
export type IntakeAdoptionResult = {
  id: string; connectionId: string; sourceRecordId: string; sourceUpdatedAt: string;
  contactId: string; leadId: string; taskId: string;
  createdContact: boolean; replayed: boolean; message: string;
};
const Result = z.object({
  id: z.uuid(), connectionId: z.uuid(), sourceRecordId: z.uuid(), sourceUpdatedAt: revision,
  contactId: z.uuid(), leadId: z.uuid(), taskId: z.uuid(),
  createdContact: z.boolean(), replayed: z.boolean(), message: z.string().trim().min(1).max(2000),
}).strict();

function instant(value: string): bigint | null {
  const parts = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/.exec(value);
  if (!parts) return null;
  const whole = Date.parse(`${parts[1]}${parts[3]}`);
  return Number.isFinite(whole) ? BigInt(whole) * BigInt(1000) + BigInt((parts[2] ?? "").padEnd(6, "0")) : null;
}
export function sameIntakeRevision(left: string, right: string): boolean {
  const a = instant(left), b = instant(right);
  return a !== null && b !== null && a === b;
}
export function parseIntakeAdoptionCommand(raw: unknown): IntakeAdoptionCommand {
  const parsed = IntakeAdoptionCommandSchema.safeParse(raw);
  if (!parsed.success) throw new IntakeAdoptionError("Review the source version and explicitly choose a new or existing contact.", 400);
  return parsed.data;
}

type Scoped = { partner_id: string; client_id: string };
export type IntakeAdoptionSource = Scoped & {
  id: string; connection_id: string; object_type: string; external_object_id: string;
  updated_at: string; native_object_id: string | null; canonical_data: Record<string, unknown> | null;
};
export type IntakeAdoptionConnection = Scoped & {
  id: string; provider_key: string; status: string; runtime_mode: string;
  config: Record<string, unknown> | null;
};
export type IntakeAdoptionContact = Scoped & { id: string; updated_at: string };
export type IntakeAdoptionLink = Scoped & {
  connection_id: string; object_type: string; external_object_id: string; native_object_id: string;
};
export type IntakeAdoptionPlan = {
  source: { recordId: string; connectionId: string; externalId: string; updatedAt: string };
  contact: { mode: "existing"; id: string; updatedAt: string } | {
    mode: "create"; firstName: string; lastName: null; email: string | null; phone: string | null;
    source: "owner_intake_unverified"; tags: ["source_identity_unverified"];
  };
  lead: { title: string; description: string; status: "new"; sourceEventType: "owner_intake_adoption"; nextAction: string };
  task: { title: string; description: string; status: "open"; priority: "medium"; taskType: "intake_review" };
  actorId: string;
};
function scoped(actor: IntakeAdoptionActor, row: Scoped) {
  return row.partner_id === actor.partnerId && row.client_id === actor.clientId;
}
function supplied(value: unknown, maximum: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > maximum)
    throw new IntakeAdoptionError("The source contact details need review before adoption.", 422);
  return value.trim();
}

/** Pure plan for an authorized, fresh source. Production must enforce these
 * rules and commit contact/lead/task/link/receipt together in its transaction.
 * Successful request receipts are replayed before invoking this fresh-plan path.
 */
export function planIntakeAdoption(input: {
  actor: IntakeAdoptionActor; command: IntakeAdoptionCommand;
  source: IntakeAdoptionSource | null; connection: IntakeAdoptionConnection | null;
  contact?: IntakeAdoptionContact | null; existingLink?: IntakeAdoptionLink | null;
  stream?: { status: string; last_error: string | null } | null;
}): IntakeAdoptionPlan {
  const { actor, source, connection } = input;
  if (!actor.canWrite) throw new IntakeAdoptionError("Business owner write access is required.", 403);
  const command = parseIntakeAdoptionCommand(input.command);
  if (!source || !connection || !scoped(actor, source) || !scoped(actor, connection) ||
      source.id !== command.recordId || source.connection_id !== command.connectionId || connection.id !== command.connectionId ||
      source.external_object_id !== command.externalId || source.object_type !== "lead" || connection.provider_key !== "generic_inbound_webhook")
    throw new IntakeAdoptionError("The imported inquiry is unavailable in this workspace.", 404);
  if (connection.status !== "connected" || connection.runtime_mode === "paused" || connection.config?.workspace_view_only !== true ||
      input.stream?.status === "failing" || !!input.stream?.last_error)
    throw new IntakeAdoptionError("Restore this intake connection before adopting its current source records.", 409);
  if (!sameIntakeRevision(source.updated_at, command.expectedUpdatedAt))
    throw new IntakeAdoptionError("The inquiry changed. Refresh and review the current source before adoption.", 409);
  const data = source.canonical_data;
  if (!data || Array.isArray(data) || (data.deleted !== undefined && data.deleted !== false) || data.status === "deleted" ||
      (data.provider !== undefined && data.provider !== "generic_inbound_webhook") || !["new", "updated"].includes(String(data.status)))
    throw new IntakeAdoptionError("This source is deleted or no longer an eligible intake inquiry.", 409);
  if (source.native_object_id || input.existingLink)
    throw new IntakeAdoptionError("This source already has a saved adoption. Open its linked lead or replay the original request.", 409);
  let contact: IntakeAdoptionPlan["contact"];
  if (command.contact.mode === "existing") {
    const selected = input.contact;
    if (!selected || selected.id !== command.contact.id || !scoped(actor, selected))
      throw new IntakeAdoptionError("The selected contact is unavailable in this workspace.", 404);
    if (!sameIntakeRevision(selected.updated_at, command.contact.expectedUpdatedAt))
      throw new IntakeAdoptionError("The selected contact changed. Review it before linking this inquiry.", 409);
    contact = { mode: "existing", id: selected.id, updatedAt: selected.updated_at };
  } else {
    const name = supplied(data.name, 200), email = supplied(data.email, 320), phone = supplied(data.phone, 60);
    if (email && !z.email().safeParse(email).success)
      throw new IntakeAdoptionError("The source email needs review before creating a contact.", 422);
    contact = { mode: "create", firstName: name || "Unidentified inquiry", lastName: null,
      email: email || null, phone: phone || null, source: "owner_intake_unverified", tags: ["source_identity_unverified"] };
  }
  const title = supplied(data.title, 500).slice(0, 200) || "Imported inquiry", description = supplied(data.description, 6000);
  return {
    source: { recordId: source.id, connectionId: connection.id, externalId: source.external_object_id, updatedAt: source.updated_at },
    contact, actorId: actor.actorId,
    lead: { title, description, status: "new", sourceEventType: "owner_intake_adoption", nextAction: "Review the imported inquiry before contacting the customer." },
    task: { title: `Review inquiry: ${title}`.slice(0, 180), description, status: "open", priority: "medium", taskType: "intake_review" },
  };
}

export type IntakeAdoptionRepository = {
  /** Atomic production boundary: replay exact scoped request first, then lock,
   * validate and commit a fresh plan. No best-effort separate CRM writes. */
  apply(actor: IntakeAdoptionActor, command: IntakeAdoptionCommand): Promise<unknown>;
};
export async function adoptIntake(repository: IntakeAdoptionRepository, actor: IntakeAdoptionActor, raw: unknown): Promise<IntakeAdoptionResult> {
  if (!actor.canWrite) throw new IntakeAdoptionError("Business owner write access is required.", 403);
  const command = parseIntakeAdoptionCommand(raw);
  const saved = Result.safeParse(await repository.apply(actor, command));
  if (!saved.success || saved.data.connectionId !== command.connectionId || saved.data.sourceRecordId !== command.recordId ||
      !sameIntakeRevision(saved.data.sourceUpdatedAt, command.expectedUpdatedAt) || saved.data.createdContact !== (command.contact.mode === "create") ||
      (command.contact.mode === "existing" && saved.data.contactId !== command.contact.id))
    throw new IntakeAdoptionError("The saved adoption could not be confirmed. Retry with the same request key.", 503);
  return saved.data;
}
export function supabaseIntakeAdoptionRepository(admin: SupabaseClient): IntakeAdoptionRepository {
  return { async apply(actor, command) {
    const { data, error } = await admin.rpc("adopt_owner_intake_record", {
      p_partner: actor.partnerId, p_client: actor.clientId, p_actor: actor.actorId, p_command: command,
    });
    if (error) {
      if (["40001", "23505"].includes(error.code)) throw new IntakeAdoptionError("The source, contact or request changed. Refresh before trying a new adoption.", 409);
      if (error.code === "22023") throw new IntakeAdoptionError("Review the current source and choose a valid contact before adoption.", 422);
      if (error.code === "42501") throw new IntakeAdoptionError("Business owner write access is required.", 403);
      if (error.code === "P0002") throw new IntakeAdoptionError("The selected source or contact is unavailable.", 404);
      throw new IntakeAdoptionError("The adoption could not be saved. Retry with the same request key.", 503);
    }
    return data;
  } };
}
