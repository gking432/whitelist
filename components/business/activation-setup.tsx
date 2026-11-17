"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Globe,
  Mail,
  MessageCircle,
  CalendarDays,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import type {
  ActivationChoices,
  ActivationSnapshot,
} from "@/lib/activation/types";
import { buttonClass, secondaryClass } from "./record-editor";
import { OnboardingProgress } from "./onboarding-progress";

const outcomes: Record<string, string> = {
  sync_pending:
    "Account connected, but inbox monitoring could not start yet. Refresh the checks and save setup again to retry.",
  wrong_account:
    "Reconnect the same business account. Contact your operator to replace it without affecting pending customer actions.",
  connected:
    "Account connected. Your selected assistants now share this account. Check readiness below.",
  denied: "Authorization cancelled. Your previous connection was kept.",
  expired:
    "This connection attempt expired or was already used. Connect again.",
  changed: "Your setup changed while connecting. Review it and connect again.",
  permissions:
    "Some permissions were not approved. Connect again and approve inbox and calendar access.",
  sign_in_required: "Sign in as the business owner, then connect again.",
  unavailable: "Your operator needs to finish the connection setup.",
  failed:
    "The account could not be verified. Your previous connection was kept. Try connecting again.",
};
const statusCopy = {
  not_started: "Let’s get you connected",
  paused: "Team paused",
  needs_attention: "A few things still need setup",
  running: "Running · owner approval required",
};
export function ActivationSetup({
  initialSnapshot,
  outcome,
}: {
  initialSnapshot: ActivationSnapshot;
  outcome?: string;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [formRevision, setFormRevision] = useState(
    initialSnapshot.plan?.revision ?? 0,
  );
  const [refreshError, setRefreshError] = useState(false);
  const [choices, setChoices] = useState<ActivationChoices>(() => {
    const plan = initialSnapshot.plan;
    return plan
      ? {
          inquiries: plan.inquiries,
          bookings: plan.bookings,
          website: plan.website,
          email: plan.email,
          instagram: plan.instagram,
          sms: plan.sms,
          workspace_provider: plan.workspace_provider,
          booking_start_hour: plan.booking_start_hour,
          booking_end_hour: plan.booking_end_hour,
          booking_minutes: plan.booking_minutes,
          booking_weekdays: plan.booking_weekdays,
          timezone: plan.timezone,
        }
      : {
          inquiries: true,
          bookings: initialSnapshot.recommendedBookings,
          website: true,
          email: false,
          instagram: false,
          sms: false,
          workspace_provider: "google_workspace",
          booking_start_hour: 9,
          booking_end_hour: 17,
          booking_minutes: 60,
          booking_weekdays: [1, 2, 3, 4, 5],
          timezone: "America/Chicago",
        };
  });
  const [busy, setBusy] = useState(false),
    lock = useRef(false);
  const [notice, setNotice] = useState(
    outcome
      ? (outcomes[outcome] ?? "Connection returned. Check its status below.")
      : "",
  );
  const [error, setError] = useState(false);
  useEffect(() => {
    if (snapshot.plan?.status !== "active") return;
    const controller = new AbortController();
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight || lock.current || document.visibilityState !== "visible")
        return;
      inFlight = true;
      try {
        const response = await fetch("/api/business/activation", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Unavailable");
        const data = (await response.json()) as ActivationSnapshot;
        if (!controller.signal.aborted && !lock.current) {
          setSnapshot((current) =>
            !data.plan || data.plan.revision >= (current.plan?.revision ?? 0)
              ? data
              : current,
          );
          setRefreshError(false);
        }
      } catch {
        if (!controller.signal.aborted) setRefreshError(true);
      } finally {
        inFlight = false;
      }
    }, 15000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [snapshot.plan?.status]);
  const dirty =
    !snapshot.plan ||
    (Object.keys(choices) as (keyof ActivationChoices)[]).some(
      (key) =>
        JSON.stringify(choices[key]) !== JSON.stringify(snapshot.plan?.[key]),
    );
  const account = snapshot.accounts.find(
    (a) => a.provider === choices.workspace_provider,
  )!;
  async function request(input?: unknown) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    setError(false);
    try {
      const response = await fetch(
        "/api/business/activation",
        input
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(input),
            }
          : { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Setup could not be updated.");
      if (data.url) {
        window.location.assign(data.url);
        return;
      }
      const nextSnapshot = (data.snapshot ?? data) as ActivationSnapshot;
      if (
        !input &&
        nextSnapshot.plan &&
        nextSnapshot.plan.revision !== formRevision
      ) {
        setChoices(
          (current) =>
            Object.fromEntries(
              Object.keys(current).map((key) => [
                key,
                nextSnapshot.plan![key as keyof ActivationChoices],
              ]),
            ) as ActivationChoices,
        );
      }
      setFormRevision(nextSnapshot.plan?.revision ?? 0);
      setSnapshot(nextSnapshot);
      setRefreshError(false);
      setNotice(data.message ?? "Checks refreshed.");
    } catch (e) {
      setError(true);
      setNotice(
        e instanceof Error ? e.message : "Connection interrupted. Try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const setupStale = formRevision !== (snapshot.plan?.revision ?? 0);
  const disabled = busy || !snapshot.canWrite || setupStale;
  const save = (status: "active" | "paused") =>
    request({
      action: "save",
      revision: formRevision,
      status,
      ...choices,
    });
  return (
    <div className="mx-auto max-w-5xl space-y-7 p-5 sm:p-8">
      <OnboardingProgress current="activation" />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            Your customer team
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Connect once. Put your team to work.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Choose the work you need help with. Your assistants share customer
            records and hand bookings to the scheduling assistant.
          </p>
        </div>
        <Link href="/client/mobile" className={secondaryClass}>
          My approvals <ArrowRight className="size-4" />
        </Link>
      </header>
      <p className="rounded-xl border p-4 text-sm leading-6">Review your <Link href="/client/onboarding" className="font-medium underline">business facts and channel authority</Link> before enabling customer work. Account access and action permission are checked separately.</p>
      {notice ? (
        <p
          role={error ? "alert" : "status"}
          className={`rounded-xl border p-4 text-sm ${error ? "border-red-200 bg-red-50 text-red-900" : "bg-secondary"}`}
        >
          {notice}
        </p>
      ) : null}
      {setupStale ? (
        <p role="status" className="rounded-xl border p-4 text-sm">
          Setup changed in another session. Refresh the checks below to load
          those settings before editing.
        </p>
      ) : null}
      {!snapshot.canWrite ? (
        <p className="rounded-xl border p-4 text-sm">
          You have read-only access to this setup.
        </p>
      ) : null}
      <section className="rounded-2xl border bg-card p-5 sm:p-6">
        <h2 className="font-semibold">1. What should your team help with?</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            {
              key: "inquiries",
              title: "Answer inquiries & care for customers",
              detail:
                "Prepare replies using your services, policies and customer history.",
              icon: MessageCircle,
            },
            {
              key: "bookings",
              title: "Help customers book appointments",
              detail:
                "Check your calendar, offer open times and ask you to approve the booking.",
              icon: CalendarDays,
            },
          ].map(({ key, title, detail, icon: Icon }) => (
            <label
              key={key}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${choices[key as "inquiries" | "bookings"] ? "border-primary bg-primary/5" : ""}`}
            >
              <input
                type="checkbox"
                className="mt-1 size-4 accent-primary"
                disabled={disabled}
                checked={choices[key as "inquiries" | "bookings"]}
                onChange={(e) =>
                  setChoices({ ...choices, [key]: e.target.checked })
                }
              />
              <div>
                <Icon className="mb-3 size-5 text-primary" />
                <span className="text-sm font-semibold">{title}</span>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {detail}
                </p>
              </div>
            </label>
          ))}
        </div>
        {choices.bookings ? (
          <fieldset className="mt-5 rounded-xl bg-secondary/50 p-4">
            <legend className="text-sm font-semibold">
              Confirm your booking hours
            </legend>
            <div className="grid gap-3 sm:grid-cols-4">
              {(
                [
                  { key: "booking_start_hour", label: "From", max: 23, min: 0 },
                  { key: "booking_end_hour", label: "Until", max: 24, min: 1 },
                  {
                    key: "booking_minutes",
                    label: "Appointment minutes",
                    max: 480,
                    min: 15,
                  },
                ] as const
              ).map(({ key, label, min, max }) => (
                <label key={key} className="text-xs font-medium">
                  {label}
                  <input
                    type="number"
                    min={min}
                    max={max}
                    disabled={disabled}
                    className="mt-2 min-h-11 w-full rounded-lg border bg-background px-3"
                    value={choices[key]}
                    onChange={(e) =>
                      setChoices({ ...choices, [key]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
              <label className="text-xs font-medium">
                Timezone
                <input
                  disabled={disabled}
                  className="mt-2 min-h-11 w-full rounded-lg border bg-background px-3"
                  value={choices.timezone}
                  onChange={(e) =>
                    setChoices({ ...choices, timezone: e.target.value })
                  }
                  list="booking-timezones"
                />
                <datalist id="booking-timezones">
                  {[
                    "America/New_York",
                    "America/Chicago",
                    "America/Denver",
                    "America/Los_Angeles",
                    "Europe/London",
                    "UTC",
                  ].map((zone) => (
                    <option key={zone} value={zone} />
                  ))}
                </datalist>
              </label>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Hours use the 24-hour clock. Uses your primary calendar; busy
              events are excluded.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                (day, index) => (
                  <label
                    key={day}
                    className="flex min-h-10 items-center gap-2 text-xs"
                  >
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={choices.booking_weekdays.includes(index)}
                      onChange={(e) =>
                        setChoices({
                          ...choices,
                          booking_weekdays: e.target.checked
                            ? [...choices.booking_weekdays, index].sort()
                            : choices.booking_weekdays.filter(
                                (d) => d !== index,
                              ),
                        })
                      }
                    />
                    {day}
                  </label>
                ),
              )}
            </div>
          </fieldset>
        ) : null}
        <h3 className="mt-6 text-sm font-semibold">
          Where do customers reach you?
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          {(
            [
              {
                key: "website",
                label: "Website chat",
                detail: "Chat link + website embed",
                icon: Globe,
              },
              {
                key: "email",
                label: "Email",
                detail: "Google or Microsoft",
                icon: Mail,
              },
              {
                key: "instagram",
                label: "Instagram",
                detail: "Assisted setup",
                icon: MessageCircle,
              },
              {
                key: "sms",
                label: "Text messages",
                detail: "Assisted setup",
                icon: MessageCircle,
              },
            ] as const
          ).map(({ key, label, detail, icon: Icon }) => (
            <label
              key={key}
              className={`cursor-pointer rounded-xl border p-4 ${choices[key] ? "border-primary bg-primary/5" : ""}`}
            >
              <div className="flex items-center justify-between">
                <Icon className="size-4 text-primary" />
                <input
                  className="size-4 accent-primary"
                  type="checkbox"
                  disabled={disabled}
                  checked={choices[key]}
                  onChange={(e) =>
                    setChoices({ ...choices, [key]: e.target.checked })
                  }
                />
              </div>
              <p className="mt-3 text-sm font-semibold">{label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
            </label>
          ))}
        </div>
        {choices.email || choices.bookings ? (
          <fieldset className="mt-5">
            <legend className="text-sm font-semibold">
              Your business account
            </legend>
            <div className="mt-3 flex flex-wrap gap-3">
              {snapshot.accounts.map((a) => (
                <label
                  key={a.provider}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-3 text-sm"
                >
                  <input
                    type="radio"
                    name="workspace"
                    disabled={disabled}
                    checked={choices.workspace_provider === a.provider}
                    onChange={() =>
                      setChoices({ ...choices, workspace_provider: a.provider })
                    }
                  />
                  {a.name}
                  {a.connected ? " · connected" : ""}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              One authorization gives the team email, calendar and contacts
              access. No separate account for each assistant.
            </p>
          </fieldset>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            className={buttonClass}
            disabled={disabled}
            onClick={() => void save("active")}
          >
            {busy
              ? "Working…"
              : snapshot.plan
                ? "Save & enable assistants"
                : "Enable selected assistants"}
            <ArrowRight className="size-4" />
          </button>
          {snapshot.plan?.status === "active" ? (
            <button
              className={secondaryClass}
              disabled={disabled || dirty}
              onClick={() => void save("paused")}
            >
              Pause team
            </button>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Outgoing replies and bookings require your approval.
          </p>
        </div>
      </section>
      {snapshot.plan ? (
        <section className="rounded-2xl border bg-card p-5 sm:p-6">
          <h2 className="font-semibold">2. Connect your accounts</h2>
          {snapshot.plan.email || snapshot.plan.bookings ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4">
              <div>
                <h3 className="text-sm font-semibold">
                  {account.name} ·{" "}
                  {snapshot.plan.email && snapshot.plan.bookings
                    ? "Email & calendar"
                    : snapshot.plan.email
                      ? "Email"
                      : "Calendar"}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {snapshot.workspaceAccount ??
                    "Sign in, choose the business account and approve access."}
                </p>
                {!account.available ? (
                  <p className="mt-2 text-xs text-amber-800">
                    Your operator is preparing this connection. You won’t need
                    API keys or developer settings.
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className={buttonClass}
                  disabled={
                    disabled ||
                    dirty ||
                    !account.available ||
                    snapshot.plan.status !== "active"
                  }
                  onClick={() => void request({ action: "connect" })}
                >
                  {snapshot.workspaceAccount ? "Reconnect" : "Connect"}{" "}
                  {account.name}
                  <ArrowRight className="size-4" />
                </button>
                {snapshot.workspaceAccount ? (
                  <button
                    className={secondaryClass}
                    disabled={disabled || dirty}
                    onClick={() => void request({ action: "check" })}
                  >
                    Check access
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {snapshot.plan.website && snapshot.widgetUrl ? (
            <div className="mt-4 rounded-xl border p-4">
              <h3 className="text-sm font-semibold">Website chat</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Add this chat to your site, or share the chat link directly.
                Website installation still needs your site editor.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={snapshot.widgetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={secondaryClass}
                >
                  Open chat <ArrowRight className="size-4" />
                </a>
                <button
                  className={secondaryClass}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(snapshot.widgetUrl!);
                      setNotice("Chat link copied.");
                      setError(false);
                    } catch {
                      setNotice("Copy the link from the website code below.");
                    }
                  }}
                >
                  Copy chat link
                </button>
              </div>
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Website embed code
                </summary>
                <pre className="mt-3 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-secondary p-3 text-xs">
                  {snapshot.widgetSnippet}
                </pre>
              </details>
            </div>
          ) : null}
          {snapshot.plan.instagram || snapshot.plan.sms ? (
            <div className="mt-4 rounded-xl border p-4">
              <h3 className="text-sm font-semibold">
                Instagram & texting setup
              </h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                These channels need operator setup and a real message test.
                Texting can also require a business number and registration.
                They stay marked as needing setup until verified.
              </p>
              <Link href="/client/support" className={`${secondaryClass} mt-3`}>
                Request connection setup <ArrowRight className="size-4" />
              </Link>
            </div>
          ) : null}
          {dirty ? (
            <p className="mt-3 text-sm text-amber-800">
              Save your changes before connecting.
            </p>
          ) : null}
        </section>
      ) : null}
      <section className="rounded-2xl border bg-card p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Readiness
            </p>
            <h2 className="mt-1 font-semibold">
              {refreshError
                ? "Connection checks unavailable — refresh to retry"
                : statusCopy[snapshot.status]}
            </h2>
          </div>
          <button
            className={secondaryClass}
            disabled={busy}
            onClick={() => void request()}
            aria-label="Refresh connection checks"
          >
            <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
          </button>
        </div>
        {snapshot.checks.length ? (
          <ul className="mt-4 divide-y">
            {snapshot.checks.map((check) => (
              <li key={check.key} className="flex items-start gap-3 py-4">
                {check.ready ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                ) : (
                  <Clock3 className="mt-0.5 size-5 shrink-0 text-amber-600" />
                )}
                <div>
                  <p className="text-sm font-medium">{check.label}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {check.detail}
                  </p>
                  {check.key === "knowledge" && !check.ready ? (
                    <Link
                      className="mt-2 inline-block text-sm text-primary underline"
                      href="/client/business/business"
                    >
                      Add business details
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Enable your selection to see the exact next steps.
          </p>
        )}
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-secondary p-4 text-xs leading-5 text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0" />
          Checks confirm configuration and access. Your first approved reply or
          booking confirms real delivery. You can review every proposed action
          from your phone.
        </p>
      </section>
    </div>
  );
}
