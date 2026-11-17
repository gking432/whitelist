import type { ContextObservation, ContextSource } from "./context-contract.ts";
import type { ContextScope, RecordEvidence } from "./context.ts";

export type ObservedTransition = {
  status: string;
  at: string;
  nextAt: string | null;
  observedMilliseconds: number | null;
  source: ContextSource;
};
export type WorkflowLineage = {
  record: ContextSource;
  currentStatus: string;
  transitions: ObservedTransition[];
  historyComplete: false;
  limitation: string;
};

const reference = (row: RecordEvidence): ContextSource => ({ table: row.table, id: row.id, revision: String(row.revision ?? row.updated_at), updatedAt: row.updated_at });

/** Join only explicit persisted event foreign keys. Current snapshots are never manufactured into historical events. */
export function buildObservedLineage(scope: ContextScope, records: RecordEvidence[], limit = 100): WorkflowLineage[] {
  for (const row of records)
    if (row.partner_id !== scope.partnerId || row.client_id !== scope.clientId)
      throw new Error("Workflow evidence does not belong to this workspace.");
  return records.filter((r) => ["agent_work_items", "business_records"].includes(r.table))
    .slice(0, Math.max(0, Math.min(limit, 100)))
    .map((record) => {
      const eventTable = record.table === "agent_work_items" ? "agent_work_events" : "business_workspace_events";
      const events = records.filter((r) => r.table === eventTable && r.source_record_id === record.id && Number.isFinite(Date.parse(r.updated_at)))
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id));
      return {
        record: reference(record), currentStatus: record.status,
        transitions: events.map((event, index) => {
          const next = events[index + 1];
          return {
            status: event.status, at: event.updated_at, nextAt: next?.updated_at ?? null,
            observedMilliseconds: next ? Math.max(0, Date.parse(next.updated_at) - Date.parse(event.updated_at)) : null,
            source: reference(event),
          };
        }),
        historyComplete: false as const,
        limitation: "Only explicitly linked saved events in the bounded sample are shown. Times measure intervals between recorded transitions; they do not establish labor time, complete history or activity in other applications.",
      };
    });
}

/** Attach inspected event identities to current waiting points without backdating the current snapshot. */
export function attachObservationLineage(observations: ContextObservation[], lineage: WorkflowLineage[]): ContextObservation[] {
  return observations.map((observation) => {
    const trace = lineage.find((item) => observation.sources.some((s) => s.table === item.record.table && s.id === item.record.id));
    if (!trace?.transitions.length) return observation;
    const latest = trace.transitions[trace.transitions.length - 1];
    if (latest.status !== trace.currentStatus || Date.parse(latest.at) > Date.parse(observation.since)) return observation;
    return {
      ...observation,
      sources: [...observation.sources, latest.source],
      limitation: `${observation.limitation} A matching saved status event is linked; earlier or intermediate activity may be outside this sample.`,
    };
  });
}
