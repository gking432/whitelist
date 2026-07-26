import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  BellCheck,
  CheckCircle2,
  ClipboardList,
  ScrollText,
} from "lucide-react";

import {
  ActionJobsPanel,
  type ActionJobView,
} from "@/components/partner/action-jobs-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getClientOpsCounts } from "@/lib/clients/ops";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { formatDateTime, formatEnum } from "@/lib/format";
import {
  computeClientHealth,
  emptyOpsCounts,
  type ClientHealthStatus,
} from "@/lib/health/client-health";
import { isRetryableJobStatus } from "@/lib/jobs/record";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Runs / Logs",
};

export const dynamic = "force-dynamic";

const RUN_STATUSES = [
  "succeeded",
  "failed",
  "paused_for_approval",
  "running",
  "skipped",
] as const;

const runStatusStyles: Record<string, string> = {
  succeeded: "border-emerald-200 bg-emerald-50 text-emerald-800",
  failed: "border-red-200 bg-red-50 text-red-900",
  paused_for_approval: "border-amber-200 bg-amber-50 text-amber-900",
  running: "border-sky-200 bg-sky-50 text-sky-800",
  skipped: "border-slate-200 bg-slate-50 text-slate-700",
};

const healthStyles: Record<ClientHealthStatus, string> = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-800",
  onboarding: "border-sky-200 bg-sky-50 text-sky-800",
  attention: "border-amber-200 bg-amber-50 text-amber-900",
  failing: "border-red-200 bg-red-50 text-red-900",
  paused: "border-slate-200 bg-slate-50 text-slate-700",
};

type PageProps = {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ status?: string }>;
};

type RunRow = {
  id: string;
  status: string;
  runtime_mode: string;
  summary: string | null;
  requires_approval: boolean;
  error_message: string | null;
  created_at: string;
  instance: { name: string } | null;
  trigger_event: { event_type: string } | null;
};

export default async function ClientRunsPage({
  params,
  searchParams,
}: PageProps) {
  const { clientId } = await params;
  const { status } = await searchParams;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind !== "ok") {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const statusFilter = RUN_STATUSES.includes(status as never) ? status : null;

  let query = supabase
    .from("workflow_runs")
    .select(
      "id, status, runtime_mode, summary, requires_approval, error_message, created_at, instance:client_workflow_instances(name), trigger_event:integration_events!workflow_runs_trigger_event_id_fkey(event_type)",
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const [{ data, error }, { data: jobsData }, opsCounts] = await Promise.all([
    query,
    supabase
      .from("action_jobs")
      .select(
        "id, kind, status, attempt_count, last_error, last_attempt_at, created_at",
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(15),
    workspace.access.partnerId
      ? getClientOpsCounts(
          supabase,
          workspace.access.partnerId,
          clientId,
        ).catch(() => ({ ...emptyOpsCounts }))
      : Promise.resolve({ ...emptyOpsCounts }),
  ]);

  if (error) {
    return (
      <section className="rounded-lg border bg-card p-6">
        <h2 className="font-semibold">Runs unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Workflow runs could not be loaded. Refresh to try again.
        </p>
      </section>
    );
  }

  const runs = (data ?? []) as unknown as RunRow[];
  const base = `/partner/clients/${clientId}/runs`;
  const clientBase = `/partner/clients/${clientId}`;
  const health = computeClientHealth(workspace.client.status, opsCounts);
  const successfulRuns7d = Math.max(
    opsCounts.runs7d - opsCounts.failedRuns7d,
    0,
  );
  const successRate =
    opsCounts.runs7d > 0
      ? Math.round((successfulRuns7d / opsCounts.runs7d) * 100)
      : null;

  const jobs: ActionJobView[] = (
    (jobsData ?? []) as {
      id: string;
      kind: string;
      status: string;
      attempt_count: number;
      last_error: string | null;
      last_attempt_at: string | null;
      created_at: string;
    }[]
  ).map((job) => ({
    ...job,
    retryable: isRetryableJobStatus(job.status),
  }));

  const filters = [
    { label: "All", value: null },
    ...RUN_STATUSES.map((value) => ({ label: formatEnum(value), value })),
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">
            {workspace.client.default_runtime_mode === "live"
              ? "Live operations"
              : "Sandbox operations"}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">
              {workspace.client.default_runtime_mode === "live"
                ? "Live monitoring"
                : "Activity & Logs"}
            </h2>
            <Badge variant="outline" className={healthStyles[health.status]}>
              {formatEnum(health.status)}
            </Badge>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            See what Northstar did, where an automation stopped, and which
            client-owned decisions are still waiting.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`${clientBase}/approvals`}>
              <BellCheck aria-hidden="true" />
              Client decisions
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`${clientBase}/audit`}>
              <ScrollText aria-hidden="true" />
              Audit trail
            </Link>
          </Button>
        </div>
      </header>

      <section
        aria-label="Operational health"
        className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2 xl:grid-cols-4"
      >
        {[
          {
            label: "Runs in 7 days",
            value: opsCounts.runs7d,
            detail: "All workflow executions",
          },
          {
            label: "Without failure",
            value: successRate === null ? "—" : `${successRate}%`,
            detail: `${successfulRuns7d} runs without a failure`,
          },
          {
            label: "Failed runs",
            value: opsCounts.failedRuns7d,
            detail: "Needs partner investigation",
          },
          {
            label: "Client decisions",
            value: opsCounts.pendingApprovals,
            detail: "Waiting on authorized client staff",
          },
        ].map((metric, index) => (
          <div
            key={metric.label}
            className={`px-4 py-4 ${
              index > 0 ? "border-t xl:border-l xl:border-t-0" : ""
            } ${index % 2 === 1 ? "sm:border-l" : ""} ${
              index >= 2 ? "sm:border-t" : "sm:border-t-0"
            }`}
          >
            <p className="text-xs text-muted-foreground">{metric.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {metric.value}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {metric.detail}
            </p>
          </div>
        ))}
      </section>

      {health.reasons.length > 0 ? (
        <section className="flex flex-col gap-3 border-l-4 border-amber-400 bg-amber-50/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 size-5 shrink-0 text-amber-800"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-semibold">Needs attention</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {health.reasons[0]}
              </p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link
              href={
                opsCounts.failedRuns7d > 0
                  ? `${base}?status=failed`
                  : opsCounts.connectionsFailing > 0 ||
                      opsCounts.connectionsNeedsAttention > 0
                    ? `${clientBase}/setup#connections`
                    : `${clientBase}/approvals`
              }
            >
              Investigate
            </Link>
          </Button>
        </section>
      ) : (
        <section className="flex items-start gap-3 border-l-4 border-emerald-500 bg-emerald-50/60 px-4 py-4">
          <CheckCircle2
            className="mt-0.5 size-5 shrink-0 text-emerald-700"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-semibold">No operational issues</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Connections, workflows, and recent runs show no active failure.
            </p>
          </div>
        </section>
      )}

      <ActionJobsPanel
        clientId={clientId}
        jobs={jobs}
        canRetry={workspace.access.canOperateCustomerActions}
      />

      <section>
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-primary" aria-hidden="true" />
          <h3 className="font-semibold">Workflow activity</h3>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Open any row to inspect its timeline, AI mode, redacted input, and
          provider context.
        </p>
      </section>

      <nav
        aria-label="Run status filter"
        className="flex gap-1 overflow-x-auto border-b"
      >
        {filters.map((filter) => {
          const isActive = filter.value === statusFilter;
          const href = filter.value ? `${base}?status=${filter.value}` : base;

          return (
            <Link
              key={filter.label}
              href={href}
              className={cn(
                "whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      {runs.length === 0 ? (
        <section className="flex min-h-56 flex-col items-center justify-center rounded-lg border bg-card px-6 py-10 text-center">
          <ClipboardList
            className="size-6 text-muted-foreground"
            aria-hidden="true"
          />
          <h3 className="mt-3 text-sm font-semibold">
            {statusFilter ? "No runs match this filter" : "No runs yet"}
          </h3>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            {statusFilter
              ? "Try a different status filter."
              : "Runs appear when inbound events trigger an enabled workflow."}
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="border-b text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Workflow</th>
                  <th className="px-4 py-3 font-medium">Trigger</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Mode</th>
                  <th className="px-4 py-3 font-medium">Approval</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {runs.map((run) => (
                  <tr key={run.id} className="hover:bg-secondary/30">
                    <td className="px-5 py-3.5 text-muted-foreground">
                      <Link
                        href={`${base}/${run.id}`}
                        className="hover:underline"
                      >
                        {formatDateTime(run.created_at)}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5">
                      <Link
                        href={`${base}/${run.id}`}
                        className="font-medium hover:underline"
                      >
                        {run.instance?.name ?? "Workflow"}
                      </Link>
                      {run.error_message ? (
                        <p className="mt-0.5 max-w-72 truncate text-xs text-destructive">
                          {run.error_message}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {run.trigger_event?.event_type ?? "—"}
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge
                        variant="outline"
                        className={runStatusStyles[run.status] ?? ""}
                      >
                        {formatEnum(run.status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {formatEnum(run.runtime_mode)}
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {run.requires_approval ? "Required" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
