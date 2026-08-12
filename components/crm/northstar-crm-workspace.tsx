"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  BarChart3,
  Bot,
  Cable,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  ContactRound,
  Inbox,
  LayoutDashboard,
  ListTodo,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  PhoneCall,
  Plus,
  Search,
  Settings,
  Sparkles,
  Star,
  TrendingUp,
  Workflow,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";

import {
  createCrmAppointment,
  createCrmLead,
  createCrmMessageDraft,
  createCrmQuote,
  createCrmTask,
  saveCrmAvailability,
  startCrmAiCallback,
  setCrmAppointmentStatus,
  setCrmQuoteStatus,
  setCrmTaskStatus,
  updateCrmContact,
  updateCrmAppointment,
  updateCrmLead,
  updateCrmLeadStage,
  updateCrmWorkspaceSettings,
} from "@/app/crm/actions";
import {
  ClientTeamPermissions,
  type ClientTeamMember,
} from "@/components/client/team-permissions";
import { ClientAutomationHealth } from "@/components/client/automation-health";
import { BusinessOutcomeReports } from "@/components/client/business-outcome-reports";
import { MarketingAnalyticsDashboard } from "@/components/client/marketing-analytics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { NorthstarCrmData } from "@/lib/crm/operating-suite";
import { appointmentDurationMinutes } from "@/lib/crm/appointments";
import type {
  AutomationConnection,
  AutomationRun,
  AutomationWorkflow,
} from "@/lib/crm/automation-health";
import type { CrmView } from "@/lib/crm/views";
import { COMMON_TIMEZONES } from "@/lib/clients/constants";
import type { FormState } from "@/lib/forms/state";
import type { ClientSectionKey } from "@/lib/permissions/client-sections";
import { cn } from "@/lib/utils";

type Contact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  company_name: string | null;
  preferred_channel: string | null;
  source: string | null;
  created_at: string;
};

type Lead = {
  id: string;
  contact_id: string;
  status: string;
  title: string | null;
  service_type: string | null;
  description: string | null;
  urgency: string | null;
  quality: string | null;
  source_event_type: string | null;
  summary: string | null;
  next_action: string | null;
  estimated_value_min: number | null;
  estimated_value_max: number | null;
  created_at: string;
};

type Task = {
  id: string;
  contact_id: string | null;
  lead_id: string | null;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  due_at: string | null;
};

type Communication = {
  id: string;
  contact_id: string | null;
  channel: string;
  direction: string;
  status: string;
  from_value: string | null;
  to_value: string | null;
  subject: string | null;
  body: string;
  ai_generated: boolean;
  occurred_at: string;
};

type Appointment = {
  id: string;
  contact_id: string | null;
  lead_id: string | null;
  title: string;
  start_at: string;
  end_at: string;
  status: string;
  location: string | null;
  notes: string | null;
  created_at: string;
};

type Availability = {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  appointment_minutes: number;
  label: string | null;
};

type Call = {
  id: string;
  from_number: string | null;
  to_number: string | null;
  direction: string;
  status: string;
  provider: string;
  matched_contact_id: string | null;
  summary: string | null;
  crm_note: string | null;
  extracted: Record<string, unknown> | null;
  started_at: string;
  ended_at: string | null;
};

type TranscriptTurn = {
  id: string;
  call_session_id: string;
  seq: number;
  role: "caller" | "staff" | "ai_assistant";
  content: string;
  occurred_at: string;
};

type Quote = {
  id: string;
  contact_id: string | null;
  lead_id: string | null;
  service_type: string;
  status: string;
  low_amount: number;
  high_amount: number;
  ai_summary: string | null;
  created_at: string;
};

type Feedback = {
  id: string;
  source: string;
  rating: number | null;
  feedback_text: string;
  sentiment: string;
  risk_level: string;
  summary: string;
  suggested_internal_action: string | null;
  suggested_customer_response: string | null;
  ai_status: string;
  created_at: string;
};

type TimelineEntry = {
  id: string;
  actor_type: string;
  created_at: string;
};

type IntegrationEvent = {
  id: string;
  connection_id: string | null;
  direction: string;
  event_type: string;
  status: string;
  external_object_type: string | null;
  external_object_id: string | null;
  error_message: string | null;
  created_at: string;
};

const VIEW_ITEMS: {
  key: CrmView;
  label: string;
  icon: typeof LayoutDashboard;
}[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "pipeline", label: "Pipeline", icon: TrendingUp },
  { key: "contacts", label: "Contacts", icon: ContactRound },
  { key: "tasks", label: "Tasks", icon: ListTodo },
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "schedule", label: "Schedule", icon: CalendarDays },
  { key: "calls", label: "AI Calls", icon: PhoneCall },
  { key: "quotes", label: "Quotes", icon: CircleDollarSign },
  { key: "marketing", label: "Marketing", icon: Star },
  { key: "automations", label: "AI Automations", icon: Workflow },
  { key: "reports", label: "Reports", icon: BarChart3 },
  { key: "crm-sync", label: "CRM Sync", icon: Cable },
  { key: "settings", label: "Settings", icon: Settings },
];

const PIPELINE_STAGES = [
  "new",
  "contacted",
  "quoted",
  "scheduled",
  "won",
  "lost",
] as const;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function contactName(contact: Contact | undefined): string {
  if (!contact) return "Unknown contact";
  return (
    [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
    contact.phone ||
    contact.email ||
    "Unnamed contact"
  );
}

function money(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

function when(value: string | null | undefined): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown time"
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
}

function localDateTimeInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function localDateTimeToIso(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function statusClass(status: string): string {
  if (["won", "sent", "delivered", "booked", "done", "positive"].includes(status)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (["urgent", "failed", "lost", "negative"].includes(status)) {
    return "border-red-200 bg-red-50 text-red-800";
  }
  if (["high", "pending_approval", "quoted", "mixed"].includes(status)) {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function runtimeLabel(runtimeMode: string): string {
  return runtimeMode === "sandbox"
    ? "setup"
    : runtimeMode.replaceAll("_", " ");
}

function Metric({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof LayoutDashboard;
}) {
  return (
    <div className="border-r px-4 py-4 last:border-r-0">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Icon className="size-4 text-primary" aria-hidden="true" />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function Empty({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="grid min-h-40 place-items-center px-6 py-8 text-center">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
          {detail}
        </p>
      </div>
    </div>
  );
}

export function NorthstarCrmWorkspace({
  clientId,
  clientName,
  productName = "CRM",
  basePath,
  view,
  canEdit,
  canOperate,
  canManageTeam,
  visibleSections,
  approvalsPath,
  assistantPath,
  actionCenterPath,
  data,
  embedded = false,
  initialSearch = "",
  showNewLead = false,
}: {
  clientId: string;
  clientName: string;
  productName?: string;
  basePath: string;
  view: CrmView;
  canEdit: boolean;
  canOperate: boolean;
  canManageTeam: boolean;
  visibleSections?: ClientSectionKey[];
  approvalsPath: string;
  assistantPath: string;
  actionCenterPath?: string | null;
  data: NorthstarCrmData;
  embedded?: boolean;
  initialSearch?: string;
  showNewLead?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [actionMessage, setActionMessage] = useState<FormState | null>(null);
  const [search, setSearch] = useState(initialSearch);
  const [newLeadOpen, setNewLeadOpen] = useState(showNewLead);
  const [editingAppointmentId, setEditingAppointmentId] = useState<string | null>(
    null,
  );
  const [renderedAt] = useState(() => Date.now());
  const canSeeView = (candidate: CrmView) =>
    !visibleSections || visibleSections.includes(candidate);
  const contacts = data.contacts as unknown as Contact[];
  const leads = data.leads as unknown as Lead[];
  const tasks = data.tasks as unknown as Task[];
  const communications = data.communications as unknown as Communication[];
  const appointments = data.appointments as unknown as Appointment[];
  const availability = data.availability as unknown as Availability[];
  const calls = data.calls as unknown as Call[];
  const transcriptTurns =
    data.transcriptTurns as unknown as TranscriptTurn[];
  const quotes = data.quotes as unknown as Quote[];
  const feedback = data.feedback as unknown as Feedback[];
  const campaigns = data.campaigns;
  const timeline = data.timeline as unknown as TimelineEntry[];
  const workflows = data.workflows as unknown as AutomationWorkflow[];
  const workflowRuns = data.workflowRuns as unknown as AutomationRun[];
  const connections = data.connections as unknown as AutomationConnection[];
  const integrationEvents =
    data.integrationEvents as unknown as IntegrationEvent[];
  const teamMembers = data.teamMembers as unknown as ClientTeamMember[];
  const crmConnections = connections.filter(
    (connection) =>
      connection.provider?.category === "crm" ||
      connection.provider?.category === "field_service",
  );
  const crmConnectionIds = new Set(
    crmConnections.map((connection) => connection.id),
  );
  const crmSyncEvents = integrationEvents.filter(
    (event) =>
      (event.connection_id && crmConnectionIds.has(event.connection_id)) ||
      event.external_object_type === "crm_contact" ||
      event.external_object_type === "crm_lead" ||
      event.external_object_type === "customer" ||
      event.external_object_type === "lead",
  );
  const contactById = useMemo(
    () => new Map(contacts.map((contact) => [contact.id, contact])),
    [contacts],
  );
  const transcriptByCall = useMemo(() => {
    const grouped = new Map<string, TranscriptTurn[]>();

    for (const turn of transcriptTurns) {
      const group = grouped.get(turn.call_session_id) ?? [];
      group.push(turn);
      grouped.set(turn.call_session_id, group);
    }

    for (const group of grouped.values()) {
      group.sort((a, b) => a.seq - b.seq);
    }

    return grouped;
  }, [transcriptTurns]);

  function run(action: () => Promise<FormState>, onSuccess?: () => void) {
    setActionMessage(null);
    startTransition(async () => {
      const response = await action();
      setActionMessage(response);
      if (response.status === "success") {
        onSuccess?.();
        router.refresh();
      }
    });
  }

  const openLeads = leads.filter(
    (lead) => !["won", "lost"].includes(lead.status),
  );
  const openTasks = tasks.filter((task) => task.status === "open");
  const upcoming = appointments.filter(
    (appointment) =>
      appointment.status !== "cancelled" &&
      new Date(appointment.end_at).getTime() >= renderedAt,
  );
  const pipelineValue = openLeads.reduce(
    (total, lead) =>
      total +
      ((Number(lead.estimated_value_min) || 0) +
        (Number(lead.estimated_value_max) || 0)) /
        2,
    0,
  );
  const filteredContacts = contacts.filter((contact) =>
    [
      contactName(contact),
      contact.email ?? "",
      contact.phone ?? "",
      contact.address ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const filteredLeads = leads.filter((lead) => {
    const contact = contactById.get(lead.contact_id);
    return [
      contactName(contact),
      contact?.email ?? "",
      contact?.phone ?? "",
      lead.service_type ?? "",
      lead.description ?? "",
      lead.status,
      lead.urgency ?? "",
      lead.quality ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase());
  });

  return (
    <div className="space-y-5">
      {!embedded ? (
      <header className="flex flex-col gap-4 border-b pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h1 className="font-semibold">{clientName} CRM</h1>
              <p className="text-xs text-muted-foreground">
                {productName} AI operations suite
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.pendingApprovals > 0 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={approvalsPath}>
                <ClipboardCheck aria-hidden="true" />
                {data.pendingApprovals} approval
                {data.pendingApprovals === 1 ? "" : "s"}
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link href={assistantPath}>
              <Bot aria-hidden="true" />
              Assistant popup
            </Link>
          </Button>
          {!canEdit && !canOperate ? (
            <Badge variant="outline">Read-only support view</Badge>
          ) : null}
        </div>
      </header>
      ) : null}

      {!embedded ? (
      <nav
        aria-label="CRM sections"
        className="flex gap-1 overflow-x-auto border-b"
      >
        {VIEW_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={`${basePath}?view=${item.key}`}
              className={cn(
                "-mb-px inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-xs font-medium",
                view === item.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      ) : null}

      {actionMessage ? (
        <div
          className={cn(
            "rounded-md border px-4 py-3 text-sm",
            actionMessage.status === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900",
          )}
        >
          {actionMessage.message}
        </div>
      ) : null}

      {pending ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          {productName} is working…
        </div>
      ) : null}

      {view === "overview" ? (
        <div className="space-y-5">
          <section className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Open pipeline"
              value={openLeads.length}
              detail={`${leads.length} total opportunities`}
              icon={TrendingUp}
            />
            <Metric
              label="Pipeline value"
              value={money(pipelineValue)}
              detail="Midpoint of current ballparks"
              icon={CircleDollarSign}
            />
            <Metric
              label="Open tasks"
              value={openTasks.length}
              detail={`${openTasks.filter((task) => task.priority === "urgent").length} urgent`}
              icon={ListTodo}
            />
            <Metric
              label="Appointments"
              value={upcoming.length}
              detail="Upcoming on the calendar"
              icon={CalendarDays}
            />
          </section>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]">
            <section className="overflow-hidden rounded-lg border bg-card">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="text-sm font-semibold">Priority queue</h2>
                {canSeeView("pipeline") ? (
                  <Link
                    href={`${basePath}?view=pipeline`}
                    className="text-xs font-medium text-primary"
                  >
                    Open pipeline
                  </Link>
                ) : null}
              </div>
              {openLeads.length === 0 ? (
                <Empty
                  title="No open leads"
                  detail="New customer inquiries and manually created leads will appear here."
                />
              ) : (
                <div className="divide-y">
                  {[...openLeads]
                    .sort((a, b) => {
                      const weight = (value: string | null) =>
                        value === "emergency"
                          ? 4
                          : value === "high"
                            ? 3
                            : value === "medium"
                              ? 2
                              : 1;
                      return weight(b.urgency) - weight(a.urgency);
                    })
                    .slice(0, 6)
                    .map((lead) => (
                      <div
                        key={lead.id}
                        className="flex items-start justify-between gap-4 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {lead.title ??
                              contactName(contactById.get(lead.contact_id))}
                          </p>
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                            {lead.next_action ?? lead.summary ?? "Review lead"}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {lead.urgency ? (
                            <Badge
                              variant="outline"
                              className={statusClass(lead.urgency)}
                            >
                              {lead.urgency}
                            </Badge>
                          ) : null}
                          <Badge variant="outline">{lead.status}</Badge>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </section>

            <section className="overflow-hidden rounded-lg border bg-card">
              <div className="border-b px-4 py-3">
                <h2 className="text-sm font-semibold">Next up</h2>
              </div>
              <div className="divide-y">
                {upcoming.slice(0, 4).map((appointment) => (
                  <div key={appointment.id} className="px-4 py-3">
                    <p className="text-sm font-medium">{appointment.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {when(appointment.start_at)}
                    </p>
                  </div>
                ))}
                {openTasks.slice(0, Math.max(0, 5 - upcoming.length)).map((task) => (
                  <div key={task.id} className="px-4 py-3">
                    <p className="text-sm font-medium">{task.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {task.due_at ? `Due ${when(task.due_at)}` : "No due date"}
                    </p>
                  </div>
                ))}
                {upcoming.length === 0 && openTasks.length === 0 ? (
                  <Empty
                    title="Nothing waiting"
                    detail="Appointments and tasks will appear here."
                  />
                ) : null}
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {view === "pipeline" ? (
        <div className="space-y-5">
          {canEdit ? (
            <details
              id="new-lead"
              className="rounded-lg border bg-card"
              open={newLeadOpen}
              onToggle={(event) =>
                setNewLeadOpen(event.currentTarget.open)
              }
            >
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
                Add lead
              </summary>
              <form
                className="grid gap-3 border-t p-4 sm:grid-cols-2 lg:grid-cols-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  run(() =>
                    createCrmLead({
                      clientId,
                      name: String(form.get("name") ?? ""),
                      phone: String(form.get("phone") ?? ""),
                      email: String(form.get("email") ?? ""),
                      address: String(form.get("address") ?? ""),
                      serviceType: String(form.get("service_type") ?? ""),
                      description: String(form.get("description") ?? ""),
                      source: "crm_manual",
                    }),
                  );
                  event.currentTarget.reset();
                }}
              >
                <Input name="name" placeholder="Customer name" required />
                <Input name="phone" placeholder="Phone" />
                <Input name="email" type="email" placeholder="Email" />
                <Input name="address" placeholder="Service address" />
                <Input name="service_type" placeholder="Service needed" />
                <Textarea
                  name="description"
                  placeholder="What does the customer need?"
                  className="sm:col-span-2"
                />
                <Button type="submit" disabled={pending}>
                  <Plus aria-hidden="true" />
                  Create lead
                </Button>
              </form>
            </details>
          ) : null}

          <section className="overflow-x-auto pb-2">
            <div className="grid min-w-[1080px] grid-cols-6 gap-3">
              {PIPELINE_STAGES.map((stage) => {
                const stageLeads = leads.filter((lead) => lead.status === stage);
                return (
                  <div key={stage} className="min-w-0">
                    <div className="mb-2 flex items-center justify-between px-1">
                      <h2 className="text-xs font-semibold uppercase text-muted-foreground">
                        {stage}
                      </h2>
                      <Badge variant="outline">{stageLeads.length}</Badge>
                    </div>
                    <div className="min-h-52 space-y-2 rounded-lg bg-secondary/45 p-2">
                      {stageLeads.map((lead) => {
                        const contact = contactById.get(lead.contact_id);
                        return (
                          <article
                            key={lead.id}
                            className="rounded-md border bg-card p-3"
                          >
                            <p className="text-sm font-medium">
                              {contactName(contact)}
                            </p>
                            <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                              {lead.service_type ??
                                lead.description ??
                                "General inquiry"}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {lead.urgency ? (
                                <Badge
                                  variant="outline"
                                  className={statusClass(lead.urgency)}
                                >
                                  {lead.urgency}
                                </Badge>
                              ) : null}
                              {lead.quality ? (
                                <Badge variant="outline">{lead.quality}</Badge>
                              ) : null}
                            </div>
                            {lead.estimated_value_max ? (
                              <p className="mt-2 text-xs font-medium">
                                {money(lead.estimated_value_min)}–
                                {money(lead.estimated_value_max)}
                              </p>
                            ) : null}
                            {canEdit ? (
                              <Select
                                className="mt-3 h-8 text-xs"
                                value={lead.status}
                                onChange={(event) =>
                                  run(() =>
                                    updateCrmLeadStage({
                                      clientId,
                                      leadId: lead.id,
                                      status: event.target.value,
                                    }),
                                  )
                                }
                                disabled={pending}
                                aria-label="Move lead stage"
                              >
                                {PIPELINE_STAGES.map((option) => (
                                  <option key={option} value={option}>
                                    Move to {option}
                                  </option>
                                ))}
                              </Select>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}

      {view === "contacts" ? (
        <div className="space-y-5">
          <section className="overflow-hidden rounded-lg border bg-card">
            <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold">Leads</h2>
                <p className="text-xs text-muted-foreground">
                  {leads.length} lead{leads.length === 1 ? "" : "s"} across the
                  pipeline
                </p>
              </div>
              <label className="relative block w-full md:hidden">
                <Search
                  className="absolute left-2.5 top-2.5 size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="pl-8"
                  placeholder="Search leads"
                />
              </label>
            </div>
            {filteredLeads.length === 0 ? (
              <Empty
                title={leads.length === 0 ? "No leads yet" : "No matching leads"}
                detail="New customer requests and manually entered opportunities appear here."
              />
            ) : (
              <div className="divide-y">
                {filteredLeads.map((lead) => {
                  const contact = contactById.get(lead.contact_id);
                  const relatedTasks = tasks.filter(
                    (task) => task.lead_id === lead.id,
                  );
                  const relatedAppointments = appointments.filter(
                    (appointment) => appointment.lead_id === lead.id,
                  );
                  const relatedQuotes = quotes.filter(
                    (quote) => quote.lead_id === lead.id,
                  );

                  return (
                    <details key={lead.id} className="group">
                      <summary className="grid cursor-pointer list-none gap-3 px-4 py-3 hover:bg-secondary/35 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_auto] sm:items-center">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {contactName(contact)}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[contact?.phone, contact?.email]
                              .filter(Boolean)
                              .join(" · ") || "No contact details"}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm">
                            {lead.service_type ?? "General inquiry"}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {lead.next_action ?? lead.summary ?? "No next action"}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {lead.urgency ? (
                            <Badge
                              variant="outline"
                              className={statusClass(lead.urgency)}
                            >
                              {lead.urgency}
                            </Badge>
                          ) : null}
                          <Badge
                            variant="outline"
                            className={statusClass(lead.status)}
                          >
                            {lead.status}
                          </Badge>
                        </div>
                      </summary>

                      <div className="border-t bg-secondary/15 p-4">
                        <div className="grid gap-4 xl:grid-cols-2">
                          <form
                            className="space-y-3 rounded-lg border bg-card p-4"
                            onSubmit={(event) => {
                              event.preventDefault();
                              const form = new FormData(event.currentTarget);
                              run(() =>
                                updateCrmLead({
                                  clientId,
                                  leadId: lead.id,
                                  serviceType: String(
                                    form.get("service_type") ?? "",
                                  ),
                                  description: String(
                                    form.get("description") ?? "",
                                  ),
                                  nextAction: String(
                                    form.get("next_action") ?? "",
                                  ),
                                  estimatedValueMin: Number(
                                    form.get("estimated_value_min"),
                                  ),
                                  estimatedValueMax: Number(
                                    form.get("estimated_value_max"),
                                  ),
                                }),
                              );
                            }}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <h3 className="text-sm font-semibold">
                                Opportunity
                              </h3>
                              {canEdit ? (
                                <Select
                                  className="h-8 w-36 text-xs"
                                  value={lead.status}
                                  onChange={(event) =>
                                    run(() =>
                                      updateCrmLeadStage({
                                        clientId,
                                        leadId: lead.id,
                                        status: event.target.value,
                                      }),
                                    )
                                  }
                                  disabled={pending}
                                  aria-label={`Stage for ${contactName(contact)}`}
                                >
                                  {PIPELINE_STAGES.map((stage) => (
                                    <option key={stage} value={stage}>
                                      {stage.replaceAll("_", " ")}
                                    </option>
                                  ))}
                                </Select>
                              ) : null}
                            </div>
                            <Input
                              name="service_type"
                              defaultValue={lead.service_type ?? ""}
                              placeholder="Service type"
                              required
                              disabled={!canEdit}
                            />
                            <Textarea
                              name="description"
                              defaultValue={lead.description ?? ""}
                              placeholder="Customer request"
                              disabled={!canEdit}
                            />
                            <Textarea
                              name="next_action"
                              defaultValue={lead.next_action ?? ""}
                              placeholder="Next action"
                              disabled={!canEdit}
                            />
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Input
                                name="estimated_value_min"
                                type="number"
                                min="0"
                                step="1"
                                defaultValue={lead.estimated_value_min ?? ""}
                                placeholder="Low estimate"
                                disabled={!canEdit}
                              />
                              <Input
                                name="estimated_value_max"
                                type="number"
                                min="0"
                                step="1"
                                defaultValue={lead.estimated_value_max ?? ""}
                                placeholder="High estimate"
                                disabled={!canEdit}
                              />
                            </div>
                            {canEdit ? (
                              <Button type="submit" size="sm" disabled={pending}>
                                Save opportunity
                              </Button>
                            ) : null}
                          </form>

                          {contact ? (
                            <form
                              className="space-y-3 rounded-lg border bg-card p-4"
                              onSubmit={(event) => {
                                event.preventDefault();
                                const form = new FormData(event.currentTarget);
                                run(() =>
                                  updateCrmContact({
                                    clientId,
                                    contactId: contact.id,
                                    firstName: String(
                                      form.get("first_name") ?? "",
                                    ),
                                    lastName: String(
                                      form.get("last_name") ?? "",
                                    ),
                                    companyName: String(
                                      form.get("company_name") ?? "",
                                    ),
                                    phone: String(form.get("phone") ?? ""),
                                    email: String(form.get("email") ?? ""),
                                    address: String(form.get("address") ?? ""),
                                    preferredChannel: String(
                                      form.get("preferred_channel") ?? "",
                                    ),
                                  }),
                                );
                              }}
                            >
                              <h3 className="text-sm font-semibold">Customer</h3>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <Input
                                  name="first_name"
                                  defaultValue={contact.first_name ?? ""}
                                  placeholder="First name"
                                  required
                                  disabled={!canEdit}
                                />
                                <Input
                                  name="last_name"
                                  defaultValue={contact.last_name ?? ""}
                                  placeholder="Last name"
                                  disabled={!canEdit}
                                />
                              </div>
                              <Input
                                name="company_name"
                                defaultValue={contact.company_name ?? ""}
                                placeholder="Company"
                                disabled={!canEdit}
                              />
                              <div className="grid gap-3 sm:grid-cols-2">
                                <Input
                                  name="phone"
                                  defaultValue={contact.phone ?? ""}
                                  placeholder="Phone"
                                  disabled={!canEdit}
                                />
                                <Input
                                  name="email"
                                  type="email"
                                  defaultValue={contact.email ?? ""}
                                  placeholder="Email"
                                  disabled={!canEdit}
                                />
                              </div>
                              <Input
                                name="address"
                                defaultValue={contact.address ?? ""}
                                placeholder="Service address"
                                disabled={!canEdit}
                              />
                              <Select
                                name="preferred_channel"
                                defaultValue={contact.preferred_channel ?? ""}
                                disabled={!canEdit}
                              >
                                <option value="">No channel preference</option>
                                <option value="phone">Phone</option>
                                <option value="sms">SMS</option>
                                <option value="email">Email</option>
                              </Select>
                              {canEdit ? (
                                <Button
                                  type="submit"
                                  size="sm"
                                  disabled={pending}
                                >
                                  Save customer
                                </Button>
                              ) : null}
                            </form>
                          ) : null}
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <div className="rounded-md border bg-card px-3 py-2">
                            <p className="text-[11px] text-muted-foreground">
                              Tasks
                            </p>
                            <p className="mt-0.5 text-sm font-medium">
                              {
                                relatedTasks.filter(
                                  (task) => task.status === "open",
                                ).length
                              }{" "}
                              open
                            </p>
                          </div>
                          <div className="rounded-md border bg-card px-3 py-2">
                            <p className="text-[11px] text-muted-foreground">
                              Appointments
                            </p>
                            <p className="mt-0.5 text-sm font-medium">
                              {relatedAppointments.length}
                            </p>
                          </div>
                          <div className="rounded-md border bg-card px-3 py-2">
                            <p className="text-[11px] text-muted-foreground">
                              Quotes
                            </p>
                            <p className="mt-0.5 text-sm font-medium">
                              {relatedQuotes.length}
                            </p>
                          </div>
                        </div>
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </section>

          {contacts.length > 0 ? (
            <section className="overflow-hidden rounded-lg border bg-card">
              <div className="border-b px-4 py-3">
                <h2 className="text-sm font-semibold">Customer directory</h2>
                <p className="text-xs text-muted-foreground">
                  {filteredContacts.length} matching contact
                  {filteredContacts.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="divide-y">
                {filteredContacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                  >
                    <p className="truncate text-sm font-medium">
                      {contactName(contact)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground sm:text-right">
                      {[contact.phone, contact.email, contact.address]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {view === "tasks" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="overflow-hidden rounded-lg border bg-card">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Task queue</h2>
            </div>
            {tasks.length === 0 ? (
              <Empty
                title="No tasks"
                detail="AI recommendations and manually created work appear here."
              />
            ) : (
              <div className="divide-y">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-start justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className={statusClass(task.priority)}
                        >
                          {task.priority}
                        </Badge>
                        <p
                          className={cn(
                            "text-sm font-medium",
                            task.status !== "open" &&
                              "text-muted-foreground line-through",
                          )}
                        >
                          {task.title}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {task.due_at ? `Due ${when(task.due_at)}` : "No due date"}
                        {task.contact_id
                          ? ` · ${contactName(contactById.get(task.contact_id))}`
                          : ""}
                      </p>
                    </div>
                    {canEdit ? (
                      <Select
                        className="h-8 w-28 text-xs"
                        value={task.status}
                        onChange={(event) =>
                          run(() =>
                            setCrmTaskStatus({
                              clientId,
                              taskId: task.id,
                              status: event.target.value as
                                | "open"
                                | "done"
                                | "cancelled",
                            }),
                          )
                        }
                        disabled={pending}
                        aria-label={`Status for ${task.title}`}
                      >
                        <option value="open">Open</option>
                        <option value="done">Done</option>
                        <option value="cancelled">Cancelled</option>
                      </Select>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          {canEdit ? (
            <form
              className="h-fit space-y-3 rounded-lg border bg-card p-4"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                run(() =>
                  createCrmTask({
                    clientId,
                    title: String(form.get("title") ?? ""),
                    description: String(form.get("description") ?? ""),
                    priority: String(form.get("priority") ?? "medium"),
                    dueAt: String(form.get("due_at") ?? ""),
                    contactId: String(form.get("contact_id") ?? ""),
                    leadId: String(form.get("lead_id") ?? ""),
                  }),
                );
                event.currentTarget.reset();
              }}
            >
              <h2 className="text-sm font-semibold">Create task</h2>
              <Input name="title" placeholder="Task title" required />
              <Textarea name="description" placeholder="Details" />
              <Select name="priority" defaultValue="medium">
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </Select>
              <Input name="due_at" type="datetime-local" />
              <Select name="lead_id" defaultValue="">
                <option value="">No linked lead</option>
                {openLeads.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {contactName(contactById.get(lead.contact_id))} ·{" "}
                    {lead.service_type ?? "Lead"}
                  </option>
                ))}
              </Select>
              <Select name="contact_id" defaultValue="">
                <option value="">No contact</option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contactName(contact)}
                  </option>
                ))}
              </Select>
              <Button type="submit" className="w-full" disabled={pending}>
                <Plus aria-hidden="true" />
                Add task
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}

      {view === "inbox" ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
          <section className="overflow-hidden rounded-lg border bg-card">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Omnichannel inbox</h2>
                <p className="text-xs text-muted-foreground">
                  Forms, calls, texts, emails, and AI drafts
                </p>
              </div>
              <Badge variant="outline">{communications.length}</Badge>
            </div>
            {communications.length === 0 ? (
              <Empty
                title="No conversations yet"
                detail="Connected forms, phone, SMS, and email activity will appear here automatically."
              />
            ) : (
              <div className="divide-y">
                {communications.map((item) => (
                  <article key={item.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          {item.channel.replaceAll("_", " ")}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {item.direction}
                        </span>
                        {item.ai_generated ? (
                          <Badge variant="outline">
                            <Sparkles className="size-3" />
                            AI
                          </Badge>
                        ) : null}
                      </div>
                      <Badge
                        variant="outline"
                        className={statusClass(item.status)}
                      >
                        {item.status.replaceAll("_", " ")}
                      </Badge>
                    </div>
                    {item.subject ? (
                      <p className="mt-2 text-sm font-medium">{item.subject}</p>
                    ) : null}
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
                      {item.body}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {when(item.occurred_at)} ·{" "}
                      {item.direction === "inbound"
                        ? item.from_value
                        : item.to_value}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>

          {canOperate ? (
            <aside className="space-y-4">
              <form
                className="space-y-3 rounded-lg border bg-card p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  run(() =>
                    createCrmMessageDraft({
                      clientId,
                      contactId: String(form.get("contact_id") ?? ""),
                      objective: String(form.get("objective")) as
                        | "new_lead_response"
                        | "missed_call_rescue"
                        | "estimate_follow_up"
                        | "appointment_confirmation"
                        | "review_request",
                      channel: String(form.get("channel")) as "sms" | "email",
                      context: String(form.get("context") ?? ""),
                    }),
                  );
                }}
              >
                <div>
                  <h2 className="text-sm font-semibold">AI message drafting</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Every customer-facing draft goes to Approvals.
                  </p>
                </div>
                <Select name="contact_id" required defaultValue="">
                  <option value="" disabled>
                    Choose contact
                  </option>
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contactName(contact)}
                    </option>
                  ))}
                </Select>
                <Select name="channel" defaultValue="sms">
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                </Select>
                <Select name="objective" defaultValue="new_lead_response">
                  <option value="new_lead_response">New lead response</option>
                  <option value="missed_call_rescue">Missed-call rescue</option>
                  <option value="estimate_follow_up">Estimate follow-up</option>
                  <option value="appointment_confirmation">
                    Appointment confirmation
                  </option>
                  <option value="review_request">Review request</option>
                </Select>
                <Textarea
                  name="context"
                  placeholder="Extra context for the draft"
                />
                <Button type="submit" className="w-full" disabled={pending}>
                  <Sparkles aria-hidden="true" />
                  Draft for approval
                </Button>
              </form>
            </aside>
          ) : null}
        </div>
      ) : null}

      {view === "schedule" ? (
        <div className="space-y-5">
          <section className="overflow-hidden rounded-lg border bg-card">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Appointments</h2>
            </div>
            {appointments.length === 0 ? (
              <Empty
                title="No appointments"
                detail="Bookings requested by the AI assistant and manual appointments appear here."
              />
            ) : (
              <div className="divide-y">
                {appointments.map((appointment) => {
                  const editing = editingAppointmentId === appointment.id;
                  const duration = appointmentDurationMinutes(
                    appointment.start_at,
                    appointment.end_at,
                  );

                  return (
                    <div key={appointment.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{appointment.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {when(appointment.start_at)} · {duration} min
                            {appointment.location
                              ? ` · ${appointment.location}`
                              : ""}
                          </p>
                        </div>
                        {canEdit ? (
                          <div className="flex items-center gap-1">
                            <Select
                              className="h-8 w-32 text-xs"
                              value={appointment.status}
                              onChange={(event) =>
                                run(() =>
                                  setCrmAppointmentStatus({
                                    clientId,
                                    appointmentId: appointment.id,
                                    status: event.target.value as
                                      | "proposed"
                                      | "booked"
                                      | "completed"
                                      | "cancelled",
                                  }),
                                )
                              }
                              disabled={pending}
                              aria-label={`Status for ${appointment.title}`}
                            >
                              <option value="proposed">Proposed</option>
                              <option value="booked">Booked</option>
                              <option value="completed">Completed</option>
                              <option value="cancelled">Cancelled</option>
                            </Select>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              onClick={() =>
                                setEditingAppointmentId(editing ? null : appointment.id)
                              }
                              aria-label={editing ? "Close appointment editor" : `Edit ${appointment.title}`}
                              title={editing ? "Close editor" : "Edit appointment"}
                            >
                              {editing ? <X aria-hidden="true" /> : <Pencil aria-hidden="true" />}
                            </Button>
                          </div>
                        ) : (
                          <Badge
                            variant="outline"
                            className={statusClass(appointment.status)}
                          >
                            {appointment.status}
                          </Badge>
                        )}
                      </div>
                      {editing ? (
                        <form
                          className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const form = new FormData(event.currentTarget);
                            run(
                              () =>
                                updateCrmAppointment({
                                  clientId,
                                  appointmentId: appointment.id,
                                  title: String(form.get("title") ?? ""),
                                  startAt: localDateTimeToIso(
                                    String(form.get("start_at") ?? ""),
                                  ),
                                  durationMinutes: Number(form.get("duration")),
                                  location: String(form.get("location") ?? ""),
                                  notes: String(form.get("notes") ?? ""),
                                }),
                              () => setEditingAppointmentId(null),
                            );
                          }}
                        >
                          <Input
                            name="title"
                            defaultValue={appointment.title}
                            required
                          />
                          <Input
                            name="start_at"
                            type="datetime-local"
                            defaultValue={localDateTimeInput(appointment.start_at)}
                            required
                          />
                          <Select name="duration" defaultValue={String(duration)}>
                            <option value="30">30 minutes</option>
                            <option value="60">60 minutes</option>
                            <option value="90">90 minutes</option>
                            <option value="120">2 hours</option>
                            <option value="180">3 hours</option>
                            <option value="240">4 hours</option>
                          </Select>
                          <Input
                            name="location"
                            defaultValue={appointment.location ?? ""}
                            placeholder="Location"
                          />
                          <Textarea
                            name="notes"
                            defaultValue={appointment.notes ?? ""}
                            placeholder="Internal notes"
                            className="sm:col-span-2"
                          />
                          <Button type="submit" disabled={pending} className="sm:col-span-2 sm:justify-self-end">
                            <CalendarDays aria-hidden="true" />
                            Save appointment
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="overflow-hidden rounded-lg border bg-card">
              <div className="border-b px-4 py-3">
                <h2 className="text-sm font-semibold">Bookable hours</h2>
                <p className="text-xs text-muted-foreground">
                  Used by the live-call scheduling popup before Google is
                  connected.
                </p>
              </div>
              <div className="divide-y">
                {availability.map((window) => (
                  <div
                    key={window.id}
                    className="flex items-center justify-between px-4 py-3 text-sm"
                  >
                    <span>
                      {WEEKDAYS[window.weekday]} ·{" "}
                      {window.start_time.slice(0, 5)}–
                      {window.end_time.slice(0, 5)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {window.appointment_minutes} min
                    </span>
                  </div>
                ))}
                {availability.length === 0 ? (
                  <Empty
                    title="Default hours active"
                    detail={`Until custom hours are added, ${productName} proposes weekdays from 9 AM to 5 PM.`}
                  />
                ) : null}
              </div>
              {canEdit ? (
                <form
                  className="grid gap-3 border-t p-4 sm:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    run(() =>
                      saveCrmAvailability({
                        clientId,
                        weekday: Number(form.get("weekday")),
                        startTime: String(form.get("start_time") ?? ""),
                        endTime: String(form.get("end_time") ?? ""),
                        appointmentMinutes: Number(
                          form.get("appointment_minutes"),
                        ),
                      }),
                    );
                  }}
                >
                  <Select name="weekday" defaultValue="1">
                    {WEEKDAYS.map((day, index) => (
                      <option key={day} value={index}>
                        {day}
                      </option>
                    ))}
                  </Select>
                  <Select name="appointment_minutes" defaultValue="60">
                    <option value="30">30-minute appointments</option>
                    <option value="60">60-minute appointments</option>
                    <option value="90">90-minute appointments</option>
                    <option value="120">2-hour appointments</option>
                  </Select>
                  <Input name="start_time" type="time" defaultValue="09:00" />
                  <Input name="end_time" type="time" defaultValue="17:00" />
                  <Button type="submit" className="sm:col-span-2" disabled={pending}>
                    <Plus aria-hidden="true" />
                    Add availability
                  </Button>
                </form>
              ) : null}
            </section>

            {canEdit ? (
              <form
                className="h-fit space-y-3 rounded-lg border bg-card p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  run(() =>
                    createCrmAppointment({
                      clientId,
                      title: String(form.get("title") ?? ""),
                      startAt: localDateTimeToIso(
                        String(form.get("start_at") ?? ""),
                      ),
                      durationMinutes: Number(form.get("duration")),
                      contactId: String(form.get("contact_id") ?? ""),
                      leadId: String(form.get("lead_id") ?? ""),
                      location: String(form.get("location") ?? ""),
                      notes: String(form.get("notes") ?? ""),
                    }),
                  );
                  event.currentTarget.reset();
                }}
              >
                <h2 className="text-sm font-semibold">Add appointment</h2>
                <Input name="title" placeholder="Appointment title" required />
                <Input name="start_at" type="datetime-local" required />
                <Select name="duration" defaultValue="60">
                  <option value="30">30 minutes</option>
                  <option value="60">60 minutes</option>
                  <option value="90">90 minutes</option>
                  <option value="120">2 hours</option>
                </Select>
                <Select name="lead_id" defaultValue="">
                  <option value="">No linked lead</option>
                  {openLeads.map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {contactName(contactById.get(lead.contact_id))} ·{" "}
                      {lead.service_type ?? "Lead"}
                    </option>
                  ))}
                </Select>
                <Select name="contact_id" defaultValue="">
                  <option value="">No contact</option>
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contactName(contact)}
                    </option>
                  ))}
                </Select>
                <Input name="location" placeholder="Location" />
                <Textarea name="notes" placeholder="Internal notes" />
                <Button type="submit" className="w-full" disabled={pending}>
                  <CalendarDays aria-hidden="true" />
                  Add appointment
                </Button>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}

      {view === "calls" ? (
        <div className="space-y-5">
          {canOperate ? (
            <form
              className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                run(() =>
                  startCrmAiCallback({
                    clientId,
                    contactId: String(form.get("contact_id") ?? ""),
                    reason: String(form.get("reason") ?? "lead_callback") as
                      | "lead_callback"
                      | "reschedule"
                      | "reminder",
                  }),
                );
              }}
            >
              <div>
                <label className="text-xs font-medium" htmlFor="ai-callback-contact">
                  Customer
                </label>
                <Select id="ai-callback-contact" name="contact_id" required defaultValue="">
                  <option value="" disabled>
                    Choose a customer to call
                  </option>
                  {contacts
                    .filter((contact) => Boolean(contact.phone))
                    .map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contactName(contact)} · {contact.phone}
                      </option>
                    ))}
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium" htmlFor="ai-callback-reason">
                  Reason
                </label>
                <Select id="ai-callback-reason" name="reason" defaultValue="lead_callback">
                  <option value="lead_callback">New lead follow-up</option>
                  <option value="reschedule">Reschedule</option>
                  <option value="reminder">Appointment reminder</option>
                </Select>
              </div>
              <Button type="submit" disabled={pending}>
                <PhoneCall aria-hidden="true" />
                Start AI callback
              </Button>
            </form>
          ) : null}
          <section className="overflow-hidden rounded-lg border bg-card">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Call history</h2>
                <p className="text-xs text-muted-foreground">
                  Transcripts, AI summaries, and scheduling details
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={assistantPath}>
                  <Bot aria-hidden="true" />
                  Open assistant
                </Link>
              </Button>
            </div>
            {calls.length === 0 ? (
              <Empty
                title="No calls yet"
                detail="Calls from connected phone systems will appear here automatically."
              />
            ) : (
              <div className="divide-y">
                {calls.map((call) => {
                  const turns = transcriptByCall.get(call.id) ?? [];
                  const matchedContact = call.matched_contact_id
                    ? contactById.get(call.matched_contact_id)
                    : null;
                  const extracted = call.extracted ?? {};
                  const facts = [
                    ["Service", extracted.service_need],
                    ["Urgency", extracted.urgency],
                    ["Scheduling", extracted.appointment_preference],
                    ["Address", extracted.address],
                  ].filter(
                    (fact): fact is [string, string] =>
                      typeof fact[1] === "string" &&
                      Boolean(fact[1].trim()),
                  );

                  return (
                    <details key={call.id} className="group">
                      <summary className="grid cursor-pointer list-none gap-3 px-4 py-3 transition-colors hover:bg-secondary/30 lg:grid-cols-[12rem_8rem_minmax(0,1fr)_auto]">
                        <div>
                          <p className="text-sm font-medium">
                            {matchedContact
                              ? contactName(matchedContact)
                              : call.from_number ?? "Unknown caller"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {when(call.started_at)}
                          </p>
                        </div>
                        <div>
                          <Badge
                            variant="outline"
                            className={statusClass(call.status)}
                          >
                            {call.status.replaceAll("_", " ")}
                          </Badge>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {call.provider.replaceAll("_", " ")}
                          </p>
                        </div>
                        <p className="text-sm leading-6 text-muted-foreground">
                          {call.crm_note ??
                            call.summary ??
                            (call.status === "in_progress"
                              ? "Call in progress"
                              : "No summary captured")}
                        </p>
                        <ChevronRight
                          className="mt-1 size-4 text-muted-foreground transition-transform group-open:rotate-90"
                          aria-hidden="true"
                        />
                      </summary>
                      <div className="border-t bg-secondary/15 px-4 py-4">
                        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
                          <section>
                            <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                              Transcript
                            </p>
                            {turns.length > 0 ? (
                              <div className="mt-2 space-y-2">
                                {turns.map((turn) => (
                                  <div
                                    key={turn.id}
                                    className="rounded-md border bg-card px-3 py-2"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[11px] font-semibold">
                                        {turn.role === "caller"
                                          ? "Customer"
                                          : turn.role === "staff"
                                            ? "Team member"
                                            : "AI assistant"}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground">
                                        {when(turn.occurred_at)}
                                      </span>
                                    </div>
                                    <p className="mt-1 whitespace-pre-wrap text-xs leading-5">
                                      {turn.content}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-2 text-xs text-muted-foreground">
                                No transcript was captured for this call.
                              </p>
                            )}
                          </section>
                          <aside className="space-y-4">
                            <div>
                              <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                                Call details
                              </p>
                              <dl className="mt-2 space-y-2 text-xs">
                                <div className="flex justify-between gap-3">
                                  <dt className="text-muted-foreground">
                                    Direction
                                  </dt>
                                  <dd className="font-medium">
                                    {call.direction}
                                  </dd>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <dt className="text-muted-foreground">
                                    From
                                  </dt>
                                  <dd className="text-right font-medium">
                                    {call.from_number ?? "Unknown"}
                                  </dd>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <dt className="text-muted-foreground">To</dt>
                                  <dd className="text-right font-medium">
                                    {call.to_number ?? "Unknown"}
                                  </dd>
                                </div>
                              </dl>
                            </div>
                            {facts.length > 0 ? (
                              <div>
                                <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                                  AI captured
                                </p>
                                <dl className="mt-2 space-y-2 text-xs">
                                  {facts.map(([label, value]) => (
                                    <div key={label}>
                                      <dt className="text-muted-foreground">
                                        {label}
                                      </dt>
                                      <dd className="mt-0.5 font-medium">
                                        {value}
                                      </dd>
                                    </div>
                                  ))}
                                </dl>
                              </div>
                            ) : null}
                            {call.summary &&
                            call.summary !== call.crm_note ? (
                              <div>
                                <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                                  Internal summary
                                </p>
                                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                                  {call.summary}
                                </p>
                              </div>
                            ) : null}
                          </aside>
                        </div>
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {view === "quotes" ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
          <section className="overflow-hidden rounded-lg border bg-card">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Quote intelligence</h2>
              <p className="text-xs text-muted-foreground">
                Internal ballparks only; inspection required before final price
              </p>
            </div>
            {quotes.length === 0 ? (
              <Empty
                title="No ballparks yet"
                detail="Build a quote from service type, quantity, and complexity."
              />
            ) : (
              <div className="divide-y">
                {quotes.map((quote) => (
                  <div
                    key={quote.id}
                    className="flex flex-wrap items-start justify-between gap-3 px-4 py-4"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {quote.service_type}
                      </p>
                      <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                        {quote.ai_summary}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">
                        {money(Number(quote.low_amount))}–
                        {money(Number(quote.high_amount))}
                      </p>
                      {canEdit ? (
                        <Select
                          className="mt-2 h-8 w-40 text-xs"
                          value={quote.status}
                          onChange={(event) =>
                            run(() =>
                              setCrmQuoteStatus({
                                clientId,
                                quoteId: quote.id,
                                status: event.target.value as
                                  | "internal_ballpark"
                                  | "draft"
                                  | "sent"
                                  | "accepted"
                                  | "declined",
                              }),
                            )
                          }
                          disabled={pending}
                          aria-label={`Status for ${quote.service_type} quote`}
                        >
                          <option value="internal_ballpark">
                            Internal ballpark
                          </option>
                          <option value="draft">Draft</option>
                          <option value="sent">Sent</option>
                          <option value="accepted">Accepted</option>
                          <option value="declined">Declined</option>
                        </Select>
                      ) : (
                        <Badge variant="outline">
                          {quote.status.replaceAll("_", " ")}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {canEdit ? (
            <form
              className="h-fit space-y-3 rounded-lg border bg-card p-4"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                run(() =>
                  createCrmQuote({
                    clientId,
                    contactId: String(form.get("contact_id") ?? ""),
                    leadId: String(form.get("lead_id") ?? ""),
                    serviceType: String(form.get("service_type") ?? ""),
                    quantity: Number(form.get("quantity")),
                    complexity: String(form.get("complexity")) as
                      | "standard"
                      | "complex"
                      | "premium",
                    notes: String(form.get("notes") ?? ""),
                  }),
                );
              }}
            >
              <h2 className="text-sm font-semibold">Build ballpark</h2>
              <Select name="lead_id" defaultValue="">
                <option value="">Choose lead (optional)</option>
                {openLeads.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {contactName(contactById.get(lead.contact_id))} ·{" "}
                    {lead.service_type ?? "Lead"}
                  </option>
                ))}
              </Select>
              <Select name="contact_id" defaultValue="">
                <option value="">Choose contact (optional)</option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contactName(contact)}
                  </option>
                ))}
              </Select>
              <Input name="service_type" placeholder="Service type" required />
              <Input
                name="quantity"
                type="number"
                min="1"
                step="1"
                defaultValue="1"
                aria-label="Quantity"
              />
              <Select name="complexity" defaultValue="standard">
                <option value="standard">Standard complexity</option>
                <option value="complex">Complex project</option>
                <option value="premium">Premium materials / scope</option>
              </Select>
              <Textarea name="notes" placeholder="Scope notes" />
              <Button type="submit" className="w-full" disabled={pending}>
                <CircleDollarSign aria-hidden="true" />
                Calculate ballpark
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}

      {view === "marketing" ? (
        <MarketingAnalyticsDashboard
          contacts={contacts}
          leads={leads}
          appointments={appointments}
          feedback={feedback}
          campaigns={campaigns}
        />
      ) : null}

      {view === "reports" ? (
        <BusinessOutcomeReports
          leads={leads}
          appointments={appointments}
          communications={communications}
          calls={calls}
          quotes={quotes}
          workflows={workflows}
          workflowRuns={workflowRuns}
          timeline={timeline}
        />
      ) : null}

      {view === "automations" ? (
        <ClientAutomationHealth
          workflows={workflows}
          runs={workflowRuns}
          connections={connections}
          escalationRules={data.escalationRules}
          escalationContact={{
            name: data.client?.primary_contact_name ?? null,
            email: data.client?.primary_contact_email ?? null,
            phone: data.client?.primary_contact_phone ?? null,
          }}
          actionCenterPath={
            visibleSections?.includes("action-center")
              ? (actionCenterPath ?? null)
              : null
          }
        />
      ) : null}

      {view === "crm-sync" ? (
        <div className="space-y-5">
          <section className="overflow-hidden rounded-lg border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold">
                  CRM and field-service connections
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Connection health and recent write-back activity
                </p>
              </div>
              <Badge variant="outline">
                {data.client?.crm_operating_mode.replaceAll("_", " ") ??
                  productName}
              </Badge>
            </div>
            {crmConnections.length === 0 ? (
              <Empty
                title={`${productName} is the system of record`}
                detail="No external CRM is connected. Your partner can add one when records should mirror or sync elsewhere."
              />
            ) : (
              <div className="divide-y">
                {crmConnections.map((connection) => (
                  <div
                    key={connection.id}
                    className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {connection.display_name}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {connection.provider?.display_name ?? "External CRM"}
                      </p>
                    </div>
                    <Badge variant="outline">
                      {runtimeLabel(connection.runtime_mode)}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={statusClass(connection.status)}
                    >
                      {connection.status.replaceAll("_", " ")}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-lg border bg-card">
            <div className="border-b px-5 py-4">
              <h2 className="text-sm font-semibold">Recent sync activity</h2>
            </div>
            {crmSyncEvents.length === 0 ? (
              <Empty
                title="No sync activity"
                detail="External CRM write-backs will appear here with their real delivery status."
              />
            ) : (
              <div className="divide-y">
                {crmSyncEvents.slice(0, 25).map((event) => (
                  <div
                    key={event.id}
                    className="grid gap-2 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {event.event_type.replaceAll(".", " ")}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {when(event.created_at)}
                        {event.external_object_id
                          ? ` · ${event.external_object_id}`
                          : ""}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={statusClass(event.status)}
                    >
                      {event.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {view === "settings" ? (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]">
            <section className="overflow-hidden rounded-lg border bg-card">
              <div className="border-b px-5 py-4">
                <h2 className="text-sm font-semibold">Company profile</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Business details used throughout the CRM workspace
                </p>
              </div>
              {data.client ? (
                <form
                  className="grid gap-4 p-5 sm:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    run(() =>
                      updateCrmWorkspaceSettings({
                        clientId,
                        name: String(form.get("name") ?? ""),
                        industry: String(form.get("industry") ?? ""),
                        timezone: String(form.get("timezone") ?? ""),
                        websiteUrl: String(form.get("website_url") ?? ""),
                        primaryContactName: String(
                          form.get("primary_contact_name") ?? "",
                        ),
                        primaryContactEmail: String(
                          form.get("primary_contact_email") ?? "",
                        ),
                        primaryContactPhone: String(
                          form.get("primary_contact_phone") ?? "",
                        ),
                      }),
                    );
                  }}
                >
                  <Input
                    name="name"
                    defaultValue={data.client.name}
                    placeholder="Company name"
                    required
                    disabled={!canEdit}
                  />
                  <Input
                    name="industry"
                    defaultValue={data.client.industry ?? ""}
                    placeholder="Industry"
                    disabled={!canEdit}
                  />
                  <Input
                    name="website_url"
                    type="url"
                    defaultValue={data.client.website_url ?? ""}
                    placeholder="Website"
                    disabled={!canEdit}
                  />
                  <Select
                    name="timezone"
                    defaultValue={data.client.timezone}
                    disabled={!canEdit}
                  >
                    {COMMON_TIMEZONES.map((timezone) => (
                      <option key={timezone} value={timezone}>
                        {timezone}
                      </option>
                    ))}
                  </Select>
                  <Input
                    name="primary_contact_name"
                    defaultValue={data.client.primary_contact_name ?? ""}
                    placeholder="Primary contact"
                    disabled={!canEdit}
                  />
                  <Input
                    name="primary_contact_email"
                    type="email"
                    defaultValue={data.client.primary_contact_email ?? ""}
                    placeholder="Primary contact email"
                    disabled={!canEdit}
                  />
                  <Input
                    name="primary_contact_phone"
                    defaultValue={data.client.primary_contact_phone ?? ""}
                    placeholder="Primary contact phone"
                    disabled={!canEdit}
                  />
                  {canEdit ? (
                    <div className="flex items-center sm:justify-end">
                      <Button type="submit" disabled={pending}>
                        Save settings
                      </Button>
                    </div>
                  ) : null}
                </form>
              ) : (
                <Empty
                  title="Settings unavailable"
                  detail="The company profile could not be loaded."
                />
              )}
            </section>

            <aside className="space-y-5">
              <section className="rounded-lg border bg-card p-5">
                <h2 className="text-sm font-semibold">Operating mode</h2>
                <dl className="mt-3 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">CRM</dt>
                    <dd className="font-medium">
                      {data.client?.crm_operating_mode.replaceAll("_", " ") ??
                        "Unavailable"}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Automations</dt>
                    <dd className="font-medium">
                      {data.client?.default_runtime_mode
                        ? runtimeLabel(data.client.default_runtime_mode)
                        : "Unavailable"}
                    </dd>
                  </div>
                </dl>
              </section>
            </aside>
          </div>
          <ClientTeamPermissions
            members={teamMembers}
            canManage={canManageTeam}
          />
        </div>
      ) : null}

      {!embedded ? (
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-xs text-muted-foreground">
        <p>
          {productName} is the system of record when no external CRM is
          connected; mirror and assist modes keep it alongside another CRM.
        </p>
        <Link
          href={`${basePath}?view=${VIEW_ITEMS[(VIEW_ITEMS.findIndex((item) => item.key === view) + 1) % VIEW_ITEMS.length].key}`}
          className="inline-flex items-center gap-1 font-medium text-primary"
        >
          Next section
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </Link>
      </footer>
      ) : null}
    </div>
  );
}
