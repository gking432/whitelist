"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  FlaskConical,
  ListChecks,
} from "lucide-react";

import {
  runFeatureTest,
  type FeatureTestActionState,
} from "@/app/test-center/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CapabilityKey, CapabilityStatus } from "@/lib/packages/capabilities";
import type { FeatureTestDefinition } from "@/lib/testing/test-center";
import { cn } from "@/lib/utils";

export type TestCenterItem = FeatureTestDefinition & {
  label: string;
  capabilityStatus: CapabilityStatus;
  statusNote: string | null;
  latestStatus: "passed" | "failed" | null;
  latestAt: string | null;
};

const initialFeatureTestState: FeatureTestActionState = { status: "idle" };

function FeatureTestCard({
  item,
  audience,
  clientId,
  canRun,
  isLive,
  activityHref,
}: {
  item: TestCenterItem;
  audience: "partner" | "client";
  clientId: string;
  canRun: boolean;
  isLive: boolean;
  activityHref: string;
}) {
  const [result, setResult] = useState<FeatureTestActionState>(
    initialFeatureTestState,
  );
  const [isPending, startTransition] = useTransition();
  const automated = item.testMode === "automated";

  return (
    <details className="group border-b last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 sm:px-5">
        {item.latestStatus === "passed" ? (
          <CircleCheck className="size-5 shrink-0 text-emerald-600" aria-hidden="true" />
        ) : item.latestStatus === "failed" ? (
          <AlertTriangle className="size-5 shrink-0 text-rose-600" aria-hidden="true" />
        ) : (
          <CircleDashed className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{item.label}</span>
            <Badge variant="outline">{item.testMode}</Badge>
            {item.capabilityStatus !== "available" ? (
              <Badge variant="secondary">{item.capabilityStatus.replaceAll("_", " ")}</Badge>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {item.whatWorks}
          </p>
        </div>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>

      <div className="border-t bg-secondary/20 px-4 py-4 sm:px-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.55fr)]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">How to test it</p>
            <ol className="mt-3 space-y-3">
              {item.steps.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm leading-5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full border bg-card text-[11px] font-semibold">{index + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="border-l-0 lg:border-l lg:pl-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pass condition</p>
            <p className="mt-2 text-sm leading-6">{item.expectedResult}</p>
            {item.statusNote ? (
              <p className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-950">{item.statusNote}</p>
            ) : null}

            {automated ? (
              <Button
                type="button"
                size="sm"
                className="mt-4 w-full sm:w-auto"
                disabled={!canRun || isPending || isLive}
                onClick={() =>
                  startTransition(async () => {
                    const next = await runFeatureTest(
                      audience,
                      clientId,
                      item.capabilityKey as CapabilityKey,
                      initialFeatureTestState,
                      new FormData(),
                    );
                    setResult(next);
                  })
                }
              >
                <FlaskConical aria-hidden="true" />
                {isPending ? "Running..." : "Run automated test"}
              </Button>
            ) : (
              <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <ListChecks className="size-4" aria-hidden="true" />
                {item.testMode === "guided" ? "Follow the steps above." : "Not available in V1."}
              </div>
            )}

            {isLive && automated ? (
              <p className="mt-2 text-xs leading-5 text-amber-800">
                Automated synthetic tests are locked while live. Use a sandbox business or follow the guided verification steps.
              </p>
            ) : null}

            {result.status !== "idle" ? (
              <div
                className={cn(
                  "mt-3 rounded-md border px-3 py-2 text-xs leading-5",
                  result.status === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-rose-200 bg-rose-50 text-rose-900",
                )}
              >
                <p className="font-medium">{result.message}</p>
                {result.totalAssertions !== undefined ? (
                  <p className="mt-1">{result.passedAssertions}/{result.totalAssertions} checks passed.</p>
                ) : null}
                {result.scenarioResults?.map((scenario) => (
                  <p key={scenario.title} className="mt-1">
                    {scenario.passed ? "Passed" : "Failed"}: {scenario.title}
                  </p>
                ))}
                <Link href={activityHref} className="mt-2 inline-block font-medium underline">Open activity</Link>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </details>
  );
}

export function TestCenter({
  businessName,
  packageName,
  items,
  audience,
  clientId,
  canRun,
  isLive,
  activityHref,
}: {
  businessName: string;
  packageName: string;
  items: TestCenterItem[];
  audience: "partner" | "client";
  clientId: string;
  canRun: boolean;
  isLive: boolean;
  activityHref: string;
}) {
  const automatedCount = items.filter((item) => item.testMode === "automated").length;
  const passedCount = items.filter((item) => item.latestStatus === "passed").length;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Test Center</p>
        <h1 className="mt-1 text-xl font-semibold">{businessName}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {packageName} includes {items.length} feature{items.length === 1 ? "" : "s"}. Open any feature for exact test steps and pass conditions.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant="outline">{passedCount}/{items.length} passed</Badge>
          <Badge variant="outline">{automatedCount} automated</Badge>
          <Badge variant="outline">{items.length - automatedCount} guided or pending</Badge>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border bg-card">
        {items.map((item) => (
          <FeatureTestCard
            key={item.capabilityKey}
            item={item}
            audience={audience}
            clientId={clientId}
            canRun={canRun}
            isLive={isLive}
            activityHref={activityHref}
          />
        ))}
      </section>
    </div>
  );
}
