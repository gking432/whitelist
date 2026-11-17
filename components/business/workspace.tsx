"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Layers3,
  Megaphone,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import type {
  BusinessArea,
  BusinessRecord,
  BusinessSnapshot,
  RecordKind,
} from "@/lib/business/types";
import { displayMoney, opportunityEconomics } from "@/lib/business/rules";
import { BusinessSetup } from "./setup";
import { Capabilities } from "./capabilities";
import { AREA_COPY, KIND_LABELS } from "./record-fields";
import {
  BusinessDialog,
  RecordEditor,
  buttonClass,
  inputClass,
  secondaryClass,
} from "./record-editor";
import { RecordDetail, StatusPill } from "./record-detail";

const areaKinds: Partial<Record<BusinessArea, RecordKind[]>> = {
  marketing: ["campaign"],
  sourcing: ["opportunity", "supplier", "brief"],
  purchasing: ["purchase", "product", "supplier"],
  operations: ["job", "knowledge", "quote", "invoice", "brief"],
};
const areaCards = [
  {
    area: "marketing",
    name: "Marketing",
    description: "Campaigns & content",
    icon: Megaphone,
    tint: "bg-rose-50 text-rose-700",
    kind: "campaign",
  },
  {
    area: "sourcing",
    name: "Sourcing",
    description: "Suppliers & opportunities",
    icon: Search,
    tint: "bg-violet-50 text-violet-700",
    kind: "opportunity",
  },
  {
    area: "purchasing",
    name: "Purchasing",
    description: "Stock & buying decisions",
    icon: ShoppingBag,
    tint: "bg-amber-50 text-amber-700",
    kind: "purchase",
  },
  {
    area: "operations",
    name: "Operations",
    description: "Jobs & everyday work",
    icon: Layers3,
    tint: "bg-sky-50 text-sky-700",
    kind: "job",
  },
] as const;
function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed bg-card px-6 py-12 text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
        <Layers3 className="size-5" />
      </span>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function BusinessWorkspace({
  initialSnapshot,
  area = "home",
  initialRecordId,
}: {
  initialSnapshot: BusinessSnapshot;
  area?: BusinessArea;
  initialRecordId?: string;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [notice, setNotice] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialRecordId ?? null,
  );
  const [editor, setEditor] = useState<{
    kind: RecordKind;
    record?: BusinessRecord;
  } | null>(null);
  const editorRequestKey = useRef<string | null>(null);
  const [contactForm, setContactForm] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [kind, setKind] = useState<RecordKind>(areaKinds[area]?.[0] ?? "job");
  const selected = snapshot.records.find((r) => r.id === selectedId);
  const copy = AREA_COPY[area];
  async function mutate(input: unknown): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/business/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw new Error(result.error || "The change could not be saved.");
      if (result.snapshot) setSnapshot(result.snapshot);
      if (result.recordId) setSelectedId(result.recordId);
      setNotice({ message: result.message, error: false });
      return true;
    } catch (error) {
      setNotice({
        message:
          error instanceof Error
            ? error.message
            : "Connection interrupted. Refresh before retrying.",
        error: true,
      });
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/business/workspace", {
        cache: "no-store",
      });
      const state = await response.json();
      if (!response.ok)
        throw new Error(state.error || "Records could not be refreshed.");
      setSnapshot(state);
      setNotice(null);
    } catch (error) {
      setNotice({
        message:
          error instanceof Error
            ? error.message
            : "Records could not be refreshed.",
        error: true,
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const active = snapshot.records.filter((r) => r.status !== "archived");
  const pending = active.filter((r) => r.status === "needs_approval");
  const jobs = active.filter(
    (r) => r.kind === "job" && r.status !== "completed",
  );
  const enabled = snapshot.installs.filter((i) => i.status === "enabled");
  const filtered = snapshot.records.filter(
    (r) =>
      r.kind === kind &&
      (status === "all" || status === "active"
        ? status === "all" || r.status !== "archived"
        : r.status === status) &&
      `${r.title} ${r.body}`.toLowerCase().includes(query.toLowerCase()),
  );
  const openEditor = (recordKind: RecordKind) => {
    editorRequestKey.current = crypto.randomUUID();
    setSelectedId(null);
    setEditor({ kind: recordKind });
  };
  const newButton = (recordKind: RecordKind, label?: string) => (
    <button
      onClick={() => openEditor(recordKind)}
      disabled={!snapshot.canWrite || busy || Boolean(snapshot.error)}
      className={buttonClass}
    >
      <Plus className="size-4" />
      {label ?? `New ${KIND_LABELS[recordKind].toLowerCase()}`}
    </button>
  );
  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.17em] text-primary">
            {copy.eyebrow}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {copy.title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            {copy.description}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void refresh()}
            disabled={busy}
            className={secondaryClass}
            aria-label="Refresh business records"
          >
            <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
            <span className="sm:sr-only">Refresh</span>
          </button>
          {area === "home" ? (
            <Link
              href="/client/activate"
              className={secondaryClass}
            >
              <Sparkles className="size-4" />
              Connect your assistants
            </Link>
          ) : areaKinds[area] ? (
            newButton(kind)
          ) : null}
        </div>
      </header>
      {snapshot.isTestAccount ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-2.5 text-xs text-muted-foreground">
          <CircleHelp className="size-3.5" />
          Test business. Records are saved in this test account; external
          actions are not simulated as completed.
        </div>
      ) : null}
      {snapshot.error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {snapshot.error}
        </div>
      ) : null}
      {!snapshot.canWrite ? (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          You’re viewing this business with read-only access.
        </p>
      ) : null}
      {notice ? (
        <div
          role={notice.error ? "alert" : "status"}
          className={`flex items-start justify-between gap-4 rounded-xl border p-4 text-sm ${notice.error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}
        >
          <span>{notice.message}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}
      {area === "business" || (area === "home" && snapshot.setupRequired) ? (
        <BusinessSetup
          key={snapshot.setupRequired ? "new" : "saved"}
          profile={snapshot.profile}
          busy={busy || !snapshot.canWrite || Boolean(snapshot.error)}
          isNew={snapshot.setupRequired}
          onSave={async (profile) => {
            const ok = await mutate({ action: "save_profile", profile });
            return ok;
          }}
        />
      ) : null}
      {area === "home" && !snapshot.setupRequired ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                label: "Needs your decision",
                value: pending.length + snapshot.pendingCustomerApprovals,
                detail: "Approvals waiting for you",
                icon: ClipboardCheck,
                href: "/client/business/approvals",
              },
              {
                label: "Work in progress",
                value: jobs.length,
                detail: "Open jobs across the business",
                icon: Layers3,
                href: "/client/business/operations",
              },
              {
                label: "Capabilities enabled",
                value: enabled.length,
                detail: "Ready to help with your work",
                icon: Sparkles,
                href: "/client/business/automations",
              },
            ].map((stat) => (
              <Link
                href={stat.href}
                key={stat.label}
                className="group rounded-2xl border bg-card p-5"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">
                    {stat.label}
                  </p>
                  <stat.icon className="size-4 text-primary" />
                </div>
                <p className="mt-4 text-3xl font-semibold tracking-tight">
                  {stat.value}
                </p>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  {stat.detail}
                  <ArrowUpRight className="size-3.5 transition group-hover:translate-x-0.5" />
                </div>
              </Link>
            ))}
          </div>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {areaCards.map((card) => (
              <Link
                key={card.area}
                href={`/client/business/${card.area}`}
                className="group flex items-center gap-4 rounded-2xl border bg-card p-5"
              >
                <span
                  className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${card.tint}`}
                >
                  <card.icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold">{card.name}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {card.description}
                  </p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            ))}
          </section>
          <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
            <section className="rounded-2xl border bg-card">
              <div className="flex items-center justify-between border-b px-5 py-4">
                <h2 className="font-semibold">Your next decisions</h2>
                <Link
                  href="/client/business/approvals"
                  className="text-xs font-medium text-primary"
                >
                  View all
                </Link>
              </div>
              {pending.length ? (
                <div className="divide-y">
                  {pending.slice(0, 5).map((record) => (
                    <button
                      key={record.id}
                      onClick={() => setSelectedId(record.id)}
                      className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-secondary/40"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                        <ClipboardCheck className="size-4" />
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{record.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {KIND_LABELS[record.kind]} · ready for review
                        </p>
                      </div>
                      <ArrowRight className="size-4 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="px-6 py-10">
                  <CheckCircle2 className="size-7 text-primary/60" />
                  <h3 className="mt-3 text-sm font-medium">
                    Nothing waiting on you.
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Campaigns, purchase requests, and quotes will appear here
                    when they’re ready for a decision.
                  </p>
                </div>
              )}
            </section>
            <section className="rounded-2xl border bg-card">
              <div className="flex items-center justify-between border-b px-5 py-4">
                <h2 className="font-semibold">Recent work</h2>
                <Clock3 className="size-4 text-muted-foreground" />
              </div>
              <div className="p-5">
                {snapshot.events.length ? (
                  <ol className="space-y-5">
                    {snapshot.events.slice(0, 5).map((event) => (
                      <li key={event.id} className="flex gap-3">
                        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/35" />
                        <div>
                          <button
                            disabled={!event.record_id}
                            onClick={() => setSelectedId(event.record_id)}
                            className="text-left text-sm leading-5 hover:text-primary"
                          >
                            {event.summary}
                          </button>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {shortDate(event.created_at)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm leading-6 text-muted-foreground">
                    As you and your assistants work, the activity appears here
                    with a link to the record.
                  </p>
                )}
              </div>
            </section>
          </div>
          <section>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">A good place to start</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Suggested from your business and priorities.
                </p>
              </div>
              <Link
                href="/client/business/automations"
                className="inline-flex items-center gap-2 text-xs font-medium text-primary"
              >
                All capabilities
                <ArrowRight className="size-3" />
              </Link>
            </div>
            <Capabilities
              snapshot={snapshot}
              busy={busy}
              onMutation={mutate}
              compact
            />
          </section>
        </>
      ) : null}
      {area === "automations" ? (
        <Capabilities snapshot={snapshot} busy={busy} onMutation={mutate} />
      ) : null}
      {area === "approvals" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-5">
            <div>
              <h2 className="font-semibold">
                Customer messages & appointments
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {snapshot.pendingCustomerApprovals} pending in the
                connected-action queue.
              </p>
            </div>
            <Link href="/client/approvals" className={secondaryClass}>
              Review customer actions
              <ArrowRight className="size-4" />
            </Link>
          </div>
          {pending.length ? (
            <div className="grid gap-4 md:grid-cols-2">
              {pending.map((record) => (
                <button
                  key={record.id}
                  onClick={() => setSelectedId(record.id)}
                  className="rounded-2xl border bg-card p-5 text-left transition hover:border-primary/40"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      {KIND_LABELS[record.kind]}
                    </p>
                    <StatusPill status={record.status} />
                  </div>
                  <h2 className="mt-4 font-semibold">{record.title}</h2>
                  <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {record.body ||
                      "Review the record details before approving."}
                  </p>
                  <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary">
                    Review decision
                    <ArrowRight className="size-4" />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="You’re all caught up"
              description="Submit a campaign, purchase request, or quote for approval. The exact work and its details will appear here."
            />
          )}
        </>
      ) : null}
      {area === "customers" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <Link href="/client/crm?view=inbox" className={secondaryClass}>
                Conversations
                <ArrowUpRight className="size-3.5" />
              </Link>
              <Link href="/client/crm?view=contacts" className={secondaryClass}>
                Detailed CRM
                <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
            <button
              disabled={busy || !snapshot.canWrite}
              onClick={() => setContactForm(true)}
              className={buttonClass}
            >
              <Plus className="size-4" />
              Add customer
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3.5 top-3 size-4 text-muted-foreground" />
            <input
              aria-label="Search customers"
              className={`${inputClass} pl-10`}
              placeholder="Search name, email, or phone"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {snapshot.contacts.length ? (
            <div className="overflow-hidden rounded-2xl border bg-card">
              <div className="divide-y">
                {snapshot.contacts
                  .filter((c) =>
                    `${c.first_name} ${c.last_name} ${c.email} ${c.phone}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((contact) => (
                    <div
                      key={contact.id}
                      className="flex flex-wrap items-center gap-4 p-5"
                    >
                      <span className="flex size-10 items-center justify-center rounded-full bg-primary/8 text-primary">
                        <Users className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {[contact.first_name, contact.last_name]
                            .filter(Boolean)
                            .join(" ") || "Customer"}
                        </p>
                        <p className="mt-1 break-words text-xs text-muted-foreground">
                          {[contact.email, contact.phone]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {contact.source?.replaceAll("_", " ") ||
                          "Shared record"}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <EmptyState
              title="Your customer history starts here"
              description="Add a customer, connect a source, or capture an inquiry through your website. These are the shared records your assistants work with."
            />
          )}
        </>
      ) : null}
      {areaKinds[area] ? (
        <>
          <div className="flex flex-wrap gap-2 border-b pb-4">
            {areaKinds[area]?.map((recordKind) => (
              <button
                key={recordKind}
                onClick={() => {
                  setKind(recordKind);
                  setQuery("");
                  setStatus("active");
                }}
                className={`rounded-xl px-4 py-2 text-sm font-medium ${kind === recordKind ? "bg-primary text-white" : "text-muted-foreground hover:bg-secondary"}`}
              >
                {KIND_LABELS[recordKind]}
                {recordKind === "knowledge" ? "" : "s"}
                <span className="ml-2 opacity-70">
                  {active.filter((r) => r.kind === recordKind).length}
                </span>
              </button>
            ))}
          </div>
          {area === "sourcing" && kind === "opportunity" ? (
            <p className="rounded-xl bg-violet-50/60 px-4 py-3 text-xs leading-6 text-violet-900">
              Save real opportunities and source links, then compare their
              economics. Expected resale values are your estimates. Live
              marketplace monitoring is not connected.
            </p>
          ) : null}
          {area === "marketing" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-primary/5 px-4 py-3">
              <p className="text-xs leading-6 text-primary">
                Prepare content here, review it, and publish through your chosen
                channel. Publication is recorded separately from approval.
              </p>
              <Link
                href="/client/business/automations"
                className="inline-flex items-center gap-2 text-xs font-semibold text-primary"
              >
                <Sparkles className="size-3.5" />
                Open marketing studio
              </Link>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-48 flex-1">
              <Search className="absolute left-3.5 top-3 size-4 text-muted-foreground" />
              <input
                aria-label="Search records"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your work…"
                className={`${inputClass} pl-10`}
              />
            </div>
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={`${inputClass} sm:!w-48`}
            >
              <option value="active">Active records</option>
              <option value="all">All records</option>
              <option value="draft">Draft</option>
              <option value="needs_approval">Needs approval</option>
              <option value="approved">Approved</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          {filtered.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((record) => (
                <button
                  key={record.id}
                  onClick={() => setSelectedId(record.id)}
                  className="group flex flex-col rounded-2xl border bg-card p-5 text-left transition hover:border-primary/40 hover:shadow-sm"
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      {shortDate(record.created_at)}
                    </span>
                    <StatusPill status={record.status} />
                  </div>
                  <h2 className="mt-4 font-semibold leading-6">
                    {record.title}
                  </h2>
                  <p className="mt-2 line-clamp-3 flex-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {record.body ||
                      `${KIND_LABELS[record.kind]} details and history`}
                  </p>
                  {record.kind === "product" ? (
                    <div className="mt-4 flex w-full justify-between border-t pt-3 text-xs">
                      <span>{String(record.data.quantity)} in stock</span>
                      <span>
                        {displayMoney(
                          record.data.price,
                          snapshot.profile.currency,
                        )}
                      </span>
                    </div>
                  ) : record.kind === "purchase" ? (
                    <div className="mt-4 flex w-full justify-between border-t pt-3 text-xs">
                      <span>{String(record.data.quantity)} units</span>
                      <span className="font-semibold">
                        {displayMoney(
                          Number(record.data.quantity) *
                            Number(record.data.unit_cost) +
                            Number(record.data.shipping || 0),
                          snapshot.profile.currency,
                        )}
                      </span>
                    </div>
                  ) : record.kind === "opportunity" ? (
                    <div className="mt-4 flex w-full justify-between border-t pt-3 text-xs">
                      <span>Expected contribution</span>
                      <span className="font-semibold">
                        {displayMoney(
                          opportunityEconomics(record.data).profit,
                          snapshot.profile.currency,
                        )}
                      </span>
                    </div>
                  ) : record.kind === "job" ? (
                    <div className="mt-4 flex w-full justify-between border-t pt-3 text-xs">
                      <span>
                        {String(record.data.assignee || "Unassigned")}
                      </span>
                      <span>
                        {String(record.data.due_date || "No due date")}
                      </span>
                    </div>
                  ) : null}
                  <span className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-primary">
                    Open record
                    <ArrowRight className="size-3" />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title={
                query || status !== "active"
                  ? "No matching records"
                  : `Your first ${KIND_LABELS[kind].toLowerCase()}`
              }
              description={
                query
                  ? "Try a different search or status filter."
                  : kind === "product"
                    ? "Add stock levels, costs, and reorder points. Your purchasing planner uses them to prepare replenishment requests."
                    : `Create a ${KIND_LABELS[kind].toLowerCase()} to start tracking real work in this area.`
              }
              action={query ? undefined : newButton(kind)}
            />
          )}
        </>
      ) : null}
      {area === "business" ? (
        <section className="rounded-2xl border bg-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold">Connected tools</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Connect your existing systems once and reuse them across
                supported capabilities.
              </p>
            </div>
            <Link href="/client/integrations" className={secondaryClass}>
              Manage connections
              <ArrowUpRight className="size-4" />
            </Link>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {snapshot.connections.length ? (
              snapshot.connections.map((connection) => (
                <span
                  key={connection.id}
                  className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs"
                >
                  <span
                    className={`size-1.5 rounded-full ${connection.status === "connected" ? "bg-emerald-500" : "bg-amber-500"}`}
                  />
                  {connection.display_name} · {connection.runtime_mode}
                </span>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">
                No external systems are connected yet. Internal planning and
                records work without them.
              </p>
            )}
          </div>
        </section>
      ) : null}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Package className="size-3.5" />
          One business. Shared records. Decisions stay with you.
        </span>
        <span>
          {snapshot.aiConfigured
            ? "AI drafting configured"
            : "Templates & rule-based planning available"}
        </span>
      </footer>
      {selected && !editor ? (
        <RecordDetail
          key={selected.id}
          record={selected}
          currency={snapshot.profile.currency}
          busy={busy}
          canWrite={snapshot.canWrite}
          onClose={() => setSelectedId(null)}
          onEdit={() => {
            setEditor({ kind: selected.kind, record: selected });
            setSelectedId(null);
          }}
          onMutation={mutate}
        />
      ) : null}
      {editor ? (
        <>
          <RecordEditor
            key={editor.record?.id ?? editor.kind}
            kind={editor.kind}
            record={editor.record}
            records={snapshot.records}
            busy={busy}
            error={notice?.error ? notice.message : undefined}
            onClose={() => setEditor(null)}
            onSave={async (record, id, revision) =>
              mutate({
                action: "save_record",
                record,
                id,
                revision,
                requestKey: (editorRequestKey.current ??= crypto.randomUUID()),
              })
            }
          />
          {notice?.error ? (
            <div className="sr-only" role="alert">
              {notice.message}
            </div>
          ) : null}
        </>
      ) : null}
      {contactForm ? (
        <BusinessDialog
          title="Add a customer"
          onClose={() => setContactForm(false)}
        >
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              const f = new FormData(event.currentTarget);
              if (
                await mutate({
                  action: "add_contact",
                  name: f.get("name"),
                  email: f.get("email"),
                  phone: f.get("phone"),
                })
              )
                setContactForm(false);
            }}
          >
            {[
              { name: "name", label: "Full name", type: "text" },
              { name: "email", label: "Email", type: "email" },
              { name: "phone", label: "Phone", type: "tel" },
            ].map((field) => (
              <label
                className="block space-y-2 text-sm font-medium"
                key={field.name}
              >
                {field.label}
                <input
                  name={field.name}
                  type={field.type}
                  required={field.name === "name"}
                  className={inputClass}
                />
              </label>
            ))}
            <p className="text-xs text-muted-foreground">
              Include at least an email address or phone number.
            </p>
            {notice?.error ? (
              <p role="alert" className="text-sm text-destructive">
                {notice.message}
              </p>
            ) : null}
            <button disabled={busy} className={buttonClass}>
              Save customer
            </button>
          </form>
        </BusinessDialog>
      ) : null}
    </div>
  );
}
