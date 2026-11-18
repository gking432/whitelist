import { reconcileMoneySources, moneyEvidenceForSource } from "../money/source-reconciliation.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadConnectedRecords, type OwnerConnectionRow } from "../connections/data.ts";
import { mapConnectedData } from "../connections/records.ts";
import { contextReviewIsCurrent, effectiveAuthoritySnapshot, internalCalendarEnabled, type AuthorityActivation, type AuthorityConnection, type AuthoritySettings } from "../agents/authority.ts";
import { buildBusinessContext, type BusinessContextInput, type ConnectionEvidence, type ContextScope, type EvidenceBatch, type KnowledgeEvidence, type ProfileEvidence, type RecordEvidence, type StreamEvidence } from "./context.ts";

export const CONTEXT_RECORD_LIMIT = 100;
export const CONTEXT_CONNECTION_LIMIT = 100;
type QueryResult = { data: unknown; error: unknown; limited?: boolean };

/** All service-role reads explicitly bind both tenant keys. No credentials or provider payloads leave this loader. */
export async function readBusinessContext(
  admin: SupabaseClient,
  scope: ContextScope,
  canWrite: boolean,
  clock: () => Date = () => new Date(),
) {
  const generatedAt = clock().toISOString();
  const calendarUntil = new Date(Date.parse(generatedAt) + 32 * 86400000).toISOString();
  const scoped = (table: string, columns: string) => admin.from(table).select(columns)
    .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId);
  const tenant = "partner_id,client_id";
  const [profile, review, knowledge, settings, activation, connections, records, leads, approvals, work, appointments, workspaceEvents, workEvents, client] = await Promise.all([
    scoped("business_workspace_profiles", `${tenant},profile,updated_at`).maybeSingle(),
    scoped("business_context_reviews", `${tenant},profile_revision,reviewed_at`).maybeSingle(),
    scoped("client_knowledge_profiles", `${tenant},id,business_description,services_offered,business_hours,booking_rules,updated_at`).maybeSingle(),
    scoped("agent_team_settings", "status,authority_revision,channel_authority,conversations_enabled,sales_enabled,scheduling_enabled").maybeSingle(),
    scoped("business_agent_activation", "status,website,email,sms,instagram,bookings,workspace_connection_id").maybeSingle(),
    scoped("integration_connections", `${tenant},id,display_name,external_account_name,external_account_id,status,runtime_mode,config,provider:integration_providers!inner(provider_key)`)
      .order("id").limit(CONTEXT_CONNECTION_LIMIT + 1),
    scoped("business_records", `${tenant},id,kind,title,status,revision,source_record_id,updated_at,created_at`)
      .order("updated_at", { ascending: false }).limit(CONTEXT_RECORD_LIMIT + 1),
    scoped("crm_leads", `${tenant},id,title,status,next_action,updated_at,created_at`)
      .in("status", ["new", "contacted", "qualified", "quoted"])
      .order("updated_at", { ascending: true }).limit(CONTEXT_RECORD_LIMIT + 1),
    scoped("approval_items", `${tenant},id,type,title,status,updated_at,created_at`)
      .eq("status", "pending").order("created_at", { ascending: true }).limit(CONTEXT_RECORD_LIMIT + 1),
    scoped("agent_work_items", `${tenant},id,kind,title,status,revision,source_record_id,updated_at,created_at`)
      .order("updated_at", { ascending: false }).limit(CONTEXT_RECORD_LIMIT + 1),
    scoped("crm_appointments", `${tenant},id,title,status,start_at,updated_at,created_at`)
      .in("status", ["booked", "proposed"]).gte("start_at", generatedAt)
      .lt("start_at", calendarUntil)
      .order("start_at").limit(CONTEXT_RECORD_LIMIT + 1),
    scoped("business_workspace_events", `${tenant},id,record_id,action,summary,created_at`)
      .order("created_at", { ascending: false }).limit(CONTEXT_RECORD_LIMIT + 1),
    scoped("agent_work_events", `${tenant},id,work_id,status,summary,created_at`)
      .order("created_at", { ascending: false }).limit(CONTEXT_RECORD_LIMIT + 1),
    admin.from("client_businesses").select("id,partner_id,status,crm_operating_mode,default_runtime_mode")
      .eq("partner_id", scope.partnerId).eq("id", scope.clientId).maybeSingle(),
  ]);
  const results: QueryResult[] = [profile, review, knowledge, settings, activation, connections, records, leads, approvals, work, appointments, workspaceEvents, workEvents, client];
  if (results.some((result) => result.error)) throw new Error("Shared business context could not be fully loaded. Check the data service and context migration.");
  type Row = Record<string, unknown>;
  const rows = (value: unknown): Row[] => Array.isArray(value) ? value as Row[] : [];
  const text = (value: unknown) => typeof value === "string" ? value : "";
  const clientRow = client.data as unknown as Row | null;
  if (clientRow && (clientRow.partner_id !== scope.partnerId || clientRow.id !== scope.clientId)) throw new Error("Business evidence does not belong to this workspace.");
  const connectionRows = rows(connections.data).slice(0, CONTEXT_CONNECTION_LIMIT);
  const connected = await loadConnectedRecords(admin, scope, {
    connections: connectionRows as unknown as OwnerConnectionRow[], recordLimit: CONTEXT_RECORD_LIMIT,
    nativeAppointmentIds: rows(appointments.data).slice(0, CONTEXT_RECORD_LIMIT).map((row) => text(row.id)),
    clock: () => new Date(generatedAt),
  });
  if (connected.data.errors.length) throw new Error("Shared business context could not reconcile connected records.");
  const accountPolicy: AuthorityConnection[] = connectionRows.map((row) => ({
    id: text(row.id), status: text(row.status), runtime_mode: text(row.runtime_mode),
    config: row.config as Record<string, unknown>, provider_key: text((row.provider as Row)?.provider_key),
  }));
  const connectionEvidence: ConnectionEvidence[] = connectionRows.map((row, index) => ({
    partner_id: text(row.partner_id), client_id: text(row.client_id), id: text(row.id), display_name: text(row.display_name),
    status: text(row.status), runtime_mode: text(row.runtime_mode), provider_key: accountPolicy[index].provider_key ?? "",
  }));
  const batch = (key: string, label: string, result: QueryResult, table: string, kind: string): EvidenceBatch => ({
    key, label, limit: CONTEXT_RECORD_LIMIT, hasMore: rows(result.data).length > CONTEXT_RECORD_LIMIT,
    rows: rows(result.data).slice(0, CONTEXT_RECORD_LIMIT).map((row): RecordEvidence => ({
      partner_id: text(row.partner_id), client_id: text(row.client_id), id: text(row.id), table,
      kind: text(row.kind) || text(row.type) || kind,
      title: (text(row.title) || text(row.summary) || kind).slice(0, 300),
      status: text(row.status) || text(row.action),
      revision: typeof row.revision === "number" ? row.revision : text(row.updated_at) || text(row.created_at),
      updated_at: text(row.updated_at) || text(row.created_at), created_at: text(row.created_at),
      source_record_id: text(row.source_record_id) || text(row.record_id) || text(row.work_id) || null,
      start_at: text(row.start_at) || undefined, next_action: text(row.next_action),
    })),
  });
  const reconciledMoney = reconcileMoneySources(connected.data.invoices, connected.data.payments);
  const invoiceBySource = new Map(reconciledMoney.invoices.flatMap((invoice) => invoice.sourceRecords.map((source) => [source.id, invoice] as const)));
  const paymentBySource = new Map(reconciledMoney.payments.flatMap((payment) => payment.sourceRecords.map((source) => [source.id, payment] as const)));
  const importedBatch = (kind: string): EvidenceBatch => {
    const batch = connected.batches.find((item) => item.objectType === kind);
    return {
      key: `imported:${kind}`, label: `Imported ${kind} snapshots`, limit: CONTEXT_RECORD_LIMIT,
      hasMore: batch?.hasMore ?? false,
      rows: (batch?.rows ?? []).flatMap((row): RecordEvidence[] => {
        const single = mapConnectedData(connected.apps, [row], generatedAt);
        const message = single.messages[0], appointment = single.appointments[0], lead = single.leads?.[0], invoiceSource = invoiceBySource.get(row.id), paymentSource = paymentBySource.get(row.id);
        const invoice = invoiceSource ? moneyEvidenceForSource(invoiceSource, row.id) : undefined, payment = paymentSource ? moneyEvidenceForSource(paymentSource, row.id) : undefined;
        const display = message ?? appointment ?? lead ?? invoice ?? payment;
        const cancelled = kind === "appointment" && (row.canonical_data.deleted === true || ["cancelled", "canceled"].includes(text(row.canonical_data.status)));
        if (!display && !cancelled) return [];
        const provider = connected.apps.find((app) => app.id === row.connection_id)?.provider;
        return [{
          partner_id: text(row.partner_id), client_id: text(row.client_id), id: row.id,
          table: "integration_canonical_records", kind,
          title: (message?.subject ?? appointment?.title ?? lead?.title ?? (invoice ? `Invoice ${invoice.number ?? invoice.externalId}` : payment ? `Payment ${payment.externalId}` : "Cancelled appointment")).slice(0, 300),
          status: cancelled ? row.canonical_data.deleted === true ? "deleted" : "cancelled" : message ? "imported_snapshot" : appointment?.status ?? lead?.status ?? invoice?.status ?? payment?.status ?? "unknown",
          revision: row.updated_at ?? row.external_updated_at ?? "unknown",
          updated_at: invoice?.updatedAt ?? payment?.updatedAt ?? row.external_updated_at ?? row.updated_at ?? generatedAt,
          source_updated_at: row.updated_at ?? undefined,
          source_record_id: row.connection_id, start_at: appointment?.startAt,
          native_object_id: row.native_object_id, external_object_id: row.external_object_id, external_parent_id: row.external_parent_id,
          display: {
            connectionId: row.connection_id, externalId: row.external_object_id, provider,
            href: display?.href ?? null, ...(message ? { direction: message.direction } : {}),
            ...(lead ? { summary: lead.preview } : {}),
            ...((invoice?.sourceWarning || payment?.sourceWarning) ? { summary: invoice?.sourceWarning || payment?.sourceWarning || undefined } : {}),
            ...(invoice ? { currency: invoice.currency, totalMinor: invoice.totalMinor, amountDueMinor: invoice.amountDueMinor, amountPaidMinor: invoice.amountPaidMinor } : {}),
            ...(payment ? { currency: payment.currency, amountMinor: payment.amountMinor, amountRefundedMinor: payment.amountRefundedMinor } : {}),
          },
        }];
      }),
    };
  };
  const batches = [
    batch("workspace", "Workspace records", records, "business_records", "workspace"),
    batch("leads", "Open leads", leads, "crm_leads", "lead"),
    batch("approvals", "Pending owner decisions", approvals, "approval_items", "approval"),
    batch("assignments", "Recent assignments", work, "agent_work_items", "assignment"),
    batch("appointments", "Upcoming appointments", appointments, "crm_appointments", "appointment"),
    batch("workspace_events", "Recorded workspace activity", workspaceEvents, "business_workspace_events", "event"),
    batch("work_events", "Recorded assignment activity", workEvents, "agent_work_events", "event"),
    ...["message", "appointment", "lead", "invoice", "payment"].map(importedBatch),
  ];
  const input: BusinessContextInput = {
    scope, generatedAt, profile: profile.data as unknown as ProfileEvidence | null,
    review: review.data as unknown as BusinessContextInput["review"], knowledge: knowledge.data as unknown as KnowledgeEvidence | null,
    authority: effectiveAuthoritySnapshot(settings.data ? {
      ...settings.data as unknown as AuthoritySettings,
      context_reviewed: contextReviewIsCurrent(
        (profile.data as unknown as ProfileEvidence | null)?.updated_at ?? null,
        (review.data as unknown as BusinessContextInput["review"])?.profile_revision ?? null,
        (profile.data as unknown as ProfileEvidence | null)?.profile as Record<string, unknown> | null,
        knowledge.data as unknown as Record<string, unknown> | null,
      ),
    } : null, activation.data as unknown as AuthorityActivation | null, accountPolicy, {
      internalCalendarEnabled: internalCalendarEnabled(clientRow ? { status: text(clientRow.status), crm_operating_mode: text(clientRow.crm_operating_mode), default_runtime_mode: text(clientRow.default_runtime_mode) } : null),
    }),
    connections: connectionEvidence,
    streams: connected.states as StreamEvidence[],
    streamCoverage: connected.apps.flatMap((app) => (app.streams ?? []).map((stream) => ({
      key: `${app.id}:${stream.key}`, label: `${app.name} · ${stream.key}`, connectionId: app.id,
      capability: `read:${stream.key}`, status: stream.status === "paused" ? "stale" as const : stream.status,
      lastUpdatedAt: stream.lastSyncedAt,
      sampled: connected.rows.filter((row) => row.connection_id === app.id && row.object_type === stream.key).length,
      limit: CONTEXT_RECORD_LIMIT, hasMore: connected.batches.find((batch) => batch.objectType === stream.key)?.hasMore ?? false,
      detail: stream.detail,
    }))),
    batches, canWrite,
  };
  const snapshot = buildBusinessContext(input);
  if (rows(connections.data).length > CONTEXT_CONNECTION_LIMIT || connected.data.limited)
    snapshot.coverage.push({ key: "connection_limit", label: "Connection coverage", connectionId: null, capability: "read", status: "stale", lastUpdatedAt: generatedAt, sampled: connectionRows.length, limit: CONTEXT_CONNECTION_LIMIT, hasMore: true, detail: "Only a bounded set of connections and stream states was loaded. Other accounts may need attention." });
  return snapshot;
}
