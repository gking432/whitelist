"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { CalendarChangePreview } from "@/components/approvals/calendar-change-preview";
import { CrmGatewayPreview } from "@/components/approvals/crm-gateway-preview";
import { ExternalActionPreview } from "@/components/approvals/external-action-preview";
import { InvoiceFollowupPreview } from "@/components/approvals/invoice-followup-preview";
import { OwnerApprovalResolutionForm } from "@/components/approvals/owner-approval-resolution-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ConnectedCustomer } from "@/lib/crm/provider-contract";
import { readCalendarMutationPayload } from "@/lib/scheduling/calendar-mutation-rules";
import { localDate, safeSourceUrl, type BriefTask, type DailyBriefData } from "@/lib/business/daily-brief";
import type { FocusRow } from "@/lib/business/focus-brief";
import { orderMorningApprovals, overlappingAppointments } from "@/lib/business/morning-queue";
import { InlineWeekCalendar, type Slot } from "./inline-week-calendar";

type Approval = DailyBriefData["approvals"][number];
type Appointment = DailyBriefData["appointments"][number];
type Entry = { kind: "approval"; key: string; approval: Approval } | { kind: "row"; key: string; row: FocusRow };
type Density = "1" | "3" | "all";
export type PreviewAction = {
  approvalId: string;
  resolution: "approve" | "reject" | "propose_time";
  editedContent: string;
  bookedSlot?: Slot;
  proposedSlot?: Slot;
};

function readSlot(value: unknown): Slot | null {
  if (!value || typeof value !== "object") return null;
  const slot = value as Record<string, unknown>;
  if (typeof slot.start_iso !== "string" || typeof slot.end_iso !== "string") return null;
  const start = Date.parse(slot.start_iso), end = Date.parse(slot.end_iso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start_iso: slot.start_iso, end_iso: slot.end_iso };
}

function proposedSlot(type: string | undefined, payload: Record<string, unknown> | null): Slot | null {
  if (type === "appointment_change") {
    const change = readCalendarMutationPayload(payload);
    return change?.new_slot ?? change?.old_slot ?? null;
  }
  return type === "appointment_booking" ? readSlot(payload?.slot) : null;
}

function formatSlotTime(slot: Slot | null, timeZone: string): string | null {
  if (!slot) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(slot.start_iso));
}

function formatSlotDateTime(slot: Slot, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(slot.start_iso));
}

function customerForApproval(approval: Approval, customers: ConnectedCustomer[]): ConnectedCustomer | null {
  const payload = approval.proposed_payload;
  const email = typeof payload?.to === "string" ? payload.to.toLowerCase() : "";
  const name = typeof payload?.customer_name === "string" ? payload.customer_name.toLowerCase() : "";
  return customers.find((customer) => !customer.archived && email && customer.email?.toLowerCase() === email)
    ?? customers.find((customer) => !customer.archived && name && customer.name.toLowerCase() === name)
    ?? null;
}

function CustomerContext({ approval, customer }: { approval: Approval; customer: ConnectedCustomer | null }) {
  const payload = approval.proposed_payload;
  const name = customer?.name ?? (typeof payload?.customer_name === "string" ? payload.customer_name : null);
  const email = customer?.email ?? (typeof payload?.to === "string" ? payload.to : null);
  if (!name && !email) return null;
  const visibleName = name ?? email ?? "Contact";
  const initials = visibleName.split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase();
  const source = customer?.account;
  const href = safeSourceUrl(customer?.href);
  const history = typeof payload?.customer_history === "string" ? payload.customer_history : null;
  return <section aria-label="Customer profile" className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
    <div className="h-12 bg-gradient-to-r from-[#eaf2ff] via-[#eef7ff] to-[#eef5fa]" />
    <div className="-mt-5 px-4 pb-4">
      <div className="flex size-11 items-center justify-center rounded-full border-[3px] border-white bg-[#d8e9ff] text-sm font-bold text-blue-800 shadow-sm">{initials}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{visibleName}</h3>
        {customer?.lifecycleStage ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium capitalize text-blue-700">{customer.lifecycleStage.replaceAll("_", " ")}</span> : null}
      </div>
      <p className="mt-0.5 text-xs text-slate-500">{source ? "From " + source : "Contact on this request"}</p>
      <dl className="mt-3 grid gap-2 border-t border-slate-100 pt-3 text-xs sm:grid-cols-2">
        {email ? <div><dt className="font-medium text-slate-500">Email</dt><dd className="mt-0.5 break-all text-slate-800">{email}</dd></div> : null}
        {customer?.phone ? <div><dt className="font-medium text-slate-500">Phone</dt><dd className="mt-0.5 text-slate-800">{customer.phone}</dd></div> : null}
      </dl>
      <div className="mt-3 border-t border-slate-100 pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Current request</p>
        <p className="mt-1 text-xs leading-5 text-slate-700">{approval.summary}</p>
      </div>
      {history ? <div className="mt-3 border-t border-slate-100 pt-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">History</p><p className="mt-1 text-xs leading-5 text-slate-700">{history}</p></div> : null}
      {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex text-xs font-semibold text-blue-700 hover:underline">Open source record</a> : null}
    </div>
  </section>;
}

function PreviewDecisionForm({ approval, slot, appointments, timeZone, expanded, onPreviewAction, onSaved }: {
  approval: Approval; slot: Slot | null; appointments: Appointment[]; timeZone: string; expanded: boolean;
  onPreviewAction?: (action: PreviewAction) => void; onSaved: (message: string) => void;
}) {
  const draftId = useId();
  const [draft, setDraft] = useState(approval.editable_content ?? "");
  const generatedDraft = useRef(approval.editable_content ?? "");
  const previousSlot = useRef(slot?.start_iso + "|" + slot?.end_iso);
  const [error, setError] = useState<string | null>(null);
  const booking = approval.type === "appointment_booking";
  const bill = approval.type === "sample_bill";
  const task = approval.type === "sample_task";
  const suggestedTime = formatSlotTime(slot, timeZone);
  const originalSlot = readSlot(approval.proposed_payload?.slot);
  const revisedTime = booking && !!slot && !!originalSlot &&
    (slot.start_iso !== originalSlot.start_iso || slot.end_iso !== originalSlot.end_iso);
  useEffect(() => {
    if (!booking || !slot) return;
    const name = typeof approval.proposed_payload?.customer_name === "string" ? approval.proposed_payload.customer_name.split(" ")[0] : "there";
    const next = revisedTime
      ? "Hi " + name + ", would " + formatSlotDateTime(slot, timeZone) + " work for your consultation? Let me know and I can confirm it."
      : "Hi " + name + ", " + formatSlotDateTime(slot, timeZone) + " is confirmed. See you then!";
    const slotKey = slot.start_iso + "|" + slot.end_iso;
    setDraft((current) => slotKey !== previousSlot.current || current === generatedDraft.current ? next : current);
    previousSlot.current = slotKey;
    generatedDraft.current = next;
  }, [approval.proposed_payload, booking, revisedTime, slot, timeZone]);
  const conflicting = booking && slot ? overlappingAppointments(appointments, slot).length > 0 : false;
  const approveLabel = booking ? revisedTime ? "Send new time" : suggestedTime ? "Approve " + suggestedTime + " & send" : "Approve booking & send" : bill ? "Pay now (sample)" : task ? "Mark done (sample)" : "Approve & send";
  const declineLabel = bill ? "Keep autopay" : task ? "Keep on list" : "Decline";
  function decide(resolution: PreviewAction["resolution"]) {
    if (!onPreviewAction) return;
    if (resolution !== "reject" && approval.editable_content != null && !draft.trim()) {
      setError("Add a message before approving this sample action.");
      return;
    }
    if (resolution !== "reject" && booking && (!slot || conflicting)) {
      setError("This time conflicts with a calendar item. Choose another time below.");
      return;
    }
    setError(null);
    onPreviewAction({ approvalId: approval.id, resolution, editedContent: draft,
      ...(resolution === "approve" && booking && slot ? { bookedSlot: slot } : {}),
      ...(resolution === "propose_time" && slot ? { proposedSlot: slot } : {}) });
    onSaved(resolution === "reject"
      ? bill ? "Sample choice saved: autopay remains scheduled." : task ? "Sam’s brief remains on your sample task list." : "Sample decision saved. No message was sent."
      : resolution === "propose_time" ? "Sample revised time sent. The booking is waiting for Jayden’s reply."
      : booking ? "Sample appointment booked for " + (suggestedTime ?? "the selected time") + " and the confirmation recorded as sent."
        : bill ? "Sample payment recorded. No real payment was made."
          : task ? "Sam’s brief marked done in this sample workspace."
          : "Sample reply recorded as sent. No real message was sent.");
  }
  return <div className="space-y-3">
    {approval.editable_content != null ? expanded ? <div>
      <Label htmlFor={draftId}>Draft reply</Label>
      <Textarea id={draftId} value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} className="mt-1.5 bg-white" />
      <p className="mt-1 text-xs text-slate-500">You can edit this before approving.</p>
    </div> : <div className="rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">Reply ready to send</p>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-700">{draft}</p>
    </div> : null}
    {error ? <p role="alert" className="text-xs font-medium text-red-700">{error}</p> : null}
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" data-primary-action disabled={!onPreviewAction || conflicting} onClick={() => decide(revisedTime ? "propose_time" : "approve")}>{approveLabel}</Button>
      <Button type="button" variant="outline" disabled={!onPreviewAction} onClick={() => decide("reject")}>{declineLabel}</Button>
      <span className="text-[11px] text-slate-400">Sample only</span>
    </div>
  </div>;
}

function ApprovalRow({ approval, appointments, timeZone, customers, open, calendarOpen, onToggle, onToggleCalendar, onSaved, preview, onPreviewAction, onRescheduleAppointment }: {
  approval: Approval; appointments: Appointment[]; timeZone: string; customers: ConnectedCustomer[]; open: boolean; calendarOpen: boolean; preview: boolean;
  onToggleCalendar: () => void;
  onToggle: () => void; onSaved: (message: string) => void; onPreviewAction?: (action: PreviewAction) => void;
  onRescheduleAppointment?: (appointmentId: string, slot: Slot) => void;
}) {
  const panelId = useId();
  const calendarId = useId();
  const payload = approval.proposed_payload ?? null;
  const isInvoice = payload?.invoice_followup_version === 1;
  const allowEdit = !["crm_change", "appointment_change"].includes(approval.type ?? "") && !isInvoice;
  const sendsMessage = approval.type === "customer_message" || isInvoice;
  const originalSlot = proposedSlot(approval.type, payload);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(originalSlot);
  const [liveDraftPreview, setLiveDraftPreview] = useState(approval.editable_content ?? "");
  const requestedSlot = preview ? readSlot(payload?.requested_slot) : null;
  const change = approval.type === "appointment_change" ? readCalendarMutationPayload(payload) : null;
  const excludeIds = change ? [change.appointment_id, ...(change.source_record_id ? ["imported:" + change.source_record_id] : [])] : [];
  const customer = customerForApproval(approval, customers);
  const hasContactContext = Boolean(customer || typeof payload?.customer_name === "string" || typeof payload?.to === "string");
  const adjustedSlot = preview && approval.type === "appointment_booking" && originalSlot && selectedSlot &&
    (originalSlot.start_iso !== selectedSlot.start_iso || originalSlot.end_iso !== selectedSlot.end_iso);
  const prompt = adjustedSlot && selectedSlot
    ? (typeof payload?.customer_name === "string" ? payload.customer_name : "This customer") + " accepted the original time. You selected " + formatSlotDateTime(selectedSlot, timeZone) + ". Send this as a new offer?"
    : typeof payload?.decision_prompt === "string" ? payload.decision_prompt : approval.summary;
  const nextStep = adjustedSlot ? "Send the revised time and wait for the customer’s reply before booking." :
    typeof payload?.next_step === "string" ? payload.next_step : null;
  const subject = typeof payload?.subject === "string" ? payload.subject : null;
  const slotTime = formatSlotTime(selectedSlot, timeZone);
  return <article data-morning-action={approval.id} className="border-b border-slate-100 last:border-b-0">
    <div className="px-5 py-5 sm:px-6">
      <div className="flex items-start gap-3">
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-blue-500" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-blue-700">Decision needed</p>
          <h3 className="mt-1 text-[15px] font-semibold leading-6 text-slate-900">{approval.title}</h3>
          <p className={"mt-1.5 text-sm leading-6 text-slate-600 " + (open ? "" : "line-clamp-2")}>{prompt}</p>
        </div>
      </div>
      <div className="ml-5 mt-3 flex flex-wrap items-center gap-2">
        {selectedSlot ? <button type="button" aria-label={calendarOpen ? "Close calendar" : "Show calendar for this appointment"} aria-expanded={calendarOpen} aria-controls={calendarId} onClick={onToggleCalendar}
          className={"inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 " + (calendarOpen ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:border-blue-200 hover:bg-blue-50")}>
          <CalendarDays aria-hidden="true" className="size-4" />{slotTime ? slotTime + " · calendar" : "Calendar"}
        </button> : null}
        <button type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          {open ? "Less detail" : "Details"}<ChevronDown aria-hidden="true" className={"size-4 transition-transform " + (open ? "rotate-180" : "")} />
        </button>
      </div>
      <div className="ml-5 mt-4">
        {!preview && approval.editable_content != null && !open ? <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">Proposed message</p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-700">{liveDraftPreview}</p>
        </div> : null}
        {preview ? <PreviewDecisionForm approval={approval} slot={selectedSlot} appointments={appointments} timeZone={timeZone} expanded={open} onPreviewAction={onPreviewAction} onSaved={onSaved} /> :
          <OwnerApprovalResolutionForm approvalId={approval.id} editableContent={approval.editable_content ?? null} allowEdit={allowEdit} inline compact expanded={open} onDraftChange={setLiveDraftPreview}
            approveLabel={sendsMessage ? "Approve & send" : approval.type === "appointment_booking" ? "Approve booking" : "Approve"}
            consequence={sendsMessage ? "Approval queues this message for delivery." :
              approval.type === "appointment_booking" ? "Approval queues the booking. Its confirmation message needs a separate approval." :
                "Approval queues the proposed action."} onSaved={onSaved} />}
      </div>
      {open ? <div id={panelId} className="ml-5 mt-5 space-y-4 border-t border-slate-100 pt-5 ns-fade-up">
        <CustomerContext approval={approval} customer={customer} />
        {approval.summary && approval.summary !== prompt && !hasContactContext ? <p className="text-sm leading-6 text-slate-700">{approval.summary}</p> : null}
        {subject ? <p className="text-xs text-slate-600"><span className="font-semibold">Subject:</span> {subject}</p> : null}
        {nextStep ? <p className="rounded-xl bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900"><span className="font-semibold">Suggested next step:</span> {nextStep}</p> : null}
        {!preview && approval.type === "external_action" ? <ExternalActionPreview payload={payload} /> : null}
        {!preview && approval.type === "appointment_change" ? <CalendarChangePreview payload={payload} /> : null}
        {!preview && isInvoice ? <InvoiceFollowupPreview payload={payload} /> : null}
        {!preview && approval.type === "crm_change" ? <CrmGatewayPreview payload={payload} /> : null}
      </div> : null}
      {calendarOpen && selectedSlot ? <div id={calendarId} className="ml-5 mt-5 border-t border-slate-100 pt-5 ns-fade-up">
        <InlineWeekCalendar appointments={appointments} timeZone={timeZone} proposedSlot={selectedSlot} requestedSlot={requestedSlot} excludeIds={excludeIds} preview={preview}
          onRescheduleAppointment={preview ? onRescheduleAppointment : undefined}
          onProposedSlotChange={preview ? setSelectedSlot : undefined} />
      </div> : null}
    </div>
  </article>;
}

function RecordRow({ row, preview, task, saving, error, onOpenRecord, onCompleteTask, onAcknowledge }: {
  row: FocusRow; preview: boolean; task: BriefTask | null; saving: boolean; error: string | null;
  onOpenRecord: (id: string) => void; onCompleteTask: () => void; onAcknowledge: () => void;
}) {
  const destination = preview && row.href?.startsWith("/client/") ? row.href.replace("/client/", "/preview/") : row.href;
  const external = safeSourceUrl(destination);
  const actionLabel = row.kind === "report" ? "View report" : row.kind === "invoice" ? "View invoice" : "Open";
  return <article className="border-b border-slate-100 px-5 py-5 last:border-b-0 sm:px-6">
    <div className="flex items-start gap-3">
      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{row.label}</p>
        <h3 className="mt-1 text-sm font-semibold leading-6 text-slate-900">{row.title}</h3>
        {row.detail ? <p className="mt-1 text-xs leading-5 text-slate-600">{row.detail}</p> : null}
        {error ? <p role="alert" className="mt-2 text-xs font-medium text-red-700">{error}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {task ? <button type="button" data-record-action onClick={onCompleteTask} disabled={saving} className="inline-flex min-h-9 items-center rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60">{saving ? "Completing…" : "Complete task"}</button> : null}
          {row.recordId ? <button type="button" onClick={() => onOpenRecord(row.recordId!)} className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">Open record</button> :
            external ? <a href={external} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">Open source</a> :
            destination?.startsWith("/") ? <Link href={destination} className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">{actionLabel}</Link> : null}
          <button type="button" data-record-action onClick={onAcknowledge} className="inline-flex min-h-9 items-center rounded-lg bg-slate-100 px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200">{row.key.startsWith("action:") ? "Skip until tomorrow" : "Done for now"}</button>
        </div>
      </div>
    </div>
  </article>;
}

export function MorningWorkQueue({ approvals, appointments, timeZone, customers = [], tasks = [], canWriteTasks = false, rows, scopeKey, now, onOpenRecord, preview = false, moreDecisionCount = 0, onPreviewAction, onRescheduleAppointment, onCalendarOpenChange }: {
  approvals: Approval[]; appointments: Appointment[]; timeZone: string; customers?: ConnectedCustomer[]; tasks?: BriefTask[]; canWriteTasks?: boolean; rows: FocusRow[]; scopeKey: string; now: string;
  onOpenRecord: (id: string) => void; preview?: boolean; moreDecisionCount?: number; onPreviewAction?: (action: PreviewAction) => void;
  onRescheduleAppointment?: (appointmentId: string, slot: Slot) => void;
  onCalendarOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const storageKey = "meridian:morning-queue:v1:" + scopeKey;
  const acknowledgedKey = "meridian:morning-acknowledged:v1:" + scopeKey + ":" + localDate(now, timeZone);
  const [density, setDensity] = useState<Density>("1");
  const [page, setPage] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [calendarKey, setCalendarKey] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Record<string, string>>({});
  const [acknowledgedRows, setAcknowledgedRows] = useState<string[]>([]);
  const [completedTaskIds, setCompletedTaskIds] = useState<string[]>([]);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({});
  const queue = useRef<HTMLElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(storageKey);
        setDensity(saved === "1" || saved === "3" || saved === "all" ? saved : "1");
      } catch { /* Browser storage may be unavailable. */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved: unknown = JSON.parse(localStorage.getItem(acknowledgedKey) ?? "[]");
        setAcknowledgedRows(Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string").slice(-100) : []);
      } catch { /* Browser storage may be unavailable. */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [acknowledgedKey]);
  function choose(next: Density) {
    setDensity(next); setPage(0); setOpenKey(null);
    setCalendarKey(null); onCalendarOpenChange?.(false);
    try { localStorage.setItem(storageKey, next); } catch { /* Keep the choice in memory. */ }
  }
  function toggleCalendar(key: string) {
    const next = calendarKey === key ? null : key;
    setCalendarKey(next);
    onCalendarOpenChange?.(next !== null);
  }
  function closeCalendar() {
    if (calendarKey) {
      setCalendarKey(null);
      onCalendarOpenChange?.(false);
    }
  }
  function acknowledge(key: string) {
    const next = [...new Set([...acknowledgedRows, key])].slice(-100);
    setAcknowledgedRows(next);
    try { localStorage.setItem(acknowledgedKey, JSON.stringify(next)); } catch { /* Keep the choice in memory. */ }
    requestAnimationFrame(() => queue.current?.querySelector<HTMLButtonElement>("[data-primary-action], [data-record-action]")?.focus());
  }
  async function completeTask(task: BriefTask) {
    if (!canWriteTasks || preview || !task.updated_at || savingTaskId) return;
    setSavingTaskId(task.id);
    setTaskErrors((current) => ({ ...current, [task.id]: "" }));
    try {
      const response = await fetch("/api/business/todo", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "task_status", id: task.id, status: "done", updatedAt: task.updated_at }),
      });
      const result: { ok?: boolean; message?: string; error?: string } = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "The task could not be completed.");
      setCompletedTaskIds((current) => [...current, task.id]);
      setReceipts((current) => ({ ...current, ["task:" + task.id]: result.message || "Task completed." }));
      router.refresh();
      requestAnimationFrame(() => queue.current?.querySelector<HTMLButtonElement>("[data-primary-action], [data-record-action]")?.focus());
    } catch (error) {
      setTaskErrors((current) => ({ ...current, [task.id]: error instanceof Error ? error.message : "The task could not be completed." }));
    } finally {
      setSavingTaskId(null);
    }
  }
  const approvalKeys = new Set(approvals.map((approval) => "approval:" + approval.id));
  const representedTaskKeys = new Set(approvals.flatMap((approval) =>
    approval.type === "sample_task" && typeof approval.proposed_payload?.task_id === "string"
      ? ["action:" + approval.proposed_payload.task_id] : []));
  const decisionEntries: Entry[] = orderMorningApprovals(approvals.filter((item) => !receipts[item.id]), now)
    .map((approval) => ({ kind: "approval" as const, key: "approval:" + approval.id, approval }));
  const informationalEntries: Entry[] = rows
    .filter((row) => !approvalKeys.has(row.key) && !representedTaskKeys.has(row.key) && !acknowledgedRows.includes(row.key) &&
      !completedTaskIds.some((id) => row.key === "action:" + id))
    .map((row) => ({ kind: "row" as const, key: row.key, row }));
  const overdueEntries = informationalEntries.filter((entry) => entry.kind === "row" && entry.row.kind === "invoice" &&
    /past[ -]?due|overdue/i.test(entry.row.title + " " + entry.row.detail + " " + entry.row.label));
  const lowerDecisionIndex = decisionEntries.findIndex((entry) => entry.kind === "approval" &&
    (entry.approval.type === "sample_bill" || entry.approval.type === "sample_task"));
  const insertAt = lowerDecisionIndex < 0 ? decisionEntries.length : lowerDecisionIndex;
  const entries: Entry[] = [
    ...decisionEntries.slice(0, insertAt),
    ...overdueEntries,
    ...decisionEntries.slice(insertAt),
    ...informationalEntries.filter((entry) => !overdueEntries.includes(entry)),
  ];
  const seen = new Set<string>();
  const unique = entries.filter((entry) => {
    if (seen.has(entry.key)) return false;
    seen.add(entry.key);
    return true;
  });
  const count = density === "all" ? Math.max(1, unique.length) : Number(density);
  const totalPages = Math.max(1, Math.ceil(unique.length / count));
  const currentPage = Math.min(page, totalPages - 1);
  const visible = unique.slice(currentPage * count, (currentPage + 1) * count);
  const latestReceipt = Object.values(receipts).at(-1);
  return <section ref={queue} aria-labelledby="morning-work-heading" className="min-w-0 rounded-[22px] border border-[#e6ebf2] bg-white shadow-[0_10px_30px_-26px_rgba(27,45,80,.45)]">
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-6">
      <div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Your morning flow</p><h2 id="morning-work-heading" className="mt-1 text-lg font-semibold tracking-[-0.025em] text-slate-900">Next up <span className="ml-1 text-sm font-normal tabular-nums text-slate-400">{unique.length}</span></h2></div>
      <div role="group" aria-label="Items shown at once" className="inline-flex rounded-xl bg-slate-100 p-1">{(["1", "3", "all"] as const).map((choice) => <button key={choice} type="button" aria-pressed={density === choice} onClick={() => choose(choice)} className={"min-h-9 min-w-10 rounded-lg px-2.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 " + (density === choice ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-800")}>{choice === "all" ? "All" : choice}</button>)}</div>
    </div>
    {moreDecisionCount > 0 ? <Link href={preview ? "/preview" : "/client/approvals"} className="mx-5 mb-3 inline-flex min-h-10 items-center text-xs font-semibold text-blue-700 hover:underline sm:mx-6">{moreDecisionCount} more {moreDecisionCount === 1 ? "decision" : "decisions"} in Approvals</Link> : null}
    {latestReceipt ? <p role="status" className="mx-5 mb-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 sm:mx-6">{latestReceipt}</p> : null}
    {visible.length ? <div className="border-t border-slate-100">{visible.map((entry) => entry.kind === "approval" ?
      <ApprovalRow key={entry.key} approval={entry.approval} appointments={appointments} timeZone={timeZone} customers={customers} open={openKey === entry.key} calendarOpen={calendarKey === entry.key} onToggleCalendar={() => toggleCalendar(entry.key)} onToggle={() => setOpenKey((current) => current === entry.key ? null : entry.key)} preview={preview} onPreviewAction={onPreviewAction} onRescheduleAppointment={onRescheduleAppointment} onSaved={(message) => { setReceipts((current) => ({ ...current, [entry.approval.id]: message })); setOpenKey(null); closeCalendar(); requestAnimationFrame(() => queue.current?.querySelector<HTMLButtonElement>("[data-primary-action], [data-record-action]")?.focus()); }} /> :
      <RecordRow key={entry.key} row={entry.row} preview={preview} task={canWriteTasks && !preview ? tasks.find((task) => entry.row.key === "action:" + task.id && task.status === "open" && !!task.updated_at) ?? null : null} saving={savingTaskId !== null} error={taskErrors[entry.row.key.slice("action:".length)] || null} onOpenRecord={onOpenRecord} onCompleteTask={() => { const task = tasks.find((item) => entry.row.key === "action:" + item.id); if (task) void completeTask(task); }} onAcknowledge={() => acknowledge(entry.key)} />)}</div> :
      <p className="border-t border-slate-100 px-6 py-8 text-sm text-slate-500">You’re caught up in the records available here.</p>}
    {density !== "all" && unique.length > count ? <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500 sm:px-6"><button type="button" disabled={currentPage === 0} onClick={() => { setPage((value) => Math.max(0, value - 1)); setOpenKey(null); closeCalendar(); }} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-30"><ChevronLeft aria-hidden="true" className="size-4" />Previous</button><span className="tabular-nums">{currentPage + 1} of {totalPages}</span><button type="button" disabled={currentPage >= totalPages - 1} onClick={() => { setPage((value) => value + 1); setOpenKey(null); closeCalendar(); }} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-30">Next<ChevronRight aria-hidden="true" className="size-4" /></button></div> : null}
  </section>;
}
