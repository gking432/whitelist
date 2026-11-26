import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  CreditCard,
  FileText,
  Mail,
  PlugZap,
  UsersRound,
} from "lucide-react";
import { formatMinorMoney } from "@/lib/connections/money";
import { addDays, localDate, validTimeZone, type DailyBriefData } from "@/lib/business/daily-brief";
import { OwnerAreaHeader } from "./owner-ui";

type SampleArea = "calendar" | "money" | "apps";

const card = "rounded-2xl border border-slate-200/80 bg-white shadow-[0_12px_32px_-26px_rgba(15,23,42,0.38)]";
const muted = "text-sm leading-6 text-slate-500";

function formattedDate(value: string, timeZone: string, options: Intl.DateTimeFormatOptions) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: validTimeZone(timeZone) }).format(date);
}

function formattedMoney(value: number | null, currency: string | null) {
  return formatMinorMoney(value, currency) ?? "Amount unavailable";
}

function SampleHeader({ title, description }: { title: string; description: string }) {
  return <div className="flex flex-wrap items-start justify-between gap-4">
    <div>
      <OwnerAreaHeader title={title} />
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>
    </div>
    <span className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800">Sample data</span>
  </div>;
}

function CalendarArea({ data }: { data: DailyBriefData }) {
  const today = localDate(data.generatedAt, data.timeZone);
  const appointments = [...data.appointments].sort((a, b) => a.start_at.localeCompare(b.start_at));
  const days = Array.from({ length: 7 }, (_, index) => addDays(today, index));
  const eventsFor = (day: string) => appointments.filter((appointment) => localDate(appointment.start_at, data.timeZone) === day);
  const next = appointments.find((appointment) => appointment.start_at >= data.generatedAt) ?? appointments[0];
  return <div className="max-w-6xl">
    <SampleHeader title="Calendar" description="See how your appointments and proposed times fit together. These are example events in your workspace." />
    <div className="mt-7 grid items-start gap-5 xl:grid-cols-[minmax(0,1.75fr)_minmax(270px,1fr)]">
      <section className={`${card} overflow-hidden`} aria-labelledby="sample-week-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2.5"><span className="flex size-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><CalendarDays className="size-4" aria-hidden="true" /></span><h2 id="sample-week-heading" className="text-sm font-semibold text-slate-900">Your week</h2></div>
          <span className="text-xs text-slate-500">{formattedDate(`${today}T12:00:00Z`, "UTC", { month: "long", day: "numeric", year: "numeric" })}</span>
        </div>
        <div className="overflow-x-auto px-3 py-4 sm:px-4">
          <div className="grid min-w-[650px] grid-cols-7 gap-2">
            {days.map((day, index) => {
              const events = eventsFor(day);
              return <div id={`sample-day-${day}`} key={day} className={`min-h-36 rounded-xl border p-2.5 ${index === 0 ? "border-blue-200 bg-blue-50/60" : "border-slate-100 bg-slate-50/65"}`}>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{formattedDate(`${day}T12:00:00Z`, "UTC", { weekday: "short" })}</p>
                <p className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{day.slice(-2).replace(/^0/, "")}</p>
                <div className="mt-3 space-y-1.5">{events.slice(0, 2).map((event) => <span key={event.id} className="block rounded-md bg-white px-2 py-1.5 text-[10px] font-medium leading-4 text-slate-700 shadow-sm"><span className="block text-blue-700">{formattedDate(event.start_at, data.timeZone, { hour: "numeric", minute: "2-digit" })}</span><span className="line-clamp-2">{event.title}</span></span>)}{events.length > 2 ? <span className="block px-1 text-[10px] text-slate-500">+{events.length - 2} more</span> : null}</div>
              </div>;
            })}
          </div>
        </div>
      </section>
      <section className={`${card} p-5 sm:p-6`} aria-labelledby="sample-next-appointment">
        <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Clock3 className="size-4" aria-hidden="true" /></div>
        <h2 id="sample-next-appointment" className="mt-4 text-sm font-semibold text-slate-900">Next appointment</h2>
        {next ? <><p className="mt-3 text-lg font-semibold tracking-tight text-slate-900">{next.title}</p><p className="mt-2 text-sm text-slate-600">{formattedDate(next.start_at, data.timeZone, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}</p><p className="mt-1 text-xs text-slate-500">{next.sourceAccount || "Example calendar"}</p><div className="mt-5 border-t border-slate-100 pt-4"><p className="text-xs leading-5 text-slate-500">A proposed time can be checked beside existing appointments from the Today action.</p><Link href="/preview" className="mt-3 inline-flex min-h-10 items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-900">Open Today <ArrowRight aria-hidden="true" className="size-3.5" /></Link></div></> : <p className={`mt-3 ${muted}`}>No example appointments yet.</p>}
      </section>
    </div>
    <section className={`${card} mt-5 p-5 sm:p-6`} aria-labelledby="sample-appointment-list">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="sample-appointment-list" className="text-sm font-semibold text-slate-900">Upcoming appointments</h2><span className="text-xs text-slate-500">{appointments.length} sample {appointments.length === 1 ? "event" : "events"}</span></div>
      <div className="mt-3 divide-y divide-slate-100">{appointments.map((appointment) => <article key={appointment.id} className="flex flex-wrap items-start justify-between gap-3 py-4"><div className="min-w-0"><p className="text-sm font-medium text-slate-900">{appointment.title}</p><p className="mt-1 text-xs text-slate-500">{appointment.sourceAccount || "Example calendar"}{appointment.status === "proposed" ? " · Proposed" : ""}</p></div><p className="text-xs font-medium text-slate-600">{formattedDate(appointment.start_at, data.timeZone, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p></article>)}{!appointments.length ? <p className="py-5 text-sm text-slate-500">No sample appointments to show.</p> : null}</div>
    </section>
  </div>;
}

function MoneyArea({ data }: { data: DailyBriefData }) {
  const invoices = [...(data.connectedData?.invoices ?? [])].sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
  const payments = [...(data.connectedData?.payments ?? [])].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const open = invoices.filter((invoice) => ["open", "past_due"].includes(invoice.status));
  const pastDue = open.filter((invoice) => invoice.status === "past_due");
  const currency = invoices.find((invoice) => invoice.currency)?.currency ?? "USD";
  const outstanding = open.filter((invoice) => invoice.currency === currency).reduce((sum, invoice) => sum + (invoice.amountDueMinor ?? 0), 0);
  const paid = payments.filter((payment) => payment.currency === currency && payment.status === "succeeded").reduce((sum, payment) => sum + (payment.amountMinor ?? 0), 0);
  const multipleCurrencies = open.some((invoice) => invoice.currency !== currency);
  return <div className="max-w-6xl">
    <SampleHeader title="Money" description="A simple view of invoices and payments. Example records show how financial work will appear here." />
    <div className="mt-7 grid gap-4 sm:grid-cols-3">
      <div className={`${card} p-5`}><div className="flex size-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><FileText className="size-4" aria-hidden="true" /></div><p className="mt-4 text-xs text-slate-500">Open invoices</p><p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{open.length}</p><p className="mt-1 text-xs text-slate-500">{multipleCurrencies ? "Several currencies" : `${formattedMoney(outstanding, currency)} outstanding`}</p></div>
      <div className={`${card} p-5`}><div className="flex size-9 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><Clock3 className="size-4" aria-hidden="true" /></div><p className="mt-4 text-xs text-slate-500">Past due</p><p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{pastDue.length}</p><p className="mt-1 text-xs text-slate-500">Follow-up stays visible on Today</p></div>
      <div className={`${card} p-5`}><div className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><CreditCard className="size-4" aria-hidden="true" /></div><p className="mt-4 text-xs text-slate-500">Sample payments</p><p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{formattedMoney(paid, currency)}</p><p className="mt-1 text-xs text-slate-500">From {payments.length} example {payments.length === 1 ? "record" : "records"}</p></div>
    </div>
    <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,1fr)]">
      <section className={`${card} p-5 sm:p-6`} aria-labelledby="sample-invoices"><div className="flex items-center justify-between gap-3"><h2 id="sample-invoices" className="text-sm font-semibold text-slate-900">Invoices</h2><span className="text-xs text-slate-500">{invoices.length} example records</span></div><div className="mt-3 divide-y divide-slate-100">{invoices.map((invoice) => <article key={invoice.id} className="flex flex-wrap items-start justify-between gap-3 py-4"><div><p className="text-sm font-medium text-slate-900">{invoice.number || "Invoice"}</p><p className="mt-1 text-xs text-slate-500">{invoice.account} · Due {invoice.dueAt ? formattedDate(invoice.dueAt, data.timeZone, { month: "short", day: "numeric" }) : "date unavailable"}</p></div><div className="text-right"><p className="text-sm font-semibold text-slate-900">{formattedMoney(invoice.amountDueMinor, invoice.currency)}</p><span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${invoice.status === "past_due" ? "bg-amber-50 text-amber-800" : invoice.status === "paid" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{invoice.status.replaceAll("_", " ")}</span></div></article>)}{!invoices.length ? <p className="py-5 text-sm text-slate-500">No sample invoices to show.</p> : null}</div></section>
      <section className={`${card} p-5 sm:p-6`} aria-labelledby="sample-payments"><h2 id="sample-payments" className="text-sm font-semibold text-slate-900">Recent payments</h2><div className="mt-3 divide-y divide-slate-100">{payments.map((payment) => <article key={payment.id} className="flex items-start justify-between gap-3 py-4"><div><p className="text-sm font-medium text-slate-900">{payment.account}</p><p className="mt-1 text-xs text-slate-500">{payment.updatedAt ? formattedDate(payment.updatedAt, data.timeZone, { month: "short", day: "numeric" }) : "Date unavailable"} · {payment.status.replaceAll("_", " ")}</p></div><p className="text-sm font-semibold text-slate-900">{formattedMoney(payment.amountMinor, payment.currency)}</p></article>)}{!payments.length ? <p className="py-5 text-sm text-slate-500">No sample payments to show.</p> : null}</div><Link href="/preview" className="mt-4 inline-flex min-h-10 items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-900">Review next steps on Today <ArrowRight aria-hidden="true" className="size-3.5" /></Link></section>
    </div>
  </div>;
}

const appIcons: Record<string, typeof Mail> = {
  google_workspace: Mail,
  microsoft_365: Mail,
  hubspot: UsersRound,
  stripe: CreditCard,
  generic_inbound_webhook: PlugZap,
};

function AppsArea({ data }: { data: DailyBriefData }) {
  const apps = data.connectedData?.apps ?? [];
  const sampleLinks: Record<string, { href: string; label: string }> = {
    google_workspace: { href: "/preview/messages", label: "Browse sample messages" },
    microsoft_365: { href: "/preview/calendar", label: "Browse sample calendar" },
    hubspot: { href: "/preview", label: "See customer work on Today" },
    stripe: { href: "/preview/money", label: "Browse sample money" },
    generic_inbound_webhook: { href: "/preview/messages", label: "Browse sample inquiries" },
  };
  return <div className="max-w-6xl">
    <SampleHeader title="Apps & connections" description="See where your business information could come together. Every account below is an example; no real account is connected." />
    <div className={`${card} mt-7 flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-white to-blue-50/40 p-5 sm:p-6`}><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-700">In this sample workspace</p><h2 className="mt-2 text-lg font-semibold tracking-tight text-slate-900">Your tools, one view</h2><p className="mt-1 text-sm leading-6 text-slate-500">Explore example messages, appointments, customers, and money records across Meridian.</p></div><Link href="/preview" className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-xs font-medium text-white transition-colors hover:bg-slate-700">Go to Today <ArrowRight aria-hidden="true" className="size-3.5" /></Link></div>
    <div className="mt-5 grid gap-4 md:grid-cols-2">{apps.map((app) => {
      const Icon = appIcons[app.provider] ?? PlugZap;
      const link = sampleLinks[app.provider];
      return <article key={app.id} className={`${card} p-5 sm:p-6`}><div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Icon className="size-[18px]" aria-hidden="true" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-slate-900">{app.name}</h2><span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600"><Check className="size-3" aria-hidden="true" /> Example</span></div><p className="mt-1 truncate text-xs text-slate-500">{app.account || "Sample account"}</p></div></div><div className="mt-5 border-t border-slate-100 pt-4"><p className="text-xs font-medium text-slate-700">Example information</p><p className="mt-1 text-xs leading-5 text-slate-500">{app.capabilities?.length ? app.capabilities.slice(0, 3).join(" · ") : app.streams?.map((stream) => stream.key.replaceAll("_", " ")).join(" · ") || "Records in your workspace"}</p>{link ? <Link href={link.href} className="mt-3 inline-flex min-h-10 items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-900">{link.label}<ArrowRight aria-hidden="true" className="size-3.5" /></Link> : null}</div></article>;
    })}{!apps.length ? <p className={`${card} p-5 text-sm text-slate-500`}>No example apps to show.</p> : null}</div>
    <p className="mt-5 text-xs leading-5 text-slate-500">Connecting a real account requires a private owner workspace and your authorization.</p>
  </div>;
}

export function SampleSourceArea({ area, data }: { area: SampleArea; data: DailyBriefData }) {
  if (area === "calendar") return <CalendarArea data={data} />;
  if (area === "money") return <MoneyArea data={data} />;
  return <AppsArea data={data} />;
}
