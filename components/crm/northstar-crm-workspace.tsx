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
  PhoneCall,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  Star,
  TrendingUp,
  Workflow,
} from "lucide-react";
import { useRouter } from "next/navigation";

import {
  analyzeAndSaveCrmFeedback,
  createCrmAppointment,
  createCrmLead,
  createCrmMessageDraft,
  createCrmQuote,
  createCrmTask,
  receiveCrmCommunication,
  saveCrmAvailability,
  setCrmTaskStatus,
  updateCrmLeadStage,
} from "@/app/crm/actions";
import { VoiceCallLab } from "@/components/crm/voice-call-lab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { NorthstarCrmData } from "@/lib/crm/operating-suite";
import type { CrmView } from "@/lib/crm/views";
import type { FormState } from "@/lib/forms/state";
import { cn } from "@/lib/utils";

type Contact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
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
  title: string;
  start_at: string;
  end_at: string;
  status: string;
  location: string | null;
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
  direction: string;
  status: string;
  provider: string;
  summary: string | null;
  crm_note: string | null;
  started_at: string;
  ended_at: string | null;
};

type Quote = {
  id: string;
  contact_id: string | null;
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
  { key: "feedback", label: "Feedback", icon: Star },
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
  basePath,
  view,
  canEdit,
  canOperate,
  approvalsPath,
  assistantPath,
  data,
  embedded = false,
}: {
  clientId: string;
  clientName: string;
  basePath: string;
  view: CrmView;
  canEdit: boolean;
  canOperate: boolean;
  approvalsPath: string;
  assistantPath: string;
  data: NorthstarCrmData;
  embedded?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [actionMessage, setActionMessage] = useState<FormState | null>(null);
  const [search, setSearch] = useState("");
  const [renderedAt] = useState(() => Date.now());
  const contacts = data.contacts as unknown as Contact[];
  const leads = data.leads as unknown as Lead[];
  const tasks = data.tasks as unknown as Task[];
  const communications = data.communications as unknown as Communication[];
  const appointments = data.appointments as unknown as Appointment[];
  const availability = data.availability as unknown as Availability[];
  const calls = data.calls as unknown as Call[];
  const quotes = data.quotes as unknown as Quote[];
  const feedback = data.feedback as unknown as Feedback[];
  const contactById = useMemo(
    () => new Map(contacts.map((contact) => [contact.id, contact])),
    [contacts],
  );

  function run(action: () => Promise<FormState>) {
    setActionMessage(null);
    startTransition(async () => {
      const response = await action();
      setActionMessage(response);
      if (response.status === "success") router.refresh();
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
  const wonLeads = leads.filter((lead) => lead.status === "won");
  const conversion =
    leads.length > 0 ? Math.round((wonLeads.length / leads.length) * 100) : 0;
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
                Northstar AI operations suite
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
          Northstar is working…
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
                <Link
                  href={`${basePath}?view=pipeline`}
                  className="text-xs font-medium text-primary"
                >
                  Open pipeline
                </Link>
              </div>
              {openLeads.length === 0 ? (
                <Empty
                  title="No open leads"
                  detail="Create a lead or run an intake test to fill the CRM."
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
            <details className="rounded-lg border bg-card">
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
                  <Sparkles aria-hidden="true" />
                  Create and analyze
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
        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold">Customer records</h2>
              <p className="text-xs text-muted-foreground">
                {contacts.length} contacts across every channel
              </p>
            </div>
            <label className="relative block w-full sm:w-72">
              <Search
                className="absolute left-2.5 top-2.5 size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-8"
                placeholder="Search contacts"
              />
            </label>
          </div>
          {filteredContacts.length === 0 ? (
            <Empty
              title="No matching contacts"
              detail="Contacts appear when leads, calls, forms, texts, or emails arrive."
            />
          ) : (
            <div className="divide-y">
              {filteredContacts.map((contact) => {
                const contactLeads = leads.filter(
                  (lead) => lead.contact_id === contact.id,
                );
                return (
                  <div
                    key={contact.id}
                    className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {contactName(contact)}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[contact.phone, contact.email]
                          .filter(Boolean)
                          .join(" · ") || "No contact details"}
                      </p>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {contact.address ?? contact.source ?? "No address"}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {contactLeads.slice(0, 2).map((lead) => (
                        <Badge key={lead.id} variant="outline">
                          {lead.status}
                        </Badge>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
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
                    {canEdit && task.status === "open" ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        title="Complete task"
                        onClick={() =>
                          run(() =>
                            setCrmTaskStatus({
                              clientId,
                              taskId: task.id,
                              status: "done",
                            }),
                          )
                        }
                        disabled={pending}
                      >
                        <Check aria-hidden="true" />
                      </Button>
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
                detail="Use the customer simulator to send an inbound message through the real workflow engine."
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
                    receiveCrmCommunication({
                      clientId,
                      channel: String(form.get("channel")) as
                        | "sms"
                        | "email"
                        | "form",
                      name: String(form.get("name") ?? ""),
                      phone: String(form.get("phone") ?? ""),
                      email: String(form.get("email") ?? ""),
                      message: String(form.get("message") ?? ""),
                    }),
                  );
                }}
              >
                <div>
                  <h2 className="text-sm font-semibold">Customer simulator</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Sends an inbound event through routing, lead analysis, CRM,
                    drafting, and approvals.
                  </p>
                </div>
                <Select name="channel" defaultValue="sms">
                  <option value="sms">Inbound SMS</option>
                  <option value="email">Inbound email</option>
                  <option value="form">Website form</option>
                </Select>
                <Input name="name" placeholder="Customer name" />
                <Input name="phone" placeholder="Phone" />
                <Input name="email" type="email" placeholder="Email" />
                <Textarea
                  name="message"
                  placeholder="What is the customer saying?"
                  required
                />
                <Button type="submit" className="w-full" disabled={pending}>
                  <Send aria-hidden="true" />
                  Send through workflows
                </Button>
              </form>

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
                {appointments.map((appointment) => (
                  <div
                    key={appointment.id}
                    className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{appointment.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {when(appointment.start_at)}
                        {appointment.location
                          ? ` · ${appointment.location}`
                          : ""}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={statusClass(appointment.status)}
                    >
                      {appointment.status}
                    </Badge>
                  </div>
                ))}
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
                    detail="Until custom hours are added, Northstar proposes weekdays from 9 AM to 5 PM."
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
                      startAt: String(form.get("start_at") ?? ""),
                      durationMinutes: Number(form.get("duration")),
                      contactId: String(form.get("contact_id") ?? ""),
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
          <VoiceCallLab clientId={clientId} canOperate={canOperate} />
          <section className="overflow-hidden rounded-lg border bg-card">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Call history</h2>
            </div>
            {calls.length === 0 ? (
              <Empty
                title="No calls yet"
                detail="Run the phone lab above. Real carrier calls will land in this same history after Twilio Voice is connected."
              />
            ) : (
              <div className="divide-y">
                {calls.map((call) => (
                  <div
                    key={call.id}
                    className="grid gap-3 px-4 py-3 lg:grid-cols-[12rem_8rem_minmax(0,1fr)]"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {call.from_number ?? "Unknown caller"}
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
                        {call.status}
                      </Badge>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {call.provider.replaceAll("_", " ")}
                      </p>
                    </div>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {call.summary ?? call.crm_note ?? "Call in progress"}
                    </p>
                  </div>
                ))}
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
                      <Badge variant="outline">{quote.status.replaceAll("_", " ")}</Badge>
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

      {view === "feedback" ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
          <section className="overflow-hidden rounded-lg border bg-card">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Feedback intelligence</h2>
            </div>
            {feedback.length === 0 ? (
              <Empty
                title="No feedback analyzed"
                detail="Paste a review or customer message to identify sentiment, risk, next actions, and a response."
              />
            ) : (
              <div className="divide-y">
                {feedback.map((item) => (
                  <article key={item.id} className="px-4 py-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className={statusClass(item.sentiment)}
                      >
                        {item.sentiment}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={statusClass(item.risk_level)}
                      >
                        {item.risk_level} risk
                      </Badge>
                      {item.rating ? (
                        <Badge variant="outline">{item.rating}/5</Badge>
                      ) : null}
                      <span className="text-[11px] text-muted-foreground">
                        {item.source} · {item.ai_status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm">{item.summary}</p>
                    {item.suggested_internal_action ? (
                      <p className="mt-2 rounded-md bg-secondary/50 px-3 py-2 text-xs leading-5">
                        <span className="font-medium">Next action:</span>{" "}
                        {item.suggested_internal_action}
                      </p>
                    ) : null}
                  </article>
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
                  analyzeAndSaveCrmFeedback({
                    clientId,
                    source: String(form.get("source") ?? ""),
                    rating: Number(form.get("rating")),
                    feedbackText: String(form.get("feedback_text") ?? ""),
                    contactId: String(form.get("contact_id") ?? ""),
                  }),
                );
              }}
            >
              <h2 className="text-sm font-semibold">Analyze feedback</h2>
              <Select name="source" defaultValue="google_review">
                <option value="google_review">Google review</option>
                <option value="facebook">Facebook</option>
                <option value="email">Email</option>
                <option value="survey">Survey</option>
                <option value="manual">Manual entry</option>
              </Select>
              <Select name="rating" defaultValue="5">
                <option value="5">5 stars</option>
                <option value="4">4 stars</option>
                <option value="3">3 stars</option>
                <option value="2">2 stars</option>
                <option value="1">1 star</option>
              </Select>
              <Select name="contact_id" defaultValue="">
                <option value="">No contact match</option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contactName(contact)}
                  </option>
                ))}
              </Select>
              <Textarea
                name="feedback_text"
                placeholder="Paste the customer's feedback"
                required
              />
              <Button type="submit" className="w-full" disabled={pending}>
                <Sparkles aria-hidden="true" />
                Analyze sentiment and risk
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}

      {view === "reports" ? (
        <div className="space-y-5">
          <section className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Lead conversion"
              value={`${conversion}%`}
              detail={`${wonLeads.length} won of ${leads.length}`}
              icon={TrendingUp}
            />
            <Metric
              label="Pipeline"
              value={money(pipelineValue)}
              detail={`${openLeads.length} open opportunities`}
              icon={CircleDollarSign}
            />
            <Metric
              label="Customer touches"
              value={communications.length + calls.length}
              detail={`${calls.length} calls · ${communications.length} messages`}
              icon={MessageSquareText}
            />
            <Metric
              label="AI operations"
              value={
                data.timeline.filter(
                  (item) => item.actor_type === "ai_assistant",
                ).length
              }
              detail="CRM contributions logged"
              icon={Sparkles}
            />
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-lg border bg-card p-4">
              <h2 className="text-sm font-semibold">Pipeline distribution</h2>
              <div className="mt-4 space-y-3">
                {PIPELINE_STAGES.map((stage) => {
                  const count = leads.filter(
                    (lead) => lead.status === stage,
                  ).length;
                  const percent =
                    leads.length > 0 ? Math.round((count / leads.length) * 100) : 0;
                  return (
                    <div key={stage}>
                      <div className="flex justify-between text-xs">
                        <span className="capitalize">{stage}</span>
                        <span className="text-muted-foreground">{count}</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-sm bg-secondary">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-lg border bg-card p-4">
              <h2 className="text-sm font-semibold">System readiness</h2>
              <div className="mt-3 divide-y">
                {data.connections.map((connection) => {
                  const provider = connection.provider as
                    | { display_name?: string; provider_key?: string }
                    | null;
                  return (
                    <div
                      key={String(connection.id)}
                      className="flex items-center justify-between py-3"
                    >
                      <span className="text-sm">
                        {provider?.display_name ??
                          String(connection.display_name ?? "Integration")}
                      </span>
                      <div className="flex gap-1.5">
                        <Badge variant="outline">
                          {String(connection.status)}
                        </Badge>
                        <Badge variant="outline">
                          {String(connection.runtime_mode)}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
                {data.connections.length === 0 ? (
                  <p className="py-6 text-sm text-muted-foreground">
                    Northstar CRM works internally now. Provider connections
                    activate live delivery and sync.
                  </p>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {view === "automations" ? (
        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold">AI automations</h2>
          </div>
          <Empty
            title="No automations configured"
            detail="Installed workflows will appear here after client setup."
          />
        </section>
      ) : null}

      {view === "crm-sync" ? (
        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold">CRM connections</h2>
          </div>
          {data.connections.length === 0 ? (
            <Empty
              title="No CRM connected"
              detail="Connect an external CRM when this workspace should mirror or assist another system."
            />
          ) : (
            <div className="divide-y">
              {data.connections.map((connection) => (
                <div
                  key={String(connection.id)}
                  className="flex items-center justify-between gap-3 px-5 py-4"
                >
                  <span className="text-sm font-medium">
                    {String(connection.display_name ?? "CRM connection")}
                  </span>
                  <Badge variant="outline">
                    {String(connection.status)}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {view === "settings" ? (
        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold">Workspace settings</h2>
          </div>
          <Empty
            title="No settings available"
            detail="Client permissions and workspace configuration will appear here."
          />
        </section>
      ) : null}

      {!embedded ? (
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-xs text-muted-foreground">
        <p>
          Northstar CRM is the system of record when no external CRM is
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
