import { z } from "zod";

export const ONBOARDING_STEPS = ["description", "connections", "assistant", "assistant_choice", "review", "permissions", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const profileRevision = z.string().min(1).max(80);
const step = z.enum(ONBOARDING_STEPS);
const skippable = z.enum(["description", "connections", "assistant", "assistant_choice", "review", "permissions"]);
const base = { key: z.uuid(), revision: revision.max(Number.MAX_SAFE_INTEGER - 1) };
const description = z.string().trim().min(1).max(3000).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));

/** Presentation progress is not business readiness, review or permission. */
export const OnboardingRequestSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("answer"), field: z.literal("description"), value: description.nullable(), expectedProfileRevision: profileRevision }).strict(),
  z.object({ ...base, action: z.literal("navigate"), step }).strict(),
  z.object({ ...base, action: z.literal("skip"), step: skippable }).strict(),
]);
export type OnboardingRequest = z.infer<typeof OnboardingRequestSchema>;
export type OnboardingCommand = OnboardingRequest extends infer Request ? Request extends OnboardingRequest ? Omit<Request, "key" | "revision"> : never : never;
export const OnboardingSnapshotSchema = z.object({
  available: z.literal(true), canEdit: z.literal(true), profileRevision,
  answers: z.object({ description: z.string().max(10000).nullable() }).strict(),
  progress: z.object({ revision, step, skipped: z.array(skippable).max(6).refine(values => new Set(values).size === values.length), finished: z.boolean() }).strict().refine(value => value.finished === (value.step === "done")),
}).strict();
export type OnboardingSnapshot = z.infer<typeof OnboardingSnapshotSchema>;
export const OnboardingReceiptSchema = z.object({
  id: z.uuid(), key: z.uuid(), revision, profileRevision, replayed: z.boolean(), cancelledWork: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();
export type OnboardingReceipt = z.infer<typeof OnboardingReceiptSchema>;
export const OnboardingSaveResponseSchema = z.object({ snapshot: OnboardingSnapshotSchema, result: OnboardingReceiptSchema }).strict();
export type OnboardingSaveResponse = z.infer<typeof OnboardingSaveResponseSchema>;
