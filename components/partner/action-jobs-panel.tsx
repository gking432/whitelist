"use client";

import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";

import { retryActionJob } from "@/app/partner/clients/[clientId]/runs/actions";
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
  pending: "border-amber-200 bg-amber-50 text-amber-900",
  cancelled: "border-slate-200 bg-slate-50 text-slate-500",
};

export function ActionJobsPanel({
  clientId,
  jobs,
  canRetry,
}: {
  clientId: string;
  jobs: ActionJobView[];
  canRetry: boolean;
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
            ) : null}
            {messages[job.id] ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {messages[job.id]}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
