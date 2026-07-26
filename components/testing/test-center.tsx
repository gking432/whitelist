"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  FlaskConical,
  ListChecks,
} from "lucide-react";

import {
  recordGuidedFeatureTest,
  runFeatureTest,
  type FeatureTestActionState,
} from "@/app/test-center/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  CapabilityKey,
  CapabilityStatus,
} from "@/lib/packages/capabilities";
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
  openByDefault,
}: {
  item: TestCenterItem;
  audience: "partner" | "client";
  clientId: string;
  canRun: boolean;
  isLive: boolean;
  activityHref: string;
  openByDefault: boolean;
}) {
  const router = useRouter();
  const [result, setResult] = useState<FeatureTestActionState>(
    initialFeatureTestState,
  );
  const [isPending, startTransition] = useTransition();
  const automated = item.testMode === "automated";

  return (
    <details className="group border-b last:border-b-0" open={openByDefault}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 sm:px-5 [&::-webkit-details-marker]:hidden">
        {item.latestStatus === "passed" ? (
          <CircleCheck
            className="size-5 shrink-0 text-emerald-600"
            aria-hidden="true"
          />
        ) : item.latestStatus === "failed" ? (
          <AlertTriangle
            className="size-5 shrink-0 text-rose-600"
            aria-hidden="true"
          />
        ) : (
          <CircleDashed
            className="size-5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{item.label}</span>
            <Badge variant="outline">{item.testMode}</Badge>
            {item.capabilityStatus !== "available" ? (
              <Badge variant="secondary">
                {item.capabilityStatus.replaceAll("_", " ")}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {item.whatWorks}
          </p>
          {item.latestAt ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Latest result{" "}
              {new Intl.DateTimeFormat("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              }).format(new Date(item.latestAt))}
            </p>
          ) : null}
        </div>
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>

      <div className="border-t bg-secondary/20 px-4 py-4 sm:px-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.55fr)]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              How to test it
            </p>
            <ol className="mt-3 space-y-3">
              {item.steps.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm leading-5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full border bg-card text-[11px] font-semibold">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="border-l-0 lg:border-l lg:pl-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Pass condition
            </p>
            <p className="mt-2 text-sm leading-6">{item.expectedResult}</p>
            {item.statusNote ? (
              <p className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-950">
                {item.statusNote}
              </p>
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
                    router.refresh();
                  })
                }
              >
                <FlaskConical aria-hidden="true" />
                {isPending ? "Running..." : "Run automated test"}
              </Button>
            ) : item.testMode === "guided" && audience === "partner" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={!canRun || isPending || isLive}
                  onClick={() =>
                    startTransition(async () => {
                      const next = await recordGuidedFeatureTest(
                        clientId,
                        item.capabilityKey as CapabilityKey,
                        "passed",
                      );
                      setResult(next);
                      router.refresh();
                    })
                  }
                >
                  <CircleCheck aria-hidden="true" />
                  {isPending ? "Saving..." : "Mark passed"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!canRun || isPending || isLive}
                  onClick={() =>
                    startTransition(async () => {
                      const next = await recordGuidedFeatureTest(
                        clientId,
                        item.capabilityKey as CapabilityKey,
                        "failed",
                      );
                      setResult(next);
                      router.refresh();
                    })
                  }
                >
                  <AlertTriangle aria-hidden="true" />
                  Needs work
                </Button>
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <ListChecks className="size-4" aria-hidden="true" />
                {item.testMode === "guided"
                  ? "Follow the steps above."
                  : "Not available in V1."}
              </div>
            )}

            {isLive && automated ? (
              <p className="mt-2 text-xs leading-5 text-amber-800">
                Automated synthetic tests are locked while live. Use a sandbox
                business or follow the guided verification steps.
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
                  <p className="mt-1">
                    {result.passedAssertions}/{result.totalAssertions} checks
                    passed.
                  </p>
                ) : null}
                {result.scenarioResults?.map((scenario) => (
                  <p key={scenario.title} className="mt-1">
                    {scenario.passed ? "Passed" : "Failed"}: {scenario.title}
                  </p>
                ))}
                <Link
                  href={activityHref}
                  className="mt-2 inline-block font-medium underline"
                >
                  Open activity
                </Link>
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
  nextHref,
}: {
  businessName: string;
  packageName: string;
  items: TestCenterItem[];
  audience: "partner" | "client";
  clientId: string;
  canRun: boolean;
  isLive: boolean;
  activityHref: string;
  nextHref?: string;
}) {
  const automatedCount = items.filter(
    (item) => item.testMode === "automated",
  ).length;
  const passedCount = items.filter(
    (item) => item.latestStatus === "passed",
  ).length;
  const allPassed = passedCount === items.length;
  const firstIncompleteIndex = items.findIndex(
    (item) => item.latestStatus !== "passed",
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">
            Step 4
          </p>
          <h2 className="mt-1 text-xl font-semibold">Verify {packageName}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Test every feature installed for {businessName}. Automated checks
            run inside Northstar; guided checks prove the real staff and
            provider experience.
          </p>
        </div>
        <div className="shrink-0 text-left sm:text-right">
          <p className="text-2xl font-semibold tabular-nums">
            {passedCount}/{items.length}
          </p>
          <p className="text-xs text-muted-foreground">features passed</p>
        </div>
      </header>

      <section
        aria-label="Test Center progress"
        className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-3"
      >
        <div className="px-4 py-3.5">
          <p className="text-xs text-muted-foreground">Automated checks</p>
          <p className="mt-1 text-sm font-semibold">{automatedCount}</p>
        </div>
        <div className="border-t px-4 py-3.5 sm:border-l sm:border-t-0">
          <p className="text-xs text-muted-foreground">Guided checks</p>
          <p className="mt-1 text-sm font-semibold">
            {items.length - automatedCount}
          </p>
        </div>
        <div className="border-t px-4 py-3.5 sm:border-l sm:border-t-0">
          <p className="text-xs text-muted-foreground">Next step</p>
          <p className="mt-1 text-sm font-semibold">
            {allPassed ? "Launch review" : "Finish verification"}
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border bg-card">
        {items.map((item, index) => (
          <FeatureTestCard
            key={item.capabilityKey}
            item={item}
            audience={audience}
            clientId={clientId}
            canRun={canRun}
            isLive={isLive}
            activityHref={activityHref}
            openByDefault={index === firstIncompleteIndex}
          />
        ))}
      </section>

      {nextHref ? (
        <section
          className={`flex flex-col gap-3 border-l-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between ${
            allPassed
              ? "border-emerald-500 bg-emerald-50/70"
              : "border-amber-400 bg-amber-50/60"
          }`}
        >
          <div>
            <p className="font-semibold">
              {allPassed
                ? "Package verification complete"
                : `${items.length - passedCount} feature${
                    items.length - passedCount === 1 ? "" : "s"
                  } still need a passing result`}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {allPassed
                ? "Review the release gates and activation targets before going live."
                : "Open the next unfinished feature and follow its exact test steps."}
            </p>
          </div>
          {allPassed ? (
            <Button asChild className="shrink-0">
              <Link href={nextHref}>
                Continue to Launch
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <Button disabled className="shrink-0">
              Launch review locked
            </Button>
          )}
        </section>
      ) : null}
    </div>
  );
}
