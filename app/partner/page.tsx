import Link from "next/link";
import {
  AlertTriangle,
  BellCheck,
  CheckCircle2,
  PlugZap,
  Plus,
  ShieldAlert,
  UsersRound,
  Workflow,
} from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import {
  buildGettingStartedSteps,
  PartnerGettingStarted,
  shouldShowGettingStarted,
} from "@/components/partner/partner-getting-started";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getPartnerDashboardData,
  PartnerDashboardDataError,
  type AttentionSeverity,
  type ClientHealthStatus,
  type PartnerDashboardData,
} from "@/lib/dashboard/partner-dashboard";
import { formatDate, formatEnum } from "@/lib/format";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import {
  isAccessError,
  requirePrimaryPartnerAccess,
} from "@/lib/permissions/access";
import type { AccessContext } from "@/lib/permissions/types";

export const metadata = {
  title: "Partner Dashboard",
};

export const dynamic = "force-dynamic";

const healthStyles: Record<ClientHealthStatus, string> = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-800",
  onboarding: "border-sky-200 bg-sky-50 text-sky-800",
  attention: "border-amber-200 bg-amber-50 text-amber-900",
  failing: "border-red-200 bg-red-50 text-red-900",
  paused: "border-slate-200 bg-slate-50 text-slate-700",
};

const attentionStyles: Record<AttentionSeverity, string> = {
  critical: "bg-destructive",
  warning: "bg-amber-500",
  setup: "bg-sky-500",
};

function AccessDenied() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Partner access required</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-muted-foreground">
            This workspace is available to active partner members. Contact your
            platform administrator if your access should be connected to a
            partner organization.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

export default async function PartnerPage() {
  const user = await requireAuthenticatedUser("/partner");

  let access: AccessContext;

  try {
    access = await requirePrimaryPartnerAccess(user.id);
  } catch (error) {
    if (isAccessError(error) && error.code === "ACCESS_DENIED") {
      return <AccessDenied />;
    }

    throw error;
  }

  if (!access.partnerId) {
    return <AccessDenied />;
  }

  let dashboard: PartnerDashboardData;

  try {
    dashboard = await getPartnerDashboardData(access.partnerId);
  } catch (error) {
    if (!(error instanceof PartnerDashboardDataError)) {
      throw error;
    }

    return (
      <AppShell
        organizationName="Partner workspace"
        userEmail={user.email ?? "Authenticated user"}
      >
        <section className="rounded-lg border bg-card p-6">
          <div className="flex items-start gap-3">
            <ShieldAlert
              className="mt-0.5 size-5 shrink-0 text-destructive"
              aria-hidden="true"
            />
            <div>
              <h1 className="text-lg font-semibold">Dashboard unavailable</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Client operations could not be loaded. Try again after the data
                service is available.
              </p>
            </div>
          </div>
        </section>
      </AppShell>
    );
  }

  const metrics = [
    {
      label: "Client businesses",
      value: dashboard.metrics.totalClients,
      detail: `${dashboard.metrics.activeClients} active, ${dashboard.metrics.onboardingClients} onboarding`,
      icon: UsersRound,
    },
    {
      label: "Needs attention",
      value: dashboard.metrics.clientsNeedingAttention,
      detail: "Clients with operational issues",
      icon: AlertTriangle,
    },
    {
      label: "Client decisions pending",
      value: dashboard.metrics.openApprovals,
      detail: "Read-only visibility for support",
      icon: BellCheck,
    },
    {
      label: "Failed runs (7d)",
      value: dashboard.metrics.failedRuns7d,
      detail: `${dashboard.metrics.totalRuns7d} total runs this week`,
      icon: Workflow,
    },
  ];

  const operationalSummaries = [
    {
      label: "Active workflows",
      value: `${dashboard.metrics.activeWorkflows} enabled`,
      detail:
        dashboard.metrics.activeWorkflows > 0
          ? "Automations enabled across clients."
          : "Enable workflow templates inside a client workspace.",
      icon: Workflow,
    },
    {
      label: "Integration health",
      value:
        dashboard.metrics.failingConnections > 0
          ? `${dashboard.metrics.failingConnections} failing`
          : "No failures",
      detail:
        dashboard.metrics.failingConnections > 0
          ? "Open the affected client's Integrations tab."
          : "No failing connections are recorded.",
      icon: PlugZap,
    },
    {
      label: "Client decisions",
      value: `${dashboard.metrics.openApprovals} open`,
      detail:
        dashboard.metrics.openApprovals > 0
          ? "Clients own these decisions; inspect their status when troubleshooting."
          : "No client decisions are waiting.",
      icon: BellCheck,
    },
  ];

  const displayedClients = dashboard.clients.slice(0, 8);
  const displayedAttention = dashboard.attentionItems.slice(0, 6);

  // On-ramp: the next concrete step for a partner still getting going. Aims
  // at the client that's mid-onboarding (or the first one), and hides once
  // there's a client, enabled workflows, and at least one run.
  const onboardingTarget =
    dashboard.clients.find((client) => client.status === "onboarding") ??
    dashboard.clients[0] ??
    null;
  const showGettingStarted = shouldShowGettingStarted({
    totalClients: dashboard.metrics.totalClients,
    activeWorkflows: dashboard.metrics.activeWorkflows,
    totalRuns7d: dashboard.metrics.totalRuns7d,
  });
  const gettingStartedSteps = buildGettingStartedSteps({
    totalClients: dashboard.metrics.totalClients,
    activeWorkflows: dashboard.metrics.activeWorkflows,
    totalRuns7d: dashboard.metrics.totalRuns7d,
    targetClientId: onboardingTarget?.id ?? null,
    targetClientName: onboardingTarget?.name ?? null,
  });
  const canAddClient =
    !access.isImpersonating || access.impersonationMode === "sandbox_full";

  return (
    <AppShell
      organizationName={dashboard.partner.name}
      userEmail={user.email ?? "Authenticated user"}
      activeNav="dashboard"
    >
      <div className="space-y-7">
        <header className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Badge variant="secondary" className="mb-3">
              Partner dashboard
            </Badge>
            <h1 className="text-xl font-semibold tracking-tight">
              Client operations
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Health and attention across {dashboard.partner.name} client
              businesses.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">{formatEnum(dashboard.partner.status)}</Badge>
            <Badge variant="outline">{access.role.replaceAll("_", " ")}</Badge>
            {canAddClient ? (
              <Button asChild size="sm" variant="gold">
                <Link href="/partner/clients/new">
                  <Plus aria-hidden="true" />
                  Add client
                </Link>
              </Button>
            ) : null}
          </div>
        </header>

        {showGettingStarted ? (
          <PartnerGettingStarted steps={gettingStartedSteps} />
        ) : null}

        <section
          aria-label="Partner metrics"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          {metrics.map((metric) => {
            const Icon = metric.icon;

            return (
              <Card key={metric.label}>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {metric.label}
                  </CardTitle>
                  <Icon className="size-4 text-primary" aria-hidden="true" />
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-semibold tabular-nums">
                    {metric.value}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {metric.detail}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(19rem,0.75fr)]">
          <section className="overflow-hidden rounded-lg border bg-card">
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
              <div>
                <h2 className="font-semibold">Client health</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Highest-priority clients appear first.
                </p>
              </div>
              <Link
                href="/partner/clients"
                className="text-xs font-medium text-primary hover:underline"
              >
                All clients
              </Link>
            </div>

            {displayedClients.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center">
                <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <UsersRound className="size-5" aria-hidden="true" />
                </div>
                <h3 className="mt-4 font-semibold">No client businesses yet</h3>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                  Add the first client business to begin tracking operational
                  health and attention.
                </p>
                {canAddClient ? (
                  <Button asChild className="mt-5">
                    <Link href="/partner/clients/new">
                      <Plus aria-hidden="true" />
                      Add client
                    </Link>
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="divide-y">
                {displayedClients.map((client) => (
                  <div
                    key={client.id}
                    className="grid gap-4 px-5 py-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_0.85fr_0.7fr_0.6fr]"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/partner/clients/${client.id}`}
                        className="truncate text-sm font-semibold hover:underline"
                      >
                        {client.name}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {client.industry ?? "Industry not set"} · Updated{" "}
                        {formatDate(client.updatedAt)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Health</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className={healthStyles[client.health]}
                        >
                          {formatEnum(client.health)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatEnum(client.status)}
                        </span>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Approvals</p>
                      <p className="mt-1.5 text-sm font-medium tabular-nums">
                        {client.pendingApprovals} open
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Failed (7d)
                      </p>
                      <p className="mt-1.5 text-sm font-medium tabular-nums">
                        {client.failedRuns7d}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {dashboard.clients.length > displayedClients.length ? (
              <p className="border-t px-5 py-3 text-xs text-muted-foreground">
                Showing {displayedClients.length} highest-priority clients.
              </p>
            ) : null}
          </section>

          <section className="overflow-hidden rounded-lg border bg-card">
            <div className="border-b px-5 py-4">
              <h2 className="font-semibold">Attention queue</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Client states requiring review.
              </p>
            </div>

            {displayedAttention.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center">
                <CheckCircle2
                  className="size-6 text-emerald-600"
                  aria-hidden="true"
                />
                <h3 className="mt-3 text-sm font-semibold">
                  No clients need attention
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  All current client statuses are clear.
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {displayedAttention.map((item) => (
                  <Link
                    key={item.clientId}
                    href={`/partner/clients/${item.clientId}`}
                    className="flex gap-3 px-5 py-4 hover:bg-secondary/30"
                  >
                    <span
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${attentionStyles[item.severity]}`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {item.clientName}
                      </p>
                      <p className="mt-1 text-xs font-medium text-foreground">
                        {item.label}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {item.detail}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="border-b px-5 py-4">
            <h2 className="font-semibold">Operational signals</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Read-only client decisions, workflow activity, and integration health.
            </p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3">
            {operationalSummaries.map((summary, index) => {
              const Icon = summary.icon;

              return (
                <div
                  key={summary.label}
                  className={`flex gap-3 px-5 py-5 ${
                    index > 0 ? "border-t lg:border-l lg:border-t-0" : ""
                  }`}
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      {summary.label}
                    </p>
                    <p className="mt-1 text-sm font-semibold">{summary.value}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {summary.detail}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
