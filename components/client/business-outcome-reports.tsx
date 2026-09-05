"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  CalendarCheck,
  CheckCircle2,
  CircleDollarSign,
  FileCheck2,
  Lightbulb,
  MessageSquareText,
  Target,
  TrendingUp,
  Workflow,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import {
  buildBusinessReport,
  type BusinessReportRange,
  type ReportingAppointment,
  type ReportingCall,
  type ReportingCommunication,
  type ReportingLead,
  type ReportingQuote,
  type ReportingTimelineEntry,
  type ReportingWorkflow,
  type ReportingWorkflowRun,
} from "@/lib/crm/business-reporting";
import { cn } from "@/lib/utils";

type ReportView = "executive" | "sales" | "automation";

const RANGE_LABELS: Record<BusinessReportRange, string> = {
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

function compactMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
}

function formatTime(value: string | null): string {
  if (!value) return "No activity";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown time"
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
}

function ReportMetric({
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

function EmptyReport() {
  return (
    <section className="grid min-h-64 place-items-center rounded-lg border bg-card px-6 py-10 text-center">
      <div>
        <Activity
          className="mx-auto size-6 text-muted-foreground"
          aria-hidden="true"
        />
        <h2 className="mt-3 text-sm font-semibold">
          Business outcomes will appear here
        </h2>
        <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
          Sales, appointments, customer interactions, quotes, and automation
          results populate automatically from real activity.
        </p>
      </div>
    </section>
  );
}

export function BusinessOutcomeReports({
  leads,
  appointments,
  communications,
  calls,
  quotes,
  workflows,
  workflowRuns,
  timeline,
}: {
  leads: ReportingLead[];
  appointments: ReportingAppointment[];
  communications: ReportingCommunication[];
  calls: ReportingCall[];
  quotes: ReportingQuote[];
  workflows: ReportingWorkflow[];
  workflowRuns: ReportingWorkflowRun[];
  timeline: ReportingTimelineEntry[];
}) {
  const [range, setRange] = useState<BusinessReportRange>("90d");
  const [activeView, setActiveView] = useState<ReportView>("executive");
  const report = useMemo(
    () =>
      buildBusinessReport({
        leads,
        appointments,
        communications,
        calls,
        quotes,
        workflows,
        workflowRuns,
        timeline,
        range,
      }),
    [
      appointments,
      calls,
      communications,
      leads,
      quotes,
      range,
      timeline,
      workflowRuns,
      workflows,
    ],
  );
  const hasData =
    report.leadCount > 0 ||
    report.appointmentCount > 0 ||
    report.communicationCount > 0 ||
    report.callCount > 0 ||
    report.workflowRunCount > 0;
  const trendMax = Math.max(
    1,
    ...report.trend.flatMap((point) => [
      point.leads,
      point.won,
      point.automationSuccesses,
    ]),
  );
  const stageMax = Math.max(1, ...report.stages.map((stage) => stage.value));

  return (
    <div className="min-w-0 max-w-full space-y-5 overflow-x-hidden">
      <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center">
        <div className="grid w-full grid-cols-3 sm:flex sm:w-auto sm:shrink-0">
          {(
            [
              ["executive", "Executive"],
              ["sales", "Sales"],
              ["automation", "AI operations"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveView(key)}
              className={cn(
                "min-h-9 whitespace-nowrap border-b-2 px-2 text-xs font-medium sm:px-4",
                activeView === key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Select
          value={range}
          onChange={(event) =>
            setRange(event.target.value as BusinessReportRange)
          }
          className="w-full sm:ml-auto sm:w-44 sm:shrink-0"
          aria-label="Report date range"
        >
          {Object.entries(RANGE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      {!hasData ? (
        <EmptyReport />
      ) : (
        <>
          {activeView === "executive" ? (
            <>
              <section className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2 xl:grid-cols-5">
                <ReportMetric
                  label="Estimated won value"
                  value={compactMoney(report.estimatedWonValue)}
                  detail={`${report.wonCount} won customers`}
                  icon={CircleDollarSign}
                />
                <ReportMetric
                  label="Open pipeline"
                  value={compactMoney(report.estimatedPipelineValue)}
                  detail={`${report.openPipelineCount} opportunities`}
                  icon={TrendingUp}
                />
                <ReportMetric
                  label="Lead conversion"
                  value={`${report.conversionRate}%`}
                  detail={`${report.wonCount} won of ${report.leadCount}`}
                  icon={Target}
                />
                <ReportMetric
                  label="Appointments"
                  value={report.appointmentCount}
                  detail={`${report.completedAppointmentCount} completed`}
                  icon={CalendarCheck}
                />
                <ReportMetric
                  label="Automation success"
                  value={
                    report.workflowSuccessRate === null
                      ? "No data"
                      : `${report.workflowSuccessRate}%`
                  }
                  detail={`${report.workflowSuccessCount} successful runs`}
                  icon={Workflow}
                />
              </section>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.7fr)]">
                <section className="overflow-hidden rounded-lg border bg-card">
                  <div className="border-b px-5 py-4">
                    <h2 className="text-sm font-semibold">Outcome trend</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Sales and automation results during the selected period
                    </p>
                  </div>
                  <div className="grid h-64 grid-cols-8 items-end gap-2 px-5 pb-5 pt-8">
                    {report.trend.map((point) => (
                      <div
                        key={point.label}
                        className="flex h-full min-w-0 flex-col justify-end"
                      >
                        <div className="flex flex-1 items-end justify-center gap-1">
                          {[
                            [point.leads, "bg-primary/75", "leads"],
                            [point.won, "bg-amber-500", "won"],
                            [
                              point.automationSuccesses,
                              "bg-emerald-500",
                              "automation successes",
                            ],
                          ].map(([value, color, label]) => (
                            <div
                              key={String(label)}
                              className={cn(
                                "w-full max-w-5 rounded-t-sm",
                                color,
                              )}
                              style={{
                                height: `${Math.max(
                                  (Number(value) / trendMax) * 100,
                                  Number(value) > 0 ? 6 : 1,
                                )}%`,
                              }}
                              title={`${value} ${label}`}
                            />
                          ))}
                        </div>
                        <p className="mt-2 truncate text-center text-[9px] text-muted-foreground">
                          {point.label}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-4 border-t px-5 py-3 text-[11px] text-muted-foreground">
                    {[
                      ["bg-primary/75", "Leads"],
                      ["bg-amber-500", "Won"],
                      ["bg-emerald-500", "Automation successes"],
                    ].map(([color, label]) => (
                      <span key={label} className="flex items-center gap-1.5">
                        <span className={cn("size-2", color)} />
                        {label}
                      </span>
                    ))}
                  </div>
                </section>

                <section className="overflow-hidden rounded-lg border bg-card">
                  <div className="border-b px-5 py-4">
                    <h2 className="text-sm font-semibold">Measured activity</h2>
                  </div>
                  <dl className="divide-y text-xs">
                    {[
                      [
                        "Customer interactions",
                        report.communicationCount + report.callCount,
                      ],
                      ["Messages", report.communicationCount],
                      ["Calls", report.callCount],
                      ["Quotes created", report.quoteCount],
                      ["Accepted quotes", report.acceptedQuoteCount],
                      ["AI CRM contributions", report.aiContributionCount],
                    ].map(([label, value]) => (
                      <div
                        key={String(label)}
                        className="flex items-center justify-between gap-4 px-5 py-3"
                      >
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="font-medium tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </div>

              <section className="grid overflow-hidden rounded-lg border bg-card lg:grid-cols-2">
                <div className="border-b px-5 py-4 lg:border-b-0 lg:border-r">
                  <div className="flex items-center gap-2">
                    <CheckCircle2
                      className="size-4 text-emerald-700"
                      aria-hidden="true"
                    />
                    <h2 className="text-sm font-semibold">
                      ROI inputs available
                    </h2>
                  </div>
                  <dl className="mt-4 space-y-3 text-xs">
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">
                        Estimated won value
                      </dt>
                      <dd className="font-medium">
                        {money(report.estimatedWonValue)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">
                        Accepted quote value
                      </dt>
                      <dd className="font-medium">
                        {money(report.acceptedQuoteValue)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">
                        Successful automated actions
                      </dt>
                      <dd className="font-medium">
                        {report.workflowSuccessCount}
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    <AlertTriangle
                      className="size-4 text-amber-700"
                      aria-hidden="true"
                    />
                    <h2 className="text-sm font-semibold">
                      ROI not calculated yet
                    </h2>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    A defensible ROI percentage requires realized invoice
                    revenue, ad spend, labor cost, and service cost. This report
                    will not substitute estimates for those actual inputs.
                  </p>
                </div>
              </section>

              {report.insights.length > 0 ? (
                <section className="overflow-hidden rounded-lg border bg-card">
                  <div className="flex items-center gap-2 border-b px-5 py-4">
                    <Lightbulb
                      className="size-4 text-primary"
                      aria-hidden="true"
                    />
                    <h2 className="text-sm font-semibold">Outcome insights</h2>
                  </div>
                  <div className="divide-y">
                    {report.insights.map((insight) => (
                      <p key={insight} className="px-5 py-3 text-sm leading-6">
                        {insight}
                      </p>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}

          {activeView === "sales" ? (
            <div className="min-w-0 space-y-5">
              <section className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2 xl:grid-cols-4">
                <ReportMetric
                  label="Leads"
                  value={report.leadCount}
                  detail={RANGE_LABELS[range]}
                  icon={Target}
                />
                <ReportMetric
                  label="Conversion"
                  value={`${report.conversionRate}%`}
                  detail={`${report.wonCount} won customers`}
                  icon={TrendingUp}
                />
                <ReportMetric
                  label="Quotes accepted"
                  value={report.acceptedQuoteCount}
                  detail={money(report.acceptedQuoteValue)}
                  icon={FileCheck2}
                />
                <ReportMetric
                  label="Appointments"
                  value={report.appointmentCount}
                  detail={`${report.completedAppointmentCount} completed`}
                  icon={CalendarCheck}
                />
              </section>

              <div className="grid gap-5 lg:grid-cols-2">
                <section className="rounded-lg border bg-card px-5 py-4">
                  <h2 className="text-sm font-semibold">
                    Pipeline distribution
                  </h2>
                  <div className="mt-5 space-y-4">
                    {report.stages.map((stage) => (
                      <div key={stage.label}>
                        <div className="flex justify-between text-xs">
                          <span>{stage.label}</span>
                          <span className="font-medium tabular-nums">
                            {stage.value}
                          </span>
                        </div>
                        <div className="mt-1.5 h-2 overflow-hidden rounded-sm bg-secondary">
                          <div
                            className="h-full bg-primary"
                            style={{
                              width: `${Math.max(
                                (stage.value / stageMax) * 100,
                                stage.value > 0 ? 3 : 0,
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="overflow-hidden rounded-lg border bg-card">
                  <div className="border-b px-5 py-4">
                    <h2 className="text-sm font-semibold">Sales value</h2>
                  </div>
                  <dl className="divide-y text-xs">
                    {[
                      ["Open opportunities", report.openPipelineCount],
                      [
                        "Estimated open pipeline",
                        money(report.estimatedPipelineValue),
                      ],
                      ["Won customers", report.wonCount],
                      ["Estimated won value", money(report.estimatedWonValue)],
                      ["Quotes created", report.quoteCount],
                      [
                        "Accepted quote value",
                        money(report.acceptedQuoteValue),
                      ],
                    ].map(([label, value]) => (
                      <div
                        key={String(label)}
                        className="flex items-center justify-between gap-4 px-5 py-3"
                      >
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="font-medium tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </div>
            </div>
          ) : null}

          {activeView === "automation" ? (
            <div className="space-y-5">
              <section className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2 xl:grid-cols-5">
                <ReportMetric
                  label="Workflow runs"
                  value={report.workflowRunCount}
                  detail={RANGE_LABELS[range]}
                  icon={Workflow}
                />
                <ReportMetric
                  label="Succeeded"
                  value={report.workflowSuccessCount}
                  detail={
                    report.workflowSuccessRate === null
                      ? "No completed runs"
                      : `${report.workflowSuccessRate}% success rate`
                  }
                  icon={CheckCircle2}
                />
                <ReportMetric
                  label="Failed"
                  value={report.workflowFailureCount}
                  detail="Failed or cancelled"
                  icon={AlertTriangle}
                />
                <ReportMetric
                  label="Approval-gated"
                  value={report.approvalGatedRunCount}
                  detail="Human review required"
                  icon={FileCheck2}
                />
                <ReportMetric
                  label="AI contributions"
                  value={report.aiContributionCount}
                  detail="Recorded in CRM activity"
                  icon={Bot}
                />
              </section>

              <section className="min-w-0 overflow-hidden rounded-lg border bg-card">
                <div className="border-b px-5 py-4">
                  <h2 className="text-sm font-semibold">
                    Automation performance
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Actual run outcomes by installed workflow
                  </p>
                </div>
                {report.workflows.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No automation runs in this period.
                  </p>
                ) : (
                  <div className="max-w-full overflow-x-auto">
                    <table className="w-full min-w-[44rem] text-left text-xs">
                      <thead className="border-b bg-secondary/30 text-[10px] uppercase text-muted-foreground">
                        <tr>
                          <th className="px-5 py-3 font-semibold">Workflow</th>
                          <th className="px-4 py-3 text-right font-semibold">
                            Runs
                          </th>
                          <th className="px-4 py-3 text-right font-semibold">
                            Succeeded
                          </th>
                          <th className="px-4 py-3 text-right font-semibold">
                            Failed
                          </th>
                          <th className="px-4 py-3 text-right font-semibold">
                            Success
                          </th>
                          <th className="px-5 py-3 text-right font-semibold">
                            Last run
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {report.workflows.map((workflow) => (
                          <tr key={workflow.id}>
                            <td className="px-5 py-3">
                              <p className="font-medium">{workflow.name}</p>
                              {workflow.lastOutcome ? (
                                <p className="mt-0.5 max-w-md truncate text-[11px] text-muted-foreground">
                                  {workflow.lastOutcome}
                                </p>
                              ) : null}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {workflow.runs}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {workflow.succeeded}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {workflow.failed}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Badge variant="outline">
                                {workflow.successRate === null
                                  ? "No data"
                                  : `${workflow.successRate}%`}
                              </Badge>
                            </td>
                            <td className="px-5 py-3 text-right text-muted-foreground">
                              {formatTime(workflow.lastRunAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-3">
                <div className="border-b px-5 py-4 sm:border-b-0 sm:border-r">
                  <MessageSquareText
                    className="size-4 text-primary"
                    aria-hidden="true"
                  />
                  <p className="mt-3 text-xs text-muted-foreground">
                    AI-drafted messages
                  </p>
                  <p className="mt-1 text-xl font-semibold">
                    {report.aiGeneratedCommunicationCount}
                  </p>
                </div>
                <div className="border-b px-5 py-4 sm:border-b-0 sm:border-r">
                  <Activity
                    className="size-4 text-primary"
                    aria-hidden="true"
                  />
                  <p className="mt-3 text-xs text-muted-foreground">
                    Inbound messages
                  </p>
                  <p className="mt-1 text-xl font-semibold">
                    {report.inboundCommunicationCount}
                  </p>
                </div>
                <div className="px-5 py-4">
                  <Bot className="size-4 text-primary" aria-hidden="true" />
                  <p className="mt-3 text-xs text-muted-foreground">
                    Outbound messages
                  </p>
                  <p className="mt-1 text-xl font-semibold">
                    {report.outboundCommunicationCount}
                  </p>
                </div>
              </section>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
