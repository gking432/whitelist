import { z } from "zod";
import type { CanonicalRecord } from "../integrations/connectors/types.ts";

const Intake = z.object({
  id: z.string().trim().min(1).max(200),
  title: z.string().trim().max(200).optional(),
  name: z.string().trim().max(200).optional(),
  email: z.union([z.literal(""), z.email()]).optional(),
  phone: z.string().trim().max(60).optional(),
  message: z.string().max(6000).optional(),
  submitted_at: z.iso.datetime({ offset: true }).optional(),
  updated_at: z.iso.datetime({ offset: true }).optional(),
  source_url: z.string().max(2000).optional(),
}).strict();

/** Form claims are source records, never permission to merge a known customer. */
export function normalizeOwnerIntake(eventType: string, raw: unknown, receivedAt: string): CanonicalRecord {
  if (!["form.submitted", "lead.created", "lead.updated", "lead.deleted"].includes(eventType))
    throw new Error("Use form.submitted, lead.created, lead.updated or lead.deleted for this intake connection.");
  const data = Intake.parse(raw);
  const received = Date.parse(receivedAt);
  const sourceTime = data.updated_at ?? data.submitted_at ?? receivedAt;
  if (!Number.isFinite(received) || Date.parse(sourceTime) > received + 300000)
    throw new Error("The submission timestamp is invalid.");
  if (["lead.updated", "lead.deleted"].includes(eventType) && !data.updated_at)
    throw new Error("Updates and deletions require the source updated_at timestamp.");
  const update = eventType === "lead.updated";
  return {
    objectType: "lead", externalId: data.id, updatedAt: sourceTime,
    deleted: eventType === "lead.deleted",
    data: {
      provider: "generic_inbound_webhook",
      ...(!update || data.title !== undefined || data.name !== undefined ? { title: data.title || (data.name ? `Inquiry from ${data.name}` : "Website inquiry") } : {}),
      ...(!update || data.name !== undefined ? { name: data.name ?? null } : {}),
      ...(!update || data.email !== undefined ? { email: data.email || null } : {}),
      ...(!update || data.phone !== undefined ? { phone: data.phone || null } : {}),
      ...(!update || data.message !== undefined ? { description: data.message ?? "" } : {}),
      status: "new", received_at: data.submitted_at ?? (update ? null : receivedAt),
      source_url: null,
    },
    source: { event_type: eventType, source_id: data.id },
  };
}
