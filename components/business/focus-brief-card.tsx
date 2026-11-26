import Link from "next/link";
import { ArrowUpRight, CalendarDays } from "lucide-react";
import type { FocusBrief } from "@/lib/business/focus-brief";

type DocketItem = {
  id: string;
  title: string;
  date: string;
  time?: string | null;
  label: string;
};

function endOfWeek(today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const date = new Date(today + "T12:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== today) return null;
  date.setUTCDate(date.getUTCDate() + (7 - date.getUTCDay()) % 7);
  return date.toISOString().slice(0, 10);
}

export function FocusBriefCard({
  brief,
  upcoming = [],
  today = "",
  timeZone = "UTC",
}: {
  brief: FocusBrief;
  upcoming?: DocketItem[];
  today?: string;
  timeZone?: string;
}) {
  const weekEnd = endOfWeek(today);
  const todayItems = upcoming.filter((item) => item.date === today).slice(0, 2);
  const weekItems = weekEnd ? upcoming.filter((item) => item.date > today && item.date <= weekEnd).slice(0, 2) : [];
  const formatWhen = (item: DocketItem) => {
    const date = new Date(`${item.date}T12:00:00Z`);
    if (!Number.isFinite(date.getTime())) return item.label;
    const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(date);
    if (!item.time || !Number.isFinite(Date.parse(item.time))) return day;
    return `${day} · ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(item.time))}`;
  };

  return (
    <section aria-label="Your docket" className="relative min-w-0 overflow-hidden rounded-[22px] bg-[linear-gradient(135deg,#143f95_0%,#1d56b5_63%,#2a64c4_100%)] px-6 py-5 text-white shadow-[0_14px_34px_-24px_rgba(20,63,149,.8)] sm:px-7 sm:py-6">
      <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-24 size-72 rounded-full border border-white/10" />
      <div className="relative">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-100/85"><CalendarDays aria-hidden="true" className="size-4" /> On your docket</div>
        <p className="mt-3 text-[22px] font-semibold leading-tight tracking-[-0.03em] sm:text-[26px]">{brief.title}</p>
        <p className="mt-1 max-w-[56ch] text-sm leading-6 text-blue-100/85">{brief.description}</p>
        <div className="mt-4 grid gap-4 border-t border-white/20 pt-4 sm:grid-cols-2 sm:gap-7">
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.13em] text-blue-100/75">Today</h2>
            {todayItems.length ? <ul className="mt-2 space-y-2">{todayItems.map((item) => <li key={item.id} className="min-w-0"><span className="block truncate text-sm font-medium">{item.title}</span><span className="block text-xs text-blue-100/75">{item.time && Number.isFinite(Date.parse(item.time)) ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(item.time)) + " · " + item.label : item.label}</span></li>)}</ul> : <p className="mt-2 text-sm text-blue-100/80">No scheduled commitments today.</p>}
          </div>
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.13em] text-blue-100/75">Later this week</h2>
            {weekItems.length ? <ul className="mt-2 space-y-2">{weekItems.map((item) => <li key={item.id} data-upcoming-appointment={item.label === "Appointment" ? "" : undefined} className="min-w-0"><span className="block truncate text-sm font-medium">{item.title}</span><span className="block text-xs text-blue-100/75">{formatWhen(item)} · {item.label}</span></li>)}</ul> : <p className="mt-2 text-sm text-blue-100/80">Nothing else scheduled this week.</p>}
            {!weekItems.length && brief.upcomingAppointment ? <div data-upcoming-appointment className="mt-3 border-t border-white/15 pt-3"><span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-100/70">Next appointment</span><span className="mt-1 block truncate text-sm font-medium">{brief.upcomingAppointment.title}</span><span className="block text-xs text-blue-100/75">{brief.upcomingAppointment.when}</span></div> : null}
          </div>
        </div>
        {brief.link ? <Link href={brief.link.href} className="mt-3 inline-flex min-h-10 items-center gap-1 text-sm font-medium text-white/90 underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">{brief.link.label}<ArrowUpRight aria-hidden="true" className="size-3.5" /></Link> : null}
      </div>
    </section>
  );
}
