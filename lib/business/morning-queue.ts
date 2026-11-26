import { addDays, localDate, type BriefAppointment, type DailyAction } from "./daily-brief.ts";
import type { FocusRow } from "./focus-brief.ts";
import type { SyncedInvoice } from "../connections/types.ts";
import type { BusinessRecord } from "./types.ts";
import { readCalendarMutationPayload } from "../scheduling/calendar-mutation-rules.ts";

export type MorningQueueContext = {
  today: string;
  timeZone: string;
  actions: DailyAction[];
  appointments: BriefAppointment[];
  connectedInvoices: SyncedInvoice[];
  savedInvoices: BusinessRecord[];
};

type Approval = import("./daily-brief.ts").DailyBriefData["approvals"][number];
function approvalDeadline(approval: Approval): number | null {
  const payload = approval.proposed_payload;
  if (approval.type === "appointment_change") {
    const change = readCalendarMutationPayload(payload);
    const at = Date.parse(change?.new_slot?.start_iso ?? change?.old_slot.start_iso ?? "");
    return Number.isFinite(at) ? at : null;
  }
  if (approval.type !== "appointment_booking" || !payload?.slot || typeof payload.slot !== "object") return null;
  const at = Date.parse(String((payload.slot as Record<string, unknown>).start_iso ?? ""));
  return Number.isFinite(at) ? at : null;
}

/** A near-term calendar decision leads, followed by customer-facing decisions; age breaks ties without inventing deadlines. */
export function orderMorningApprovals(approvals: readonly Approval[], now: string): Approval[] {
  const clock = Date.parse(now);
  const horizon = Number.isFinite(clock) ? clock + 7 * 86400000 : Number.POSITIVE_INFINITY;
  const priority = (approval: Approval) => {
    const deadline = approvalDeadline(approval);
    if (deadline !== null && deadline <= horizon) return 0;
    if (approval.type === "customer_message" || approval.proposed_payload?.invoice_followup_version === 1) return 1;
    if (deadline !== null) return 2;
    return 3;
  };
  return approvals.map((approval, index) => ({ approval, index })).sort((a, b) => {
    const urgency = priority(a.approval) - priority(b.approval);
    if (urgency) return urgency;
    const deadline = (approvalDeadline(a.approval) ?? Infinity) - (approvalDeadline(b.approval) ?? Infinity);
    if (Number.isFinite(deadline) && deadline) return deadline;
    return a.approval.created_at.localeCompare(b.approval.created_at) || a.index - b.index;
  }).map(({ approval }) => approval);
}

export function overlappingAppointments(appointments: readonly BriefAppointment[], slot: { start_iso: string; end_iso: string }, excludedIds: readonly string[] = []): BriefAppointment[] {
  const start = Date.parse(slot.start_iso), end = Date.parse(slot.end_iso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const excluded = new Set(excludedIds);
  return appointments.filter((appointment) =>
    !excluded.has(appointment.id) &&
    !["cancelled", "canceled", "deleted"].includes(appointment.status) &&
    Number.isFinite(Date.parse(appointment.start_at)) && Number.isFinite(Date.parse(appointment.end_at)) &&
    Date.parse(appointment.start_at) < end && Date.parse(appointment.end_at) > start);
}

/** Keep the first source-backed presentation for each item, then rank actual owner work ahead of FYI records. */
export function orderMorningQueueRows(rows: readonly FocusRow[], context: MorningQueueContext): FocusRow[] {
  const actionByKey = new Map(context.actions.map((action) => ["action:" + action.id, action]));
  const appointmentByKey = new Map(context.appointments.map((appointment) => ["appointment:" + appointment.id, appointment]));
  const connectedInvoiceByKey = new Map(context.connectedInvoices.map((invoice) => ["connected-invoice:" + invoice.connectionId + ":" + invoice.id, invoice]));
  const savedInvoiceByKey = new Map(context.savedInvoices.map((invoice) => ["invoice:" + invoice.id, invoice]));
  const unique = new Map<string, { row: FocusRow; sourceOrder: number }>();
  rows.forEach((row, sourceOrder) => {
    if (!unique.has(row.key)) unique.set(row.key, { row, sourceOrder });
  });
  const rank = (row: FocusRow): { tier: number; due: string } => {
    const action = actionByKey.get(row.key);
    if (action) {
      const due = action.dueDate || "9999-12-31";
      return {
        tier: action.status === "blocked" || action.priority === "urgent" || (!!action.dueDate && action.dueDate < context.today)
          ? 1 : action.dueDate === context.today ? 2 : action.priority === "high" ? 3 : 4,
        due,
      };
    }
    if (row.key.startsWith("money-source:") || row.label === "Agent blocked" || row.label === "Blocked") return { tier: 1, due: "0000-01-01" };
    if (row.kind === "attention") return { tier: 2, due: "0000-01-01" };
    const connectedInvoice = connectedInvoiceByKey.get(row.key);
    const savedInvoice = savedInvoiceByKey.get(row.key);
    if (connectedInvoice || savedInvoice) {
      const due = connectedInvoice?.dueAt ? localDate(connectedInvoice.dueAt, context.timeZone) :
        savedInvoice?.data.due_date ? String(savedInvoice.data.due_date) : "9999-12-31";
      const pastDue = connectedInvoice?.status === "past_due" || (!!due && due < context.today);
      return { tier: pastDue || due === context.today ? 2 : due <= addDays(context.today, 3) ? 3 : 5, due };
    }
    const appointment = appointmentByKey.get(row.key);
    if (appointment) {
      const due = localDate(appointment.start_at, context.timeZone) || "9999-12-31";
      return { tier: appointment.status === "proposed" ? 2 : due === context.today ? 3 : 4, due };
    }
    if (row.kind === "goal") return { tier: 2, due: "0000-01-01" };
    return { tier: row.kind === "action" ? 4 : 5, due: "9999-12-31" };
  };
  return [...unique.values()].sort((a, b) => {
    const left = rank(a.row), right = rank(b.row);
    return left.tier - right.tier || left.due.localeCompare(right.due) || a.sourceOrder - b.sourceOrder;
  }).map((item) => item.row);
}
