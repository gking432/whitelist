"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Clock3, Pencil, X } from "lucide-react";
import { addDays, localDate, validTimeZone, type BriefAppointment } from "@/lib/business/daily-brief";
import { overlappingAppointments } from "@/lib/business/morning-queue";

export type Slot = { start_iso: string; end_iso: string };

type CalendarView = "week" | "day";
type EditTarget = { kind: "appointment"; id: string; title: string; slot: Slot } | { kind: "proposed"; slot: Slot };
type CalendarItem = {
  key: string;
  kind: "appointment" | "requested" | "proposed";
  title: string;
  slot: Slot;
  appointmentId?: string;
  start: number;
  end: number;
  lane?: number;
  lanes?: number;
};

const HOUR_HEIGHT = 48;
const VIEW_STORAGE_KEY = "meridian:inline-calendar-view:v1";
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function wallParts(value: string, timeZone: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: validTimeZone(timeZone),
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const number = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const year = number("year"), month = number("month"), day = number("day");
  const hour = number("hour"), minute = number("minute");
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  return { year, month, day, hour, minute };
}

function minuteOfDay(value: string, timeZone: string) {
  const parts = wallParts(value, timeZone);
  return parts ? parts.hour * 60 + parts.minute : null;
}

function timeInputValue(value: string, timeZone: string) {
  const parts = wallParts(value, timeZone);
  return parts ? `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}` : "";
}

function zonedLocalToIso(date: string, time: string, timeZone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  if (!Number.isFinite(target) || hour > 23 || minute > 59 ||
    new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== date) return null;

  // Iterate the wall-time difference so the editor follows the workspace time zone,
  // including dates on either side of daylight saving changes.
  let instant = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = wallParts(new Date(instant).toISOString(), timeZone);
    if (!parts) return null;
    const rendered = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const difference = target - rendered;
    if (difference === 0) return new Date(instant).toISOString();
    instant += difference;
  }
  return null;
}

function segmentForDay(slot: Slot, day: string, timeZone: string) {
  const startDay = localDate(slot.start_iso, timeZone);
  const endDay = localDate(slot.end_iso, timeZone);
  if (!startDay || !endDay || day < startDay || day > endDay) return null;
  const startMinute = minuteOfDay(slot.start_iso, timeZone);
  const endMinute = minuteOfDay(slot.end_iso, timeZone);
  if (startMinute === null || endMinute === null) return null;
  const start = day === startDay ? startMinute : 0;
  const end = day === endDay ? endMinute : 24 * 60;
  return end > start ? { start, end } : null;
}

function arrangeItems(items: CalendarItem[]): CalendarItem[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  let group: CalendarItem[] = [];
  let groupEnd = -1;
  const finish = () => {
    if (!group.length) return;
    const laneEnds: number[] = [];
    for (const item of group) {
      let lane = laneEnds.findIndex((end) => end <= item.start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = item.end;
      item.lane = lane;
    }
    for (const item of group) item.lanes = laneEnds.length;
    group = [];
  };
  for (const item of sorted) {
    if (group.length && item.start >= groupEnd) finish();
    group.push(item);
    groupEnd = Math.max(groupEnd, item.end);
  }
  finish();
  return sorted;
}

function dayLabel(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

function hourLabel(hour: number) {
  return hour === 0 ? "12 AM" : hour === 12 ? "12 PM" : hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

export function InlineWeekCalendar({
  appointments,
  timeZone,
  proposedSlot = null,
  requestedSlot = null,
  excludeIds = [],
  preview,
  onRescheduleAppointment,
  onProposedSlotChange,
}: {
  appointments: BriefAppointment[];
  timeZone: string;
  proposedSlot?: Slot | null;
  requestedSlot?: Slot | null;
  excludeIds?: string[];
  preview: boolean;
  onRescheduleAppointment?: (appointmentId: string, slot: Slot) => void;
  onProposedSlotChange?: (slot: Slot) => void;
}) {
  const zone = validTimeZone(timeZone);
  const initialDate = localDate(proposedSlot?.start_iso ?? requestedSlot?.start_iso ?? new Date().toISOString(), zone);
  const [anchorDate, setAnchorDate] = useState(initialDate);
  const [view, setView] = useState<CalendarView>("week");
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [draftDate, setDraftDate] = useState("");
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const startInputRef = useRef<HTMLInputElement>(null);
  const endInputRef = useRef<HTMLInputElement>(null);
  const requestedStart = requestedSlot ? Date.parse(requestedSlot.start_iso) : NaN;
  const requestedEnd = requestedSlot ? Date.parse(requestedSlot.end_iso) : NaN;
  const proposedStart = proposedSlot ? Date.parse(proposedSlot.start_iso) : NaN;
  const proposedEnd = proposedSlot ? Date.parse(proposedSlot.end_iso) : NaN;
  const validRequested = Number.isFinite(requestedStart) && Number.isFinite(requestedEnd) && requestedEnd > requestedStart;
  const validProposed = Number.isFinite(proposedStart) && Number.isFinite(proposedEnd) && proposedEnd > proposedStart;
  const requestedConflicts = validRequested && requestedSlot ? overlappingAppointments(appointments, requestedSlot, excludeIds) : [];
  const proposedConflicts = validProposed && proposedSlot ? overlappingAppointments(appointments, proposedSlot, excludeIds) : [];
  const firstDate = view === "week" ? addDays(anchorDate, -new Date(`${anchorDate}T12:00:00Z`).getUTCDay()) : anchorDate;
  const dates = Array.from({ length: view === "week" ? 7 : 1 }, (_, index) => addDays(firstDate, index));
  const gridColumns = `64px repeat(${dates.length}, minmax(${view === "week" ? "100px" : "250px"}, 1fr))`;
  const timeFormatter = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });
  const today = localDate(new Date().toISOString(), zone);
  // Keep navigation focused on the time that Approve will actually book. The
  // original request remains visible as its own calendar item and summary chip.
  const selectedDate = localDate(proposedSlot?.start_iso ?? requestedSlot?.start_iso ?? "", zone);
  const targetStartIso = validProposed ? proposedSlot?.start_iso ?? null : requestedSlot?.start_iso ?? null;
  const rangeLabel = view === "day"
    ? dayLabel(firstDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : `${dayLabel(firstDate, { month: "short", day: "numeric" })} – ${dayLabel(addDays(firstDate, 6), { month: "short", day: "numeric", year: "numeric" })}`;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
        if (stored === "day" || stored === "week") setView(stored);
      } catch {
        // The calendar still works when browser storage is unavailable.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const target = (validRequested || validProposed) && targetStartIso ? minuteOfDay(targetStartIso, zone) : 9 * 60;
    if (target !== null) scroller.scrollTop = Math.max(0, (target - 120) / 60 * HOUR_HEIGHT);

    // The week can be wider than the decision card on a phone. Center the
    // appointment day so opening the calendar reveals the relevant column.
    if (view === "week") {
      const dayToShow = selectedDate >= firstDate && selectedDate <= addDays(firstDate, 6)
        ? selectedDate : anchorDate;
      const dayIndex = Math.round((new Date(`${dayToShow}T12:00:00Z`).getTime() -
        new Date(`${firstDate}T12:00:00Z`).getTime()) / 86_400_000);
      const dayWidth = (scroller.scrollWidth - 64) / 7;
      const centered = 64 + dayIndex * dayWidth - (scroller.clientWidth - dayWidth) / 2;
      scroller.scrollLeft = Math.max(0, Math.min(scroller.scrollWidth - scroller.clientWidth, centered));
    } else {
      scroller.scrollLeft = 0;
    }
  }, [anchorDate, firstDate, selectedDate, targetStartIso, validProposed, validRequested, view, zone]);

  function selectView(next: CalendarView) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Keep the selected view for this session if browser storage is unavailable.
    }
  }

  function navigate(direction: -1 | 1) {
    setAnchorDate(addDays(anchorDate, direction * (view === "week" ? 7 : 1)));
    setEditing(null);
    setError(null);
  }

  function openEditor(target: EditTarget) {
    if (!preview || (target.kind === "appointment" ? !onRescheduleAppointment : !onProposedSlotChange)) return;
    setEditing(target);
    setDraftDate(localDate(target.slot.start_iso, zone));
    setDraftStart(timeInputValue(target.slot.start_iso, zone));
    setDraftEnd(timeInputValue(target.slot.end_iso, zone));
    setError(null);
    setNotice(null);
  }

  function saveEdit() {
    if (!editing) return;
    const selectedDate = dateInputRef.current?.value ?? draftDate;
    const start = zonedLocalToIso(selectedDate, startInputRef.current?.value ?? draftStart, zone);
    const end = zonedLocalToIso(selectedDate, endInputRef.current?.value ?? draftEnd, zone);
    if (!start || !end) {
      setError("Choose a valid date and time in this calendar’s time zone.");
      return;
    }
    if (Date.parse(end) <= Date.parse(start)) {
      setError("End time must be later than start time on the selected day.");
      return;
    }
    const nextSlot = { start_iso: start, end_iso: end };
    const conflicts = overlappingAppointments(appointments, nextSlot,
      editing.kind === "appointment" ? [editing.id] : excludeIds);
    if (conflicts.length) {
      setError(`That time overlaps ${conflicts.map((item) => item.title).join(", ")}. Choose an open time.`);
      return;
    }
    if (editing.kind === "appointment") onRescheduleAppointment?.(editing.id, nextSlot);
    else onProposedSlotChange?.(nextSlot);
    setAnchorDate(selectedDate);
    setEditing(null);
    setError(null);
    setNotice(editing.kind === "appointment" ? "Sample appointment moved on this calendar." : "Suggested time updated for this decision.");
  }

  function itemsForDate(date: string): CalendarItem[] {
    const items: CalendarItem[] = [];
    for (const appointment of appointments) {
      if (appointment.allDay || ["cancelled", "canceled", "deleted"].includes(appointment.status)) continue;
      const slot = { start_iso: appointment.start_at, end_iso: appointment.end_at };
      if (!(Date.parse(slot.end_iso) > Date.parse(slot.start_iso))) continue;
      const segment = segmentForDay(slot, date, zone);
      if (segment) items.push({ key: `appointment:${appointment.id}`, kind: "appointment", appointmentId: appointment.id, title: appointment.title, slot, ...segment });
    }
    if (validRequested && requestedSlot &&
      (!validProposed || requestedSlot.start_iso !== proposedSlot?.start_iso || requestedSlot.end_iso !== proposedSlot?.end_iso)) {
      const segment = segmentForDay(requestedSlot, date, zone);
      if (segment) items.push({ key: "requested", kind: "requested", title: "Requested time", slot: requestedSlot, ...segment });
    }
    if (validProposed && proposedSlot) {
      const segment = segmentForDay(proposedSlot, date, zone);
      if (segment) items.push({ key: "proposed", kind: "proposed", title: "Suggested time", slot: proposedSlot, ...segment });
    }
    return arrangeItems(items);
  }

  return <section aria-label="Appointment calendar" className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5">
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><CalendarClock aria-hidden="true" className="size-4" /></span>
        <div className="min-w-0"><h3 className="text-sm font-semibold text-slate-900">Calendar</h3><p className="truncate text-xs text-slate-500">{rangeLabel}</p></div>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => navigate(-1)} aria-label={view === "week" ? "Previous week" : "Previous day"} className="flex size-8 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ChevronLeft aria-hidden="true" className="size-4" /></button>
        <button type="button" onClick={() => setAnchorDate(selectedDate || today)} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{validProposed ? "Booking day" : selectedDate ? "Request day" : "Today"}</button>
        <button type="button" onClick={() => navigate(1)} aria-label={view === "week" ? "Next week" : "Next day"} className="flex size-8 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ChevronRight aria-hidden="true" className="size-4" /></button>
      </div>
      <div role="group" aria-label="Calendar view" className="flex rounded-lg bg-slate-100 p-0.5">
        {(["day", "week"] as const).map((choice) => <button key={choice} type="button" aria-pressed={view === choice} onClick={() => selectView(choice)} className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${view === choice ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{choice}</button>)}
      </div>
    </div>

    {(validRequested || validProposed) ? <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
      {validRequested && requestedSlot ? <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${requestedConflicts.length ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}><span className="size-1.5 rounded-full bg-amber-500" />Requested {timeFormatter.format(new Date(requestedSlot.start_iso))}{requestedConflicts.length ? ` · ${requestedConflicts.length} conflict${requestedConflicts.length === 1 ? "" : "s"}` : " · Open"}</span> : null}
      {validProposed && proposedSlot ? <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${proposedConflicts.length ? "bg-red-50 text-red-800" : "bg-blue-50 text-blue-800"}`}><span className={`size-1.5 rounded-full ${proposedConflicts.length ? "bg-red-500" : "bg-blue-500"}`} />Suggested {timeFormatter.format(new Date(proposedSlot.start_iso))}{proposedConflicts.length ? ` · ${proposedConflicts.length} conflict${proposedConflicts.length === 1 ? "" : "s"}` : " · Open"}</span> : null}
    </div> : null}

    <div ref={scrollRef} aria-label={`${view === "week" ? "Weekly" : "Daily"} calendar schedule`} className="max-h-[560px] overflow-auto overscroll-contain">
      <div className={view === "week" ? "min-w-[790px]" : "min-w-[340px]"}>
        <div className="sticky top-0 z-20 grid border-b border-slate-200 bg-white/95 backdrop-blur-sm" style={{ gridTemplateColumns: gridColumns }}>
          <div className="border-r border-slate-100" />
          {dates.map((date) => <div key={date} className={`border-l border-slate-100 px-2 py-2 text-center ${date === today ? "bg-blue-50/60" : ""}`}>
            <span className="block text-[10px] font-medium uppercase tracking-wide text-slate-500">{dayLabel(date, { weekday: "short" })}</span>
            <span className={`mx-auto mt-0.5 flex size-7 items-center justify-center rounded-full text-xs font-semibold ${date === today ? "bg-blue-600 text-white" : "text-slate-800"}`}>{dayLabel(date, { day: "numeric" })}</span>
          </div>)}
        </div>
        {dates.some((date) => appointments.some((appointment) => appointment.allDay && !["cancelled", "canceled", "deleted"].includes(appointment.status) && localDate(appointment.start_at, zone) <= date && localDate(appointment.end_at, zone) >= date)) ?
          <div className="grid border-b border-slate-100 bg-white" style={{ gridTemplateColumns: gridColumns }}>
            <div className="self-center pr-2 text-right text-[10px] text-slate-400">All day</div>
            {dates.map((date) => <div key={date} className="min-h-8 space-y-1 border-l border-slate-100 p-1">{appointments.filter((appointment) => appointment.allDay && !["cancelled", "canceled", "deleted"].includes(appointment.status) && localDate(appointment.start_at, zone) <= date && localDate(appointment.end_at, zone) >= date).map((appointment) => <div key={appointment.id} className="truncate rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-800" title={appointment.title}>{appointment.title}</div>)}</div>)}
          </div> : null}
        <div className="grid" style={{ gridTemplateColumns: gridColumns, height: HOUR_HEIGHT * 24 }}>
          <div className="relative border-r border-slate-100 bg-white">
            {HOURS.map((hour) => <span key={hour} className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-slate-400" style={{ top: hour * HOUR_HEIGHT + 1 }}>{hourLabel(hour)}</span>)}
          </div>
          {dates.map((date) => {
            const items = itemsForDate(date);
            const nowMinute = date === today ? minuteOfDay(new Date().toISOString(), zone) : null;
            return <div key={date} aria-label={dayLabel(date, { weekday: "long", month: "long", day: "numeric" })} className={`relative border-l border-slate-100 ${date === today ? "bg-blue-50/20" : "bg-white"}`} style={{ backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent 23px, #f1f5f9 23px, #f1f5f9 24px, transparent 24px, transparent 47px, #e2e8f0 47px, #e2e8f0 48px)", backgroundSize: `100% ${HOUR_HEIGHT}px` }}>
              {items.map((item) => {
                const editable = preview && (item.kind === "appointment" ? !!onRescheduleAppointment : item.kind === "proposed" && !!onProposedSlotChange);
                const isConflict = item.kind === "requested" ? requestedConflicts.length > 0 : item.kind === "proposed" ? proposedConflicts.length > 0 : false;
                const color = item.kind === "requested" ? "border-amber-300 bg-amber-100/90 text-amber-950" : item.kind === "proposed" ? isConflict ? "border-red-300 bg-red-50 text-red-900" : "border-blue-400 bg-blue-100/95 text-blue-950" : "border-indigo-200 bg-indigo-50/95 text-indigo-950";
                const style = { top: item.start / 60 * HOUR_HEIGHT + 1, height: Math.max(22, (item.end - item.start) / 60 * HOUR_HEIGHT - 2), left: `${((item.lane ?? 0) / (item.lanes ?? 1)) * 100 + 1}%`, width: `${100 / (item.lanes ?? 1) - 2}%` };
                const label = `${item.title}, ${timeFormatter.format(new Date(item.slot.start_iso))} to ${timeFormatter.format(new Date(item.slot.end_iso))}${isConflict ? ", conflict" : ""}${editable ? ", edit time" : ""}`;
                const content = <><span className="block truncate font-semibold">{item.title}</span><span className="block truncate opacity-75">{timeFormatter.format(new Date(item.slot.start_iso))}–{timeFormatter.format(new Date(item.slot.end_iso))}</span></>;
                return editable && item.kind !== "requested"
                  ? <button key={item.key} type="button" aria-label={label} title={label} onClick={() => openEditor(item.kind === "appointment" ? { kind: "appointment", id: item.appointmentId!, title: item.title, slot: item.slot } : { kind: "proposed", slot: item.slot })} className={`absolute z-10 overflow-hidden rounded-md border px-1.5 py-1 text-left text-[10px] leading-tight shadow-sm transition-all hover:brightness-95 focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${color}`} style={style}>{content}</button>
                  : <div key={item.key} aria-label={label} title={label} className={`absolute overflow-hidden rounded-md border px-1.5 py-1 text-[10px] leading-tight shadow-sm ${color}`} style={style}>{content}</div>;
              })}
              {nowMinute !== null ? <div aria-hidden="true" className="pointer-events-none absolute z-20 h-px w-full bg-red-400" style={{ top: nowMinute / 60 * HOUR_HEIGHT }}><span className="absolute -left-1 -top-1 size-2 rounded-full bg-red-400" /></div> : null}
            </div>;
          })}
        </div>
      </div>
    </div>

    {editing ? <div className="border-t border-blue-100 bg-blue-50/45 px-4 py-3 sm:px-5">
      <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Pencil aria-hidden="true" className="size-3.5 text-blue-600" />{editing.kind === "appointment" ? `Move ${editing.title}` : "Adjust suggested time"}</div><button type="button" aria-label="Close time editor" onClick={() => { setEditing(null); setError(null); }} className="rounded-md p-1 text-slate-500 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><X aria-hidden="true" className="size-4" /></button></div>
      <div className="mt-3 flex flex-wrap items-end gap-2.5">
        <label className="text-[11px] font-medium text-slate-600">Date<input ref={dateInputRef} type="date" value={draftDate} onChange={(event) => setDraftDate(event.target.value)} className="mt-1 block h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" /></label>
        <label className="text-[11px] font-medium text-slate-600">Start<input ref={startInputRef} type="time" step={900} value={draftStart} onChange={(event) => setDraftStart(event.target.value)} className="mt-1 block h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" /></label>
        <label className="text-[11px] font-medium text-slate-600">End<input ref={endInputRef} type="time" step={900} value={draftEnd} onChange={(event) => setDraftEnd(event.target.value)} className="mt-1 block h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" /></label>
        <button type="button" onClick={saveEdit} className="h-9 rounded-lg bg-blue-600 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">Save time</button>
      </div>
      {error ? <p role="alert" className="mt-2 text-xs font-medium text-red-700">{error}</p> : null}
      <p className="mt-2 text-[11px] text-slate-500">Times use {zone}. Changes stay in this sample workspace.</p>
    </div> : null}
    {notice && !editing ? <p role="status" className="border-t border-slate-100 px-4 py-2.5 text-xs font-medium text-blue-700 sm:px-5">{notice}</p> : null}
    <div className="flex items-center gap-1.5 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500 sm:px-5"><Clock3 aria-hidden="true" className="size-3" />{preview ? "Choose an appointment or suggested time to adjust it here." : "Calendar items are shown for context. Live changes go through the approval flow."}</div>
  </section>;
}
