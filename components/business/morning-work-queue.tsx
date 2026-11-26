"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { CalendarChangePreview } from "@/components/approvals/calendar-change-preview";
import { CrmGatewayPreview } from "@/components/approvals/crm-gateway-preview";
import { ExternalActionPreview } from "@/components/approvals/external-action-preview";
import { InvoiceFollowupPreview } from "@/components/approvals/invoice-followup-preview";
import { OwnerApprovalResolutionForm } from "@/components/approvals/owner-approval-resolution-form";
import { readCalendarMutationPayload } from "@/lib/scheduling/calendar-mutation-rules";
import { localDate, safeSourceUrl, type DailyBriefData } from "@/lib/business/daily-brief";
import type { FocusRow } from "@/lib/business/focus-brief";
import { orderMorningApprovals, overlappingAppointments } from "@/lib/business/morning-queue";

type Approval = DailyBriefData["approvals"][number];
type Appointment = DailyBriefData["appointments"][number];
type Slot = { start_iso: string; end_iso: string };
type Entry = { kind: "approval"; key: string; approval: Approval } | { kind: "row"; key: string; row: FocusRow };
type Density = "1" | "3" | "all";

function proposedSlot(type: string | undefined, payload: Record<string, unknown> | null): Slot | null {
  if (type === "appointment_change") {
    const change = readCalendarMutationPayload(payload);
    return change?.new_slot ?? change?.old_slot ?? null;
  }
  if (type !== "appointment_booking" || !payload?.slot || typeof payload.slot !== "object") return null;
  const slot = payload.slot as Record<string, unknown>;
  if (typeof slot.start_iso !== "string" || typeof slot.end_iso !== "string" || Date.parse(slot.end_iso) <= Date.parse(slot.start_iso)) return null;
  return { start_iso: slot.start_iso, end_iso: slot.end_iso };
}

function CalendarPeek({ slot, appointments, timeZone, cancellation, excludeIds }: {
  slot: Slot; appointments: Appointment[]; timeZone: string; cancellation: boolean; excludeIds: string[];
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
  return <div className="group relative inline-flex" onMouseLeave={() => setDismissed(false)} onKeyDown={(event) => { if (event.key === "Escape") { setPinned(false); setDismissed(true); } }}>
    <button type="button" aria-label="Preview this day on your calendar" aria-expanded={pinned} onClick={() => { setPinned((current) => !current); setDismissed(pinned); }}
      className="inline-flex size-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
      <CalendarDays aria-hidden="true" className="size-[18px]" />
    </button>
    <div role="region" aria-label="Appointment calendar preview"
      className={(pinned ? "block " : dismissed ? "hidden " : "hidden group-hover:block group-focus-within:block ") + "absolute bottom-full left-0 z-30 mb-2 w-[min(19rem,calc(100vw-3rem))] rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-xl shadow-slate-900/15 ns-fade-up"}>
      <p className="text-sm font-semibold text-slate-900">{formatDay.format(new Date(slot.start_iso))}</p>
      <p className="mt-1 text-xs text-slate-500">Proposed · {formatTime.formatRange(new Date(slot.start_iso), new Date(slot.end_iso))}</p>
      {overlaps.length ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">{overlaps.length} calendar {overlaps.length === 1 ? "item overlaps" : "items overlap"} this time</p> : <p className="mt-3 text-xs text-slate-600">No overlapping appointments in the records available here.</p>}
      <ol className="mt-2 divide-y divide-slate-100">{events.map((item) => <li key={item.id} className="py-2 text-xs"><span className="font-medium text-slate-800">{item.title}{excludeIds.includes(item.id) ? " · Current appointment" : ""}</span><span className="mt-0.5 block tabular-nums text-slate-500">{item.allDay ? "All day" : formatTime.formatRange(new Date(item.start_at), new Date(item.end_at))}</span></li>)}</ol>
      <p className="mt-2 text-[11px] leading-4 text-slate-400">The calendar is checked again when the action runs.</p>
    </div>
  </div>;
}

function ApprovalRow({ approval, appointments, timeZone, open, onToggle, onSaved }: {
  approval: Approval; appointments: Appointment[]; timeZone: string; open: boolean;
  onToggle: () => void; onSaved: (message: string) => void;
}) {
  const panelId = useId();
  const payload = approval.proposed_payload ?? null;
  const isInvoice = payload?.invoice_followup_version === 1;
  const allowEdit = !["crm_change", "appointment_change"].includes(approval.type ?? "") && !isInvoice;
  const sendsMessage = approval.type === "customer_message" || isInvoice;
  const slot = proposedSlot(approval.type, payload);
  const change = approval.type === "appointment_change" ? readCalendarMutationPayload(payload) : null;
  const excludeIds = change ? [change.appointment_id, ...(change.source_record_id ? ["imported:" + change.source_record_id] : [])] : [];
  const recipient = sendsMessage && typeof payload?.to === "string" ? payload.to : null;
  const subject = sendsMessage && typeof payload?.subject === "string" ? payload.subject : null;
  return <article data-morning-action={approval.id} className={"border-b border-slate-100 last:border-b-0 " + (open ? "bg-blue-50/35" : "")}>
    <button type="button" data-review-button aria-expanded={open} aria-controls={panelId} onClick={onToggle}
      className="group flex min-h-[72px] w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-blue-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 sm:px-6">
      <span className="size-2 shrink-0 rounded-full bg-blue-500" aria-hidden="true" />
      <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold text-slate-900">{approval.title}</span><span className="mt-0.5 block text-xs text-slate-500">Your decision is needed</span></span>
      <span className="shrink-0 text-xs font-semibold text-blue-700">{open ? "Minimize" : "Review"}</span>
      <ChevronDown aria-hidden="true" className={"size-4 shrink-0 text-blue-700 transition-transform duration-200 " + (open ? "rotate-180" : "")} />
    </button>
    {open ? <div id={panelId} className="border-t border-blue-100/80 px-5 pb-5 pt-4 ns-fade-up sm:px-6">
      {approval.summary ? <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{approval.summary}</p> : null}
      {recipient || subject ? <dl className="mt-3 space-y-1 break-words text-xs text-slate-600">{recipient ? <div><dt className="inline font-medium">To </dt><dd className="inline">{recipient}</dd></div> : null}{subject ? <div><dt className="inline font-medium">Subject </dt><dd className="inline">{subject}</dd></div> : null}</dl> : null}
      {slot ? <div className="mt-4 flex items-center gap-3"><CalendarPeek slot={slot} appointments={appointments} timeZone={timeZone} cancellation={payload?.mutation === "cancel"} excludeIds={excludeIds} /><span className="text-xs text-slate-500">Preview this day</span></div> : null}
      {approval.type === "external_action" ? <ExternalActionPreview payload={payload} /> : null}
      {approval.type === "appointment_change" ? <CalendarChangePreview payload={payload} /> : null}
      {isInvoice ? <InvoiceFollowupPreview payload={payload} /> : null}
      {approval.type === "crm_change" ? <CrmGatewayPreview payload={payload} /> : null}
      <div className="mt-4"><OwnerApprovalResolutionForm approvalId={approval.id} editableContent={approval.editable_content ?? null} allowEdit={allowEdit} inline
        approveLabel={sendsMessage ? "Approve and send" : approval.type === "appointment_booking" ? "Approve booking" : "Approve"}
        consequence={sendsMessage ? "Approval queues this message for delivery." : "Approval queues the proposed action."} onSaved={onSaved} /></div>
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
        destination?.startsWith("/") ? <Link href={destination} className="mt-4 inline-flex min-h-10 items-center rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-white">Open this work</Link> :
        <p className="mt-3 text-xs text-slate-500">No action is needed from this summary.</p>}
    </div> : null}
  </article>;
}

export function MorningWorkQueue({ approvals, appointments, timeZone, rows, scopeKey, now, onOpenRecord, preview = false, moreDecisionCount = 0 }: {
  approvals: Approval[]; appointments: Appointment[]; timeZone: string; rows: FocusRow[]; scopeKey: string; now: string;
  onOpenRecord: (id: string) => void; preview?: boolean; moreDecisionCount?: number;
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
  const entries: Entry[] = [
    ...orderMorningApprovals(approvals.filter((item) => !receipts[item.id]), now).map((approval) => ({ kind: "approval" as const, key: "approval:" + approval.id, approval })),
    ...rows.filter((row) => !approvalKeys.has(row.key)).map((row) => ({ kind: "row" as const, key: row.key, row })),
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
      <ApprovalRow key={entry.key} approval={entry.approval} appointments={appointments} timeZone={timeZone} open={openKey === entry.key} onToggle={() => setOpenKey((current) => current === entry.key ? null : entry.key)} onSaved={(message) => { setReceipts((current) => ({ ...current, [entry.approval.id]: message })); setOpenKey(null); requestAnimationFrame(() => queue.current?.querySelector<HTMLButtonElement>("[data-review-button]")?.focus()); }} /> :
      <RecordRow key={entry.key} row={entry.row} preview={preview} open={openKey === entry.key} onToggle={() => setOpenKey((current) => current === entry.key ? null : entry.key)} onOpenRecord={onOpenRecord} />)}</div> :
      <p className="border-t border-slate-100 px-6 py-8 text-sm text-slate-500">You’re caught up in the records available here.</p>}
    {density !== "all" && unique.length > count ? <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500 sm:px-6"><button type="button" disabled={currentPage === 0} onClick={() => { setPage((value) => Math.max(0, value - 1)); setOpenKey(null); }} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-30"><ChevronLeft aria-hidden="true" className="size-4" />Previous</button><span className="tabular-nums">{currentPage + 1} of {totalPages}</span><button type="button" disabled={currentPage >= totalPages - 1} onClick={() => { setPage((value) => value + 1); setOpenKey(null); }} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-30">Next<ChevronRight aria-hidden="true" className="size-4" /></button></div> : null}
  </section>;
}
