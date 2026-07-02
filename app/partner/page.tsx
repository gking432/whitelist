import {
  AlertTriangle,
  BellCheck,
  CheckCircle2,
  Clock3,
  PlugZap,
  ShieldAlert,
  UsersRound,
  Workflow,
} from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getPartnerDashboardData,
  PartnerDashboardDataError,
  type AttentionSeverity,
  type ClientHealth,
  type ClientStatus,
  type PartnerDashboardData,
} from "@/lib/dashboard/partner-dashboard";
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

const clientStatusLabels: Record<ClientStatus, string> = {
  onboarding: "Onboarding",
  active: "Active",
  paused: "Paused",
  at_risk: "At risk",
  archived: "Archived",
};

const healthLabels: Record<ClientHealth, string> = {
  healthy: "Healthy",
  onboarding: "Setup",
  needs_attention: "Needs attention",
};

const healthStyles: Record<ClientHealth, string> = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-800",
  onboarding: "border-sky-200 bg-sky-50 text-sky-800",
  needs_attention: "border-amber-200 bg-amber-50 text-amber-900",
};

const attentionStyles: Record<AttentionSeverity, string> = {
  critical: "bg-destructive",
  warning: "bg-amber-500",
  setup: "bg-sky-500",
};

const enumLabels: Record<string, string> = {
  external_crm_only: "External CRM",
  mirror: "Mirror",
  assist: "Assist",
  primary_crm: "Primary CRM",
  webhook_only: "Webhook only",
  none: "None",
  sandbox: "Sandbox",
  dry_run: "Dry run",
  live: "Live",
  paused: "Paused",
};

function formatEnum(value: string) {
  return enumLabels[value] ?? value.replaceAll("_", " ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

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
      detail: "Operational client accounts",
      icon: UsersRound,
    },
    {
      label: "Active now",
      value: dashboard.metrics.activeClients,
      detail: "Clients in active status",
      icon: CheckCircle2,
    },
    {
      label: "Needs attention",
      value: dashboard.metrics.clientsNeedingAttention,
      detail: "Setup, paused, or at-risk",
      icon: AlertTriangle,
    },
    {
      label: "Onboarding",
      value: dashboard.metrics.onboardingClients,
      detail: "Clients still in setup",
      icon: Clock3,
    },
  ];

  const operationalSummaries = [
    {
      label: "Open approvals",
      value: "0 open",
      detail: "No approval items are waiting.",
      icon: BellCheck,
    },
    {
      label: "Failed runs",
      value: "0 recent",
      detail: "No workflow failures are recorded.",
      icon: Workflow,
    },
    {
      label: "Integration health",
      value: "No connections",
      detail: "No integration health signals are recorded.",
      icon: PlugZap,
    },
  ];

  const displayedClients = dashboard.clients.slice(0, 8);
  const displayedAttention = dashboard.attentionItems.slice(0, 5);

  return (
    <AppShell
      organizationName={dashboard.partner.name}
      userEmail={user.email ?? "Authenticated user"}
    >
      <div className="space-y-7">
        <header className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Badge variant="secondary" className="mb-3">
              Partner dashboard
            </Badge>
            <h1 className="text-2xl font-semibold tracking-normal">
              Client operations
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Health and attention across {dashboard.partner.name} client
              businesses.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">{dashboard.partner.status}</Badge>
            <Badge variant="outline">{access.role}</Badge>
          </div>
        </header>

        <section
          aria-label="Partner metrics"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          {metrics.map((metric) => {
            const Icon = metric.icon;

            return (
              <Card key={metric.label} className="shadow-none">
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
              <span className="text-xs tabular-nums text-muted-foreground">
                {dashboard.clients.length} total
              </span>
            </div>

            {displayedClients.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center">
                <div className="flex size-11 items-center justify-center rounded-md bg-secondary text-primary">
                  <UsersRound className="size-5" aria-hidden="true" />
                </div>
                <h3 className="mt-4 font-semibold">No client businesses yet</h3>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                  Add the first client business to begin tracking operational
                  health and attention.
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {displayedClients.map((client) => (
                  <div
                    key={client.id}
                    className="grid gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1.3fr)_0.8fr] lg:grid-cols-[minmax(0,1.2fr)_0.75fr_0.8fr_0.65fr]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {client.name}
                      </p>
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
                          {healthLabels[client.health]}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {clientStatusLabels[client.status]}
                        </span>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Operating mode
                      </p>
                      <p className="mt-1.5 text-sm font-medium">
                        {formatEnum(client.crmOperatingMode)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatEnum(client.runtimeMode)} runtime
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Client portal
                      </p>
                      <p className="mt-1.5 text-sm font-medium">
                        {client.clientPortalEnabled ? "Enabled" : "Disabled"}
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
                  <div key={item.clientId} className="flex gap-3 px-5 py-4">
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
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="border-b px-5 py-4">
            <h2 className="font-semibold">Operational signals</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Current approval, workflow, and integration state.
            </p>
          </div>
          <div className="grid lg:grid-cols-3">
            {operationalSummaries.map((summary, index) => {
              const Icon = summary.icon;

              return (
                <div
                  key={summary.label}
                  className={`flex gap-3 px-5 py-5 ${
                    index > 0 ? "border-t lg:border-l lg:border-t-0" : ""
                  }`}
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-primary">
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
