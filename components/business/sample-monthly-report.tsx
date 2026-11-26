import Link from "next/link";
import { ArrowLeft, BarChart3, CalendarDays, TrendingUp } from "lucide-react";
import { localDate, type DailyBriefData, type SampleMetricPoint } from "@/lib/business/daily-brief";
import { OwnerAreaHeader } from "./owner-ui";

function priorMonth(value: string, timeZone: string) {
  const [year, month] = localDate(value, timeZone).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1, 12));
  return {
    key: date.toISOString().slice(0, 7),
    label: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(date),
  };
}

function monthlyPoints(points: SampleMetricPoint[], key: string, timeZone: string) {
  return points.filter((point) => localDate(point.at, timeZone).startsWith(key));
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function SampleMonthlyReport({ data }: { data: DailyBriefData }) {
  const month = priorMonth(data.generatedAt, data.timeZone);
  const sales = monthlyPoints(data.sampleMetrics?.sales ?? [], month.key, data.timeZone);
  const total = sales.reduce((sum, point) => sum + point.amount, 0);
  const weekly = Array.from({ length: 5 }, () => 0);
  for (const point of sales) {
    const day = Number(localDate(point.at, data.timeZone).slice(-2));
    weekly[Math.min(4, Math.floor((day - 1) / 7))] += point.amount;
  }
  const max = Math.max(1, ...weekly);

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <OwnerAreaHeader title="Monthly report" />
          <p className="mt-2 text-sm text-slate-500">A quick look at example sales activity for {month.label}.</p>
        </div>
        <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800">Sample data</span>
      </div>

      <section className="mt-7 overflow-hidden rounded-[22px] border border-blue-200/70 bg-gradient-to-br from-[#25499f] to-[#3b66bf] p-6 text-white shadow-[0_18px_42px_-26px_rgba(24,55,134,.55)] sm:p-8" aria-labelledby="sample-sales-heading">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-100"><TrendingUp aria-hidden="true" className="size-4" /> Month in review</div>
        <h2 id="sample-sales-heading" className="mt-5 text-[38px] font-semibold tracking-[-0.055em] tabular-nums sm:text-[46px]">{money.format(total)}</h2>
        <p className="mt-1 text-sm text-blue-100">in example sales during {month.label}</p>
        <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/25 pt-4 text-xs text-blue-100">
          <span className="inline-flex items-center gap-1.5"><CalendarDays aria-hidden="true" className="size-4" /> {month.label}</span>
          <span>{sales.length} recorded {sales.length === 1 ? "sale" : "sales"}</span>
        </div>
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(240px,1fr)]">
        <section className="rounded-[22px] border border-[#e6ebf2] bg-white p-6 shadow-[0_10px_30px_-26px_rgba(27,45,80,.45)]" aria-labelledby="sample-sales-trend">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500"><BarChart3 aria-hidden="true" className="size-4 text-blue-600" /> Sales by week</div>
          <h3 id="sample-sales-trend" className="mt-2 text-lg font-semibold tracking-tight text-slate-900">How the month added up</h3>
          <div className="mt-7 grid grid-cols-5 items-end gap-3 border-b border-slate-200 pb-2" aria-label="Weekly sample sales">
            {weekly.map((amount, index) => <div key={index} className="flex min-w-0 flex-col items-center gap-2">
              <span className="text-[11px] font-medium tabular-nums text-slate-600">{money.format(amount)}</span>
              <span aria-hidden="true" className="w-full rounded-t-md bg-blue-300/80" style={{ height: Math.max(8, Math.round(amount / max * 100)) }} />
            </div>)}
          </div>
          <div className="mt-2 grid grid-cols-5 gap-3 text-center text-[11px] text-slate-500">{weekly.map((_, index) => <span key={index}>Week {index + 1}</span>)}</div>
        </section>
        <section className="rounded-[22px] border border-[#e6ebf2] bg-white p-6 shadow-[0_10px_30px_-26px_rgba(27,45,80,.45)]" aria-labelledby="sample-report-note">
          <h3 id="sample-report-note" className="text-lg font-semibold tracking-tight text-slate-900">What to do next</h3>
          <p className="mt-3 text-sm leading-6 text-slate-600">This is the kind of low-priority update you can open after the morning decisions are handled. The numbers are fictional and no sales account is connected.</p>
          <Link href="/preview" className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ArrowLeft aria-hidden="true" className="size-4" /> Back to Today</Link>
        </section>
      </div>
    </div>
  );
}
