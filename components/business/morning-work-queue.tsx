"use client";

import Link from "next/link";
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
import { readCalendarMutationPayload } from "@/lib/scheduling/calendar-mutation-rules";
import { localDate, safeSourceUrl, type DailyBriefData } from "@/lib/business/daily-brief";
import type { FocusRow } from "@/lib/business/focus-brief";
import { orderMorningApprovals, overlappingAppointments } from "@/lib/business/morning-queue";

type Approval = DailyBriefData["approvals"][number];
type Appointment = DailyBriefData["appointments"][number];
type Slot = { start_iso: string; end_iso: string };
type Entry = { kind: "approval"; key: string; approval: Approval } | { kind: "row"; key: string; row: FocusRow };
type Density = "1" | "3" | "all";
export type PreviewAction = {
  approvalId: string;
  resolution: "approve" | "reject";
  editedContent: string;
  bookedSlot?: Slot;
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

function CalendarPeek({ slot, requestedSlot, appointments, timeZone, cancellation, excludeIds, preview }: {
  slot: Slot; requestedSlot?: Slot | null; appointments: Appointment[]; timeZone: string; cancellation: boolean; excludeIds: string[]; preview: boolean;
}) {
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const date = localDate(slot.start_iso, timeZone);
  const formatTime = new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone });
  const formatDay = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone });
  const events = appointments.filter((item) =>
    !["cancelled", "canceled", "deleted"].includes(item.status) &&
    Number.isFinite(Date.parse(item.start_at)) && Number.isFinite(Date.parse(item.end_at)) &&
    localDate(item.start_at, timeZone) <= date && localDate(item.end_at, timeZone) >= date
  ).sort((a, b) => a.start_at.localeCompare(b.start_at));
  const overlaps = cancellation ? [] : overlappingAppointments(events, slot, excludeIds);
  const requestedOverlaps = requestedSlot ? overlappingAppointments(events, requestedSlot, excludeIds) : [];
  const range = (value: Slot) => formatTime.formatRange(new Date(value.start_iso), new Date(value.end_iso));
  return <div className="group relative inline-flex" onMouseLeave={() => setDismissed(false)} onKeyDown={(event) => { if (event.key === "Escape") { setPinned(false); setDismissed(true); } }}>
    <button type="button" aria-label="Preview this day on your calendar" aria-expanded={pinned} onClick={() => { setPinned((current) => !current); setDismissed(pinned); }}
      className="inline-flex size-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
      <CalendarDays aria-hidden="true" className="size-[18px]" />
    </button>
    <div role="region" aria-label="Appointment calendar preview"
      className={(pinned ? "block " : dismissed ? "hidden " : "hidden group-hover:block group-focus-within:block ") + "absolute left-0 top-full z-30 mt-2 w-[min(19rem,calc(100vw-3rem))] rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-xl shadow-slate-900/15 ns-fade-up"}>
      <p className="text-sm font-semibold text-slate-900">{formatDay.format(new Date(slot.start_iso))}</p>
      {requestedSlot ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">Requested · {range(requestedSlot)} · {requestedOverlaps.length ? `${requestedOverlaps.length} conflicting calendar ${requestedOverlaps.length === 1 ? "item" : "items"}` : "Available"}</p> : null}
      <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-blue-800">{requestedSlot ? "Suggested" : "Proposed"} · {range(slot)} · {overlaps.length ? `${overlaps.length} ${overlaps.length === 1 ? "conflict" : "conflicts"}` : preview ? "Available" : "No overlaps in available records"}</p>
      <ol className="mt-2 divide-y divide-slate-100">{events.map((item) => <li key={item.id} className="py-2 text-xs"><span className="font-medium text-slate-800">{item.title}{excludeIds.includes(item.id) ? " · Current appointment" : ""}</span><span className="mt-0.5 block tabular-nums text-slate-500">{item.allDay ? "All day" : formatTime.formatRange(new Date(item.start_at), new Date(item.end_at))}</span></li>)}</ol>
      <p className="mt-2 text-[11px] leading-4 text-slate-400">{preview ? "Sample calendar. No real booking will be made." : "The calendar is checked again when the action runs."}</p>
    </div>
  </div>;
}

function PreviewApprovalActions({ approval, slot, appointments, timeZone, onPreviewAction, onSaved }: {
  approval: Approval; slot: Slot | null; appointments: Appointment[]; timeZone: string;
  onPreviewAction?: (action: PreviewAction) => void; onSaved: (message: string) => void;
}) {
  const draftId = useId();
  const [draft, setDraft] = useState(approval.editable_content ?? "");
  const [error, setError] = useState<string | null>(null);
  const booking = approval.type === "appointment_booking";
  const bill = approval.type === "sample_bill";
  const task = approval.type === "sample_task";
  const suggestedTime = slot ? new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(slot.start_iso)) : null;
  const conflicting = booking && slot ? overlappingAppointments(appointments, slot).length > 0 : false;
  const approveLabel = booking ? suggestedTime ? `Approve ${suggestedTime} & send` : "Approve booking & send" : bill ? "Pay now (sample)" : task ? "Mark done (sample)" : "Approve and send";
  const declineLabel = bill ? "Keep autopay" : task ? "Keep on list" : "Decline";
  function decide(resolution: PreviewAction["resolution"]) {
    if (!onPreviewAction) return;
    if (resolution === "approve" && approval.editable_content != null && !draft.trim()) {
      setError("Add a message before approving this sample action.");
      return;
    }
    if (resolution === "approve" && booking && (!slot || conflicting)) {
      setError("The suggested time is unavailable in this sample calendar.");
      return;
    }
    setError(null);
    onPreviewAction({ approvalId: approval.id, resolution, editedContent: draft, ...(resolution === "approve" && booking && slot ? { bookedSlot: slot } : {}) });
    onSaved(resolution === "reject"
      ? bill ? "Sample choice saved: autopay remains scheduled." : task ? "Sam’s brief remains on your sample task list." : "Sample decision saved. No message was sent."
      : booking ? `Sample appointment booked for ${suggestedTime ?? "the suggested time"} and the draft confirmation recorded as sent.`
        : bill ? "Sample payment recorded. No real payment was made."
          : task ? "Sam’s brief marked done in this sample workspace."
          : "Sample reply recorded as sent. No real message was sent.");
  }
  return <div className="space-y-3">
    {approval.editable_content !== null && approval.editable_content !== undefined ? <div>
      <Label htmlFor={draftId}>Draft reply</Label>
      <Textarea id={draftId} value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} className="mt-1.5 bg-white" />
      <p className="mt-1.5 text-xs text-slate-500">You can edit the draft before approving.</p>
    </div> : null}
    <p className="rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-xs leading-5 text-blue-900">
      {booking ? `Suggested next step: book the available ${suggestedTime ?? "appointment"} slot and send the reviewed confirmation.`
        : bill ? "Suggested next step: pay this sample bill early, or leave its scheduled autopay in place."
          : task ? "Suggested next step: mark this sample task done after reviewing the brief, or keep it on your list."
          : "Suggested next step: approve and send the reviewed reply."}
      <span className="block font-medium">This is a sample action. It will not contact anyone or change a real account.</span>
    </p>
    {error ? <p role="alert" className="text-xs font-medium text-red-700">{error}</p> : null}
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={!onPreviewAction || conflicting} onClick={() => decide("approve")}>{approveLabel}</Button>
      <Button type="button" variant="outline" disabled={!onPreviewAction} onClick={() => decide("reject")}>{declineLabel}</Button>
    </div>
  </div>;
}

function ApprovalRow({ approval, appointments, timeZone, open, onToggle, onSaved, preview, onPreviewAction }: {
  approval: Approval; appointments: Appointment[]; timeZone: string; open: boolean; preview: boolean;
  onToggle: () => void; onSaved: (message: string) => void; onPreviewAction?: (action: PreviewAction) => void;
}) {
  const panelId = useId();
  const payload = approval.proposed_payload ?? null;
  const isInvoice = payload?.invoice_followup_version === 1;
  const allowEdit = !["crm_change", "appointment_change"].includes(approval.type ?? "") && !isInvoice;
  const sendsMessage = approval.type === "customer_message" || isInvoice;
  const slot = proposedSlot(approval.type, payload);
  const requestedSlot = preview ? readSlot(payload?.requested_slot) : null;
  const change = approval.type === "appointment_change" ? readCalendarMutationPayload(payload) : null;
  const excludeIds = change ? [change.appointment_id, ...(change.source_record_id ? ["imported:" + change.source_record_id] : [])] : [];
  const recipient = (sendsMessage || preview) && typeof payload?.to === "string" ? payload.to : null;
  const subject = (sendsMessage || preview) && typeof payload?.subject === "string" ? payload.subject : null;
  return <article data-morning-action={approval.id} className={"border-b border-slate-100 last:border-b-0 " + (open ? "bg-blue-50/35" : "")}>
    <button type="button" data-review-button aria-expanded={open} aria-controls={panelId} onClick={onToggle}
      className="group flex min-h-[72px] w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-blue-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 sm:px-6">
      <span className="size-2 shrink-0 rounded-full bg-blue-500" aria-hidden="true" />
      <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold text-slate-900">{approval.title}</span><span className="mt-0.5 block text-xs text-slate-500">{preview ? "Sample decision · Try it here" : "Your decision is needed"}</span></span>
      <span className="shrink-0 text-xs font-semibold text-blue-700">{open ? "Minimize" : "Review"}</span>
      <ChevronDown aria-hidden="true" className={"size-4 shrink-0 text-blue-700 transition-transform duration-200 " + (open ? "rotate-180" : "")} />
    </button>
    {open ? <div id={panelId} className="border-t border-blue-100/80 px-5 pb-5 pt-4 ns-fade-up sm:px-6">
      {approval.summary ? <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{approval.summary}</p> : null}
      {recipient || subject ? <dl className="mt-3 space-y-1 break-words text-xs text-slate-600">{recipient ? <div><dt className="inline font-medium">To </dt><dd className="inline">{recipient}</dd></div> : null}{subject ? <div><dt className="inline font-medium">Subject </dt><dd className="inline">{subject}</dd></div> : null}</dl> : null}
      {slot ? <div className="mt-4 flex items-center gap-3"><CalendarPeek slot={slot} requestedSlot={requestedSlot} appointments={appointments} timeZone={timeZone} cancellation={payload?.mutation === "cancel"} excludeIds={excludeIds} preview={preview} /><span className="text-xs text-slate-500">{requestedSlot ? "See the requested time and the available option" : "Preview this day"}</span></div> : null}
      {!preview && approval.type === "external_action" ? <ExternalActionPreview payload={payload} /> : null}
      {!preview && approval.type === "appointment_change" ? <CalendarChangePreview payload={payload} /> : null}
      {!preview && isInvoice ? <InvoiceFollowupPreview payload={payload} /> : null}
      {!preview && approval.type === "crm_change" ? <CrmGatewayPreview payload={payload} /> : null}
      <div className="mt-4">{preview ? <PreviewApprovalActions approval={approval} slot={slot} appointments={appointments} timeZone={timeZone} onPreviewAction={onPreviewAction} onSaved={onSaved} /> : <OwnerApprovalResolutionForm approvalId={approval.id} editableContent={approval.editable_content ?? null} allowEdit={allowEdit} inline
        approveLabel={sendsMessage ? "Approve and send" : approval.type === "appointment_booking" ? "Approve booking" : "Approve"}
        consequence={sendsMessage ? "Approval queues this message for delivery." : "Approval queues the proposed action."} onSaved={onSaved} />}</div>
    </div> : null}
  </article>;
}

function RecordRow({ row, preview, open, onToggle, onOpenRecord }: {
  row: FocusRow; preview: boolean; open: boolean; onToggle: () => void; onOpenRecord: (id: string) => void;
}) {
  const panelId = useId();
  const destination = preview && row.href?.startsWith("/client/") ? row.href.replace("/client/", "/preview/") : row.href;
  const external = safeSourceUrl(destination);
  return <article className={"border-b border-slate-100 last:border-b-0 " + (open ? "bg-slate-50/75" : "")}>
    <button type="button" data-review-button aria-expanded={open} aria-controls={panelId} onClick={onToggle}
      className="group flex min-h-[72px] w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 sm:px-6">
      <span className="size-2 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
      <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium text-slate-800">{row.title}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{row.detail || row.kind}</span></span>
      <span className="shrink-0 text-xs font-medium text-slate-500">{open ? "Minimize" : "Review"}</span>
      <ChevronDown aria-hidden="true" className={"size-4 shrink-0 text-slate-400 transition-transform duration-200 " + (open ? "rotate-180" : "")} />
    </button>
    {open ? <div id={panelId} className="border-t border-slate-100 px-5 pb-5 pt-4 ns-fade-up sm:px-6">
      <p className="text-sm leading-6 text-slate-600">{row.detail || "This record is on your radar."}</p>
      <p className="mt-1 text-xs text-slate-500">{row.label}</p>
      {row.recordId ? <button type="button" onClick={() => onOpenRecord(row.recordId!)} className="mt-4 inline-flex min-h-10 items-center rounded-xl bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">Open record</button> :
        external ? <a href={external} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-10 items-center rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-white">Open source</a> :
        destination?.startsWith("/") ? <Link href={destination} className="mt-4 inline-flex min-h-10 items-center rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-white">{row.kind === "report" ? "View report" : row.kind === "invoice" ? "View invoice" : "Open this work"}</Link> :
        <p className="mt-3 text-xs text-slate-500">No action is needed from this summary.</p>}
    </div> : null}
  </article>;
}

export function MorningWorkQueue({ approvals, appointments, timeZone, rows, scopeKey, now, onOpenRecord, preview = false, moreDecisionCount = 0, onPreviewAction }: {
  approvals: Approval[]; appointments: Appointment[]; timeZone: string; rows: FocusRow[]; scopeKey: string; now: string;
  onOpenRecord: (id: string) => void; preview?: boolean; moreDecisionCount?: number; onPreviewAction?: (action: PreviewAction) => void;
}) {
  const storageKey = "meridian:morning-queue:v1:" + scopeKey;
  const [density, setDensity] = useState<Density>("1");
  const [page, setPage] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Record<string, string>>({});
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
  function choose(next: Density) {
    setDensity(next); setPage(0); setOpenKey(null);
    try { localStorage.setItem(storageKey, next); } catch { /* Keep the choice in memory. */ }
  }
  const approvalKeys = new Set(approvals.map((approval) => "approval:" + approval.id));
  const representedTaskKeys = new Set(approvals.flatMap((approval) =>
    approval.type === "sample_task" && typeof approval.proposed_payload?.task_id === "string"
      ? ["action:" + approval.proposed_payload.task_id] : []));
  const entries: Entry[] = [
    ...orderMorningApprovals(approvals.filter((item) => !receipts[item.id]), now).map((approval) => ({ kind: "approval" as const, key: "approval:" + approval.id, approval })),
    ...rows.filter((row) => !approvalKeys.has(row.key) && !representedTaskKeys.has(row.key)).map((row) => ({ kind: "row" as const, key: row.key, row })),
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
  return <section ref={queue} aria-labelledby="morning-work-heading" className="min-w-0 rounded-[22px] border border-[#e6ebf2] bg-white shadow-[0_10px_30px_-26px_rgba(27,45,80,.45)]">
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-6">
      <div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Your morning flow</p><h2 id="morning-work-heading" className="mt-1 text-lg font-semibold tracking-[-0.025em] text-slate-900">Next up <span className="ml-1 text-sm font-normal tabular-nums text-slate-400">{unique.length}</span></h2></div>
      <div role="group" aria-label="Items shown at once" className="inline-flex rounded-xl bg-slate-100 p-1">{(["1", "3", "all"] as const).map((choice) => <button key={choice} type="button" aria-pressed={density === choice} onClick={() => choose(choice)} className={"min-h-9 min-w-10 rounded-lg px-2.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 " + (density === choice ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-800")}>{choice === "all" ? "All" : choice}</button>)}</div>
    </div>
    {moreDecisionCount > 0 ? <Link href={preview ? "/preview" : "/client/approvals"} className="mx-5 mb-3 inline-flex min-h-10 items-center text-xs font-semibold text-blue-700 hover:underline sm:mx-6">{moreDecisionCount} more {moreDecisionCount === 1 ? "decision" : "decisions"} in Approvals</Link> : null}
    {Object.entries(receipts).map(([id, message]) => <p key={id} role="status" className="mx-5 mb-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 sm:mx-6">{message}</p>)}
    {visible.length ? <div className="border-t border-slate-100">{visible.map((entry) => entry.kind === "approval" ?
      <ApprovalRow key={entry.key} approval={entry.approval} appointments={appointments} timeZone={timeZone} open={openKey === entry.key} onToggle={() => setOpenKey((current) => current === entry.key ? null : entry.key)} preview={preview} onPreviewAction={onPreviewAction} onSaved={(message) => { setReceipts((current) => ({ ...current, [entry.approval.id]: message })); setOpenKey(null); requestAnimationFrame(() => queue.current?.querySelector<HTMLButtonElement>("[data-review-button]")?.focus()); }} /> :
      <RecordRow key={entry.key} row={entry.row} preview={preview} open={openKey === entry.key} onToggle={() => setOpenKey((current) => current === entry.key ? null : entry.key)} onOpenRecord={onOpenRecord} />)}</div> :
      <p className="border-t border-slate-100 px-6 py-8 text-sm text-slate-500">You’re caught up in the records available here.</p>}
    {density !== "all" && unique.length > count ? <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500 sm:px-6"><button type="button" disabled={currentPage === 0} onClick={() => { setPage((value) => Math.max(0, value - 1)); setOpenKey(null); }} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-30"><ChevronLeft aria-hidden="true" className="size-4" />Previous</button><span className="tabular-nums">{currentPage + 1} of {totalPages}</span><button type="button" disabled={currentPage >= totalPages - 1} onClick={() => { setPage((value) => value + 1); setOpenKey(null); }} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-30">Next<ChevronRight aria-hidden="true" className="size-4" /></button></div> : null}
  </section>;
}
