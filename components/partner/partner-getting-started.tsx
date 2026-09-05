import Link from "next/link";
import { ArrowRight, Check, Circle } from "lucide-react";

import { Button } from "@/components/ui/button";

// The partner on-ramp: a "start here" guide that turns the pile of tabs
// into a walkable path. It reads state the dashboard already computed and
// points at the single next concrete step. Once all three are done the
// partner is oriented and the dashboard hides it (see shouldShowGetting
// Started).

export type GettingStartedStep = {
  title: string;
  detail: string;
  done: boolean;
  href: string;
  cta: string;
};

export function shouldShowGettingStarted(input: {
  totalClients: number;
  activeWorkflows: number;
  totalRuns7d: number;
}): boolean {
  const allDone =
    input.totalClients > 0 &&
    input.activeWorkflows > 0 &&
    input.totalRuns7d > 0;

  return !allDone;
}

export function buildGettingStartedSteps(input: {
  totalClients: number;
  activeWorkflows: number;
  totalRuns7d: number;
  targetClientId: string | null;
  targetClientName: string | null;
}): GettingStartedStep[] {
  const setupHref = input.targetClientId
    ? `/partner/clients/${input.targetClientId}/setup`
    : "/partner/clients/new";
  const clientLabel = input.targetClientName ?? "your client";

  return [
    {
      title: "Add your first client business",
      detail:
        "Create the business you're implementing for. You can use your own details as a test business — you don't need a real client to try everything.",
      done: input.totalClients > 0,
      href: "/partner/clients/new",
      cta: "Add a client",
    },
    {
      title: "Finish the setup checklist",
      detail: `Pick the package you sold ${clientLabel}, connect the lead source and any providers the package needs, and enable its workflows. Everything starts in dry run — nothing goes live until you switch it.`,
      done: input.activeWorkflows > 0,
      href: setupHref,
      cta: "Open setup",
    },
    {
      title: "Send a test lead and watch it work",
      detail:
        "Fire a realistic sample lead through the real pipeline — AI analysis, a customer-facing draft, and a CRM entry — with nothing connected and nothing really sent. This is the fastest way to see what the product does.",
      done: input.totalRuns7d > 0,
      href: setupHref,
      cta: "Go to the test step",
    },
  ];
}

export function PartnerGettingStarted({
  steps,
}: {
  steps: GettingStartedStep[];
}) {
  const currentIndex = steps.findIndex((step) => !step.done);
  const completed = steps.filter((step) => step.done).length;

  return (
    <section className="overflow-hidden rounded-lg border border-primary/25 bg-primary/[0.03]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/15 px-5 py-4">
        <div>
          <h2 className="font-semibold">Start here</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Three steps to your first working client. You can do it all with a
            test business — no real client needed yet.
          </p>
        </div>
        <span className="text-xs font-medium tabular-nums text-muted-foreground">
          {completed} / {steps.length} done
        </span>
      </div>

      <ol className="divide-y divide-primary/10">
        {steps.map((step, index) => {
          const isCurrent = index === currentIndex;

          return (
            <li
              key={step.title}
              className={`flex gap-4 px-5 py-4 ${
                isCurrent ? "bg-primary/[0.04]" : ""
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {step.done ? (
                  <span className="flex size-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <Check className="size-3.5" aria-hidden="true" />
                  </span>
                ) : (
                  <span
                    className={`flex size-6 items-center justify-center rounded-full border text-xs font-semibold ${
                      isCurrent
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-muted-foreground/30 text-muted-foreground"
                    }`}
                  >
                    {isCurrent ? (
                      <Circle className="size-2 fill-current" aria-hidden="true" />
                    ) : (
                      index + 1
                    )}
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-semibold ${
                    step.done ? "text-muted-foreground line-through" : ""
                  }`}
                >
                  {step.title}
                </p>
                {!step.done ? (
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {step.detail}
                  </p>
                ) : null}
                {isCurrent ? (
                  <Button asChild size="sm" variant="gold" className="mt-3">
                    <Link href={step.href}>
                      {step.cta}
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
