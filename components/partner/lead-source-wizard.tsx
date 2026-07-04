"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";

import { saveLeadSourceProfile } from "@/app/partner/clients/[clientId]/setup/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  LEAD_SOURCE_KEYS,
  WEBSITE_PLATFORM_KEYS,
  leadSourceLabels,
  websitePlatformLabels,
  type IntakeAnswers,
  type LeadSourceKey,
  type WebsitePlatformKey,
  type YesNoUnsure,
} from "@/lib/lead-sources/catalog";
import { recommendSetupPlan } from "@/lib/lead-sources/recommend";
import { cn } from "@/lib/utils";

type LeadSourceWizardProps = {
  clientId: string;
  clientName: string;
  initialAnswers: IntakeAnswers;
  hasSavedPlan: boolean;
  canManage: boolean;
};

const steps = ["Lead sources", "Website", "Existing tools", "Setup plan"];

const yesNoUnsureOptions: { value: YesNoUnsure; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
];

function ChoiceChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-card text-muted-foreground hover:bg-secondary",
      )}
    >
      {children}
    </button>
  );
}

function QuestionRow({
  question,
  value,
  onChange,
}: {
  question: string;
  value: YesNoUnsure;
  onChange: (value: YesNoUnsure) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm font-medium">{question}</p>
      <div className="flex gap-1.5">
        {yesNoUnsureOptions.map((option) => (
          <ChoiceChip
            key={option.value}
            selected={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </ChoiceChip>
        ))}
      </div>
    </div>
  );
}

export function LeadSourceWizard({
  clientId,
  clientName,
  initialAnswers,
  hasSavedPlan,
  canManage,
}: LeadSourceWizardProps) {
  const [step, setStep] = useState(hasSavedPlan ? 3 : 0);
  const [answers, setAnswers] = useState<IntakeAnswers>(initialAnswers);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isPending, startTransition] = useTransition();

  const plan = useMemo(() => recommendSetupPlan(answers), [answers]);
  const base = `/partner/clients/${clientId}`;

  const toggleSource = (source: LeadSourceKey) => {
    setAnswers((current) => ({
      ...current,
      leadSources: current.leadSources.includes(source)
        ? current.leadSources.filter((item) => item !== source)
        : [...current.leadSources, source],
    }));
  };

  const setPlatform = (platform: WebsitePlatformKey) => {
    setAnswers((current) => ({ ...current, websitePlatform: platform }));
  };

  const canContinue =
    step === 0 ? answers.leadSources.length > 0 : true;

  const save = () =>
    startTransition(async () => {
      const result = await saveLeadSourceProfile(clientId, answers);
      setMessage(result.message ?? null);
      setIsError(result.status === "error");
    });

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <ol className="flex flex-wrap items-center gap-2">
        {steps.map((label, index) => {
          const isCurrent = index === step;
          const isDone = index < step;

          return (
            <li key={label} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => index < step && setStep(index)}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  isCurrent
                    ? "border-primary bg-primary text-primary-foreground"
                    : isDone
                      ? "border-primary/30 bg-primary/8 text-primary"
                      : "bg-card text-muted-foreground",
                )}
              >
                {isDone ? <Check className="size-3" aria-hidden="true" /> : null}
                {label}
              </button>
              {index < steps.length - 1 ? (
                <span className="text-muted-foreground/40">—</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {step === 0 ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">
              Where do {clientName}&apos;s leads come from?
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick everything that applies — each source gets its own setup
              path.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {LEAD_SOURCE_KEYS.map((source) => {
              const info = leadSourceLabels[source];
              const selected = answers.leadSources.includes(source);

              return (
                <button
                  key={source}
                  type="button"
                  onClick={() => toggleSource(source)}
                  className={cn(
                    "rounded-xl border bg-card p-4 text-left transition-colors",
                    selected
                      ? "border-primary/50 bg-primary/4 ring-1 ring-primary/30"
                      : "hover:border-primary/25",
                  )}
                >
                  <span className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{info.label}</span>
                    <span
                      className={cn(
                        "flex size-5 items-center justify-center rounded-full border transition-colors",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input",
                      )}
                    >
                      {selected ? (
                        <Check className="size-3" aria-hidden="true" />
                      ) : null}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {info.description}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold">
              What website platform do they use?
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This decides whether plugins, snippets, or hosted pages are the
              easiest path.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {WEBSITE_PLATFORM_KEYS.map((platform) => (
              <ChoiceChip
                key={platform}
                selected={answers.websitePlatform === platform}
                onClick={() => setPlatform(platform)}
              >
                {websitePlatformLabels[platform]}
              </ChoiceChip>
            ))}
          </div>
          {answers.websitePlatform !== "none" ? (
            <QuestionRow
              question="Can you (or the client) edit the website?"
              value={answers.canEditWebsite}
              onChange={(value) =>
                setAnswers((current) => ({ ...current, canEditWebsite: value }))
              }
            />
          ) : null}
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">
              What does {clientName} already use?
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Northstar layers on top of existing tools — nothing has to be
              replaced.
            </p>
          </div>
          <QuestionRow
            question="Do they already have a CRM?"
            value={answers.hasCrm}
            onChange={(value) =>
              setAnswers((current) => ({ ...current, hasCrm: value }))
            }
          />
          <QuestionRow
            question="Do they have a business phone provider?"
            value={answers.hasPhoneProvider}
            onChange={(value) =>
              setAnswers((current) => ({ ...current, hasPhoneProvider: value }))
            }
          />
          <QuestionRow
            question="Do they have an SMS or email sending provider?"
            value={answers.hasMessagingProvider}
            onChange={(value) =>
              setAnswers((current) => ({
                ...current,
                hasMessagingProvider: value,
              }))
            }
          />
          <QuestionRow
            question="Do they use a calendar for jobs and estimates?"
            value={answers.hasCalendar}
            onChange={(value) =>
              setAnswers((current) => ({ ...current, hasCalendar: value }))
            }
          />
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold">Recommended setup plan</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The simplest working path is highlighted for each source.
              Coming-soon paths show where setup gets even easier.
            </p>
          </div>

          {plan.sources.length === 0 ? (
            <div className="rounded-xl border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
              Go back to the first step and choose at least one lead source.
            </div>
          ) : (
            plan.sources.map((source) => (
              <div
                key={source.source}
                className="overflow-hidden rounded-xl border bg-card"
              >
                <div className="border-b bg-secondary/30 px-5 py-3.5">
                  <h3 className="text-sm font-semibold">
                    {source.sourceLabel}
                  </h3>
                  {source.note ? (
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {source.note}
                    </p>
                  ) : null}
                </div>
                <div className="divide-y">
                  {source.paths.map((path) => (
                    <div
                      key={path.path}
                      className={cn(
                        "flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-start sm:justify-between",
                        path.recommended && "bg-primary/4",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{path.label}</p>
                          {path.recommended ? (
                            <Badge variant="gold">
                              <Sparkles className="size-3" aria-hidden="true" />
                              Recommended now
                            </Badge>
                          ) : path.status === "coming_soon" ? (
                            <Badge variant="outline">Coming soon</Badge>
                          ) : path.blockedReason ? (
                            <Badge variant="outline">Not a fit</Badge>
                          ) : (
                            <Badge variant="secondary">Available</Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {path.plainDescription}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground/80">
                          {path.blockedReason ?? path.howItWorksToday}
                        </p>
                      </div>
                      {path.action ? (
                        <Button
                          asChild
                          size="sm"
                          variant={path.recommended ? "default" : "outline"}
                          className="shrink-0"
                        >
                          <Link href={`${base}${path.action.hrefSuffix}`}>
                            {path.action.label}
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}

          {plan.stackNotes.length > 0 ? (
            <div className="rounded-xl border bg-card p-5">
              <h3 className="text-sm font-semibold">About their stack</h3>
              <ul className="mt-3 space-y-2">
                {plan.stackNotes.map((note) => (
                  <li
                    key={note}
                    className="flex items-start gap-2 text-sm leading-6 text-muted-foreground"
                  >
                    <Check
                      className="mt-1 size-3.5 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="rounded-xl border border-dashed bg-secondary/30 p-5">
            <h3 className="text-sm font-semibold">Finish the setup</h3>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-muted-foreground">
              <li>Create the recommended connection(s) above.</li>
              <li>
                Enable AI Intake Routing and the Lead Response workflows in{" "}
                <Link
                  href={`${base}/workflows`}
                  className="font-medium text-primary hover:underline"
                >
                  Workflows
                </Link>
                .
              </li>
              <li>
                Send a test event to the connection endpoint and confirm the
                run appears in{" "}
                <Link
                  href={`${base}/runs`}
                  className="font-medium text-primary hover:underline"
                >
                  Runs / Logs
                </Link>
                .
              </li>
            </ol>
          </div>
        </section>
      ) : null}

      {message ? (
        <p
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            isError
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "border-emerald-200 bg-emerald-50 text-emerald-800",
          )}
        >
          {message}
        </p>
      ) : null}

      <div className="flex items-center justify-between border-t pt-4">
        <Button
          type="button"
          variant="ghost"
          disabled={step === 0}
          onClick={() => setStep((current) => Math.max(0, current - 1))}
        >
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
        {step < steps.length - 1 ? (
          <Button
            type="button"
            disabled={!canContinue}
            onClick={() => setStep((current) => current + 1)}
          >
            Continue
            <ArrowRight aria-hidden="true" />
          </Button>
        ) : canManage ? (
          <Button
            type="button"
            variant="gold"
            disabled={isPending || answers.leadSources.length === 0}
            onClick={save}
          >
            {isPending ? "Saving…" : "Save setup plan"}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Saving requires a partner operator role.
          </p>
        )}
      </div>
    </div>
  );
}
