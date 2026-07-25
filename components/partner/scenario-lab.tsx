"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  LoaderCircle,
  Play,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import {
  runScenarioLabAction,
  setupScenarioLabAction,
  type ScenarioLabSetupResult,
} from "@/app/partner/lab/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ScenarioLabRunResult } from "@/lib/testing/scenario-runner";
import {
  getLabScenario,
  LAB_SCENARIOS,
  type LabFieldKey,
  type LabScenarioKey,
  type LabScenarioValues,
} from "@/lib/testing/scenarios";
import { cn } from "@/lib/utils";

export type ScenarioLabHistoryItem = {
  id: string;
  eventType: string;
  scenarioKey: string;
  status: string;
  createdAt: string;
};

type ScenarioLabProps = {
  labClient: { id: string; name: string } | null;
  history: ScenarioLabHistoryItem[];
};

function initialValues(key: string): LabScenarioValues {
  return { ...(getLabScenario(key)?.defaults ?? {}) };
}

function StatusIcon({ passed }: { passed: boolean }) {
  return passed ? (
    <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
  ) : (
    <XCircle className="size-4 text-destructive" aria-hidden="true" />
  );
}

export function ScenarioLab({ labClient, history }: ScenarioLabProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [scenarioKey, setScenarioKey] = useState<LabScenarioKey>(
    LAB_SCENARIOS[0].key,
  );
  const [values, setValues] = useState<LabScenarioValues>(() =>
    initialValues(LAB_SCENARIOS[0].key),
  );
  const [result, setResult] = useState<ScenarioLabRunResult | null>(null);
  const [setupResult, setSetupResult] =
    useState<ScenarioLabSetupResult | null>(null);
  const scenario = useMemo(
    () => getLabScenario(scenarioKey) ?? LAB_SCENARIOS[0],
    [scenarioKey],
  );

  const selectScenario = (key: LabScenarioKey) => {
    setScenarioKey(key);
    setValues(initialValues(key));
    setResult(null);
  };

  const updateValue = (key: LabFieldKey, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const prepare = () => {
    setSetupResult(null);
    startTransition(async () => {
      const next = await setupScenarioLabAction();
      setSetupResult(next);
      router.refresh();
    });
  };

  const run = () => {
    if (!labClient) {
      return;
    }

    setResult(null);
    startTransition(async () => {
      const next = await runScenarioLabAction({
        clientId: labClient.id,
        scenarioKey,
        values,
      });
      setResult(next);
      router.refresh();
    });
  };

  if (!labClient) {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <FlaskConical className="size-5" aria-hidden="true" />
          </div>
          <CardTitle className="pt-2 text-lg">Create the sandbox business</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-6 text-muted-foreground">
            The lab uses a dedicated client with sandbox workflows, approved
            test knowledge, the built-in CRM, and no live integrations.
          </p>
          <Button onClick={prepare} disabled={isPending}>
            {isPending ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <FlaskConical aria-hidden="true" />
            )}
            Prepare Scenario Lab
          </Button>
          {setupResult ? (
            <p
              className={cn(
                "text-sm",
                setupResult.status === "success"
                  ? "text-emerald-700"
                  : "text-destructive",
              )}
            >
              {setupResult.message}
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-950 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-700" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold">Isolated sandbox</p>
            <p className="mt-0.5 text-xs leading-5 text-emerald-800">
              {labClient.name} has no live provider connections. Calendar and
              phone boundaries are simulated.
            </p>
          </div>
        </div>
        <Badge className="w-fit border-emerald-300 bg-white text-emerald-800">
          Safe to run
        </Badge>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.72fr)]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">Run a scenario</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            <div className="space-y-2">
              <Label htmlFor="scenario">Scenario</Label>
              <Select
                id="scenario"
                value={scenarioKey}
                onChange={(event) =>
                  selectScenario(event.target.value as LabScenarioKey)
                }
                disabled={isPending}
              >
                {LAB_SCENARIOS.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.title}
                  </option>
                ))}
              </Select>
              <p className="text-xs leading-5 text-muted-foreground">
                {scenario.description}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {scenario.fields.map((field) => {
                const id = `lab-${field.key}`;
                const fieldValue = values[field.key] ?? "";
                const wide = field.type === "textarea";

                return (
                  <div
                    key={field.key}
                    className={cn("space-y-2", wide && "sm:col-span-2")}
                  >
                    <Label htmlFor={id}>{field.label}</Label>
                    {field.type === "textarea" ? (
                      <Textarea
                        id={id}
                        value={fieldValue}
                        onChange={(event) =>
                          updateValue(field.key, event.target.value)
                        }
                        placeholder={field.placeholder}
                        rows={5}
                        disabled={isPending}
                      />
                    ) : field.type === "select" ? (
                      <Select
                        id={id}
                        value={fieldValue}
                        onChange={(event) =>
                          updateValue(field.key, event.target.value)
                        }
                        disabled={isPending}
                      >
                        {(field.options ?? []).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        id={id}
                        value={fieldValue}
                        onChange={(event) =>
                          updateValue(field.key, event.target.value)
                        }
                        placeholder={field.placeholder}
                        disabled={isPending}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <Button onClick={run} disabled={isPending} className="w-full sm:w-auto">
              {isPending ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <Play aria-hidden="true" />
              )}
              Run {scenario.title}
            </Button>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">Result</CardTitle>
              {result?.status === "success" ? (
                <Badge
                  variant="outline"
                  className={cn(
                    result.passed
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-destructive/25 bg-destructive/5 text-destructive",
                  )}
                >
                  {result.passedAssertions}/{result.totalAssertions} passed
                </Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="pt-5">
            {!result && !isPending ? (
              <div className="py-8 text-center">
                <FlaskConical className="mx-auto size-7 text-muted-foreground/60" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium">No result yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Run the selected scenario to see its assertions.
                </p>
              </div>
            ) : null}

            {isPending ? (
              <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                Running the real workflow pipeline…
              </div>
            ) : null}

            {result && result.status === "error" ? (
              <div className="rounded-md border border-destructive/25 bg-destructive/5 p-4">
                <div className="flex items-start gap-2">
                  <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                  <p className="text-sm leading-6 text-destructive">
                    {result.message}
                  </p>
                </div>
              </div>
            ) : null}

            {result && result.status === "success" ? (
              <div className="space-y-5">
                <div>
                  <div className="flex items-start gap-2">
                    <StatusIcon passed={Boolean(result.passed)} />
                    <p className="text-sm font-medium leading-5">
                      {result.message}
                    </p>
                  </div>
                  {result.aiSources?.length ? (
                    <p className="mt-2 pl-6 text-xs text-muted-foreground">
                      Output source: {result.aiSources.join(", ")}
                    </p>
                  ) : null}
                </div>

                <div className="divide-y border-y">
                  {(result.assertions ?? []).map((assertion) => (
                    <div key={assertion.key} className="flex gap-3 py-3">
                      <StatusIcon passed={assertion.passed} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{assertion.label}</p>
                        <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                          {assertion.detail}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {result.links ? (
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(result.links).map(([label, href]) => (
                      <Button key={label} asChild variant="outline" size="sm">
                        <Link href={href}>
                          {label.charAt(0).toUpperCase() + label.slice(1)}
                          <ExternalLink aria-hidden="true" />
                        </Link>
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <section className="overflow-hidden rounded-md border bg-card">
        <div className="border-b px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold">Recent lab intake</h2>
        </div>
        {history.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No lab events have run yet.
          </p>
        ) : (
          <div className="divide-y">
            {history.map((item) => (
              <div
                key={item.id}
                className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4 sm:px-5"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {getLabScenario(item.scenarioKey)?.title ?? item.eventType}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.eventType}
                  </p>
                </div>
                <Badge variant="outline" className="w-fit">
                  {item.status}
                </Badge>
                <time className="text-xs text-muted-foreground">
                  {new Date(item.createdAt).toLocaleString()}
                </time>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
