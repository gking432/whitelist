import { EMPTY_PROFILE, type BusinessProfile } from "./types.ts";
import { contextReviewIsCurrent } from "../agents/authority.ts";
import { attachObservationLineage, buildObservedLineage } from "./observation.ts";
import {
  BUSINESS_CONTEXT_VERSION,
  type BusinessAuthority,
  type BusinessContextSnapshot,
  type ContextCoverage,
  type ContextFact,
  type ContextObservation,
  type ContextRecommendation,
  type ContextRecord,
  type ContextSource,
} from "./context-contract.ts";

export type ContextScope = { partnerId: string; clientId: string };
export type ScopedEvidence = { partner_id: string; client_id: string };
export type ProfileEvidence = ScopedEvidence & {
  profile: Partial<BusinessProfile>;
  updated_at: string;
};
export type KnowledgeEvidence = ScopedEvidence & {
  id: string;
  updated_at: string;
  business_description: string | null;
  services_offered: string | null;
  business_hours: string | null;
  booking_rules?: string | null;
};
export type RecordEvidence = ScopedEvidence & {
  id: string;
  table: string;
  kind: string;
  title: string;
  status: string;
  revision?: string | number | null;
  updated_at: string;
  created_at?: string;
  source_record_id?: string | null;
  start_at?: string;
  next_action?: string | null;
  native_object_id?: string | null;
  external_parent_id?: string | null;
  external_object_id?: string | null;
  source_updated_at?: string;
  display?: Pick<ContextRecord, "summary" | "connectionId" | "externalId" | "provider" | "href" | "direction" | "currency" | "totalMinor" | "amountDueMinor" | "amountPaidMinor" | "amountMinor" | "amountRefundedMinor">;
};
export type StreamEvidence = ScopedEvidence & {
  connection_id: string;
  stream_key: string;
  status: string;
  last_completed_at: string | null;
  cursor_value?: Record<string, unknown> | null;
  last_error?: string | null;
};
export type ConnectionEvidence = ScopedEvidence & {
  id: string;
  display_name: string;
  provider_key: string;
  status: string;
  runtime_mode: string;
};
export type EvidenceBatch = {
  key: string;
  label: string;
  rows: RecordEvidence[];
  limit: number;
  hasMore: boolean;
};
export type BusinessContextInput = {
  scope: ContextScope;
  generatedAt: string;
  profile: ProfileEvidence | null;
  knowledge?: KnowledgeEvidence | null;
  review?: (ScopedEvidence & { profile_revision: string; reviewed_at: string }) | null;
  authority: BusinessAuthority;
  connections: ConnectionEvidence[];
  streams: StreamEvidence[];
  batches: EvidenceBatch[];
  streamCoverage?: ContextCoverage[];
  canWrite: boolean;
};

function scoped(scope: ContextScope, row: ScopedEvidence) {
  if (row.partner_id !== scope.partnerId || row.client_id !== scope.clientId)
    throw new Error("Business evidence does not belong to this workspace.");
}
function date(value: string | null | undefined) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}
function source(row: RecordEvidence): ContextSource {
  return {
    table: row.table,
    id: row.id,
    revision: String(row.revision ?? row.updated_at),
    updatedAt: row.source_updated_at ?? row.updated_at,
  };
}
const normalize = (value: string) => value.trim();

/** Collapse explicit source links only; equal names, emails or titles never establish record identity. */
export function canonicalContextRecords(rows: RecordEvidence[]): ContextRecord[] {
  const importedAppointments = rows.filter((r) => r.table === "integration_canonical_records" && r.kind === "appointment");
  const nativeIds = new Set(importedAppointments.map((r) => r.native_object_id).filter((id): id is string => !!id));
  const native = new Map(rows.filter((r) => r.table === "crm_appointments").map((r) => [r.id, r]));
  const result = new Map<string, ContextRecord>();
  for (const row of rows) {
    if (row.table === "crm_appointments" && nativeIds.has(row.id)) continue;
    const isThread = row.table === "integration_canonical_records" && row.kind === "message";
    const thread = row.external_parent_id || row.external_object_id || row.id;
    const key = isThread ? `${row.table}:message:${row.source_record_id}:${thread}` : `${row.table}:${row.id}`;
    const prior = result.get(key);
    const latest = !prior || (Date.parse(row.updated_at) || 0) >= (Date.parse(prior.updatedAt) || 0);
    const linked = row.native_object_id ? native.get(row.native_object_id) : null;
    const references = [...(prior?.sources ?? []), source(row), ...(linked ? [source(linked)] : [])];
    const record: ContextRecord = {
      id: row.id, table: row.table, kind: row.kind, title: row.title.slice(0, 300), status: row.status,
      revision: String(row.revision ?? row.updated_at), updatedAt: row.updated_at,
      ...(row.source_record_id ? { sourceRecordId: row.source_record_id } : {}),
      ...(row.start_at ? { startAt: row.start_at } : {}),
      ...row.display,
      sources: [],
    };
    result.set(key, {
      ...(latest ? record : prior!),
      sources: [...new Map(references.map((ref) => [`${ref.table}:${ref.id}`, ref])).values()],
    });
  }
  return [...result.values()];
}

/** Deterministic current-record waiting points; no inferred mailbox intent or invented process history. */
export function observeWaitingPoints(
  rows: RecordEvidence[],
  now: string,
): ContextObservation[] {
  const at = date(now);
  if (at === null) throw new Error("A valid observation clock is required.");
  return rows.flatMap((row): ContextObservation[] => {
    const since = row.table === "approval_items" ? row.created_at ?? row.updated_at : row.updated_at;
    const started = date(since);
    if (started === null || started > at || at - started < 24 * 3600000) return [];
    const isDecision = row.table === "approval_items" && row.status === "pending";
    const isAssignment = row.table === "agent_work_items" &&
      ["blocked", "waiting_approval", "waiting_external"].includes(row.status);
    const isLead = row.table === "crm_leads" &&
      ["new", "contacted", "qualified", "quoted"].includes(row.status) &&
      !!row.next_action?.trim() && at - started >= 72 * 3600000;
    if (!isDecision && !isAssignment && !isLead) return [];
    const days = Math.floor((at - started) / 86400000);
    return [{
      key: `${row.table}:${row.id}`,
      summary: isDecision
        ? `An owner decision has been pending for ${days} day${days === 1 ? "" : "s"}: ${row.title.slice(0, 160)}`
        : isAssignment
          ? `An assignment is ${row.status.replaceAll("_", " ")} and has not changed for ${days} day${days === 1 ? "" : "s"}: ${row.title.slice(0, 160)}`
          : `A saved lead has a next step and has not changed for ${days} days: ${row.title.slice(0, 160)}`,
      since,
      sources: [source(row)],
      limitation: isLead
        ? "A saved next step is not proof of customer consent or no activity in another application. Recheck before proposing follow-up."
        : "This is the current saved record and its timestamps, not a reconstructed history or proof of elapsed work time.",
    }];
  }).sort((a, b) => a.since.localeCompare(b.since)).slice(0, 30);
}

export function buildBusinessContext(input: BusinessContextInput): BusinessContextSnapshot {
  const { scope } = input;
  if (date(input.generatedAt) === null) throw new Error("A valid context clock is required.");
  for (const row of [input.profile, input.knowledge, input.review]) if (row) scoped(scope, row);
  for (const row of [...input.connections, ...input.streams, ...input.batches.flatMap((b) => b.rows)]) scoped(scope, row);
  const raw = input.profile?.profile ?? {};
  const profile: BusinessProfile = { ...EMPTY_PROFILE };
  for (const key of Object.keys(EMPTY_PROFILE) as (keyof BusinessProfile)[]) {
    if (key === "goals") profile.goals = Array.isArray(raw.goals)
      ? raw.goals.filter((v): v is string => typeof v === "string").slice(0, 30).map((v) => v.slice(0, 1000)) : [];
    else if (typeof raw[key] === "string") profile[key] = (raw[key] as string).slice(0, 20000);
  }
  const revision = input.profile?.updated_at ?? "unconfigured";
  const reviewed = contextReviewIsCurrent(input.profile?.updated_at ?? null, input.review?.profile_revision ?? null, input.profile?.profile as Record<string, unknown> | null, input.knowledge as unknown as Record<string, unknown> | null);
  const knowledgeKeys = { description: "business_description", services: "services_offered", hours: "business_hours", policies: "booking_rules" } as const;
  const facts: ContextFact[] = (Object.keys(EMPTY_PROFILE) as (keyof BusinessProfile)[]).map((key) => {
    const value = profile[key];
    const supplied = key === "goals" ? Array.isArray(raw.goals) && raw.goals.some((v) => typeof v === "string" && v.trim()) : typeof raw[key] === "string" && !!(raw[key] as string).trim();
    const sources: ContextSource[] = input.profile && supplied ? [{ table: "business_workspace_profiles", id: scope.clientId, revision, updatedAt: revision }] : [];
    const knowledgeKey = knowledgeKeys[key as keyof typeof knowledgeKeys];
    const alternative = knowledgeKey && input.knowledge?.[knowledgeKey];
    const conflict = !!supplied && typeof value === "string" && !!alternative?.trim() && normalize(value) !== normalize(alternative);
    if (conflict && input.knowledge) sources.push({ table: "client_knowledge_profiles", id: input.knowledge.id, revision: input.knowledge.updated_at, updatedAt: input.knowledge.updated_at });
    return { key, value, state: conflict ? "conflict" : supplied ? "known" : "unknown", reviewed: reviewed && !!supplied && !conflict, sources };
  });
  const rows = input.batches.flatMap((b) => b.rows.slice(0, b.limit));
  const coverage: ContextCoverage[] = input.batches.map((batch) => ({
    key: batch.key, label: batch.label, connectionId: null, capability: "read",
    status: "fresh", lastUpdatedAt: input.generatedAt, sampled: Math.min(batch.rows.length, batch.limit),
    limit: batch.limit, hasMore: batch.hasMore || batch.rows.length > batch.limit,
    detail: "Current workspace records from a bounded query; omitted records and external activity may exist.",
  }));
  if (input.streamCoverage) coverage.push(...input.streamCoverage);
  for (const connection of input.streamCoverage ? [] : input.connections) {
    const keys = input.streams.filter((s) => s.connection_id === connection.id).map((s) => s.stream_key);
    if (["google_workspace", "microsoft_365"].includes(connection.provider_key)) keys.push("message", "appointment");
    for (const streamKey of new Set(keys)) {
      const stream = input.streams.find((s) => s.connection_id === connection.id && s.stream_key === streamKey);
      const completed = date(stream?.last_completed_at);
      const partial = !!stream?.cursor_value?.pageToken;
      const status = connection.status === "needs_attention" || !!stream?.last_error || stream?.status === "failing"
        ? "error" : !stream || completed === null || !["connected", "needs_attention"].includes(connection.status)
          ? "missing" : connection.runtime_mode === "paused" || stream.status === "paused" || partial ||
            completed > Date.parse(input.generatedAt) || Date.parse(input.generatedAt) - completed > 45 * 60000 ? "stale" : "fresh";
      coverage.push({
        key: `${connection.id}:${streamKey}`, label: `${connection.display_name} · ${streamKey === "message" ? "Email" : streamKey === "appointment" ? "Calendar" : streamKey}`,
        connectionId: connection.id, capability: `read:${streamKey}`, status,
        lastUpdatedAt: stream?.last_completed_at ?? null,
        sampled: rows.filter((r) => r.table === "integration_canonical_records" && r.source_record_id === connection.id && r.kind === streamKey).length,
        limit: input.batches.find((b) => b.key === `imported:${streamKey}`)?.limit ?? 100,
        hasMore: partial || !!input.batches.find((b) => b.key === `imported:${streamKey}`)?.hasMore,
        detail: status === "fresh" ? "This stream completed recently. Imported records are current-state snapshots within the loaded window."
          : partial ? "An import page is still incomplete; coverage is partial."
            : status === "missing" ? "This stream has no verified complete import."
              : status === "error" ? "This stream needs connection or import attention."
                : "This stream is paused, delayed or has an invalid completion clock.",
      });
    }
  }
  const recommendations: ContextRecommendation[] = [];
  if (profile.description.trim() || profile.services.trim()) recommendations.push({ key: "customer_inquiries", label: "Help with customer inquiries", reason: "Your saved business details can support inquiry drafts using approved facts.", prerequisites: ["Review business details and any conflicts", "Select a supported customer channel", "Choose drafting or owner-approved actions"] });
  if (/appointment|book|salon|coach|fitness|consult|service/i.test(`${profile.industry} ${profile.services}`)) recommendations.push({ key: "booking", label: "Coordinate appointment requests", reason: "The saved business profile describes appointment or service work.", prerequisites: ["Review business hours and booking policies", "Connect a calendar with supported availability access", "Require owner approval before bookings"] });
  if (rows.some((r) => r.table === "crm_leads" && ["new", "contacted", "qualified", "quoted"].includes(r.status))) recommendations.push({ key: "lead_review", label: "Review saved lead next steps", reason: "There are open lead records in the loaded business sample.", prerequisites: ["Check current customer state and consent", "Review proposed follow-up before sending"] });
  if (rows.some((r) => r.kind === "invoice")) {
    const knownDue = rows.some((r) => r.kind === "invoice" && ["open", "past_due"].includes(r.status) && typeof r.display?.amountDueMinor === "number" && r.display.amountDueMinor > 0);
    recommendations.push({ key: "money_review", label: knownDue ? "Review money due" : "Inspect money records",
      reason: knownDue ? "A loaded source invoice records a positive remaining balance in an open state." : "Loaded invoices have recorded source statuses; a draft, void or settled invoice does not establish money due.",
      prerequisites: ["Verify current status and remaining balance in the authoritative source", "Review eligibility and owner approval before any customer-facing reminder"] });
  }
  return {
    version: BUSINESS_CONTEXT_VERSION, scope: { ...scope }, revision,
    generatedAt: input.generatedAt, profile, facts, records: canonicalContextRecords(rows), coverage, recommendations,
    observations: attachObservationLineage(observeWaitingPoints(rows, input.generatedAt), buildObservedLineage(scope, rows)),
    authority: input.authority, canWrite: input.canWrite,
  };
}

/** Bounded manager payload retains exact source IDs and coverage instead of a second ad hoc business sample. */
export function buildManagerContext(snapshot: BusinessContextSnapshot, excludeWorkId?: string) {
  const groups = new Map<string, ContextRecord[]>();
  for (const record of snapshot.records.filter((record) => !(record.table === "agent_work_items" && record.id === excludeWorkId))) {
    const key = record.table === "integration_canonical_records" ? `${record.table}:${record.kind}` : record.table;
    const group = groups.get(key) ?? [];
    if (group.length < 12) group.push(record);
    groups.set(key, group);
  }
  // Reserve space across source kinds before filling the global bound. A busy
  // workspace must not push invoices/payments out of the manager's context.
  const records: ContextRecord[] = [];
  for (let round = 0; round < 12 && records.length < 120; round++)
    for (const group of groups.values()) if (group[round] && records.length < 120) records.push(group[round]);
  return {
    version: snapshot.version, scope: snapshot.scope, revision: snapshot.revision,
    generated_at: snapshot.generatedAt,
    business_facts: snapshot.facts,
    records,
    recorded_activity: buildObservedLineage(snapshot.scope, snapshot.records.map((record) => ({
      partner_id: snapshot.scope.partnerId, client_id: snapshot.scope.clientId,
      id: record.id, table: record.table, kind: record.kind, title: record.title, status: record.status,
      revision: record.revision, updated_at: record.updatedAt, source_record_id: record.sourceRecordId,
    }))),
    record_sample_limit: 120,
    record_sample_partial: records.length < snapshot.records.filter((record) => !(record.table === "agent_work_items" && record.id === excludeWorkId)).length,
    coverage: snapshot.coverage,
    recommendations: snapshot.recommendations,
    waiting_points: snapshot.observations,
    authority: snapshot.authority,
    limits: "Facts describe current saved records and bounded imports. Unknown, conflicting or unreviewed business facts cannot be asserted as approved customer-facing knowledge. Mail unread state does not prove a neglected inquiry. No external action or complete historical workflow is established by this context.",
  };
}

export function summarizeBusinessContext(snapshot: BusinessContextSnapshot, excludeWorkId?: string) {
  const records = snapshot.records.filter((record) => !(record.table === "agent_work_items" && record.id === excludeWorkId));
  const approvals = records.filter((r) => r.table === "approval_items" && r.status === "pending").length;
  const attention = records.filter((r) => r.table === "agent_work_items" && ["blocked", "waiting_approval", "waiting_external"].includes(r.status)).length;
  const leads = records.filter((r) => r.table === "crm_leads" && ["new", "contacted", "qualified", "quoted"].includes(r.status)).length;
  const until = Date.parse(snapshot.generatedAt) + 7 * 86400000;
  const appointments = records.filter((r) => r.kind === "appointment" && ["booked", "proposed"].includes(r.status) &&
    !!r.startAt && Date.parse(r.startAt) >= Date.parse(snapshot.generatedAt) && Date.parse(r.startAt) <= until).length;
  const partial = snapshot.coverage.some((c) => c.hasMore || c.status !== "fresh");
  return {
    summary: `In the loaded records: ${approvals} pending owner decisions, ${attention} assignments needing attention, ${leads} open leads, and ${appointments} appointments in the next 7 days. ${partial ? "Some source coverage is incomplete or delayed; these are sampled records, not a complete business count." : "These are saved records and imported snapshots; other activity may exist."} Open Today or business setup to review the sources.`,
    method: "shared_context_summary",
    contextRevision: snapshot.revision,
    generatedAt: snapshot.generatedAt,
    evidence: records.filter((r) => ["approval_items", "agent_work_items", "crm_leads", "crm_appointments"].includes(r.table) || r.kind === "appointment").slice(0, 120),
  };
}
