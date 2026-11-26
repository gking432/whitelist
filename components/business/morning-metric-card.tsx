"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { ArrowUpRight, BarChart3 } from "lucide-react";
import type { DailyBriefData } from "@/lib/business/daily-brief";

type Metric = "leads" | "payments" | "outbound_email" | "sales" | "outbound_calls";
type WindowDays = 7 | 30 | 90;
const metrics: { key: Metric; label: string }[] = [
  { key: "leads", label: "New leads" },
  { key: "payments", label: "Recorded payments" },
  { key: "outbound_email", label: "Outbound email threads" },
  { key: "sales", label: "Sales" },
  { key: "outbound_calls", label: "Outbound calls" },
];
const windows: WindowDays[] = [7, 30, 90];
const active = (status: string) => ["connected", "needs_attention"].includes(status);

export function MorningMetricCard({ data, preview = false }: { data: DailyBriefData; preview?: boolean }) {
  const metricId = useId();
  const windowId = useId();
  const storageKey = `meridian:morning-metric:v1:${data.workspace.workspaceScopeKey}`;
  const [metric, setMetric] = useState<Metric>("leads");
  const [days, setDays] = useState<WindowDays>(30);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = JSON.parse(localStorage.getItem(storageKey) || "null") as { metric?: Metric; days?: WindowDays } | null;
        const nextMetric = stored && metrics.some((item) => item.key === stored.metric) ? stored.metric! : "leads";
        const nextDays = stored && windows.includes(stored.days as WindowDays) ? stored.days! : 30;
        setMetric(nextMetric);
        setDays(nextMetric === "outbound_email" && nextDays === 90 ? 30 : nextDays);
      } catch { /* Browser storage may be unavailable. */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  function choose(nextMetric: Metric, nextDays: WindowDays) {
    if (nextMetric === "outbound_email" && nextDays === 90) nextDays = 30;
    setMetric(nextMetric);
    setDays(nextDays);
    try { localStorage.setItem(storageKey, JSON.stringify({ metric: nextMetric, days: nextDays })); } catch { /* Keep the current choice in memory. */ }
  }

  const connected = data.connectedData;
  const end = Date.parse(data.generatedAt);
  const start = end - days * 86400000;
  const inRange = (value: string | null | undefined) => !!value && Number.isFinite(Date.parse(value)) && Date.parse(value) >= start && Date.parse(value) <= end;
  const leadSource = !!connected?.apps.some((app) => active(app.status) && app.provider === "generic_inbound_webhook");
  const paymentSource = !!connected?.apps.some((app) => active(app.status) && app.provider === "stripe");
  const emailSource = !!connected?.apps.some((app) => active(app.status) && ["google_workspace", "microsoft_365"].includes(app.provider));
  const leads = (connected?.leads ?? []).filter((item) => inRange(item.receivedAt));
  const emailThreads = (connected?.messages ?? []).filter((item) => item.direction === "outbound" && inRange(item.receivedAt));
  let value = "—";
  let description = "Connect a source to see this metric.";
  let available = false;
  let points: { at: string | null; amount: number }[] = [];
  const samplePoints = preview ? data.sampleMetrics?.[metric] : undefined;

  if (samplePoints) {
    available = true;
    points = samplePoints.filter((item) => inRange(item.at));
    const total = points.reduce((sum, item) => sum + item.amount, 0);
    value = metric === "sales"
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(total)
      : new Intl.NumberFormat("en-US").format(total);
    description = `Sample ${metrics.find((item) => item.key === metric)?.label.toLowerCase() ?? "activity"} · ${days} days`;
  } else if (metric === "leads" && leadSource) {
    available = true;
    value = String(leads.length);
    description = `Leads in the available connected records · ${days} days`;
    points = leads.map((item) => ({ at: item.receivedAt, amount: 1 }));
  } else if (metric === "leads") {
    description = "Connect an intake source that supplies dated lead events.";
  } else if (metric === "payments") {
    description = paymentSource
      ? "Payment dates are not verified for a time-range total here. Review payment records in Money."
      : "Connect a payment source to view recorded payments.";
  } else if (metric === "outbound_email" && emailSource) {
    available = true;
    value = String(emailThreads.length);
    description = `Outbound threads in available connected records · ${days} days. Email history covers up to 30 days.`;
    points = emailThreads.map((item) => ({ at: item.receivedAt, amount: 1 }));
  } else if (metric === "sales") {
    description = "Sales totals need a connected source that identifies completed sales.";
  } else if (metric === "outbound_calls") {
    description = "Outbound call history is not connected to this workspace yet.";
  }

  const buckets = Array.from({ length: 7 }, () => 0);
  for (const point of points) {
    const at = Date.parse(point.at ?? "");
    if (!Number.isFinite(at)) continue;
    const index = Math.min(6, Math.max(0, Math.floor((at - start) / (days * 86400000) * 7)));
    buckets[index] += point.amount;
  }
  const max = Math.max(1, ...buckets);
  const detailHref = metric === "payments" && paymentSource ? (preview ? "/preview/money" : "/client/money") : (preview ? "/preview/apps" : "/client/apps");
  const detailLabel = metric === "payments" && paymentSource ? "Open Money" : "Explore connections";
  const partial = !preview && !!(connected?.limited || connected?.errors.length || connected?.apps.some((app) =>
    active(app.status) && (app.stale || app.error || app.streams?.some((stream) => stream.status !== "fresh" || stream.partial))));
  return (
    <section aria-label="Business metric" className="min-w-0 rounded-[22px] border border-[#e6ebf2] bg-white px-6 py-5 shadow-[0_10px_30px_-26px_rgba(27,45,80,.45)] sm:px-7 sm:py-6">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500"><BarChart3 aria-hidden="true" className="size-4 text-blue-600" /> Business pulse</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <label htmlFor={metricId} className="sr-only">Metric</label>
        <select id={metricId} value={metric} onChange={(event) => choose(event.target.value as Metric, days)} className="min-h-10 min-w-0 max-w-full flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-800 outline-none transition-colors hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-blue-500">
          {metrics.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
        <label htmlFor={windowId} className="sr-only">Time range</label>
        <select id={windowId} value={days} onChange={(event) => choose(metric, Number(event.target.value) as WindowDays)} className="min-h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition-colors hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-blue-500">
          {windows.map((count) => <option key={count} value={count} disabled={metric === "outbound_email" && count === 90}>{count} days</option>)}
        </select>
      </div>
      <div className="mt-5">
        <p className="text-[34px] font-semibold leading-none tracking-[-0.055em] tabular-nums text-slate-950 sm:text-[40px]">{value}</p>
        <p className="mt-2 min-h-10 text-xs leading-5 text-slate-500">{description}</p>
      </div>
      {available ? <div aria-hidden="true" className="mt-3 flex h-12 items-end gap-1.5 border-b border-slate-100 pb-1">{buckets.map((amount, index) => <div key={index} className="flex-1 rounded-t-[3px] bg-blue-200/80 transition-[height,background-color] duration-200 ease-out hover:bg-blue-400" style={{ height: `${Math.max(10, amount / max * 100)}%` }} />)}</div> : <Link href={detailHref} className="mt-3 inline-flex min-h-11 items-center gap-1 text-xs font-medium text-blue-700 hover:underline">{detailLabel} <ArrowUpRight aria-hidden="true" className="size-3.5" /></Link>}
      {partial ? <p className="mt-3 text-[11px] leading-5 text-amber-700">Some connected records are incomplete; this number may be partial.</p> : null}
    </section>
  );
}
