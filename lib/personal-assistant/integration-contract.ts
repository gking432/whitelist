import { z } from "zod";

/** Future integration boundary only: no retrieval, model, grant or execution API. */
export const PERSONAL_ASSISTANT_INTEGRATION_VERSION = 1 as const;
export const WORKSTATION_ASSISTANT_CAPABILITIES = [
  "read_business_context", "read_customer_status", "read_team_status", "read_work_history", "read_effect_receipts", "propose_action",
] as const;
const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const clock = z.iso.datetime({ offset: true });
export const AssistantWorkspaceScopeSchema = z.object({ partnerId: z.uuid(), clientId: z.uuid() }).strict();
const verificationFields = {
  state: z.enum(["unverified", "verified", "revoked"]),
  checkedAt: clock.nullable(),
  proofId: text(200).nullable(),
};
const verifiedProof = (value: { state: string; checkedAt: string | null; proofId: string | null }) => value.state !== "verified" || (value.checkedAt !== null && value.proofId !== null);
const verification = z.object(verificationFields).strict().refine(verifiedProof);

export const AssistantIntegrationSchema = z.object({
  version: z.literal(PERSONAL_ASSISTANT_INTEGRATION_VERSION),
  identity: z.object({
    kind: z.enum(["workstation_assistant", "existing_personal_assistant", "external_shortcut"]),
    label: text(100),
    providerAssistantId: text(200).nullable(),
  }).strict(),
  workstationAccess: z.object({ ...verificationFields,
    scope: AssistantWorkspaceScopeSchema,
    capabilities: z.array(z.enum(WORKSTATION_ASSISTANT_CAPABILITIES)).max(6).refine(values => new Set(values).size === values.length),
  }).strict().refine(verifiedProof),
  inWorkstationConversation: verification,
  selfApprovalAllowed: z.literal(false),
}).strict().superRefine((value, ctx) => {
  if (value.identity.kind === "external_shortcut" && value.inWorkstationConversation.state === "verified")
    ctx.addIssue({ code: "custom", message: "An external shortcut does not establish an in-workstation conversation." });
  if (value.workstationAccess.state !== "verified" && value.workstationAccess.capabilities.length)
    ctx.addIssue({ code: "custom", message: "Unverified or revoked access grants no workstation capabilities." });
  if (value.identity.kind === "existing_personal_assistant" &&
      (value.workstationAccess.state === "verified" || value.inWorkstationConversation.state === "verified") && !value.identity.providerAssistantId)
    ctx.addIssue({ code: "custom", message: "Verify the actual external assistant identity independently of a model API." });
});

export const AssistantSourceEvidenceSchema = z.object({
  scope: AssistantWorkspaceScopeSchema,
  table: z.enum(["integration_canonical_records", "integration_object_links", "integration_sync_states", "business_records", "crm_contacts", "crm_leads", "crm_communications", "business_conversations", "business_conversation_messages", "agent_team_settings", "agent_work_items", "approval_items", "action_jobs"]),
  id: text(200),
  revision: text(200),
  sourceUpdatedAt: clock.nullable(),
  checkedAt: clock,
  freshness: z.enum(["fresh", "stale", "partial", "missing", "error", "unknown"]),
}).strict();
const approval = z.object({
  source: AssistantSourceEvidenceSchema.refine(value => value.table === "approval_items"),
  status: z.enum(["pending", "approved", "edited_and_approved", "rejected", "expired"]),
  decisionBy: z.enum(["human", "not_decided"]),
}).strict();
const effect = z.object({
  source: AssistantSourceEvidenceSchema.refine(value => value.table === "action_jobs"),
  approvalId: text(200).nullable(),
  status: z.enum(["succeeded", "provider_pending", "uncertain", "failed", "dry_run", "skipped", "cancelled"]),
  providerRef: text(500).nullable(),
  recordedAt: clock,
}).strict();
const work = z.object({
  source: AssistantSourceEvidenceSchema.refine(value => value.table === "agent_work_items"),
  managerKey: text(80),
  state: z.enum(["unknown", "planned", "awaiting_approval", "approved", "approved_future", "sent", "provider_pending", "uncertain", "blocked", "failed", "cancelled"]),
  scheduledFor: clock.nullable(),
  approval: approval.nullable(),
  effect: effect.nullable(),
  blockers: z.array(z.enum(["reply", "opt_out", "human_takeover", "source_changed", "authority_changed", "missing_evidence"])).max(6),
}).strict();
const quote = z.discriminatedUnion("state", [
  z.object({ state: z.literal("missing"), reason: z.enum(["not_checked", "not_found", "access_unavailable"]) }).strict(),
  z.object({ state: z.literal("recorded"), source: AssistantSourceEvidenceSchema.refine(value => ["business_records", "integration_canonical_records"].includes(value.table)),
    customerId: text(200), customerLink: AssistantSourceEvidenceSchema.refine(value => ["integration_object_links", "crm_leads", "business_records", "business_conversations"].includes(value.table)), status: text(80) }).strict(),
]);

/** A server must first authorize, scope and verify these references against the
 * existing read models. Structural validation is not proof of real history. */
export const WorkstationStatusResponseSchema = z.object({
  version: z.literal(PERSONAL_ASSISTANT_INTEGRATION_VERSION),
  scope: AssistantWorkspaceScopeSchema,
  checkedAt: clock,
  customer: z.object({ source: AssistantSourceEvidenceSchema.refine(value => ["crm_contacts", "integration_canonical_records"].includes(value.table)),
    identity: z.enum(["owner_verified", "unverified", "unknown"]) }).strict().nullable(),
  quote,
  team: AssistantSourceEvidenceSchema.refine(value => value.table === "agent_team_settings").nullable(),
  work: z.array(work).max(50),
  historyCoverage: z.enum(["bounded", "partial", "not_checked"]),
  replies: z.object({ state: z.enum(["not_checked", "reply_recorded", "no_reply_in_checked_sources"]),
    sources: z.array(AssistantSourceEvidenceSchema).max(20), coverage: z.enum(["bounded", "partial", "unavailable"]) }).strict(),
  missing: z.array(z.enum(["customer", "quote", "team", "history", "replies", "approval", "receipt"])).max(7).refine(values => new Set(values).size === values.length),
  actionBoundary: z.literal("existing_owner_approval_and_final_checks"),
}).strict().superRefine((value, ctx) => {
  const reject = (message: string) => ctx.addIssue({ code: "custom", message });
  const sources = [...(value.customer ? [value.customer.source] : []), ...(value.quote.state === "recorded" ? [value.quote.source, value.quote.customerLink] : []),
    ...(value.team ? [value.team] : []), ...value.replies.sources,
    ...value.work.flatMap(item => [item.source, ...(item.approval ? [item.approval.source] : []), ...(item.effect ? [item.effect.source] : [])])];
  for (const source of sources) {
    if (source.scope.partnerId !== value.scope.partnerId || source.scope.clientId !== value.scope.clientId) reject("Every source must belong to this exact workspace.");
    if (Date.parse(source.checkedAt) > Date.parse(value.checkedAt)) reject("A source observation cannot occur after this status snapshot.");
  }
  if (!value.customer && !value.missing.includes("customer")) reject("An unknown customer needs no fabricated source record.");
  if (value.quote.state === "missing" && !value.missing.includes("quote")) reject("A missing quote remains explicit.");
  if (value.quote.state === "recorded" && (!value.customer || value.quote.customerId !== value.customer.source.id)) reject("The quote must retain its exact customer association.");
  if (value.historyCoverage === "not_checked" && (value.work.length || !value.missing.includes("history"))) reject("Unchecked history cannot become a coordinated work history.");
  if (!value.team && !value.missing.includes("team")) reject("Missing team data remains explicit.");
  if (value.replies.state === "not_checked" && (value.replies.sources.length || value.replies.coverage !== "unavailable" || !value.missing.includes("replies"))) reject("Unchecked replies cannot establish customer silence.");
  if (value.replies.state !== "not_checked" && (!value.replies.sources.length || value.replies.coverage === "unavailable")) reject("A reply claim requires its checked source coverage.");
  for (const item of value.work) {
    const approved = item.approval && ["approved", "edited_and_approved"].includes(item.approval.status) && item.approval.decisionBy === "human";
    if (item.state === "planned" && (item.approval || item.effect)) reject("A plan cannot imply an approval or completed effect.");
    if (item.state === "awaiting_approval" && (item.approval?.status !== "pending" || item.approval.decisionBy !== "not_decided" || item.effect)) reject("Awaiting approval requires the actual pending decision.");
    if (["approved", "approved_future"].includes(item.state) && (!approved || item.effect)) reject("Approval alone is not a provider result.");
    if (item.state === "approved_future" && (!item.scheduledFor || Date.parse(item.scheduledFor) <= Date.parse(value.checkedAt))) reject("A future approval needs its actual future schedule.");
    if (item.state === "sent" && (!approved || item.effect?.status !== "succeeded" || !item.effect.providerRef || item.effect.approvalId !== item.approval?.source.id)) reject("Sent requires matching human approval and a successful external receipt.");
    if (["provider_pending", "uncertain"].includes(item.state) && item.effect?.status !== item.state) reject("Unknown provider outcomes cannot become sent history.");
    if (item.effect && Date.parse(item.effect.recordedAt) > Date.parse(value.checkedAt)) reject("A provider receipt cannot come from the future.");
  }
});

export type AssistantIntegration = z.infer<typeof AssistantIntegrationSchema>;
export type AssistantSourceEvidence = z.infer<typeof AssistantSourceEvidenceSchema>;
export type WorkstationStatusResponse = z.infer<typeof WorkstationStatusResponseSchema>;
