"use client";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  PlugZap,
  Workflow,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildAutomationHealth,
  type AutomationConnection,
  type AutomationRun,
  type AutomationWorkflow,
} from "@/lib/crm/automation-health";
import { cn } from "@/lib/utils";

function formatLabel(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatTime(value: string | null | undefined): string {
  if (!value) return "No activity yet";
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

function stateLabel(
  state: "healthy" | "ready" | "needs_attention" | "inactive",
): string {
  if (state === "healthy") return "Healthy";
  if (state === "needs_attention") return "Needs attention";
  if (state === "inactive") return "Inactive";
  return "Ready";
}

function stateClass(
  state: "healthy" | "ready" | "needs_attention" | "inactive",
): string {
  if (state === "healthy") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (state === "needs_attention") {
    return "border-red-200 bg-red-50 text-red-800";
  }
  if (state === "ready") {
    return "border-blue-200 bg-blue-50 text-blue-800";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function connectionClass(status: string): string {
  return ["connected", "active", "healthy"].includes(status)
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-amber-200 bg-amber-50 text-amber-900";
}

function HealthMetric({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof Workflow;
}) {
  return (
    <div className="min-w-0 border-b px-4 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <div className="flex items-center justify-between gap-2">
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

export function ClientAutomationHealth({
  workflows,
  runs,
  connections,
  escalationRules,
  escalationContact,
  actionCenterPath,
}: {
  workflows: AutomationWorkflow[];
  runs: AutomationRun[];
  connections: AutomationConnection[];
  escalationRules: string | null;
  escalationContact: {
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  actionCenterPath: string | null;
}) {
  const health = buildAutomationHealth(workflows, runs, connections);
  const escalationIdentity =
    escalationContact.name ||
    escalationContact.email ||
    escalationContact.phone ||
    null;

  return (
    <div className="space-y-5">
      <section className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-4">
        <HealthMetric
          label="Installed"
          value={health.installedCount}
          detail={`${health.activeCount} currently active`}
          icon={Workflow}
        />
        <HealthMetric
          label="Healthy"
          value={health.healthyCount}
          detail="Operating without a current issue"
          icon={CheckCircle2}
        />
        <HealthMetric
          label="30-day activity"
          value={health.recentRunCount}
          detail={`${health.recentSuccessCount} successful actions`}
          icon={Activity}
        />
        <HealthMetric
          label="Success rate"
          value={
            health.successRate === null ? "No data" : `${health.successRate}%`
          }
          detail={`${health.needsAttentionCount} need attention`}
          icon={AlertTriangle}
        />
      </section>

      {health.needsAttentionCount > 0 ? (
        <section className="flex flex-col gap-3 border-y border-red-200 bg-red-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-red-700"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-semibold text-red-950">
                {health.needsAttentionCount} automation
                {health.needsAttentionCount === 1
                  ? " needs"
                  : "s need"}{" "}
                attention
              </p>
              <p className="mt-0.5 text-xs leading-5 text-red-800">
                The issue is visible below and has the provider or failure
                context your partner needs to troubleshoot it.
              </p>
            </div>
          </div>
          {actionCenterPath ? (
            <Button asChild variant="outline" size="sm">
              <Link href={actionCenterPath}>
                Open Action Center
                <ExternalLink aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
        </section>
      ) : null}

      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Installed automations</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Live status, connected services, and actual workflow outcomes.
              Package changes are managed by your service partner.
            </p>
          </div>
          <Badge variant="outline">
            {health.activeCount} of {health.installedCount} active
          </Badge>
        </div>

        {health.items.length === 0 ? (
          <div className="grid min-h-44 place-items-center px-6 py-8 text-center">
            <div>
              <CircleDashed
                className="mx-auto size-5 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="mt-3 text-sm font-semibold">
                No automations installed
              </p>
              <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                Automations appear here after your service partner installs a
                package.
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y">
            {health.items.map((item) => {
              const description =
                item.workflow.template?.description ??
                `${formatLabel(item.workflow.template?.category ?? "AI")} automation`;

              return (
                <article key={item.workflow.id} className="px-5 py-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold">
                          {item.workflow.name}
                        </h3>
                        <Badge
                          variant="outline"
                          className={stateClass(item.state)}
                        >
                          {stateLabel(item.state)}
                        </Badge>
                      </div>
                      <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
                        {description}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {item.recentRunCount}{" "}
                        {item.recentRunCount === 1 ? "action" : "actions"} in
                        30 days
                      </span>
                      <span aria-hidden="true">|</span>
                      <span>
                        {item.workflow.runtime_mode === "live"
                          ? "Live"
                          : "Setup"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-x-6 gap-y-4 lg:grid-cols-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                        Connected services
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(item.workflow.template
                          ?.required_provider_categories?.length ?? 0) === 0 ? (
                          <Badge variant="outline">
                            <PlugZap aria-hidden="true" />
                            Northstar built-in
                          </Badge>
                        ) : null}
                        {item.connections.map((connection) => (
                          <Badge
                            key={connection.id}
                            variant="outline"
                            className={connectionClass(connection.status)}
                          >
                            {connection.display_name}
                            {connection.provider?.display_name &&
                            connection.provider.display_name !==
                              connection.display_name
                              ? ` (${connection.provider.display_name})`
                              : ""}
                            : {formatLabel(connection.status)}
                          </Badge>
                        ))}
                        {item.missingProviderCategories.map((category) => (
                          <Badge
                            key={category}
                            variant="outline"
                            className="border-red-200 bg-red-50 text-red-800"
                          >
                            {formatLabel(category)} not connected
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                        Last successful action
                      </p>
                      <p className="mt-2 text-xs font-medium">
                        {item.latestSuccess?.summary ??
                          (item.latestSuccess
                            ? "Workflow completed successfully"
                            : "No successful action yet")}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {formatTime(item.latestSuccess?.finished_at ?? null)}
                      </p>
                    </div>

                    <div>
                      <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                        Latest issue
                      </p>
                      <p
                        className={cn(
                          "mt-2 text-xs font-medium",
                          item.latestFailure && "text-red-800",
                        )}
                      >
                        {item.latestFailure?.error_message ??
                          (item.latestFailure
                            ? item.latestFailure.summary ??
                              "Workflow did not complete"
                            : "No failures recorded")}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {item.latestFailure
                          ? formatTime(item.latestFailure.created_at)
                          : `${item.recentSuccessCount} successful, ${item.recentFailureCount} failed in 30 days`}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid overflow-hidden rounded-lg border bg-card lg:grid-cols-[minmax(15rem,0.7fr)_minmax(0,1.3fr)]">
        <div className="border-b px-5 py-4 lg:border-b-0 lg:border-r">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">
            Escalation owner
          </p>
          <p className="mt-2 text-sm font-semibold">
            {escalationIdentity ?? "Not configured"}
          </p>
          {escalationContact.name &&
          (escalationContact.email || escalationContact.phone) ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {[escalationContact.email, escalationContact.phone]
                .filter(Boolean)
                .join(" | ")}
            </p>
          ) : null}
        </div>
        <div className="px-5 py-4">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">
            Escalation instructions
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {escalationRules ??
              "No escalation instructions are configured. Your service partner can add them during workflow setup."}
          </p>
        </div>
      </section>
    </div>
  );
}
