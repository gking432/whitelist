import Link from "next/link";
import { BellCheck, ClipboardList, PlugZap, Workflow } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadClientPortal } from "@/lib/clients/portal";
import { formatDateTime, formatEnum } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function ClientActionCenter() {
  const portal = await loadClientPortal();

  if (portal.kind !== "ok") {
    return null;
  }

  const { access, client } = portal;
  const supabase = await createSupabaseServerClient();

  if (!supabase || !access.clientId) {
    return null;
  }

  const clientId = access.clientId;

  const [instances, approvals, connections, runs] = await Promise.all([
    supabase
      .from("client_workflow_instances")
      .select("id, name, status, runtime_mode, last_run_at")
      .eq("client_id", clientId)
      .order("name", { ascending: true }),
    supabase
      .from("approval_items")
      .select("id")
      .eq("client_id", clientId)
      .eq("status", "pending"),
    supabase
      .from("integration_connections")
      .select("id, display_name, status")
      .eq("client_id", clientId),
    supabase
      .from("workflow_runs")
      .select("id, status, summary, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const workflowList = instances.data ?? [];
  const activeWorkflows = workflowList.filter(
    (instance) => instance.status === "active",
  ).length;
  const pendingApprovals = approvals.data?.length ?? 0;
  const connectionList = connections.data ?? [];
  const failingConnections = connectionList.filter((connection) =>
    ["failing", "needs_attention"].includes(connection.status),
  ).length;
  const recentRuns = runs.data ?? [];

  const cards = [
    {
      label: "Active automations",
      value: activeWorkflows,
      detail: "Workflows running for your business",
      icon: Workflow,
    },
    {
      label: "Approvals waiting",
      value: pendingApprovals,
      detail:
        pendingApprovals > 0
          ? "Items need your review"
          : "Nothing needs your review",
      icon: BellCheck,
    },
    {
      label: "Connected systems",
      value: connectionList.length,
      detail:
        failingConnections > 0
          ? `${failingConnections} need attention`
          : "No connection issues reported",
      icon: PlugZap,
    },
    {
      label: "Recent activity",
      value: recentRuns.length,
      detail: "Latest automation runs",
      icon: ClipboardList,
    },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">
          {client.name} automation status
        </h1>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          What&apos;s running for your business, what needs your approval, and
          recent activity.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
              </CardContent>
            </Card>
          );
        })}
      </section>

      {pendingApprovals > 0 ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-sm font-medium text-amber-900">
            {pendingApprovals} item{pendingApprovals === 1 ? "" : "s"} waiting
            for your approval.
          </p>
          {access.visibleClientSections.includes("approvals") ? (
            <Link
              href="/client/approvals"
              className="mt-1 inline-block text-sm font-medium text-amber-900 underline"
            >
              Review approvals
            </Link>
          ) : null}
        </section>
      ) : null}

      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="border-b px-5 py-4">
          <h2 className="text-sm font-semibold">Your automations</h2>
        </div>
        {workflowList.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            No automations are configured yet. Your partner sets these up for
            you.
          </div>
        ) : (
          <div className="divide-y">
            {workflowList.map((instance) => (
              <div
                key={instance.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
              >
                <div>
                  <p className="text-sm font-medium">{instance.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Last run: {formatDateTime(instance.last_run_at)}
                  </p>
                </div>
                <Badge variant="outline">{formatEnum(instance.status)}</Badge>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-sm font-semibold">Recent activity</h2>
          {access.visibleClientSections.includes("activity") ? (
            <Link
              href="/client/activity"
              className="text-xs font-medium text-primary hover:underline"
            >
              View all
            </Link>
          ) : null}
        </div>
        {recentRuns.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            No automation activity yet.
          </div>
        ) : (
          <div className="divide-y">
            {recentRuns.map((run) => (
              <div
                key={run.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {run.summary ?? "Automation run"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDateTime(run.created_at)}
                  </p>
                </div>
                <Badge variant="outline">{formatEnum(run.status)}</Badge>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
