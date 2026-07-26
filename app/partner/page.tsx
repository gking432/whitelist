import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Plus,
  Settings2,
  UsersRound,
  Workflow,
} from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import {
  getPartnerDashboardData,
  PartnerDashboardDataError,
  type AttentionSeverity,
  type ClientHealthStatus,
  type PartnerDashboardData,
} from "@/lib/dashboard/partner-dashboard";
import {
  deliveryStageHref,
  type PartnerDeliveryStage,
} from "@/lib/dashboard/partner-delivery";
import { formatDate, formatEnum } from "@/lib/format";
import { partnerOnboardingIsComplete } from "@/lib/onboarding/partner";
import {
  isAccessError,
  requirePrimaryPartnerAccess,
} from "@/lib/permissions/access";
import type { AccessContext } from "@/lib/permissions/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Agency Overview",
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

const deliveryStages: Array<{
  stage: PartnerDeliveryStage;
  label: string;
  description: string;
}> = [
  {
    stage: "package",
    label: "Package",
    description: "Choose what the client bought",
  },
  {
    stage: "setup",
    label: "Setup",
    description: "Connect accounts and configure",
  },
  {
    stage: "test",
    label: "Test",
    description: "Verify each installed feature",
  },
  {
    stage: "launch",
    label: "Launch",
    description: "Review and switch on",
  },
  {
    stage: "live",
    label: "Live",
    description: "Monitor activity and issues",
  },
];

const deliveryStageStyles: Record<PartnerDeliveryStage, string> = {
  package: "border-slate-200 bg-slate-50 text-slate-700",
  setup: "border-sky-200 bg-sky-50 text-sky-800",
  test: "border-amber-200 bg-amber-50 text-amber-900",
  launch: "border-violet-200 bg-violet-50 text-violet-800",
  live: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

const deliveryStageActions: Record<PartnerDeliveryStage, string> = {
  package: "Assign package",
  setup: "Continue setup",
  test: "Run tests",
  launch: "Launch client",
  live: "View activity",
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

export default async function PartnerPage({
  searchParams,
}: {
  searchParams: Promise<{ onboarding?: string }>;
}) {
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

  const supabase = await createSupabaseServerClient();
  const { data: onboarding } = supabase
    ? await supabase
        .from("partner_onboarding")
        .select("status, completed_at")
        .eq("partner_id", access.partnerId)
        .maybeSingle()
    : { data: null };

  if (!partnerOnboardingIsComplete(onboarding)) {
    redirect("/partner/onboarding");
  }

  const params = await searchParams;
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
            <AlertTriangle
              className="mt-0.5 size-5 shrink-0 text-destructive"
              aria-hidden="true"
            />
            <div>
              <h1 className="text-lg font-semibold">Overview unavailable</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Client delivery data could not be loaded. Try again after the
                data service is available.
              </p>
            </div>
          </div>
        </section>
      </AppShell>
    );
  }

  const metrics = [
    {
      label: "Active clients",
      value: dashboard.metrics.activeClients,
      detail: `${dashboard.metrics.totalClients} total client businesses`,
      icon: UsersRound,
    },
    {
      label: "In onboarding",
      value: dashboard.metrics.onboardingClients,
      detail: "Clients not live yet",
      icon: Settings2,
    },
    {
      label: "Needs attention",
      value: dashboard.metrics.clientsNeedingAttention,
      detail: "Clients with an issue to review",
      icon: AlertTriangle,
    },
    {
      label: "Failed runs",
      value: dashboard.metrics.failedRuns7d,
      detail: `${dashboard.metrics.totalRuns7d} automation runs in 7 days`,
      icon: Workflow,
    },
  ];

  const deliveryCounts = new Map<PartnerDeliveryStage, number>();
  for (const stage of deliveryStages) {
    deliveryCounts.set(
      stage.stage,
      dashboard.clients.filter(
        (client) => client.deliveryStage === stage.stage,
      ).length,
    );
  }

  const displayedClients = dashboard.clients.slice(0, 10);
  const displayedAttention = dashboard.attentionItems.slice(0, 6);
  const canAddClient =
    !access.isImpersonating || access.impersonationMode === "sandbox_full";

  return (
    <AppShell
      organizationName={dashboard.partner.name}
      userEmail={user.email ?? "Authenticated user"}
      activeNav="dashboard"
    >
      <div className="space-y-6">
        {params.onboarding === "complete" ? (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <p>
              Partner setup is complete. Your agency workspace is ready for its
              first client.
            </p>
          </div>
        ) : null}
        <header className="flex flex-col gap-4 border-b pb-5 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Agency overview</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Run sales and client delivery from one place.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/partner/agency">Open sales CRM</Link>
            </Button>
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

        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-semibold">Client delivery</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Every client moves through the same path from sale to live
                service.
              </p>
            </div>
            <Link
              href="/partner/clients"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              All clients
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>

          <div className="grid border-b sm:grid-cols-5">
            {deliveryStages.map((item, index) => (
              <div
                key={item.stage}
                className={`min-w-0 px-4 py-4 ${
                  index > 0 ? "border-t sm:border-l sm:border-t-0" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    {item.label}
                  </p>
                  <span className="text-lg font-semibold tabular-nums">
                    {deliveryCounts.get(item.stage) ?? 0}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {item.description}
                </p>
              </div>
            ))}
          </div>

          {displayedClients.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center">
              <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <UsersRound className="size-5" aria-hidden="true" />
              </div>
              <h3 className="mt-4 font-semibold">Add your first client</h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                Create the client business, assign its package, connect its
                accounts, test the features, and launch.
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
                  className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1.3fr)_0.8fr_0.7fr_auto] md:items-center"
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
                    <p className="mb-1.5 text-xs text-muted-foreground">
                      Current step
                    </p>
                    <Badge
                      variant="outline"
                      className={deliveryStageStyles[client.deliveryStage]}
                    >
                      {formatEnum(client.deliveryStage)}
                    </Badge>
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs text-muted-foreground">
                      Health
                    </p>
                    <Badge
                      variant="outline"
                      className={healthStyles[client.health]}
                    >
                      {formatEnum(client.health)}
                    </Badge>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link
                      href={deliveryStageHref(client.id, client.deliveryStage)}
                    >
                      {deliveryStageActions[client.deliveryStage]}
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section
          aria-label="Agency metrics"
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

        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="border-b px-5 py-4">
            <h2 className="font-semibold">Needs attention</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Problems that may affect a client&apos;s service.
            </p>
          </div>

          {displayedAttention.length === 0 ? (
            <div className="flex items-center gap-3 px-5 py-5">
              <CheckCircle2
                className="size-5 shrink-0 text-emerald-600"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-semibold">Everything looks clear</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  No client currently needs partner attention.
                </p>
              </div>
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
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <p className="truncate text-sm font-semibold">
                        {item.clientName}
                      </p>
                      <p className="text-xs font-medium">{item.label}</p>
                    </div>
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
    </AppShell>
  );
}
