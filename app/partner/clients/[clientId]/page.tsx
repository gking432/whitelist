import Link from "next/link";
import {
  AlertTriangle,
  BellCheck,
  CheckCircle2,
  ClipboardList,
  PlugZap,
  Workflow,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getClientOpsCounts } from "@/lib/clients/ops";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { formatDateTime, formatEnum } from "@/lib/format";
import {
  computeClientHealth,
  emptyOpsCounts,
  type ClientHealthStatus,
} from "@/lib/health/client-health";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Client Overview",
};

export const dynamic = "force-dynamic";

const healthStyles: Record<ClientHealthStatus, string> = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-800",
  onboarding: "border-sky-200 bg-sky-50 text-sky-800",
  attention: "border-amber-200 bg-amber-50 text-amber-900",
  failing: "border-red-200 bg-red-50 text-red-900",
  paused: "border-slate-200 bg-slate-50 text-slate-700",
};

type PageProps = {
  params: Promise<{ clientId: string }>;
};

export default async function ClientOverviewPage({ params }: PageProps) {
  const { clientId } = await params;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind !== "ok") {
    return null;
  }

  const { client, access } = workspace;
  const supabase = await createSupabaseServerClient();

  let counts = { ...emptyOpsCounts };
  let recentRuns: {
    id: string;
    status: string;
    summary: string | null;
    created_at: string;
  }[] = [];
  let loadError = false;

  if (supabase && access.partnerId) {
    try {
      const [opsCounts, runsResult] = await Promise.all([
        getClientOpsCounts(supabase, access.partnerId, clientId),
        supabase
          .from("workflow_runs")
          .select("id, status, summary, created_at")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(6),
      ]);

      counts = opsCounts;
      recentRuns = runsResult.data ?? [];
    } catch {
      loadError = true;
    }
  }

  const health = computeClientHealth(client.status, counts);
  const base = `/partner/clients/${clientId}`;

  const cards = [
    {
      label: "Integration connections",
      value: counts.connectionsTotal,
      detail:
        counts.connectionsFailing > 0
          ? `${counts.connectionsFailing} failing`
          : counts.connectionsNeedsAttention > 0
            ? `${counts.connectionsNeedsAttention} need attention`
            : "No failures recorded",
      href: `${base}/integrations`,
      icon: PlugZap,
    },
    {
      label: "Active workflows",
      value: counts.activeWorkflows,
      detail:
        counts.pausedLiveWorkflows > 0
          ? `${counts.pausedLiveWorkflows} live workflows paused`
          : "Enabled automations for this client",
      href: `${base}/workflows`,
      icon: Workflow,
    },
    {
      label: "Open approvals",
      value: counts.pendingApprovals,
      detail:
        counts.pendingApprovals > 0
          ? "Waiting for human review"
          : "No approvals waiting",
      href: `${base}/approvals`,
      icon: BellCheck,
    },
    {
      label: "Failed runs (7d)",
      value: counts.failedRuns7d,
      detail: `${counts.runs7d} total runs in the last 7 days`,
      href: `${base}/runs`,
      icon: ClipboardList,
    },
  ];

  return (
    <div className="space-y-6">
      {loadError ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Some operational signals could not be loaded. Metrics below may be
          incomplete.
        </section>
      ) : null}

      <section className="rounded-lg border bg-card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-semibold">Health summary</h2>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant="outline" className={healthStyles[health.status]}>
                {formatEnum(health.status)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Last integration event: {formatDateTime(counts.lastEventAt)}
              </span>
            </div>
          </div>
        </div>
        {health.reasons.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {health.reasons.map((reason) => (
              <li
                key={reason}
                className="flex items-start gap-2 text-sm text-muted-foreground"
              >
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0 text-amber-600"
                  aria-hidden="true"
                />
                {reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2
              className="size-4 text-emerald-600"
              aria-hidden="true"
            />
            No operational issues detected.
          </p>
        )}
      </section>

      <section
        aria-label="Operational metrics"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {cards.map((card) => {
          const Icon = card.icon;

          return (
            <Card key={card.label}>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.label}
                </CardTitle>
                <Icon className="size-4 text-primary" aria-hidden="true" />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold tabular-nums">
                  {card.value}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {card.detail}
                </p>
                <Link
                  href={card.href}
                  className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
                >
                  Open
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="font-semibold">Recent workflow runs</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Latest automation activity for this client.
            </p>
          </div>
          <Link
            href={`${base}/runs`}
            className="text-xs font-medium text-primary hover:underline"
          >
            View all runs
          </Link>
        </div>
        {recentRuns.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            No workflow runs yet. Runs appear here once inbound events trigger
            an enabled workflow.
          </div>
        ) : (
          <div className="divide-y">
            {recentRuns.map((run) => (
              <Link
                key={run.id}
                href={`${base}/runs/${run.id}`}
                className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-secondary/30"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {run.summary ?? "Workflow run"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDateTime(run.created_at)}
                  </p>
                </div>
                <Badge variant="outline">{formatEnum(run.status)}</Badge>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
