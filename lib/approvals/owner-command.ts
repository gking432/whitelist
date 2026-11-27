import { z } from "zod";

export const OWNER_APPROVAL_BODY_BYTES = 32768;
export const OWNER_APPROVAL_RESPONSE_BYTES = 32768;
export const OwnerApprovalCommandSchema = z.object({
  resolution: z.enum(["approve", "reject", "edit_and_approve"]),
  editedContent: z.string().max(20000).optional(),
  note: z.string().max(2000).optional(),
}).strict();
export type OwnerApprovalCommand = z.infer<typeof OwnerApprovalCommandSchema>;

export const OwnerApprovalResultSchema = z.object({
  status: z.enum(["error", "success"]),
  httpStatus: z.union([z.literal(200), z.literal(400), z.literal(403), z.literal(404), z.literal(409), z.literal(413), z.literal(422), z.literal(503)]),
  message: z.string().trim().min(1).max(4000),
  fieldErrors: z.record(z.string().max(80), z.string().max(1000)).refine(errors => Object.keys(errors).length <= 20).optional(),
  /** What happened to the customer-facing action, so a screen never calls a skipped send "sent". */
  delivery: z.enum(["sent", "not_sent", "uncertain"]).optional(),
}).strict().refine(result => result.status === "success" ? result.httpStatus === 200 : result.httpStatus !== 200);
export type OwnerApprovalResult = z.infer<typeof OwnerApprovalResultSchema>;

export function ownerApprovalFormCommand(form: FormData): OwnerApprovalCommand {
  const allowed = new Set(["resolution", "edited_content", "note"]);
  for (const name of form.keys()) {
    if (!allowed.has(name) || form.getAll(name).length !== 1 || typeof form.get(name) !== "string") {
      throw new Error("Use the current approval decision form.");
    }
  }
  return OwnerApprovalCommandSchema.parse({
    resolution: form.get("resolution"),
    ...(form.has("edited_content") ? { editedContent: form.get("edited_content") } : {}),
    ...(form.has("note") ? { note: form.get("note") } : {}),
  });
}
