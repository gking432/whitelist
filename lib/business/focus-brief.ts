import {
  buildDailyBrief,
  buildConnectedMoney,
  localDate,
  safeSourceUrl,
  validTimeZone,
  type DailyBriefData,
} from "./daily-brief.ts";
import { displayMoney } from "./rules.ts";
import { formatMinorMoney } from "../connections/money.ts";

export type FocusRow = {
  key: string;
  title: string;
  detail: string;
  label: string;
  kind: "attention" | "appointment" | "action" | "goal" | "invoice";
  href?: string;
  recordId?: string;
};
export type DailyWorkSection = {
  key: string;
  title: string;
  href?: string;
  rows: FocusRow[];
  remaining: number;
};
export type FocusBrief = {
  title: string;
  description: string;
  rows: FocusRow[];
  remaining: number;
  state: "attention" | "planned" | "quiet" | "unconnected" | "incomplete";
  footer: string;
  link: { label: string; href: string } | null;
  sections: DailyWorkSection[];
};

export function buildFocusBrief(data: DailyBriefData): FocusBrief {
  const brief = buildDailyBrief(data);
  const timeZone = validTimeZone(data.timeZone);
  const connected =
    !!data.connectedData?.apps.some(
      (a) => a.status === "connected" && !a.paused,
    ) ||
    data.workspace.connections.some(
      (connection) =>
        connection.status === "connected" && connection.runtime_mode === "live",
    );
  const time = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  const appointments = data.appointments
    .filter(
      (appointment) =>
        appointment.status === "booked" &&
        (appointment.allDay
          ? appointment.start_at === brief.today
          : localDate(appointment.start_at, data.timeZone) === brief.today) &&
        (appointment.allDay
          ? appointment.end_at > brief.today
          : Date.parse(appointment.end_at) > Date.parse(data.generatedAt)),
    )
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const rows: FocusRow[] = [
    ...brief.attention.map((item) => ({
      key: item.id,
      title: item.title,
      detail: item.detail,
      label: item.label,
      kind: "attention" as const,
      href: item.href,
      recordId: item.recordId,
    })),
    ...appointments.map((appointment) => ({
      key: `appointment:${appointment.id}`,
      title: appointment.title,
      detail:
        appointment.sourceAccount ||
        (Date.parse(appointment.start_at) < Date.parse(data.generatedAt)
          ? "In progress"
          : "Appointment"),
      label: appointment.allDay ? "All day" : time(appointment.start_at),
      kind: "appointment" as const,
      href: appointment.sourceHref || "/client/crm?view=schedule",
    })),
    ...brief.actions
      .filter(
        (action) =>
          (!!action.dueDate && action.dueDate <= brief.today) ||
          action.priority === "urgent" ||
          action.status === "blocked",
      )
      .filter(
        (action) =>
          !brief.attention.some((item) => item.id === `action:${action.id}`),
      )
      .map((action) => ({
        key: `action:${action.id}`,
        title: action.title,
        detail:
          action.status === "blocked"
            ? "Blocked"
            : action.dueDate && action.dueDate < brief.today
              ? "Overdue"
              : "Due today",
        label: "To-do",
        kind: "action" as const,
        ...(action.source === "workspace"
          ? { recordId: action.id }
          : { href: "/client/todo" }),
      })),
    ...brief.goals
      .filter(
        (goal) =>
          !!goal.data.due_date &&
          String(goal.data.due_date) <= brief.today &&
          Number(goal.data.current) < Number(goal.data.target),
      )
      .map((goal) => ({
        key: `goal:${goal.id}`,
        title: goal.title,
        detail: "Goal target due",
        label:
          `${Number(goal.data.current).toLocaleString()} / ${Number(goal.data.target).toLocaleString()} ${String(goal.data.unit || "")}`.trim(),
        kind: "goal" as const,
        recordId: goal.id,
      })),
  ];
  let state: FocusBrief["state"] = rows.length
    ? "planned"
    : connected
      ? "quiet"
      : "unconnected";
  let title = rows.length
    ? "Your day, lined up."
    : connected
      ? "All clear for now."
      : "No updates yet.";
  let description = connected
    ? "Nothing needs your attention in the records available here."
    : "Connect your apps to bring your appointments, messages, and decisions into view.";
  if (brief.attention.length || brief.decisions || brief.urgentCount) {
    state = "attention";
    title =
      brief.decisions > 0
        ? `${brief.decisions} ${brief.decisions === 1 ? "decision needs" : "decisions need"} you.`
        : "A few things need your attention.";
    description = appointments.length
      ? `${appointments.length} ${appointments.length === 1 ? "appointment" : "appointments"} today, too.`
      : "Start with these, then get back to your day.";
  } else if (appointments.length) {
    title =
      appointments.length === 1
        ? appointments[0].allDay
          ? "An all-day event is on your calendar."
          : Date.parse(appointments[0].start_at) < Date.parse(data.generatedAt)
            ? "Your appointment is in progress."
            : `Your next appointment is at ${time(appointments[0].start_at)}.`
        : `${appointments.length} appointments today.`;
    description =
      rows.length > appointments.length
        ? "Your schedule and the work to move forward today."
        : "Here’s what’s coming up on your calendar.";
  } else if (rows.length) {
    description = "The next steps from your saved work.";
  }
  if (data.errors.length || data.limited) {
    state = "incomplete";
    title = data.errors.length
      ? "Your brief needs a refresh."
      : "Here’s what’s on your radar.";
    description = data.errors.length
      ? "Some information couldn’t be checked. These are the records available so far."
      : "This brief covers the recent records available here.";
  }
  const unavailableImport = data.connectedData?.apps.some(
    (a) =>
      a.paused ||
      a.error ||
      a.stale ||
      (a.status === "connected" && (!a.lastSyncedAt || a.syncing)),
  );
  if (unavailableImport && !data.errors.length) {
    state = "incomplete";
    title = "Your connected apps are updating.";
    description =
      "Some information is still importing, paused, or needs attention. Check connections for the latest status.";
  }
  const unread =
    data.connectedData?.messages.filter((m) => m.unread && m.inbox) || [];
  if (unread.length && state === "quiet") {
    state = "planned";
    title = `${unread.length} unread ${unread.length === 1 ? "conversation" : "conversations"}.`;
    description = "Your recent email is below.";
  }
  const next = brief.upcoming.find(
    (item) =>
      item.time && item.date > brief.today && item.label === "Appointment",
  );
  const footer =
    next && !appointments.length
      ? `Next appointment: ${new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(next.time!))}`
      : connected
        ? "From your connected apps and saved work"
        : rows.length
          ? "From your saved work · Apps aren’t connected yet"
          : "Your connected work will appear here";
  const link =
    brief.decisions > 0
      ? { label: "Review decisions", href: "/client/business/approvals" }
      : !connected
        ? { label: "Connect an app", href: "/client/apps" }
        : brief.openActions > 0
          ? { label: "Open To-do", href: "/client/todo" }
          : null;
  const invoices = data.workspace.records
    .filter(
      (record) =>
        record.kind === "invoice" &&
        !["paid", "archived", "rejected"].includes(record.status),
    )
    .sort((a, b) =>
      String(a.data.due_date || "9999").localeCompare(
        String(b.data.due_date || "9999"),
      ),
    );
  const connectedMoney = data.connectedData ? buildConnectedMoney(data.connectedData) : null;
  const intake = data.connectedData?.leads ?? [];
  if (!rows.length && !invoices.length && (connectedMoney?.outstanding.length || intake.length) &&
      !data.errors.length && !data.limited && !unavailableImport) {
    state = "planned";
    title = connectedMoney?.outstanding.length ? "Money and customer work to review." : "Customer inquiries are ready to review.";
    description = "From your connected apps and saved customer records.";
  }
  if (
    invoices.length &&
    !rows.length &&
    !data.errors.length &&
    !data.limited &&
    !unavailableImport
  ) {
    state = "planned";
    title = `${invoices.length} ${invoices.length === 1 ? "invoice to review" : "invoices to review"}.`;
    description = "Your saved invoices are below.";
  }
  if (connectedMoney?.conflictCount && ["quiet", "planned"].includes(state)) {
    state = "incomplete";
    title = "Money records need source review.";
    description = "Conflicting or overlapping imports are excluded from amounts due until the sources agree.";
  }
  const invoiceIds = new Set(invoices.map((record) => `record:${record.id}`));
  const sections: DailyWorkSection[] = [
    {
      key: "money-source-review", title: "Money source review", href: "/client/money",
      rows: [...(connectedMoney?.invoices ?? []), ...(connectedMoney?.payments ?? [])].filter((record) => record.status === "source_conflict").map((record) => ({
        key: `money-source:${record.connectionId}:${record.id}`, title: "number" in record ? `Invoice ${record.number || record.externalId}` : "Payment source needs review",
        detail: record.sourceWarning || "Check conflicting or overlapping source records.", label: "Source review", kind: "attention" as const,
        href: "number" in record ? `/client/money#invoice-${record.id}` : "/client/money",
      })), remaining: 0,
    },
    {
      key: "connected-invoices",
      title: "Money due",
      href: "/client/money",
      rows: (connectedMoney?.outstanding ?? []).map((invoice) => ({
        key: `connected-invoice:${invoice.connectionId}:${invoice.id}`,
        title: invoice.number ? `Invoice ${invoice.number}` : "Open invoice",
        detail: [invoice.account, invoice.dueAt ? `Due ${localDate(invoice.dueAt, timeZone)}` : "", invoice.status.replaceAll("_", " ")].filter(Boolean).join(" · "),
        label: formatMinorMoney(invoice.amountDueMinor, invoice.currency) ?? "Amount unavailable",
        kind: "invoice" as const,
        href: safeSourceUrl(invoice.href) || "/client/money",
      })),
      remaining: 0,
    },
    {
      key: "intake",
      title: "Form inquiries",
      href: "/client/messages#form-inquiries",
      rows: intake.map((lead) => ({
        key: `connected-intake:${lead.connectionId}:${lead.id}`,
        title: lead.title,
        detail: [lead.account, lead.status.replaceAll("_", " ")].filter(Boolean).join(" · "),
        label: "Saved inquiry",
        kind: "attention" as const,
        href: "/client/messages#form-inquiries",
      })),
      remaining: 0,
    },
    {
      key: "messages",
      title: "Messages",
      href: "/client/messages",
      rows: [
        ...unread.map((m) => ({
          key: `email:${m.connectionId}:${m.threadId}`,
          title: m.subject,
          detail: [m.from, m.account].filter(Boolean).join(" · "),
          label: "Unread",
          kind: "attention" as const,
          href: m.href || "/client/messages",
        })),
        ...rows.filter((row) => row.key.startsWith("conversation:")),
      ],
      remaining: 0,
    },
    {
      key: "attention",
      title: "Needs your attention",
      href: "/client/business/approvals",
      rows: rows.filter(
        (row) =>
          row.kind === "attention" &&
          !row.key.startsWith("conversation:") &&
          !row.key.startsWith("action:") &&
          !row.key.startsWith("work:") &&
          !invoiceIds.has(row.key),
      ),
      remaining: 0,
    },
    {
      key: "invoices",
      title: "Invoices",
      href: "/client/business/operations",
      rows: invoices.map((record) => ({
        key: `invoice:${record.id}`,
        title: record.title,
        detail: [
          String(record.data.customer || ""),
          record.status === "draft"
            ? "Draft"
            : record.status.replaceAll("_", " "),
          record.data.due_date ? `Due ${record.data.due_date}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        label:
          typeof record.data.amount === "number"
            ? displayMoney(record.data.amount, data.workspace.profile.currency)
            : "Review",
        kind: "invoice" as const,
        recordId: record.id,
      })),
      remaining: 0,
    },
    {
      key: "appointments",
      title: "Appointments",
      href: data.connectedData?.appointments.length
        ? "/client/calendar"
        : "/client/crm?view=schedule",
      rows: rows.filter((row) => row.kind === "appointment"),
      remaining: 0,
    },
    {
      key: "todo",
      title: "To-do",
      href: "/client/todo",
      rows: rows.filter(
        (row) =>
          row.kind === "action" ||
          row.key.startsWith("action:") ||
          row.key.startsWith("work:"),
      ),
      remaining: 0,
    },
  ]
    .filter((section) => section.rows.length > 0)
    .map((section) => ({
      ...section,
      rows: section.rows.slice(0, 4),
      remaining: Math.max(0, section.rows.length - 4),
    }));
  return {
    state,
    title,
    description,
    rows: rows.slice(0, 5),
    remaining: Math.max(0, rows.length - 5),
    footer,
    link,
    sections,
  };
}
