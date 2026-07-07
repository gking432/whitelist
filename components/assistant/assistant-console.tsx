"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  ArrowUpRight,
  CalendarClock,
  Check,
  Copy,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import {
  escalateInteraction,
  resyncLatestLeadToCrm,
} from "@/app/partner/clients/[clientId]/assistant/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime, formatEnum } from "@/lib/format";
import type {
  AssistantAction,
  AssistantContextData,
} from "@/lib/assistant/context";
import { cn } from "@/lib/utils";

// The Staff Assistant Console surface. Deliberately shaped like a small
// standalone app window: everything the console renders comes from the
// serializable AssistantContextData contract, so a future desktop tray app,
// browser extension, or CRM overlay renders the same object with different
// chrome. No dashboard sprawl — one narrow, action-first column.

const urgencyStyles: Record<string, string> = {
  emergency: "border-red-200 bg-red-50 text-red-900",
  high: "border-amber-200 bg-amber-50 text-amber-900",
  medium: "border-sky-200 bg-sky-50 text-sky-800",
  low: "border-slate-200 bg-slate-50 text-slate-700",
};

const actionStateStyles: Record<string, string> = {
  works_now: "border-emerald-200 bg-emerald-50 text-emerald-800",
  dry_run: "border-sky-200 bg-sky-50 text-sky-800",
  requires_connection: "border-amber-200 bg-amber-50 text-amber-900",
  preview_only: "border-slate-200 bg-slate-100 text-slate-600",
  coming_soon: "border-slate-200 bg-slate-100 text-slate-600",
  not_in_package: "border-slate-200 bg-slate-50 text-slate-400",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </p>
  );
}

function SourceTag({ source }: { source: "ai" | "fallback" | "preview" }) {
  return (
    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
      {source === "ai"
        ? "AI"
        : source === "fallback"
          ? "Rule-based fallback"
          : "Preview"}
    </span>
  );
}

function ActionButton({
  action,
  onActivate,
  busy,
}: {
  action: AssistantAction;
  onActivate?: () => void;
  busy?: boolean;
}) {
  const chip = (
    <Badge
      variant="outline"
      className={cn("text-[10px]", actionStateStyles[action.state])}
    >
      {action.stateLabel}
    </Badge>
  );

  const body = (
    <>
      <span className="flex w-full items-center justify-between gap-2">
        <span
          className={cn(
            "text-sm font-medium",
            !action.enabled && "text-muted-foreground",
          )}
        >
          {busy ? "Working…" : action.label}
        </span>
        {chip}
      </span>
      <span className="mt-1 block text-left text-[11px] leading-4 text-muted-foreground">
        {action.detail}
      </span>
    </>
  );

  const className = cn(
    "rounded-lg border bg-background p-3 text-left transition-colors",
    action.enabled
      ? "hover:border-primary/40 hover:bg-secondary/40"
      : "opacity-80",
  );

  if (action.href && action.enabled) {
    return (
      <Link href={action.href} className={className}>
        {body}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={className}
      disabled={!action.enabled || busy}
      onClick={onActivate}
    >
      {body}
    </button>
  );
}

export function AssistantConsole({
  context,
}: {
  context: AssistantContextData;
}) {
  const [copied, setCopied] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [escalationNote, setEscalationNote] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { interaction, routing, analysis, draft } = context;
  const base = `/partner/clients/${context.clientId}`;

  const copyDraft = async () => {
    if (!draft) {
      return;
    }

    try {
      await navigator.clipboard.writeText(draft.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setActionMessage(
        "Could not access the clipboard — select and copy the draft text manually.",
      );
    }
  };

  const activate = (action: AssistantAction) => {
    if (action.key === "copy_fallback") {
      void copyDraft();
      return;
    }

    if (action.key === "escalate") {
      setEscalating((value) => !value);
      return;
    }

    if (action.key === "sync_to_crm") {
      startTransition(async () => {
        const result = await resyncLatestLeadToCrm(context.clientId);
        setActionMessage(result.message ?? null);
      });
    }
  };

  return (
    <div className="mx-auto w-full max-w-lg">
      {/* Window chrome: this is a future popup/tray app, framed as one. */}
      <div className="ns-surface-raised overflow-hidden rounded-lg border">
        <div className="flex items-center justify-between bg-sidebar px-4 py-2.5 text-white">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-brand-gold" aria-hidden="true" />
            <span className="text-sm font-semibold">Assistant</span>
            <span className="text-xs text-white/60">{context.clientName}</span>
          </div>
          <Badge
            variant="outline"
            className={
              context.mode === "live"
                ? "border-emerald-300/40 bg-emerald-400/10 text-emerald-200"
                : "border-amber-300/40 bg-amber-400/10 text-amber-200"
            }
          >
            {context.mode === "live" ? "Live data" : "Preview"}
          </Badge>
        </div>

        <div className="space-y-4 bg-card p-4">
          {context.mode === "preview" ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
              Preview — no interaction has come through this client yet. This
              sample shows what the console looks like once real leads flow.
              Nothing below is live customer data.
            </p>
          ) : null}

          {/* Active interaction */}
          {interaction ? (
            <section>
              <div className="flex items-center justify-between gap-2">
                <SectionLabel>Active interaction</SectionLabel>
                <span className="text-[11px] text-muted-foreground">
                  {interaction.receivedAt
                    ? formatDateTime(interaction.receivedAt)
                    : "Sample"}
                </span>
              </div>
              <div className="mt-1.5 rounded-lg border bg-background p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{interaction.channelLabel}</Badge>
                  {routing ? (
                    <>
                      <Badge variant="outline">
                        {formatEnum(routing.category)}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={urgencyStyles[routing.urgency] ?? ""}
                      >
                        {formatEnum(routing.urgency)} urgency
                      </Badge>
                      <Badge variant="outline">
                        {formatEnum(routing.confidence)} confidence
                      </Badge>
                    </>
                  ) : null}
                </div>
                <p className="mt-2 text-sm font-medium">
                  {interaction.contactName ?? "Unknown contact"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[interaction.contactPhone, interaction.contactEmail]
                    .filter(Boolean)
                    .join(" · ") || "No contact details captured yet"}
                </p>
                {interaction.message ? (
                  <p className="mt-2 border-l-2 border-border pl-2 text-xs leading-5 text-muted-foreground">
                    {interaction.message}
                  </p>
                ) : null}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  <span className="font-medium">CRM match:</span>{" "}
                  {context.crm.contactId
                    ? `HubSpot contact ${context.crm.contactId}`
                    : "no CRM match yet"}
                </p>
              </div>
            </section>
          ) : null}

          {/* AI read on the interaction */}
          {routing || analysis ? (
            <section>
              <div className="flex items-center justify-between">
                <SectionLabel>AI read</SectionLabel>
                {routing ? <SourceTag source={routing.source} /> : null}
              </div>
              <div className="mt-1.5 space-y-2 rounded-lg border bg-background p-3 text-sm">
                {routing?.summary ? (
                  <p className="leading-5">{routing.summary}</p>
                ) : null}
                {routing?.requiresHandoff ? (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-amber-900">
                    <TriangleAlert className="size-3.5" aria-hidden="true" />
                    Human handoff recommended
                  </p>
                ) : null}
                {analysis && analysis.missingFields.length > 0 ? (
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground">
                      Still missing
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {analysis.missingFields.map((field) => (
                        <Badge key={field} variant="outline">
                          {field}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
                {(routing?.suggestedNextAction ||
                  analysis?.recommendedNextAction) ? (
                  <div className="rounded-md bg-secondary/50 px-2.5 py-2">
                    <p className="text-[11px] font-medium text-muted-foreground">
                      Ask / do next
                    </p>
                    <p className="mt-0.5 text-xs leading-5">
                      {routing?.suggestedNextAction ||
                        analysis?.recommendedNextAction}
                    </p>
                  </div>
                ) : null}
                {routing?.recommendedOwner ? (
                  <p className="text-[11px] text-muted-foreground">
                    Routed to:{" "}
                    <span className="font-medium">
                      {formatEnum(routing.recommendedOwner)}
                    </span>
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          {/* Draft reply */}
          {draft ? (
            <section>
              <div className="flex items-center justify-between">
                <SectionLabel>
                  Draft {draft.channel.toUpperCase()}
                  {draft.to ? ` → ${draft.to}` : ""}
                </SectionLabel>
                {draft.approvalStatus ? (
                  <Badge
                    variant="outline"
                    className={
                      draft.approvalStatus === "pending"
                        ? "border-amber-200 bg-amber-50 text-amber-900"
                        : "border-slate-200 bg-slate-50 text-slate-700"
                    }
                  >
                    {formatEnum(draft.approvalStatus)}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-1.5 rounded-lg border bg-background p-3">
                {draft.subject ? (
                  <p className="text-xs font-medium">{draft.subject}</p>
                ) : null}
                <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs leading-5">
                  {draft.body}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {draft.approvalId && draft.approvalStatus === "pending" ? (
                    <Button asChild size="sm">
                      <Link href={`${base}/approvals`}>
                        Review & approve
                        <ArrowUpRight aria-hidden="true" />
                      </Link>
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copyDraft()}
                  >
                    {copied ? (
                      <>
                        <Check aria-hidden="true" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy aria-hidden="true" />
                        Copy text
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </section>
          ) : null}

          {/* Appointment slots */}
          {context.slots.length > 0 ? (
            <section>
              <SectionLabel>Suggested appointment slots</SectionLabel>
              <div className="mt-1.5 rounded-lg border bg-background p-3">
                <div className="flex flex-wrap gap-1.5">
                  {context.slots.map((slot) => (
                    <Badge key={slot.startIso} variant="outline">
                      <CalendarClock className="size-3" aria-hidden="true" />
                      {slot.label}
                    </Badge>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                  {context.slotsNote}
                </p>
              </div>
            </section>
          ) : null}

          {/* CRM status */}
          <section>
            <SectionLabel>CRM sync</SectionLabel>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              {context.crm.detail}
            </p>
          </section>

          {/* Actions */}
          <section>
            <SectionLabel>Actions</SectionLabel>
            <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {context.actions.map((action) => (
                <ActionButton
                  key={action.key}
                  action={action}
                  busy={isPending && action.key === "sync_to_crm"}
                  onActivate={() => activate(action)}
                />
              ))}
            </div>
            {escalating ? (
              <div className="mt-2 rounded-lg border bg-background p-3">
                <p className="text-xs font-medium">Escalate to a manager</p>
                <div className="mt-2 flex gap-2">
                  <Input
                    value={escalationNote}
                    onChange={(event) => setEscalationNote(event.target.value)}
                    placeholder="What should the manager know?"
                    className="h-8 text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await escalateInteraction(
                          context.clientId,
                          escalationNote,
                        );
                        setActionMessage(result.message ?? null);
                        setEscalating(false);
                        setEscalationNote("");
                      })
                    }
                  >
                    {isPending ? "Sending…" : "Escalate"}
                  </Button>
                </div>
              </div>
            ) : null}
            {actionMessage ? (
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {actionMessage}
              </p>
            ) : null}
          </section>

          {/* Recent activity */}
          {context.recentActivity.length > 0 ? (
            <section>
              <SectionLabel>Recent assistant activity</SectionLabel>
              <ul className="mt-1.5 space-y-1.5">
                {context.recentActivity.map((item, index) => (
                  <li
                    key={`${item.at}-${index}`}
                    className="flex items-baseline gap-2 text-xs leading-5"
                  >
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatDateTime(item.at)}
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium">{item.title}</span>
                      {item.detail ? (
                        <span className="text-muted-foreground">
                          {" "}
                          — {item.detail}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        {/* Runtime honesty footer */}
        <div className="border-t bg-secondary/40 px-4 py-3">
          <p className="text-[11px] leading-4 text-muted-foreground">
            <span className="font-medium text-foreground">
              You&apos;re using the web console — works now.
            </span>{" "}
            {context.packageName
              ? `Package: ${context.packageName}.`
              : "No package selected yet — actions unlock with the package."}{" "}
            Later runtimes for this same console:{" "}
            {context.runtime.futureRuntimes.join(", ").toLowerCase()}.
          </p>
          {context.soldAhead.length > 0 ? (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground hover:text-foreground">
                Sold ahead of the product ({context.soldAhead.length})
              </summary>
              <ul className="mt-1 space-y-1 text-[11px] leading-4 text-muted-foreground">
                {context.soldAhead.map((item) => (
                  <li key={item.label}>
                    <span className="font-medium">{item.label}:</span>{" "}
                    {item.note}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}
