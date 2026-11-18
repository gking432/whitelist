import type { ConnectedApp, ConnectedData } from "../connections/types.ts";
import { knownCurrency, minorAmount } from "../connections/money.ts";
import { reconcileMoneySources } from "../money/source-reconciliation.ts";
import type { BusinessRecord, BusinessSnapshot } from "./types.ts";
import type { BusinessContextSnapshot } from "./context-contract.ts";

export type BriefTask = {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  due_at: string | null;
};
export type BriefAppointment = {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  status: string;
  sourceHref?: string;
  sourceAccount?: string;
  allDay?: boolean;
};
export type DailyBriefData = {
  workspace: BusinessSnapshot;
  businessContext?: BusinessContextSnapshot;
  connectedData?: ConnectedData;
  displayName: string | null;
  timeZone: string;
  generatedAt: string;
  tasks: BriefTask[];
  appointments: BriefAppointment[];
  approvals: {
    id: string;
    title: string;
    summary: string;
    created_at: string;
  }[];
  conversations: {
    id: string;
    channel: string;
    next_action: string;
    summary: string;
    updated_at: string;
  }[];
  work: {
    id: string;
    title: string;
    status: string;
    summary: string;
    updated_at: string;
  }[];
  teamStatus: "active" | "paused" | "not_set_up";
  counts: {
    tasks: number;
    approvals: number;
    conversations: number;
    blockedWork: number;
  };
  errors: string[];
  limited: boolean;
};
export type DailyAction = {
  id: string;
  title: string;
  dueDate: string;
  priority: string;
  status: string;
  source: "workspace" | "tasks";
  goalId: string;
  description: string;
};
export type BriefAttention = {
  id: string;
  title: string;
  detail: string;
  label: string;
  href?: string;
  recordId?: string;
  urgent: boolean;
};

export function validTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return "UTC";
  }
}
export function localDate(value: string, timeZone: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: validTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return ["year", "month", "day"]
    .map((key) => parts.find((p) => p.type === key)?.value)
    .join("-");
}
export function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function goalProgress(record: BusinessRecord) {
  const current = Number(record.data.current);
  const target = Number(record.data.target);
  return Number.isFinite(current) &&
    current >= 0 &&
    Number.isFinite(target) &&
    target > 0
    ? Math.min(100, Math.round((current / target) * 100))
    : 0;
}
export function safeSourceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** Current-record invoice totals stay separated by currency and exclude drafts. */
export function buildConnectedMoney(data: ConnectedData) {
  const reconciled = reconcileMoneySources(data.invoices, data.payments);
  const invoices = reconciled.invoices.sort((a, b) =>
    (a.dueAt || "9999").localeCompare(b.dueAt || "9999") || a.id.localeCompare(b.id));
  const open = invoices.filter((invoice) => ["open", "past_due"].includes(invoice.status));
  const outstanding = open.filter((invoice) => minorAmount(invoice.amountDueMinor) !== null && invoice.amountDueMinor! > 0);
  const totals = new Map<string, { currency: string; amountMinor: number | null; count: number }>();
  for (const invoice of outstanding) {
    const currency = knownCurrency(invoice.currency);
    if (!currency) continue;
    const prior = totals.get(currency);
    const next = (prior?.amountMinor ?? 0) + invoice.amountDueMinor!;
    totals.set(currency, { currency, amountMinor: prior?.amountMinor === null || !Number.isSafeInteger(next) ? null : next, count: (prior?.count ?? 0) + 1 });
  }
  return {
    invoices,
    outstanding,
    totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    unknownDueCount: open.filter((invoice) => minorAmount(invoice.amountDueMinor) === null || !knownCurrency(invoice.currency)).length,
    payments: reconciled.payments.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "") || a.id.localeCompare(b.id)),
    sourceWarnings: reconciled.sourceWarnings,
    duplicateCount: reconciled.duplicateCount,
    conflictCount: reconciled.conflictCount,
  };
}

const streamProviders: Record<string, string[]> = {
  message: ["google_workspace", "microsoft_365"], appointment: ["google_workspace", "microsoft_365", "google_calendar"],
  invoice: ["stripe"], payment: ["stripe"], lead: ["generic_inbound_webhook"],
};
export function relevantConnectedApps(data: ConnectedData, streamKeys: string[]): ConnectedApp[] {
  return data.apps.filter((app) => app.streams?.some((stream) => streamKeys.includes(stream.key)) ||
    streamKeys.some((key) => streamProviders[key]?.includes(app.provider)));
}
export function connectedStreamWarnings(data: ConnectedData, streamKeys: string[]): string[] {
  return relevantConnectedApps(data, streamKeys).flatMap((app) => {
    const streams = app.streams?.filter((stream) => streamKeys.includes(stream.key)) ?? [];
    if (streams.length) return streams.filter((stream) => stream.status !== "fresh" || stream.partial)
      .map((stream) => `${app.account || app.name}: ${stream.detail || `${stream.key} updates are ${stream.status}.`}`);
    return app.paused || app.stale || app.error || !app.lastSyncedAt || app.status !== "connected"
      ? [`${app.account || app.name}: ${app.error || "Updates are paused, incomplete or delayed."}`] : [];
  });
}

export function buildDailyBrief(data: DailyBriefData) {
  const today = localDate(data.generatedAt, data.timeZone);
  const records = data.workspace.records;
  const goals = records
    .filter((r) => r.kind === "goal" && r.status !== "archived")
    .sort((a, b) =>
      String(a.data.due_date || "9999").localeCompare(
        String(b.data.due_date || "9999"),
      ),
    );
  const actions: DailyAction[] = [
    ...records
      .filter(
        (r) =>
          r.kind === "job" && !["completed", "archived"].includes(r.status),
      )
      .map((r): DailyAction => ({
        id: r.id,
        title: r.title,
        dueDate: String(r.data.due_date || ""),
        priority: String(r.data.priority || "normal"),
        status: r.status,
        source: "workspace",
        goalId: String(r.data.goal_id || ""),
        description: r.body,
      })),
    ...data.tasks.map((t): DailyAction => ({
      id: t.id,
      title: t.title,
      dueDate: t.due_at ? localDate(t.due_at, data.timeZone) : "",
      priority: t.priority,
      status: t.status,
      source: "tasks",
      goalId: "",
      description: t.description || "",
    })),
  ];
  const urgent = (a: DailyAction) =>
    a.status === "blocked" ||
    (!!a.dueDate && a.dueDate < today) ||
    a.priority === "urgent";
  const rank = (a: DailyAction) =>
    urgent(a)
      ? 0
      : a.dueDate === today
        ? 1
        : a.priority === "high"
          ? 2
          : !a.dueDate
            ? 3
            : 4;
  actions.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
      a.title.localeCompare(b.title),
  );
  const attention: BriefAttention[] = [
    ...data.approvals.map((a) => ({
      id: `approval:${a.id}`,
      title: a.title,
      detail: a.summary,
      label: "Decision",
      href: "/client/approvals",
      urgent: false,
    })),
    ...records
      .filter((r) => r.status === "needs_approval")
      .map((r) => ({
        id: `record:${r.id}`,
        title: r.title,
        detail: r.body.slice(0, 180),
        label: "Decision",
        recordId: r.id,
        urgent: false,
      })),
    ...data.conversations.map((c) => ({
      id: `conversation:${c.id}`,
      title: c.next_action || "Review customer inquiry",
      detail:
        c.summary ||
        `${c.channel.replaceAll("_", " ")} conversation needs a person.`,
      label: "Customer",
      href: `/client/messages?id=${encodeURIComponent(c.id)}`,
      urgent: true,
    })),
    ...data.work
      .filter((w) => w.status === "blocked")
      .map((w) => ({
        id: `work:${w.id}`,
        title: w.title,
        detail: w.summary,
        label: "Agent blocked",
        href: "/client/team",
        urgent: true,
      })),
    ...actions.filter(urgent).map((a) => ({
      id: `action:${a.id}`,
      title: a.title,
      detail:
        a.status === "blocked"
          ? "Work is blocked. Review what is needed to continue."
          : a.dueDate && a.dueDate < today
            ? `Overdue since ${a.dueDate}.`
            : "Marked urgent.",
      label: a.status === "blocked" ? "Blocked" : "Overdue / urgent",
      urgent: true,
      ...(a.source === "workspace"
        ? { recordId: a.id }
        : { href: "/client/crm?view=tasks" }),
    })),
  ].sort((a, b) => Number(b.urgent) - Number(a.urgent));
  const upcoming = [
    ...actions
      .filter((a) => a.dueDate >= today && a.dueDate <= addDays(today, 6))
      .map((a) => ({
        id: `task:${a.id}`,
        title: a.title,
        date: a.dueDate,
        time: null as string | null,
        label: "Action due",
        recordId: a.source === "workspace" ? a.id : undefined,
        href: a.source === "tasks" ? "/client/crm?view=tasks" : undefined,
      })),
    ...data.appointments.map((a) => ({
      id: `appointment:${a.id}`,
      title: a.title,
      date: localDate(a.start_at, data.timeZone),
      time: a.allDay ? undefined : a.start_at,
      label: a.status === "proposed" ? "Proposed appointment" : "Appointment",
      recordId: undefined,
      href: a.sourceHref || "/client/crm?view=schedule",
    })),
    ...goals
      .filter(
        (g) =>
          String(g.data.due_date || "") >= today &&
          String(g.data.due_date) <= addDays(today, 6),
      )
      .map((g) => ({
        id: `goal:${g.id}`,
        title: g.title,
        date: String(g.data.due_date),
        time: null,
        label: "Goal target",
        recordId: g.id,
        href: undefined,
      })),
  ]
    .filter((i) => i.date >= today && i.date <= addDays(today, 6))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.time || "").localeCompare(b.time || ""),
    );
  const news = records
    .filter(
      (r) =>
        r.kind === "knowledge" &&
        r.status !== "archived" &&
        r.data.category === "Industry update" &&
        safeSourceUrl(r.data.source_url),
    )
    .sort((a, b) =>
      String(b.data.published_date || b.created_at).localeCompare(
        String(a.data.published_date || a.created_at),
      ),
    );
  const completedToday = records.filter(
    (r) =>
      r.kind === "job" &&
      r.status === "completed" &&
      localDate(r.updated_at, data.timeZone) === today,
  ).length;
  return {
    today,
    goals,
    actions,
    attention,
    upcoming,
    news,
    completedToday,
    decisions:
      data.counts.approvals +
      records.filter((r) => r.status === "needs_approval").length,
    urgentCount:
      actions.filter(urgent).length +
      data.counts.conversations +
      data.counts.blockedWork,
    openActions:
      actions.filter((a) => a.source === "workspace").length +
      data.counts.tasks,
  };
}
