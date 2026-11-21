"use client";

import { useMemo, useState } from "react";
import {
  BarChart3,
  CircleDollarSign,
  Filter,
  Lightbulb,
  Megaphone,
  Star,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import {
  buildMarketingAnalytics,
  marketingSourceLabel,
  type MarketingAppointment,
  type MarketingContact,
  type MarketingDateRange,
  type MarketingFeedback,
  type MarketingLead,
} from "@/lib/crm/marketing-analytics";
import { cn } from "@/lib/utils";

type MarketingView = "overview" | "sources" | "reputation";
type PaidMediaSummary = {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
};

const RANGE_LABELS: Record<MarketingDateRange, string> = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "365d": "Last 12 months",
  all: "All time",
};

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function when(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown time"
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date);
}

function Metric({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof TrendingUp;
}) {
  return (
    <div className="min-w-0 border-b px-4 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
        {detail}
      </p>
    </div>
  );
}

function EmptyMarketing() {
  return (
    <section className="grid min-h-64 place-items-center rounded-lg border bg-card px-6 py-10 text-center">
      <div>
        <BarChart3
          className="mx-auto size-6 text-muted-foreground"
          aria-hidden="true"
        />
        <h2 className="mt-3 text-sm font-semibold">
          Marketing analytics will appear here
        </h2>
        <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
          Lead sources, conversions, revenue attribution, and reputation
          trends populate automatically as real customer activity enters the
          CRM.
        </p>
      </div>
    </section>
  );
}

export function MarketingAnalyticsDashboard({
  contacts,
  leads,
  appointments,
  feedback,
  campaigns,
}: {
  contacts: MarketingContact[];
  leads: MarketingLead[];
  appointments: MarketingAppointment[];
  feedback: MarketingFeedback[];
  campaigns: Record<string, unknown>[];
}) {
  const [range, setRange] = useState<MarketingDateRange>("90d");
  const [source, setSource] = useState("all");
  const [activeView, setActiveView] = useState<MarketingView>("overview");
  const analytics = useMemo(
    () =>
      buildMarketingAnalytics({
        contacts,
        leads,
        appointments,
        feedback,
        range,
        selectedSource: source,
      }),
    [appointments, contacts, feedback, leads, range, source],
  );
  const hasData =
    analytics.leadCount > 0 ||
    analytics.reviewCount > 0 ||
    analytics.appointmentCount > 0 ||
    campaigns.length > 0;
  const paidMedia = useMemo(
    () =>
      campaigns.reduce<PaidMediaSummary>(
        (summary, campaign) => ({
          spend: summary.spend + Number(campaign.spend ?? 0),
          impressions:
            summary.impressions + Number(campaign.impressions ?? 0),
          clicks: summary.clicks + Number(campaign.clicks ?? 0),
          conversions:
            summary.conversions + Number(campaign.conversions ?? 0),
          conversionValue:
            summary.conversionValue +
            Number(campaign.conversion_value ?? 0),
        }),
        {
          spend: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          conversionValue: 0,
        },
      ),
    [campaigns],
  );
  const maxTrend = Math.max(
    1,
    ...analytics.trend.map((point) => point.leads),
  );
  const maxFunnel = Math.max(
    1,
    ...analytics.funnel.map((step) => step.value),
  );
  const sentimentTotal = Math.max(analytics.reviewCount, 1);
  const mixedReviewCount = Math.max(
    analytics.reviewCount -
      analytics.positiveReviewCount -
      analytics.negativeReviewCount,
    0,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 overflow-x-auto">
          {(
            [
              ["overview", "Overview"],
              ["sources", "Acquisition"],
              ["reputation", "Reputation"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveView(key)}
              className={cn(
                "min-h-9 whitespace-nowrap border-b-2 px-4 text-xs font-medium",
                activeView === key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative">
            <Filter
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Select
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="min-w-44 pl-8"
              aria-label="Marketing source"
            >
              <option value="all">All sources</option>
              {analytics.availableSources.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
          <Select
            value={range}
            onChange={(event) =>
              setRange(event.target.value as MarketingDateRange)
            }
            className="min-w-40"
            aria-label="Date range"
          >
            {Object.entries(RANGE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {!hasData ? (
        <EmptyMarketing />
      ) : (
        <>
          {activeView === "overview" ? (
            <>
              <section className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2 xl:grid-cols-5">
                <Metric
                  label="Attributed leads"
                  value={analytics.leadCount}
                  detail={RANGE_LABELS[range]}
                  icon={Users}
                />
                <Metric
                  label="Appointments"
                  value={analytics.appointmentCount}
                  detail="Booked or completed"
                  icon={Target}
                />
                <Metric
                  label="Won customers"
                  value={analytics.wonCount}
                  detail={`${analytics.conversionRate}% lead conversion`}
                  icon={TrendingUp}
                />
                <Metric
                  label="Estimated revenue"
                  value={compactNumber(analytics.estimatedRevenue)}
                  detail="Based on won opportunity values"
                  icon={CircleDollarSign}
                />
                <Metric
                  label="Average rating"
                  value={
                    analytics.averageRating === null
                      ? "No data"
                      : analytics.averageRating.toFixed(1)
                  }
                  detail={`${analytics.reviewCount} customer reviews`}
                  icon={Star}
                />
              </section>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.7fr)]">
                <section className="overflow-hidden rounded-lg border bg-card">
                  <div className="border-b px-5 py-4">
                    <h2 className="text-sm font-semibold">
                      Lead and conversion trend
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Attributed lead volume across the selected period
                    </p>
                  </div>
                  <div className="grid h-64 grid-cols-8 items-end gap-2 px-5 pb-5 pt-8">
                    {analytics.trend.map((point) => (
                      <div
                        key={point.label}
                        className="flex h-full min-w-0 flex-col justify-end"
                      >
                        <div className="relative flex flex-1 items-end justify-center gap-1">
                          <div
                            className="w-full max-w-8 rounded-t-sm bg-primary/75"
                            style={{
                              height: `${Math.max(
                                (point.leads / maxTrend) * 100,
                                point.leads > 0 ? 6 : 1,
                              )}%`,
                            }}
                            title={`${point.leads} leads`}
                          />
                          <div
                            className="w-full max-w-3 rounded-t-sm bg-amber-500"
                            style={{
                              height: `${Math.max(
                                (point.won / maxTrend) * 100,
                                point.won > 0 ? 6 : 1,
                              )}%`,
                            }}
                            title={`${point.won} won`}
                          />
                        </div>
                        <p className="mt-2 truncate text-center text-[9px] text-muted-foreground">
                          {point.label}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-4 border-t px-5 py-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 bg-primary/75" />
                      Leads
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 bg-amber-500" />
                      Won
                    </span>
                  </div>
                </section>

                <section className="rounded-lg border bg-card px-5 py-4">
                  <h2 className="text-sm font-semibold">Conversion funnel</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Progress from inquiry to customer
                  </p>
                  <div className="mt-5 space-y-4">
                    {analytics.funnel.map((step) => (
                      <div key={step.label}>
                        <div className="flex items-center justify-between text-xs">
                          <span>{step.label}</span>
                          <span className="font-medium tabular-nums">
                            {step.value}
                          </span>
                        </div>
                        <div className="mt-1.5 h-2 overflow-hidden rounded-sm bg-secondary">
                          <div
                            className="h-full bg-primary"
                            style={{
                              width: `${Math.max(
                                (step.value / maxFunnel) * 100,
                                step.value > 0 ? 3 : 0,
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <section className="overflow-hidden rounded-lg border bg-card">
                <div className="border-b px-5 py-4">
                  <div className="flex items-center gap-2">
                    <Lightbulb
                      className="size-4 text-primary"
                      aria-hidden="true"
                    />
                    <h2 className="text-sm font-semibold">
                      Marketing insights
                    </h2>
                  </div>
                </div>
                {analytics.insights.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-muted-foreground">
                    Insights appear after enough attributed activity is
                    recorded.
                  </p>
                ) : (
                  <div className="divide-y">
                    {analytics.insights.map((insight) => (
                      <p
                        key={insight}
                        className="px-5 py-3 text-sm leading-6"
                      >
                        {insight}
                      </p>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : null}

          {activeView === "sources" ? (
            <div className="space-y-5">
              <section className="flex flex-col gap-3 border-y bg-secondary/20 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">
                    {campaigns.length > 0
                      ? "Paid-media performance"
                      : "Paid-media cost data is not connected"}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {campaigns.length > 0
                      ? "Latest synced 30-day window from connected ad platforms."
                      : "Lead, conversion, and estimated revenue attribution are available now. Cost per lead and true ROI appear after an ad platform or spend feed is connected."}
                  </p>
                </div>
                <Badge variant="outline">
                  {campaigns.length > 0
                    ? `${campaigns.length} campaigns`
                    : "Attribution active"}
                </Badge>
              </section>

              {campaigns.length > 0 ? (
                <section className="overflow-hidden rounded-lg border bg-card">
                  <div className="grid border-b sm:grid-cols-4">
                    <Metric label="Ad spend" value={money(paidMedia.spend)} detail="Latest provider window" icon={CircleDollarSign} />
                    <Metric label="Impressions" value={compactNumber(paidMedia.impressions)} detail="Latest provider window" icon={Megaphone} />
                    <Metric label="Clicks" value={compactNumber(paidMedia.clicks)} detail={paidMedia.impressions > 0 ? `${((paidMedia.clicks / paidMedia.impressions) * 100).toFixed(1)}% click rate` : "No impressions"} icon={Target} />
                    <Metric label="Platform conversions" value={paidMedia.conversions.toFixed(1)} detail={`${money(paidMedia.conversionValue)} reported value`} icon={Users} />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[42rem] text-left text-xs">
                      <thead className="border-b bg-secondary/30 text-[10px] uppercase text-muted-foreground"><tr><th className="px-5 py-3">Campaign</th><th className="px-4 py-3">Source</th><th className="px-4 py-3 text-right">Spend</th><th className="px-4 py-3 text-right">Clicks</th><th className="px-5 py-3 text-right">Conversions</th></tr></thead>
                      <tbody className="divide-y">
                        {campaigns.slice(0, 20).map((campaign) => (
                          <tr key={String(campaign.id)}>
                            <td className="px-5 py-3 font-medium">{String(campaign.name ?? "Campaign")}</td>
                            <td className="px-4 py-3 text-muted-foreground">{marketingSourceLabel(String(campaign.source ?? "unknown"))}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{money(Number(campaign.spend ?? 0))}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{compactNumber(Number(campaign.clicks ?? 0))}</td>
                            <td className="px-5 py-3 text-right tabular-nums">{Number(campaign.conversions ?? 0).toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              <section className="overflow-hidden rounded-lg border bg-card">
                <div className="border-b px-5 py-4">
                  <h2 className="text-sm font-semibold">
                    Source performance
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Acquisition quality from first touch through won customer
                  </p>
                </div>
                {analytics.sources.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No attributed sources in this period.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[44rem] text-left text-xs">
                      <thead className="border-b bg-secondary/30 text-[10px] uppercase text-muted-foreground">
                        <tr>
                          <th className="px-5 py-3 font-semibold">Source</th>
                          <th className="px-4 py-3 text-right font-semibold">
                            Leads
                          </th>
                          <th className="px-4 py-3 text-right font-semibold">
                            Appointments
                          </th>
                          <th className="px-4 py-3 text-right font-semibold">
                            Won
                          </th>
                          <th className="px-4 py-3 text-right font-semibold">
                            Conversion
                          </th>
                          <th className="px-5 py-3 text-right font-semibold">
                            Est. revenue
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {analytics.sources.map((item) => (
                          <tr key={item.source}>
                            <td className="px-5 py-3 font-medium">
                              {item.label}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {item.leads}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {item.appointments}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {item.won}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {item.conversionRate}%
                            </td>
                            <td className="px-5 py-3 text-right font-medium tabular-nums">
                              {money(item.estimatedRevenue)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          ) : null}

          {activeView === "reputation" ? (
            <div className="space-y-5">
              <section className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  label="Average rating"
                  value={
                    analytics.averageRating === null
                      ? "No data"
                      : analytics.averageRating.toFixed(1)
                  }
                  detail={`${analytics.reviewCount} reviews`}
                  icon={Star}
                />
                <Metric
                  label="Positive"
                  value={analytics.positiveReviewCount}
                  detail={`${Math.round(
                    (analytics.positiveReviewCount / sentimentTotal) * 100,
                  )}% of feedback`}
                  icon={TrendingUp}
                />
                <Metric
                  label="Negative"
                  value={analytics.negativeReviewCount}
                  detail={`${Math.round(
                    (analytics.negativeReviewCount / sentimentTotal) * 100,
                  )}% of feedback`}
                  icon={Megaphone}
                />
                <Metric
                  label="Needs follow-up"
                  value={analytics.highRiskReviewCount}
                  detail="High or urgent reputation risk"
                  icon={Target}
                />
              </section>

              <div className="grid gap-5 xl:grid-cols-[minmax(18rem,0.7fr)_minmax(0,1.3fr)]">
                <section className="rounded-lg border bg-card px-5 py-4">
                  <h2 className="text-sm font-semibold">Sentiment mix</h2>
                  <div className="mt-5 space-y-5">
                    {[
                      [
                        "Positive",
                        analytics.positiveReviewCount,
                        "bg-emerald-600",
                      ],
                      ["Mixed", mixedReviewCount, "bg-amber-500"],
                      [
                        "Negative",
                        analytics.negativeReviewCount,
                        "bg-red-600",
                      ],
                    ].map(([label, value, color]) => (
                      <div key={String(label)}>
                        <div className="flex justify-between text-xs">
                          <span>{label}</span>
                          <span className="tabular-nums">{value}</span>
                        </div>
                        <div className="mt-1.5 h-2 overflow-hidden rounded-sm bg-secondary">
                          <div
                            className={cn("h-full", color)}
                            style={{
                              width: `${(Number(value) / sentimentTotal) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="overflow-hidden rounded-lg border bg-card">
                  <div className="border-b px-5 py-4">
                    <h2 className="text-sm font-semibold">Recent reputation</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Reviews and customer feedback analyzed for sentiment and
                      risk
                    </p>
                  </div>
                  {analytics.recentFeedback.length === 0 ? (
                    <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                      No customer feedback in this period.
                    </p>
                  ) : (
                    <div className="divide-y">
                      {analytics.recentFeedback.map((item) => (
                        <article key={item.id} className="px-5 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">
                              {item.rating ? `${item.rating}/5` : "Unrated"}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={cn(
                                item.sentiment === "positive" &&
                                  "border-emerald-200 bg-emerald-50 text-emerald-800",
                                item.sentiment === "negative" &&
                                  "border-red-200 bg-red-50 text-red-800",
                              )}
                            >
                              {item.sentiment}
                            </Badge>
                            {["high", "urgent"].includes(item.risk_level) ? (
                              <Badge
                                variant="outline"
                                className="border-red-200 bg-red-50 text-red-800"
                              >
                                {item.risk_level} risk
                              </Badge>
                            ) : null}
                            <span className="text-[11px] text-muted-foreground">
                              {item.source.replaceAll("_", " ")} |{" "}
                              {when(item.created_at)}
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-6">
                            {item.summary}
                          </p>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
