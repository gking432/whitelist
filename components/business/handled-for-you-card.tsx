import Link from "next/link";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import type { DailyBriefData } from "@/lib/business/daily-brief";

export function HandledForYouCard({ data, preview = false }: { data: DailyBriefData; preview?: boolean }) {
  const completed = data.work.filter((item) => item.status === "completed")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 3);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: data.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return <section aria-labelledby="handled-for-you-heading" className="min-w-0 rounded-[22px] border border-[#e6ebf2] bg-white px-6 py-6 shadow-[0_10px_30px_-26px_rgba(27,45,80,.45)] sm:px-7 sm:py-7">
    <div className="flex items-start justify-between gap-4">
      <div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Meridian at work</p><h2 id="handled-for-you-heading" className="mt-2 text-lg font-semibold tracking-[-0.025em] text-slate-900">Handled for you</h2></div>
      <CheckCircle2 aria-hidden="true" className="mt-1 size-5 text-blue-500" />
    </div>
    {completed.length ? <ul className="mt-4 divide-y divide-slate-100">{completed.map((item) => <li key={item.id} className="py-3 first:pt-0 last:pb-0"><p className="line-clamp-1 text-sm font-medium text-slate-800">{item.title}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{item.summary || "Assignment completed."}</p>{Number.isFinite(Date.parse(item.updated_at)) ? <time dateTime={item.updated_at} className="mt-1 block text-[11px] tabular-nums text-slate-400">{time.format(new Date(item.updated_at))}</time> : null}</li>)}</ul> : <p className="mt-4 text-sm leading-6 text-slate-500">Completed agent work will appear here as it is recorded.</p>}
    <Link href={preview ? "/preview/todo" : "/client/todo"} className="mt-4 inline-flex min-h-11 items-center gap-1 text-xs font-medium text-blue-700 hover:underline">See activity <ArrowUpRight aria-hidden="true" className="size-3.5" /></Link>
  </section>;
}
