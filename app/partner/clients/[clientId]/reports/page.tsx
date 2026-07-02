import { BarChart3 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Client Reports",
};

export const dynamic = "force-dynamic";

const REPORT_DAYS = 14;

type PageProps = {
  params: Promise<{ clientId: string }>;
};

type DailyRow = {
  date: string;
  runs: number;
  failed: number;
  approvalsCreated: number;
  approvalsResolved: number;
  events: number;
};

function reportWindow(): { sinceIso: string; days: DailyRow[] } {
  const now = Date.now();
  const days: DailyRow[] = [];

  for (let index = REPORT_DAYS - 1; index >= 0; index -= 1) {
    const date = new Date(now - index * 24 * 60 * 60 * 1000);
    days.push({
      date: date.toISOString().slice(0, 10),
      runs: 0,
      failed: 0,
      approvalsCreated: 0,
      approvalsResolved: 0,
      events: 0,
    });
  }

  return {
    sinceIso: new Date(now - REPORT_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    days,
  };
}

export default async function ClientReportsPage({ params }: PageProps) {
  const { clientId } = await params;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind !== "ok") {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { sinceIso, days } = reportWindow();

  const [runsResult, approvalsResult, eventsResult] = await Promise.all([
    supabase
      .from("workflow_runs")
      .select("status, created_at")
      .eq("client_id", clientId)
      .gte("created_at", sinceIso),
    supabase
      .from("approval_items")
      .select("created_at, resolved_at")
      .eq("client_id", clientId)
      .gte("created_at", sinceIso),
    supabase
      .from("integration_events")
      .select("status, created_at")
      .eq("client_id", clientId)
      .gte("created_at", sinceIso),
  ]);

  if (runsResult.error || approvalsResult.error || eventsResult.error) {
    return (
      <section className="rounded-lg border bg-card p-6">
        <h2 className="font-semibold">Reports unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Report data could not be loaded. Refresh to try again.
        </p>
      </section>
    );
  }

  const runs = runsResult.data ?? [];
  const approvals = approvalsResult.data ?? [];
  const events = eventsResult.data ?? [];

  const totalRuns = runs.length;
  const failedRuns = runs.filter((run) => run.status === "failed").length;
  const succeededRuns = runs.filter(
    (run) => run.status === "succeeded",
  ).length;
  const pausedRuns = runs.filter(
    (run) => run.status === "paused_for_approval",
  ).length;
  const successRate =
    totalRuns > 0 ? Math.round((succeededRuns / totalRuns) * 100) : null;
  const approvalsResolved = approvals.filter(
    (approval) => approval.resolved_at !== null,
  ).length;
  const rejectedEvents = events.filter(
    (event) => event.status === "rejected",
  ).length;

  const dayKey = (value: string) => value.slice(0, 10);
  const dayByKey = new Map(days.map((day) => [day.date, day]));

  for (const run of runs) {
    const day = dayByKey.get(dayKey(run.created_at));

    if (day) {
      day.runs += 1;

      if (run.status === "failed") {
        day.failed += 1;
      }
    }
  }

  for (const approval of approvals) {
    const created = dayByKey.get(dayKey(approval.created_at));

    if (created) {
      created.approvalsCreated += 1;
    }

    if (approval.resolved_at) {
      const resolved = dayByKey.get(dayKey(approval.resolved_at));

      if (resolved) {
        resolved.approvalsResolved += 1;
      }
    }
  }

  for (const event of events) {
    const day = dayByKey.get(dayKey(event.created_at));

    if (day) {
      day.events += 1;
    }
  }

  const activeDays = days.filter(
    (day) =>
      day.runs > 0 ||
      day.events > 0 ||
      day.approvalsCreated > 0 ||
      day.approvalsResolved > 0,
  );

  const summaryCards = [
    {
      label: "Workflow runs",
      value: totalRuns,
      detail:
        successRate === null
          ? "No runs in the last 14 days"
          : `${successRate}% succeeded · ${pausedRuns} awaiting approval`,
    },
    {
      label: "Failed runs",
      value: failedRuns,
      detail: "Investigate from Runs / Logs",
    },
    {
      label: "Approvals",
      value: approvals.length,
      detail: `${approvalsResolved} resolved in the same period`,
    },
    {
      label: "Integration events",
      value: events.length,
      detail:
        rejectedEvents > 0
          ? `${rejectedEvents} rejected requests`
          : "No rejected requests",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold">Reports</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Operational outcomes for the last {REPORT_DAYS} days.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <Card key={card.label} className="shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">
                {card.value}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {card.detail}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>

      {activeDays.length === 0 ? (
        <section className="flex min-h-56 flex-col items-center justify-center rounded-lg border bg-card px-6 py-10 text-center">
          <BarChart3
            className="size-6 text-muted-foreground"
            aria-hidden="true"
          />
          <h3 className="mt-3 text-sm font-semibold">No activity to report</h3>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Reports fill in as integration events and workflow runs accumulate
            for this client.
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="border-b px-5 py-4">
            <h3 className="text-sm font-semibold">Daily activity</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Days with recorded activity in the reporting window.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b bg-secondary/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Runs</th>
                  <th className="px-4 py-3 font-medium">Failed</th>
                  <th className="px-4 py-3 font-medium">Approvals created</th>
                  <th className="px-4 py-3 font-medium">Approvals resolved</th>
                  <th className="px-4 py-3 font-medium">Integration events</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {activeDays
                  .slice()
                  .reverse()
                  .map((day) => (
                    <tr key={day.date}>
                      <td className="px-5 py-3 font-medium">{day.date}</td>
                      <td className="px-4 py-3 tabular-nums">{day.runs}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {day.failed > 0 ? (
                          <span className="font-medium text-destructive">
                            {day.failed}
                          </span>
                        ) : (
                          0
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {day.approvalsCreated}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {day.approvalsResolved}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{day.events}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="text-xs leading-5 text-muted-foreground">
        Daily metrics are also aggregated into durable reporting storage
        (client_metrics_daily) for long-range reports as scheduled aggregation
        comes online.
      </p>
    </div>
  );
}
