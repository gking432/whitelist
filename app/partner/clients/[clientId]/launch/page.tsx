import Link from "next/link";
import {
  AlertTriangle,
  CircleCheck,
  CircleDashed,
  FlaskConical,
  Radio,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";

import { LaunchActions } from "@/components/partner/launch-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { loadClientLaunchContext } from "@/lib/launch/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata = { title: "Launch Control" };
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ clientId: string }>;
};

const statusMeta = {
  setup: {
    label: "Setup required",
    detail: "Deploy a package, then return here to test it.",
    className: "border-amber-200 bg-amber-50 text-amber-950",
    icon: CircleDashed,
  },
  sandbox: {
    label: "Sandbox ready",
    detail: "Run the package tests, then finish any required provider connections.",
    className: "border-sky-200 bg-sky-50 text-sky-950",
    icon: FlaskConical,
  },
  testing: {
    label: "Testing",
    detail: "Package scenarios are running in sandbox.",
    className: "border-sky-200 bg-sky-50 text-sky-950",
    icon: FlaskConical,
  },
  blocked: {
    label: "Needs attention",
    detail: "Review the failed gate below before launch.",
    className: "border-rose-200 bg-rose-50 text-rose-950",
    icon: AlertTriangle,
  },
  tested: {
    label: "Tests passed",
    detail: "Finish the remaining connections to unlock go-live.",
    className: "border-sky-200 bg-sky-50 text-sky-950",
    icon: ShieldCheck,
  },
  ready: {
    label: "Ready to launch",
    detail: "Every gate is green. Review the targets and confirm go-live.",
    className: "border-emerald-200 bg-emerald-50 text-emerald-950",
    icon: ShieldCheck,
  },
  live: {
    label: "Live",
    detail: "Package workflows and required provider connections are active.",
    className: "border-emerald-300 bg-emerald-50 text-emerald-950",
    icon: Radio,
  },
  rolled_back: {
    label: "Rolled back",
    detail: "Pre-launch runtime modes were restored. Retest before launching again.",
    className: "border-zinc-300 bg-zinc-50 text-zinc-900",
    icon: RotateCcw,
  },
} as const;

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function ClientLaunchPage({ params }: PageProps) {
  const { clientId } = await params;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind !== "ok") return null;

  const supabase = await createSupabaseServerClient();
  if (!supabase || !workspace.access.partnerId) return null;

  let context;

  try {
    context = await loadClientLaunchContext(supabase, {
      partnerId: workspace.access.partnerId,
      clientId,
    });
  } catch {
    return (
      <section className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-sm text-rose-950">
        Launch Control could not load. Try again shortly.
      </section>
    );
  }

  const launch = context.latestLaunch;
  const statusKey = !context.package || !context.deployment
    ? "setup"
    : launch?.status === "live"
      ? "live"
      : launch?.status === "rolled_back"
        ? "rolled_back"
        : launch?.status === "testing"
          ? "testing"
          : launch?.status === "blocked" || launch?.status === "failed"
            ? "blocked"
            : launch?.status === "ready" && context.readiness.canGoLive
              ? "ready"
              : launch?.status === "ready"
                ? "tested"
                : "sandbox";
  const meta = statusMeta[statusKey];
  const StatusIcon = meta.icon;
  const targetWorkflows = context.workflows.filter((workflow) =>
    context.readiness.targetWorkflowIds.includes(workflow.id),
  );
  const targetConnections = context.connections.filter((connection) =>
    context.readiness.targetConnectionIds.includes(connection.id),
  );
  const canManage =
    workspace.access.canManageWorkflows &&
    workspace.access.canManageIntegrations;

  return (
    <div className="space-y-5">
      <section className={cn("rounded-lg border px-5 py-5", meta.className)}>
        <div className="flex items-start gap-3">
          <StatusIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider">
              Launch Control
            </p>
            <h2 className="mt-1 text-xl font-semibold">{meta.label}</h2>
            <p className="mt-1 text-sm leading-6 opacity-80">{meta.detail}</p>
            {context.package ? (
              <p className="mt-2 text-sm font-medium">
                {context.package.name}
                {launch?.launched_at
                  ? ` · Launched ${formatDate(launch.launched_at)}`
                  : launch?.rolled_back_at
                    ? ` · Rolled back ${formatDate(launch.rolled_back_at)}`
                    : ""}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
        <section className="rounded-lg border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Release gates</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                All four gates are checked again when you tap Go live.
              </p>
            </div>
            <Badge variant="outline">
              {context.readiness.gates.filter((gate) => gate.passed).length}/4
            </Badge>
          </div>

          <div className="mt-4 divide-y border-y">
            {context.readiness.gates.map((gate) => (
              <div key={gate.key} className="flex items-start gap-3 py-3.5">
                {gate.passed ? (
                  <CircleCheck
                    className="mt-0.5 size-5 shrink-0 text-emerald-600"
                    aria-hidden="true"
                  />
                ) : (
                  <CircleDashed
                    className="mt-0.5 size-5 shrink-0 text-amber-600"
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium">{gate.label}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    {gate.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {context.readiness.blockers.length > 0 && statusKey !== "live" ? (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-950">
              <p className="font-medium">Next action</p>
              <p className="mt-1 leading-5">{context.readiness.blockers[0]}</p>
              {!context.package || !context.deployment ? (
                <Button asChild variant="outline" size="sm" className="mt-3 bg-white/70">
                  <Link href={`/partner/clients/${clientId}/setup`}>Open setup</Link>
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="rounded-lg border bg-card p-5">
          <h3 className="font-semibold">
            {statusKey === "live" ? "Live controls" : "Launch actions"}
          </h3>
          <p className="mb-4 mt-1 text-sm leading-6 text-muted-foreground">
            Tests use synthetic customer data. Real sending stays off until Go live.
          </p>
          <LaunchActions
            clientId={clientId}
            launchId={launch?.id ?? null}
            launchStatus={launch?.status ?? null}
            canManage={canManage}
            canRunTests={context.readiness.canRunTests}
            canGoLive={context.readiness.canGoLive}
          />
        </section>
      </div>

      <section className="rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold">Activation targets</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Only these package resources switch to live.
            </p>
          </div>
          <Badge variant="secondary">
            {targetWorkflows.length + targetConnections.length} targets
          </Badge>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Workflows
            </p>
            <div className="mt-2 space-y-2">
              {targetWorkflows.length > 0 ? (
                targetWorkflows.map((workflow) => (
                  <div key={workflow.id} className="flex items-center justify-between gap-3 border-b pb-2 text-sm">
                    <span className="min-w-0 truncate">{workflow.name}</span>
                    <Badge variant="outline">{workflow.runtimeMode}</Badge>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No workflow targets yet.</p>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Connections
            </p>
            <div className="mt-2 space-y-2">
              {targetConnections.length > 0 ? (
                targetConnections.map((connection) => (
                  <div key={connection.id} className="flex items-center justify-between gap-3 border-b pb-2 text-sm">
                    <span className="min-w-0 truncate">{connection.displayName}</span>
                    <Badge variant="outline">{connection.runtimeMode}</Badge>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No connected targets yet.</p>
              )}
            </div>
          </div>
        </div>
      </section>

      {context.latestTestRuns.length > 0 ? (
        <section className="rounded-lg border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">Latest package tests</h3>
            {launch?.tests_completed_at ? (
              <span className="text-xs text-muted-foreground">
                {formatDate(launch.tests_completed_at)}
              </span>
            ) : null}
          </div>
          <div className="mt-3 divide-y border-y">
            {context.latestTestRuns.map((testRun) => {
              const passedAssertions =
                typeof testRun.result.passedAssertions === "number"
                  ? testRun.result.passedAssertions
                  : null;
              const totalAssertions =
                typeof testRun.result.totalAssertions === "number"
                  ? testRun.result.totalAssertions
                  : null;

              return (
                <div key={testRun.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    {testRun.status === "passed" ? (
                      <CircleCheck className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="size-4 shrink-0 text-rose-600" aria-hidden="true" />
                    )}
                    <span className="truncate text-sm font-medium">{testRun.scenario_title}</span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {passedAssertions !== null && totalAssertions !== null
                      ? `${passedAssertions}/${totalAssertions} checks`
                      : testRun.status}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {context.requirements && context.requirements.limitations.length > 0 ? (
        <section className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
          <p className="font-semibold">Package limits</p>
          <ul className="mt-1.5 space-y-1 leading-5">
            {context.requirements.limitations.map(({ capability, note }) => (
              <li key={capability.key}>
                <span className="font-medium">{capability.label}:</span> {note}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
