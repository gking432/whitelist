"use client";

import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";

import {
  reconcileActionJob,
  retryActionJob,
} from "@/app/partner/clients/[clientId]/runs/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatEnum } from "@/lib/format";
import { cn } from "@/lib/utils";

// Durable outbound actions (deliveries, bookings, syncs) with honest status.
// Retry remains available only in workspaces allowed to operate customer actions.

export type ActionJobView = {
  id: string;
  kind: string;
  status: string;
  attempt_count: number;
  outcome_detail?: string | null;
  last_error: string | null;
  last_attempt_at: string | null;
  created_at: string;
  retryable: boolean;
};

const KIND_LABELS: Record<string, string> = {
  "sms.send": "SMS delivery",
  "email.send": "Email delivery",
  "calendar.book": "Calendar booking",
  "crm.sync": "CRM sync",
};

const statusStyles: Record<string, string> = {
  succeeded: "border-emerald-200 bg-emerald-50 text-emerald-800",
  dry_run: "border-sky-200 bg-sky-50 text-sky-800",
  skipped: "border-slate-200 bg-slate-50 text-slate-700",
  failed: "border-red-200 bg-red-50 text-red-900",
  processing: "border-amber-200 bg-amber-50 text-amber-900",
  uncertain: "border-red-200 bg-red-50 text-red-900",
  pending: "border-amber-200 bg-amber-50 text-amber-900",
  cancelled: "border-slate-200 bg-slate-50 text-slate-500",
};

export function ActionJobsPanel({
  clientId,
  jobs,
  canRetry,
  canReconcile = false,
}: {
  clientId: string;
  jobs: ActionJobView[];
  canRetry: boolean;
  canReconcile?: boolean;
}) {
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (jobs.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border bg-card">
      <div className="border-b px-5 py-4">
        <h3 className="font-semibold">Outbound actions</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {canRetry
            ? "Every delivery, booking, and sync attempt, with retry for actions that did not go through."
            : "Every delivery, booking, and sync attempt. This troubleshooting view is read-only; the client controls customer-facing actions."}
        </p>
      </div>
      <ul className="divide-y">
        {jobs.map((job) => (
          <li key={job.id} className="px-5 py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {KIND_LABELS[job.kind] ?? job.kind}
                </span>
                <Badge
                  variant="outline"
                  className={cn(statusStyles[job.status])}
                >
                  {formatEnum(job.status)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Attempt {job.attempt_count} ·{" "}
                  {formatDateTime(job.last_attempt_at ?? job.created_at)}
                </span>
              </div>
              {canRetry && job.retryable ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => {
                    setPendingId(job.id);
                    startTransition(async () => {
                      const result = await retryActionJob(clientId, job.id);
                      setMessages((previous) => ({
                        ...previous,
                        [job.id]: result.message ?? "",
                      }));
                      setPendingId(null);
                    });
                  }}
                >
                  <RotateCcw aria-hidden="true" />
                  {isPending && pendingId === job.id ? "Retrying…" : "Retry"}
                </Button>
              ) : null}
            </div>
            {job.last_error ? (
              <p className="mt-1 text-xs leading-5 text-destructive">
                {job.last_error}
              </p>
            ) : job.outcome_detail ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {job.outcome_detail}
              </p>
            ) : null}
            {messages[job.id] ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {messages[job.id]}
              </p>
            ) : null}
            {job.status === "uncertain" ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                <p>
                  Delivery is unconfirmed. Check the connected provider before
                  taking any further action.
                </p>
                {canReconcile ? (
                  <form
                    className="mt-3 space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      setPendingId(job.id);
                      startTransition(async () => {
                        const result = await reconcileActionJob(
                          clientId,
                          job.id,
                          String(form.get("outcome") ?? ""),
                          String(form.get("evidence") ?? ""),
                        );
                        setMessages((previous) => ({
                          ...previous,
                          [job.id]: result.message ?? "",
                        }));
                        setPendingId(null);
                      });
                    }}
                  >
                    <label className="block">
                      Confirmed provider result
                      <select
                        name="outcome"
                        required
                        defaultValue=""
                        className="mt-1 block w-full rounded border bg-white p-2"
                      >
                        <option value="" disabled>
                          Select after checking the provider
                        </option>
                        <option value="succeeded">
                          Provider confirms it completed
                        </option>
                        <option value="cancelled">
                          Provider confirms it did not complete; close this
                          attempt
                        </option>
                      </select>
                    </label>
                    <label className="block">
                      Evidence from the provider
                      <textarea
                        name="evidence"
                        required
                        minLength={20}
                        maxLength={1000}
                        rows={2}
                        placeholder="Reference number, time checked, and what the provider confirmed. Do not include passwords or customer details."
                        className="mt-1 block w-full rounded border bg-white p-2"
                      />
                    </label>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      type="submit"
                    >
                      {isPending && pendingId === job.id
                        ? "Saving…"
                        : "Record result without resending"}
                    </Button>
                  </form>
                ) : (
                  <p className="mt-2">
                    The business owner can record the confirmed result here.
                  </p>
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
